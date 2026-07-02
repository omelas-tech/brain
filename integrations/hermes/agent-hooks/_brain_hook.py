#!/usr/bin/env python3
"""Brain Memory shell hooks for Hermes Agent.

Implements the Hermes shell-hook JSON wire protocol (payload on stdin, JSON
response on stdout). Two modes, selected by argv[1]:

  context      — for the `pre_llm_call` event. On the FIRST turn of a session,
                 runs `brain session-start` and emits {"context": "..."} so the
                 payload is injected into the LLM context. Other turns emit {}.
                 (Note: `on_session_start` is observer-only in Hermes — context
                 injection is only honored on `pre_llm_call`.)
  session-end  — for the `on_session_end` event. Appends a session entry to
                 ~/.brain/contexts.json (last 20 kept) and emits {}.

Failures never break the agent: every error path prints {} and exits 0.
Stdlib only, Python 3.10+.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SUBPROCESS_TIMEOUT = 15
KEEP_ENTRIES = 20


def brain_dir() -> Path:
    override = os.environ.get("BRAIN_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".brain"


def _project() -> str:
    return os.environ.get("BRAIN_PROJECT", "hermes")


def _run_brain(args: list) -> str:
    env = dict(os.environ)
    env["BRAIN_AGENT"] = "hermes"
    proc = subprocess.run(
        [os.environ.get("BRAIN_BIN", "brain")] + [str(a) for a in args],
        capture_output=True,
        text=True,
        timeout=SUBPROCESS_TIMEOUT,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "").strip()[:200] or "brain CLI failed")
    return proc.stdout


def _is_first_turn(payload: dict) -> bool:
    extra = payload.get("extra")
    if isinstance(extra, dict) and "is_first_turn" in extra:
        return bool(extra["is_first_turn"])
    if "is_first_turn" in payload:
        return bool(payload["is_first_turn"])
    # No signal — assume first turn so at least one injection happens.
    return True


def format_session_start(data: dict) -> str:
    """Compact rendering of the brain session-start payload (already
    budget-bounded by the aggregator)."""
    lines = [
        "## Brain Memory (persistent, cross-agent)",
        "",
        f"◉ Brain active — {data.get('memory_count', 0)} memories "
        f"({len(data.get('context_recall') or [])} in project context)",
    ]
    due = data.get("due_for_review") or 0
    if isinstance(due, (int, float)) and due > 0:
        lines.append(f"📋 {int(due)} memories due for review")
    pinned = [p for p in (data.get("pinned") or []) if isinstance(p, dict)]
    if pinned:
        lines.append("")
        lines.append("### Pinned (always apply)")
        for item in pinned:
            content = " ".join(str(item.get("content") or "").split())
            if len(content) > 220:
                content = content[:217] + "..."
            title = str(item.get("title") or "").strip()
            lines.append(f"- **{title}** — {content}" if content else f"- **{title}**")
    skills = [s for s in (data.get("skills_index") or []) if isinstance(s, dict)]
    if skills:
        lines.append("")
        lines.append("### Procedural skills available")
        for item in skills:
            desc = " ".join(str(item.get("description") or "").split())[:110]
            lines.append(f"- {item.get('name', '?')} — {desc}")
    recall = [r for r in (data.get("context_recall") or []) if isinstance(r, dict)]
    if recall:
        lines.append("")
        lines.append("### Relevant past memories")
        for item in recall:
            lines.append(f"- [{item.get('type', 'memory')}] {item.get('title', '?')}")
    lines.append("")
    lines.append(
        "Recall these with the brain CLI (`brain recall \"<query>\"`) when the "
        "user's history, people, preferences, or past decisions matter."
    )
    return "\n".join(lines)


def handle_context(payload: dict) -> dict:
    if not _is_first_turn(payload):
        return {}
    out = _run_brain(["session-start", "--project", _project()])
    data = json.loads(out)
    if not isinstance(data, dict) or not data:
        return {}
    return {"context": format_session_start(data)}


def append_context_entry(entry: dict, directory: Path | None = None, keep: int = KEEP_ENTRIES) -> None:
    directory = directory or brain_dir()
    path = directory / "contexts.json"
    container = []
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


def handle_session_end(payload: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    entry = {
        "session_id": str(payload.get("session_id") or f"hermes-{int(time.time())}"),
        "started": "",
        "ended": now,
        "project": _project(),
        "topics": [],
        "task_type": "discussing",
        "memories_created": [],
        "memories_recalled": [],
        "notable_unsaved": [],
    }
    append_context_entry(entry)
    return {}


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            payload = {}
    except (ValueError, OSError):
        payload = {}
    try:
        if mode == "context":
            response = handle_context(payload)
        elif mode == "session-end":
            response = handle_session_end(payload)
        else:
            response = {}
    except Exception:  # noqa: BLE001 — a broken hook must never halt the agent
        response = {}
    print(json.dumps(response))
    return 0


if __name__ == "__main__":
    sys.exit(main())
