"""Brain Memory provider for Hermes Agent.

Backs Hermes Agent's pluggable memory slot with Brain Memory — a local-first,
human-readable Markdown memory store (`~/.brain/`) shared across Hermes,
Claude Code, Gemini CLI, Codex, OpenCode, and OpenClaw.

Design principle: the MODEL decides what to remember (via the `brain_memorize`
tool plus injected guidance); this provider handles the plumbing
deterministically through the `brain` CLI. No mechanical transcript dumping.

All `brain` CLI calls go through subprocess with list argv (never shell=True),
bounded timeouts, and graceful degradation — if the binary is missing or
errors, we log once and return empty blocks. This provider never raises into
the agent loop.

Requires: Python 3.10+, stdlib only. The `brain` CLI comes from the
`brain-memory` npm package.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    # In-tree / installed alongside hermes-agent.
    from agent.memory_provider import MemoryProvider  # type: ignore
except ImportError:  # pragma: no cover - exercised implicitly in tests
    # Standalone shim so the provider is importable outside the hermes-agent
    # source tree (tests, external tooling). Mirrors the fetched ABC surface
    # of hermes-agent's agent/memory_provider.py (verified 2026-07).
    class MemoryProvider:  # type: ignore
        """Minimal structural stand-in for agent.memory_provider.MemoryProvider."""

        @property
        def name(self) -> str:
            raise NotImplementedError

        def is_available(self) -> bool:
            raise NotImplementedError

        def initialize(self, session_id: str, **kwargs) -> None:
            raise NotImplementedError

        def system_prompt_block(self) -> str:
            return ""

        def prefetch(self, query: str, *, session_id: str = "") -> str:
            return ""

        def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
            pass

        def sync_turn(
            self,
            user_content: str,
            assistant_content: str,
            *,
            session_id: str = "",
            messages: Optional[List[Dict[str, Any]]] = None,
        ) -> None:
            pass

        def get_tool_schemas(self) -> List[Dict[str, Any]]:
            return []

        def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
            raise NotImplementedError

        def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
            pass

        def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
            pass

        def on_session_switch(
            self,
            new_session_id: str,
            *,
            parent_session_id: str = "",
            reset: bool = False,
            rewound: bool = False,
            **kwargs,
        ) -> None:
            pass

        def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
            return ""

        def on_delegation(self, task: str, result: str, *, child_session_id: str = "", **kwargs) -> None:
            pass

        def get_config_schema(self) -> List[Dict[str, Any]]:
            return []

        def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
            pass

        def on_memory_write(
            self,
            action: str,
            target: str,
            content: str,
            metadata: Optional[Dict[str, Any]] = None,
        ) -> None:
            pass

        def backup_paths(self) -> List[str]:
            return []

        def shutdown(self) -> None:
            pass


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

VALID_MEMORY_TYPES = frozenset(
    {
        "decision",
        "insight",
        "goal",
        "experience",
        "learning",
        "relationship",
        "preference",
        "observation",
    }
)

VALID_COGNITIVE_TYPES = frozenset({"episodic", "semantic", "procedural"})

# Whitelisted keys forwarded to `brain memorize` stdin (matches bin/memorize.js).
_MEMORY_FIELDS = frozenset(
    {
        "title",
        "type",
        "path",
        "content",
        "cognitive_type",
        "salience",
        "confidence",
        "strength_adjustment",
        "tags",
        "related",
        "source",
        "encoding_context",
        "pinned",
        "pin_scope",
        "pin_priority",
        "stable",
    }
)

SUBPROCESS_TIMEOUT = 15  # seconds, per task contract
PREFETCH_JOIN_TIMEOUT = 1.5  # seconds — mirrors the mem0 provider's pattern
CHARS_PER_TOKEN = 4  # coarse estimate used for budget bounding
DEFAULT_BUDGET_TOKENS = 1600
MAX_RECALL_BODY_CHARS = 600
MAX_PREFETCH_CHARS = 1400
_MIRROR_MIN_CONTENT = 20
_MIRROR_MAX_HASHES = 500

DEFAULTS: Dict[str, Any] = {
    "project": "hermes",
    "top_recall": 6,
    "auto_reinforce": True,
    "brain_bin": "brain",
    "sync_on_memorize": False,
}

_STOPWORDS = frozenset(
    """the and for with that this from have will your about their there would could
    should which when what where while these those been being because between
    please thanks thank hello okay right just really actually maybe might""".split()
)

# Memorize guidance injected into the system prompt. Ported from the Brain
# Memory prompt contract (prompts/claude.md), personal-assistant flavored:
# memories span life domains, not just coding sessions.
GUIDANCE_BLOCK = """\
### How to use your memory
You have persistent, cross-session memory via the brain_* tools. YOU decide \
what is worth remembering — never dump transcripts or store mechanically.
- **brain_recall** — before answering anything that depends on the user's \
history, people, preferences, projects, or past decisions, recall first. \
Reinforcement of used memories is automatic.
- **brain_memorize** — store a memory when the session produces durable \
value. Types: decision (choice + rationale), insight (deep realization), \
goal (objective), experience (notable event, trip, incident, milestone), \
learning (new knowledge), relationship (people and how entities connect), \
preference (the user's tastes, style, conventions), observation (casual fact).
- File memories under life domains: professional/, personal/, social/, \
family/ — kebab-case subpaths, e.g. personal/health/sleep-routine.md or \
professional/projects/acme/launch-decision.md.
- Cognitive type: episodic (event-specific), semantic (abstracted \
knowledge), procedural (skills/workflows).
- Prefer a few high-value memories over many noisy ones. Never store \
secrets, credentials, or trivia. When the session wraps up, consider \
whether notable decisions, learnings, or preferences remain unstored."""

PRE_COMPRESS_REMINDER = (
    "[brain memory] Context is about to be compressed and older messages will be "
    "discarded. If this session produced notable decisions, learnings, insights, "
    "experiences, goals, or preferences that are NOT yet stored, call the "
    "brain_memorize tool now to preserve them before the details are lost."
)


# --------------------------------------------------------------------------
# Module helpers
# --------------------------------------------------------------------------


def brain_dir() -> Path:
    """The Brain Memory store directory.

    Respects a BRAIN_DIR override (used by tests and non-standard installs),
    else ``~/.brain``.
    """
    override = os.environ.get("BRAIN_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".brain"


def validate_relative_path(p: Any) -> Optional[str]:
    """Validate a memory path relative to ~/.brain. Returns an error string or None.

    Rejects absolute paths, drive letters, backslashes, `~`, and any `.`/`..`
    segments (path traversal).
    """
    if not isinstance(p, str) or not p.strip():
        return "path is required and must be a non-empty string"
    q = p.strip()
    if q.startswith(("/", "~")) or re.match(r"^[A-Za-z]:[\\/]", q):
        return "path must be relative to ~/.brain (no absolute paths)"
    if "\\" in q:
        return "path must use forward slashes"
    segments = q.split("/")
    if any(seg in ("", ".", "..") for seg in segments):
        return "path must not contain empty, '.' or '..' segments"
    if not q.endswith(".md"):
        return "path must end with .md"
    return None


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:48]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _strip_frontmatter(text: str) -> str:
    """Strip a leading YAML frontmatter block from a memory file body."""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4 :].lstrip("\n")
    return text


def _coerce_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    if value is None:
        return default
    return bool(value)


def _extract_ids(obj: Any, acc: Optional[List[str]] = None) -> List[str]:
    """Recursively collect string values under an ``id`` key from CLI output."""
    if acc is None:
        acc = []
    if isinstance(obj, dict):
        val = obj.get("id")
        if isinstance(val, str) and val:
            acc.append(val)
        for v in obj.values():
            _extract_ids(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _extract_ids(v, acc)
    return acc


def append_context_entry(entry: Dict[str, Any], directory: Optional[Path] = None, keep: int = 20) -> None:
    """Append a session entry to ``<brain_dir>/contexts.json`` keeping the last ``keep``.

    Tolerates both container shapes: a bare JSON array, or an object with a
    ``sessions`` array.
    # VERIFY: the brain contract shows the per-entry schema but not the
    # container; a bare array is used by default and both shapes are preserved.
    """
    directory = directory or brain_dir()
    path = directory / "contexts.json"
    container: Any = []
    if path.exists():
        try:
            container = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            container = []
    if isinstance(container, dict) and isinstance(container.get("sessions"), list):
        container["sessions"].append(entry)
        container["sessions"] = container["sessions"][-keep:]
        payload = container
    else:
        entries = container if isinstance(container, list) else []
        entries.append(entry)
        payload = entries[-keep:]
    directory.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def validate_memories(raw: Any) -> Dict[str, Any]:
    """Validate a memorize payload. Returns {"memories": [...]} or {"error": "..."}."""
    if isinstance(raw, dict):
        raw = raw.get("memories")
    if not isinstance(raw, list) or not raw:
        return {"error": "expected a non-empty 'memories' array"}
    cleaned: List[Dict[str, Any]] = []
    for i, mem in enumerate(raw):
        label = f"memories[{i}]"
        if not isinstance(mem, dict):
            return {"error": f"{label}: each memory must be an object"}
        for field in ("title", "type", "path", "content"):
            value = mem.get(field)
            if not isinstance(value, str) or not value.strip():
                return {"error": f"{label}: '{field}' is required and must be a non-empty string"}
        if mem["type"] not in VALID_MEMORY_TYPES:
            return {
                "error": f"{label}: invalid type '{mem['type']}' — must be one of "
                + ", ".join(sorted(VALID_MEMORY_TYPES))
            }
        path_err = validate_relative_path(mem["path"])
        if path_err:
            return {"error": f"{label}: {path_err}"}
        cog = mem.get("cognitive_type")
        if cog is not None and cog not in VALID_COGNITIVE_TYPES:
            return {
                "error": f"{label}: invalid cognitive_type '{cog}' — must be one of "
                + ", ".join(sorted(VALID_COGNITIVE_TYPES))
            }
        for score_field in ("salience", "confidence"):
            val = mem.get(score_field)
            if val is not None:
                if not isinstance(val, (int, float)) or not (0.0 <= float(val) <= 1.0):
                    return {"error": f"{label}: '{score_field}' must be a number between 0.0 and 1.0"}
        for list_field in ("tags", "related"):
            val = mem.get(list_field)
            if val is not None and (
                not isinstance(val, list) or not all(isinstance(x, str) for x in val)
            ):
                return {"error": f"{label}: '{list_field}' must be an array of strings"}
        cleaned.append({k: v for k, v in mem.items() if k in _MEMORY_FIELDS})
    return {"memories": cleaned}


# --------------------------------------------------------------------------
# Provider
# --------------------------------------------------------------------------


class BrainMemoryProvider(MemoryProvider):
    """Hermes Agent memory provider backed by the Brain Memory CLI."""

    def __init__(self) -> None:
        self._config: Dict[str, Any] = dict(DEFAULTS)
        self._config.update(self._env_overrides())
        self._session_id = ""
        self._hermes_home = ""
        self._session_started_at = ""
        self._index_present = False
        self._warned_unavailable = False

        # Session bookkeeping fed into ~/.brain/contexts.json at session end.
        self._state_lock = threading.Lock()
        self._recalled_ids: List[str] = []
        self._created_ids: List[str] = []
        self._topics: List[str] = []
        self._context_saved = False

        # Prefetch cache (per-turn), mirrors the mem0 provider threading pattern.
        self._prefetch_lock = threading.Lock()
        self._prefetch_thread: Optional[threading.Thread] = None
        self._prefetch_query = ""
        self._prefetch_result = ""

        # MEMORY.md mirroring.
        self._mirror_thread: Optional[threading.Thread] = None
        self._mirror_hashes: Optional[List[str]] = None

    # -- config ------------------------------------------------------------

    @staticmethod
    def _env_overrides() -> Dict[str, Any]:
        env = os.environ
        out: Dict[str, Any] = {}
        if env.get("BRAIN_PROJECT"):
            out["project"] = env["BRAIN_PROJECT"]
        if env.get("BRAIN_BIN"):
            out["brain_bin"] = env["BRAIN_BIN"]
        if env.get("BRAIN_TOP_RECALL"):
            out["top_recall"] = _coerce_int(env["BRAIN_TOP_RECALL"], DEFAULTS["top_recall"], 1, 25)
        if env.get("BRAIN_AUTO_REINFORCE") is not None and env.get("BRAIN_AUTO_REINFORCE") != "":
            out["auto_reinforce"] = _coerce_bool(env["BRAIN_AUTO_REINFORCE"], True)
        if env.get("BRAIN_SYNC_ON_MEMORIZE"):
            out["sync_on_memorize"] = _coerce_bool(env["BRAIN_SYNC_ON_MEMORIZE"], False)
        return out

    def _load_config(self, hermes_home: str) -> None:
        """Defaults < env vars < $HERMES_HOME/brain.json (mem0-style precedence)."""
        cfg = dict(DEFAULTS)
        cfg.update(self._env_overrides())
        if hermes_home:
            path = Path(hermes_home) / "brain.json"
            try:
                if path.exists():
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        for key in DEFAULTS:
                            if key in data and data[key] is not None:
                                cfg[key] = data[key]
            except (ValueError, OSError) as exc:
                logger.warning("brain: could not read %s: %s", path, exc)
        cfg["top_recall"] = _coerce_int(cfg.get("top_recall"), DEFAULTS["top_recall"], 1, 25)
        cfg["auto_reinforce"] = _coerce_bool(cfg.get("auto_reinforce"), True)
        cfg["sync_on_memorize"] = _coerce_bool(cfg.get("sync_on_memorize"), False)
        if not isinstance(cfg.get("project"), str) or not cfg["project"].strip():
            cfg["project"] = DEFAULTS["project"]
        if not isinstance(cfg.get("brain_bin"), str) or not cfg["brain_bin"].strip():
            cfg["brain_bin"] = DEFAULTS["brain_bin"]
        self._config = cfg

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "project",
                "description": "Project label recorded on new memories and used for context-dependent recall",
                "default": "hermes",
                "required": False,
                "env_var": "BRAIN_PROJECT",
            },
            {
                "key": "top_recall",
                "description": "Maximum memories returned per recall (1-25)",
                "default": 6,
                "required": False,
                "env_var": "BRAIN_TOP_RECALL",
            },
            {
                "key": "auto_reinforce",
                "description": "Automatically apply spaced reinforcement to memories surfaced by brain_recall",
                "default": True,
                "required": False,
                "env_var": "BRAIN_AUTO_REINFORCE",
            },
            {
                "key": "brain_bin",
                "description": "Path to the brain CLI binary (from the brain-memory npm package)",
                "default": "brain",
                "required": False,
                "env_var": "BRAIN_BIN",
            },
            {
                "key": "sync_on_memorize",
                "description": "Pass --sync to brain memorize so each store pushes to Brain Cloud / the Git remote",
                "default": False,
                "required": False,
                "env_var": "BRAIN_SYNC_ON_MEMORIZE",
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        if not hermes_home:
            return
        path = Path(hermes_home) / "brain.json"
        merged = {k: v for k, v in values.items() if k in DEFAULTS}
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(merged, indent=2), encoding="utf-8")
            os.replace(tmp, path)
            os.chmod(path, 0o600)
        except OSError as exc:
            logger.warning("brain: could not write %s: %s", path, exc)

    # -- identity / availability -------------------------------------------

    @property
    def name(self) -> str:
        return "brain"

    def is_available(self) -> bool:
        """True when the `brain` CLI is resolvable. No network calls."""
        bin_name = str(self._config.get("brain_bin") or "brain")
        if os.sep in bin_name:
            return os.path.isfile(os.path.expanduser(bin_name))
        return shutil.which(bin_name) is not None

    def initialize(self, session_id: str, **kwargs) -> None:
        self._session_id = session_id or ""
        self._session_started_at = _now_iso()
        hermes_home = str(kwargs.get("hermes_home") or "")
        self._hermes_home = hermes_home
        self._load_config(hermes_home)
        self._index_present = (brain_dir() / "index.json").exists()
        if not self.is_available():
            self._warn_once("brain CLI not found — install with: npm install -g brain-memory")
        elif not self._index_present:
            logger.info(
                "brain: %s/index.json not found — the store will be empty until "
                "brain-memory is initialized",
                brain_dir(),
            )

    def _warn_once(self, message: str) -> None:
        if not self._warned_unavailable:
            self._warned_unavailable = True
            logger.warning("brain: %s", message)

    # -- subprocess plumbing -------------------------------------------------

    def _run_brain(
        self,
        args: List[str],
        input_text: Optional[str] = None,
        timeout: int = SUBPROCESS_TIMEOUT,
    ) -> Optional[str]:
        """Run the brain CLI. Returns stdout on success, None on any failure."""
        argv = [str(self._config.get("brain_bin") or "brain")] + [str(a) for a in args]
        env = dict(os.environ)
        env["BRAIN_AGENT"] = "hermes"
        try:
            proc = subprocess.run(
                argv,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        except FileNotFoundError:
            self._warn_once("brain CLI not found — install with: npm install -g brain-memory")
            return None
        except subprocess.TimeoutExpired:
            logger.warning("brain: '%s' timed out after %ss", " ".join(argv[:2]), timeout)
            return None
        except OSError as exc:
            self._warn_once(f"brain CLI failed to start: {exc}")
            return None
        if proc.returncode != 0:
            logger.debug(
                "brain: '%s' exited %s: %s",
                " ".join(argv[:2]),
                proc.returncode,
                (proc.stderr or "").strip()[:300],
            )
            return None
        return proc.stdout

    def _run_brain_json(self, args: List[str], input_text: Optional[str] = None) -> Optional[Any]:
        out = self._run_brain(args, input_text=input_text)
        if out is None:
            return None
        try:
            return json.loads(out)
        except ValueError:
            logger.debug("brain: non-JSON output from %s", args[:1])
            return None

    # -- system prompt -------------------------------------------------------

    def system_prompt_block(self) -> str:
        """Session-start context: status line, pinned facts, skills, relevant
        memory titles, and memorize guidance — bounded by the aggregator's
        token budget."""
        if not self.is_available():
            return ""
        payload = self._run_brain_json(
            ["session-start", "--project", str(self._config["project"])]
        )
        if not isinstance(payload, dict):
            return ""
        return self._format_session_start(payload)

    def _format_session_start(self, payload: Dict[str, Any]) -> str:
        memory_count = payload.get("memory_count") or 0
        pinned = payload.get("pinned") or []
        skills = payload.get("skills_index") or []
        recall = payload.get("context_recall") or []
        due = payload.get("due_for_review") or 0
        low_conf = payload.get("low_confidence_alerts") or []

        budget = payload.get("budget")
        max_tokens = DEFAULT_BUDGET_TOKENS
        if isinstance(budget, dict):
            for key in ("max_tokens", "limit", "tokens", "budget"):
                if isinstance(budget.get(key), (int, float)) and budget[key] > 0:
                    max_tokens = int(budget[key])
                    break
        elif isinstance(budget, (int, float)) and budget > 0:
            max_tokens = int(budget)
        budget_chars = max(400, max_tokens * CHARS_PER_TOKEN)

        header_lines = [
            "## Brain Memory (persistent, cross-agent)",
            "",
            f"◉ Brain active — {memory_count} memories ({len(recall)} in project context)",
        ]
        if isinstance(due, (int, float)) and due > 0:
            header_lines.append(f"📋 {int(due)} memories due for review")
        if isinstance(low_conf, list) and low_conf:
            header_lines.append(
                f"⚠️ {len(low_conf)} low-confidence memories used frequently — verify before relying on them"
            )
        essential = "\n".join(header_lines) + "\n\n" + GUIDANCE_BLOCK

        sections: List[str] = []
        remaining = budget_chars - len(essential)

        def _add_section(title: str, lines: List[str]) -> None:
            nonlocal remaining
            if remaining <= 0 or not lines:
                return
            block_lines = [f"### {title}"]
            used = len(block_lines[0]) + 2
            for line in lines:
                if used + len(line) + 1 > remaining:
                    break
                block_lines.append(line)
                used += len(line) + 1
            if len(block_lines) > 1:
                sections.append("\n".join(block_lines))
                remaining -= used

        pinned_lines = []
        for item in pinned:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            content = " ".join(str(item.get("content") or "").split())
            if len(content) > 220:
                content = content[:217] + "..."
            pinned_lines.append(f"- **{title}** — {content}" if content else f"- **{title}**")
        _add_section("Pinned (always apply)", pinned_lines)

        skill_lines = []
        for item in skills:
            if not isinstance(item, dict):
                continue
            desc = " ".join(str(item.get("description") or "").split())
            if len(desc) > 110:
                desc = desc[:107] + "..."
            skill_lines.append(f"- {item.get('name', '?')} — {desc}")
        _add_section("Procedural skills available (fetch details on demand)", skill_lines)

        recall_lines = []
        for item in recall:
            if not isinstance(item, dict):
                continue
            recall_lines.append(f"- [{item.get('type', 'memory')}] {item.get('title', '?')}")
        _add_section(
            "Relevant past memories (titles only — use brain_recall for bodies)", recall_lines
        )

        parts = ["\n".join(header_lines)]
        parts.extend(sections)
        parts.append(GUIDANCE_BLOCK)
        return "\n\n".join(parts)

    # -- recall / prefetch ----------------------------------------------------

    def _recall_raw(self, query: str, top: Optional[int] = None) -> List[Dict[str, Any]]:
        top = top or int(self._config["top_recall"])
        result = self._run_brain_json(
            [
                "recall",
                query,
                "--project",
                str(self._config["project"]),
                "--top",
                str(top),
            ]
        )
        if isinstance(result, list):
            return [r for r in result if isinstance(r, dict)]
        return []

    def _read_memory_body(self, rel_path: str, limit: int = MAX_RECALL_BODY_CHARS) -> str:
        if validate_relative_path(rel_path):
            return ""
        base = brain_dir()
        try:
            resolved = (base / rel_path).resolve()
            base_resolved = base.resolve()
            if base_resolved != resolved and base_resolved not in resolved.parents:
                return ""
            text = resolved.read_text(encoding="utf-8")
        except OSError:
            return ""
        body = _strip_frontmatter(text).strip()
        if len(body) > limit:
            body = body[: limit - 3] + "..."
        return body

    def _recall_brief(self, query: str) -> str:
        """Compact recall block used for prefetch — titles + short excerpts."""
        results = self._recall_raw(query)
        if not results:
            return ""
        lines = ["### Brain recall (relevant memories)"]
        used = len(lines[0])
        for item in results:
            title = item.get("title", "?")
            mtype = item.get("type", "memory")
            score = item.get("score")
            excerpt = self._read_memory_body(str(item.get("path") or ""), limit=180)
            score_txt = f", score {score:.2f}" if isinstance(score, (int, float)) else ""
            line = f"- **{title}** ({mtype}{score_txt})"
            if excerpt:
                line += f": {' '.join(excerpt.split())}"
            if used + len(line) > MAX_PREFETCH_CHARS:
                break
            lines.append(line)
            used += len(line)
            mem_id = item.get("id")
            if isinstance(mem_id, str):
                with self._state_lock:
                    if mem_id not in self._recalled_ids:
                        self._recalled_ids.append(mem_id)
        return "\n".join(lines) if len(lines) > 1 else ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Background recall for the next turn (daemon thread, never blocks)."""
        if not query or not self.is_available():
            return
        def _work() -> None:
            try:
                result = self._recall_brief(query)
            except Exception as exc:  # noqa: BLE001 — never leak into agent loop
                logger.debug("brain: prefetch failed: %s", exc)
                result = ""
            with self._prefetch_lock:
                self._prefetch_query = query
                self._prefetch_result = result
        thread = threading.Thread(target=_work, daemon=True, name="brain-prefetch")
        self._prefetch_thread = thread
        thread.start()

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        if message:
            self.queue_prefetch(message, session_id=self._session_id)

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall context for the upcoming turn.

        Consumes the queued background result when it matches; otherwise runs a
        bounded synchronous recall. Cached per turn."""
        if not query or not self.is_available():
            return ""
        thread = self._prefetch_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=PREFETCH_JOIN_TIMEOUT)
        with self._prefetch_lock:
            if self._prefetch_query == query:
                result = self._prefetch_result
                self._prefetch_query = ""
                self._prefetch_result = ""
                return result
        try:
            return self._recall_brief(query)
        except Exception as exc:  # noqa: BLE001
            logger.debug("brain: prefetch (sync) failed: %s", exc)
            return ""

    # -- turn / session lifecycle ----------------------------------------------

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """No transcript dumping — only lightweight in-memory topic tracking
        that feeds the session entry in ~/.brain/contexts.json. Pure CPU, no
        IO, so it satisfies the non-blocking contract without a thread."""
        try:
            self._track_topics(user_content)
        except Exception as exc:  # noqa: BLE001
            logger.debug("brain: topic tracking failed: %s", exc)

    def _track_topics(self, text: str) -> None:
        if not isinstance(text, str) or not text:
            return
        words = re.findall(r"[a-zA-Z][a-zA-Z\-]{4,}", text.lower())
        added = 0
        with self._state_lock:
            for word in words:
                if word in _STOPWORDS or word in self._topics:
                    continue
                self._topics.append(word)
                added += 1
                if added >= 3 or len(self._topics) >= 12:
                    break

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Append a session entry to ~/.brain/contexts.json (keep last 20)."""
        with self._state_lock:
            if self._context_saved:
                return
            self._context_saved = True
            entry = {
                "session_id": self._session_id or f"hermes-{int(time.time())}",
                "started": self._session_started_at or _now_iso(),
                "ended": _now_iso(),
                "project": str(self._config["project"]),
                "topics": list(self._topics),
                "task_type": "discussing",
                "memories_created": list(self._created_ids),
                "memories_recalled": list(self._recalled_ids),
                "notable_unsaved": [],
            }
        try:
            append_context_entry(entry)
        except OSError as exc:
            logger.warning("brain: could not save session context: %s", exc)

    def on_session_switch(
        self,
        new_session_id: str,
        *,
        parent_session_id: str = "",
        reset: bool = False,
        rewound: bool = False,
        **kwargs,
    ) -> None:
        self._session_id = new_session_id or self._session_id
        if reset:
            with self._state_lock:
                self._recalled_ids = []
                self._created_ids = []
                self._topics = []
                self._context_saved = False
            self._session_started_at = _now_iso()

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Save-before-context-discard: remind the model to store un-memorized
        notable content before compression drops it."""
        if not self.is_available():
            return ""
        return PRE_COMPRESS_REMINDER

    def shutdown(self) -> None:
        for thread in (self._prefetch_thread, self._mirror_thread):
            if thread is not None and thread.is_alive():
                thread.join(timeout=2.0)

    def backup_paths(self) -> List[str]:
        # ~/.brain lives outside HERMES_HOME — include it in Hermes backups.
        return [str(brain_dir())]

    # -- MEMORY.md mirroring -----------------------------------------------------

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror built-in MEMORY.md/USER.md writes into ~/.brain as a guarded,
        content-hash-deduplicated observation memory (daemon thread)."""
        if not self.is_available():
            return
        if not isinstance(content, str) or len(content.strip()) < _MIRROR_MIN_CONTENT:
            return
        # VERIFY: exact `action` values emitted by the built-in memory tool are
        # undocumented; deletions are guarded out by name, everything else mirrors.
        if isinstance(action, str) and action.lower() in ("delete", "remove", "clear"):
            return
        digest = hashlib.sha256(content.strip().encode("utf-8")).hexdigest()
        if not self._mirror_should_write(digest):
            return
        payload = {
            "memories": [
                {
                    "title": f"Hermes memory note: {target or 'MEMORY.md'}"[:80],
                    "type": "observation",
                    "cognitive_type": "semantic",
                    "path": (
                        "professional/agents/hermes/"
                        f"{_slugify(target) or 'memory'}-{digest[:8]}.md"
                    ),
                    "content": content.strip(),
                    "tags": ["hermes", "memory-md"],
                    "salience": 0.3,
                    "confidence": 0.7,
                    "source": f"Mirrored from Hermes built-in memory ({action} {target})".strip(),
                    "encoding_context": {
                        "project": str(self._config["project"]),
                        "topics": [],
                        "task_type": "discussing",
                    },
                }
            ]
        }

        def _work() -> None:
            try:
                out = self._run_brain(["memorize"], input_text=json.dumps(payload))
                if out is not None:
                    self._mirror_record(digest)
                    try:
                        ids = _extract_ids(json.loads(out))
                    except ValueError:
                        ids = []
                    with self._state_lock:
                        self._created_ids.extend(i for i in ids if i not in self._created_ids)
            except Exception as exc:  # noqa: BLE001
                logger.debug("brain: memory mirror failed: %s", exc)

        prev = self._mirror_thread
        if prev is not None and prev.is_alive():
            prev.join(timeout=5.0)
        thread = threading.Thread(target=_work, daemon=True, name="brain-mirror")
        self._mirror_thread = thread
        thread.start()

    def _mirror_hash_path(self) -> Path:
        if self._hermes_home:
            return Path(self._hermes_home) / "brain-mirror.json"
        return brain_dir() / "_hermes-mirror.json"

    def _load_mirror_hashes(self) -> List[str]:
        if self._mirror_hashes is None:
            hashes: List[str] = []
            try:
                path = self._mirror_hash_path()
                if path.exists():
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(data, dict) and isinstance(data.get("hashes"), list):
                        hashes = [h for h in data["hashes"] if isinstance(h, str)]
            except (ValueError, OSError):
                hashes = []
            self._mirror_hashes = hashes
        return self._mirror_hashes

    def _mirror_should_write(self, digest: str) -> bool:
        return digest not in self._load_mirror_hashes()

    def _mirror_record(self, digest: str) -> None:
        hashes = self._load_mirror_hashes()
        hashes.append(digest)
        self._mirror_hashes = hashes[-_MIRROR_MAX_HASHES:]
        try:
            path = self._mirror_hash_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"hashes": self._mirror_hashes}), encoding="utf-8")
        except OSError as exc:
            logger.debug("brain: could not persist mirror hashes: %s", exc)

    # -- tools --------------------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        # VERIFY: hermes-agent's manager reads schema["name"] at the top level
        # (per tests/agent/test_memory_provider.py); flat name/description/
        # parameters is used here, matching that convention.
        return [
            {
                "name": "brain_recall",
                "description": (
                    "Recall relevant memories from the Brain Memory store "
                    "(~/.brain). Deterministic scoring: TF-IDF relevance, decayed "
                    "strength, spreading activation, context match, salience. "
                    "Returns full memory bodies. Use before answering anything "
                    "that depends on the user's history, people, preferences, or "
                    "past decisions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "What to recall, in natural language or keywords",
                        },
                        "top": {
                            "type": "integer",
                            "description": "Maximum results (default from provider config)",
                            "minimum": 1,
                            "maximum": 25,
                        },
                        "reinforce": {
                            "type": "boolean",
                            "description": "Apply spaced reinforcement to returned memories (default true)",
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "brain_memorize",
                "description": (
                    "Store one or more memories in the Brain Memory store. YOU "
                    "decide what is worth remembering — store durable value, not "
                    "transcripts. Each memory needs: title, type (decision|insight|"
                    "goal|experience|learning|relationship|preference|observation), "
                    "path (relative under ~/.brain using life domains professional/, "
                    "personal/, social/, family/ — e.g. personal/health/sleep-routine.md), "
                    "and markdown content."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "memories": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "type": {
                                        "type": "string",
                                        "enum": sorted(VALID_MEMORY_TYPES),
                                    },
                                    "path": {
                                        "type": "string",
                                        "description": "Relative path under ~/.brain, ending in .md",
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "Markdown body of the memory",
                                    },
                                    "cognitive_type": {
                                        "type": "string",
                                        "enum": sorted(VALID_COGNITIVE_TYPES),
                                    },
                                    "salience": {"type": "number", "minimum": 0, "maximum": 1},
                                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                                    "tags": {"type": "array", "items": {"type": "string"}},
                                    "related": {"type": "array", "items": {"type": "string"}},
                                    "source": {"type": "string"},
                                    "encoding_context": {
                                        "type": "object",
                                        "properties": {
                                            "project": {"type": "string"},
                                            "topics": {"type": "array", "items": {"type": "string"}},
                                            "task_type": {"type": "string"},
                                        },
                                    },
                                    "pinned": {"type": "boolean"},
                                    "pin_scope": {"type": "string"},
                                    "pin_priority": {"type": "integer"},
                                },
                                "required": ["title", "type", "path", "content"],
                            },
                        },
                        "sync": {
                            "type": "boolean",
                            "description": "Push to Brain Cloud / Git remote after storing",
                        },
                    },
                    "required": ["memories"],
                },
            },
            {
                "name": "brain_reinforce",
                "description": (
                    "Apply spaced reinforcement and Hebbian co-retrieval "
                    "strengthening to memories you actually used (by memory ID)."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                            "description": "Memory IDs to reinforce",
                        }
                    },
                    "required": ["ids"],
                },
            },
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        try:
            args = args if isinstance(args, dict) else {}
            if tool_name == "brain_recall":
                return self._tool_recall(args)
            if tool_name == "brain_memorize":
                return self._tool_memorize(args)
            if tool_name == "brain_reinforce":
                return self._tool_reinforce(args)
            return f"brain error: unknown tool '{tool_name}'"
        except Exception as exc:  # noqa: BLE001 — never raise into the agent loop
            logger.warning("brain: tool '%s' failed: %s", tool_name, exc)
            return f"brain error: {exc}"

    def _tool_recall(self, args: Dict[str, Any]) -> str:
        query = str(args.get("query") or "").strip()
        if not query:
            return "brain error: 'query' is required"
        if not self.is_available():
            return "brain error: the brain CLI is not installed (npm install -g brain-memory)"
        top = _coerce_int(args.get("top"), int(self._config["top_recall"]), 1, 25)
        results = self._recall_raw(query, top=top)
        if not results:
            return (
                f'No memories matched "{query}". The archive (~/.brain/_archived/) '
                "may still hold older memories."
            )
        chunks = [f'## Brain recall — "{query}"']
        recalled: List[str] = []
        for i, item in enumerate(results, 1):
            title = item.get("title", "?")
            mtype = item.get("type", "memory")
            score = item.get("score")
            confidence = item.get("confidence")
            rel_path = str(item.get("path") or "")
            score_txt = f"score {score:.2f}" if isinstance(score, (int, float)) else "score n/a"
            head = f"### {i}. {title}  ({mtype}, {score_txt})"
            body = self._read_memory_body(rel_path)
            lines = [head, f"path: ~/.brain/{rel_path}"]
            if isinstance(confidence, (int, float)) and confidence < 0.5:
                lines.append(f"⚠️ low confidence ({confidence:.2f}) — verify before relying on this")
            if body:
                lines.append(body)
            chunks.append("\n".join(lines))
            mem_id = item.get("id")
            if isinstance(mem_id, str) and mem_id:
                recalled.append(mem_id)
        if recalled:
            with self._state_lock:
                self._recalled_ids.extend(i for i in recalled if i not in self._recalled_ids)
        reinforce = args.get("reinforce")
        do_reinforce = bool(self._config["auto_reinforce"]) if reinforce is None else bool(reinforce)
        if do_reinforce and recalled:
            if self._run_brain(["reinforce"] + recalled) is not None:
                chunks.append(f"_Reinforced {len(recalled)} memories (spaced reinforcement applied)._")
        return "\n\n".join(chunks)

    def _tool_memorize(self, args: Dict[str, Any]) -> str:
        validated = validate_memories(args.get("memories"))
        if "error" in validated:
            return f"brain error: {validated['error']}"
        if not self.is_available():
            return "brain error: the brain CLI is not installed (npm install -g brain-memory)"
        memories = validated["memories"]
        for mem in memories:
            ctx = mem.get("encoding_context")
            if not isinstance(ctx, dict):
                ctx = {}
            ctx.setdefault("project", str(self._config["project"]))
            with self._state_lock:
                default_topics = list(self._topics[:6])
            ctx.setdefault("topics", default_topics)
            ctx.setdefault("task_type", "discussing")
            mem["encoding_context"] = ctx
            mem.setdefault("cognitive_type", "semantic")
            mem.setdefault("source", "Hermes Agent session")
        cli_args = ["memorize"]
        if _coerce_bool(args.get("sync"), False) or bool(self._config["sync_on_memorize"]):
            cli_args.append("--sync")
        out = self._run_brain(cli_args, input_text=json.dumps({"memories": memories}))
        if out is None:
            return "brain error: brain memorize failed — nothing was stored"
        ids: List[str] = []
        try:
            ids = _extract_ids(json.loads(out))
        except ValueError:
            pass
        if ids:
            with self._state_lock:
                self._created_ids.extend(i for i in ids if i not in self._created_ids)
        lines = [f"Stored {len(memories)} memor{'y' if len(memories) == 1 else 'ies'} in ~/.brain:"]
        for mem, mem_id in zip(memories, ids + [""] * len(memories)):
            suffix = f" [{mem_id}]" if mem_id else ""
            lines.append(f"- {mem['title']} ({mem['type']}) → {mem['path']}{suffix}")
        return "\n".join(lines)

    def _tool_reinforce(self, args: Dict[str, Any]) -> str:
        ids = args.get("ids")
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and i for i in ids):
            return "brain error: 'ids' must be a non-empty array of memory ID strings"
        if not self.is_available():
            return "brain error: the brain CLI is not installed (npm install -g brain-memory)"
        if self._run_brain(["reinforce"] + list(ids)) is None:
            return "brain error: brain reinforce failed"
        return f"Reinforced {len(ids)} memor{'y' if len(ids) == 1 else 'ies'}."
