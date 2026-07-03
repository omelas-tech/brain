"""Tests for the Brain Memory provider (plugins/memory/brain).

Fully hermetic: a temp BRAIN_DIR + HERMES_HOME per test, the brain binary
resolved as "found", and subprocess.run patched so the real brain CLI is
never invoked.
"""

from __future__ import annotations

import json
import subprocess

import pytest

import plugins.memory.brain as brain_module
from plugins.memory.brain import BrainMemoryProvider

_BRAIN_ENV_KEYS = (
    "BRAIN_DIR",
    "BRAIN_PROJECT",
    "BRAIN_BIN",
    "BRAIN_TOP_RECALL",
    "BRAIN_AUTO_REINFORCE",
    "BRAIN_SYNC_ON_MEMORIZE",
)


def _completed(argv, stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess(argv, returncode, stdout=stdout, stderr=stderr)


class FakeRun:
    """Records subprocess.run calls and answers by brain subcommand."""

    def __init__(self, responses=None):
        # responses: {subcommand: stdout-str or callable(argv, kwargs) -> stdout}
        self.responses = responses or {}
        self.calls = []  # list of (argv, kwargs)

    def __call__(self, argv, **kwargs):
        self.calls.append((list(argv), kwargs))
        sub = argv[1] if len(argv) > 1 else ""
        resp = self.responses.get(sub)
        if callable(resp):
            resp = resp(argv, kwargs)
        if resp is None:
            resp = "{}"
        if isinstance(resp, Exception):
            raise resp
        return _completed(argv, stdout=resp)

    def calls_for(self, sub):
        return [(a, k) for (a, k) in self.calls if len(a) > 1 and a[1] == sub]


class BrainEnv:
    """Isolated Brain store + Hermes home with a patched subprocess.run."""

    def __init__(self, tmp_path, monkeypatch):
        self.brain_home = tmp_path / "brain"
        self.brain_home.mkdir()
        (self.brain_home / "index.json").write_text("{}", encoding="utf-8")
        self.hermes_home = tmp_path / "hermes"
        self.hermes_home.mkdir()

        for key in _BRAIN_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("BRAIN_DIR", str(self.brain_home))

        monkeypatch.setattr(brain_module.shutil, "which", lambda _name: "/fake/bin/brain")
        self.fake_run = FakeRun()
        monkeypatch.setattr(brain_module.subprocess, "run", self.fake_run)

    def make_provider(self, session_id="sess-test", **config):
        if config:
            (self.hermes_home / "brain.json").write_text(json.dumps(config), encoding="utf-8")
        provider = BrainMemoryProvider()
        provider.initialize(session_id, hermes_home=str(self.hermes_home))
        return provider

    def write_memory(self, rel_path, body, frontmatter="id: mem_x\ntype: learning"):
        path = self.brain_home / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\n{frontmatter}\n---\n\n{body}\n", encoding="utf-8")
        return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    return BrainEnv(tmp_path, monkeypatch)


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------


def test_register_registers_a_brain_provider():
    captured = []

    class Ctx:
        def register_memory_provider(self, provider):
            captured.append(provider)

    brain_module.register(Ctx())
    assert len(captured) == 1
    assert isinstance(captured[0], BrainMemoryProvider)
    assert captured[0].name == "brain"


# ---------------------------------------------------------------------------
# Tool schemas / handle_tool_call routing
# ---------------------------------------------------------------------------


def test_tool_schemas_json_serializable(env):
    provider = env.make_provider()
    json.dumps(provider.get_tool_schemas())  # must not raise


def test_tool_schemas_expected_names_and_shape(env):
    provider = env.make_provider()
    schemas = provider.get_tool_schemas()
    names = [s["name"] for s in schemas]
    assert len(names) == len(set(names)), "tool names must be unique"
    assert set(names) == {"brain_recall", "brain_memorize", "brain_reinforce"}
    for schema in schemas:
        assert isinstance(schema.get("description"), str) and schema["description"]
        params = schema.get("parameters")
        assert isinstance(params, dict)
        assert params.get("type") == "object"
        assert isinstance(params.get("properties"), dict)
        assert isinstance(params.get("required"), list)


def test_every_schema_name_is_routed(env):
    env.fake_run.responses.update({"recall": "[]", "memorize": "{}", "reinforce": "{}"})
    provider = env.make_provider()
    for schema in provider.get_tool_schemas():
        out = provider.handle_tool_call(schema["name"], {})
        assert isinstance(out, str)
        assert "unknown tool" not in out


def test_unknown_tool(env):
    provider = env.make_provider()
    out = provider.handle_tool_call("brain_dream", {"query": "x"})
    assert "unknown tool" in out


def test_garbage_args_never_raise(env):
    provider = env.make_provider()
    for args in (None, [], "nope", {"memories": "not-a-list"}, {"ids": {}}):
        for name in ("brain_recall", "brain_memorize", "brain_reinforce"):
            out = provider.handle_tool_call(name, args)
            assert isinstance(out, str)


# ---------------------------------------------------------------------------
# Config schema
# ---------------------------------------------------------------------------


def test_config_schema_shape_and_keys(env):
    provider = env.make_provider()
    schema = provider.get_config_schema()
    json.dumps(schema)
    keys = {field["key"] for field in schema}
    assert keys == {"project", "top_recall", "auto_reinforce", "brain_bin", "sync_on_memorize"}
    for field in schema:
        assert "description" in field
        assert "default" in field


def test_save_and_reload_config(env):
    provider = env.make_provider()
    provider.save_config(
        {"project": "life", "top_recall": 3, "junk": "dropped"}, str(env.hermes_home)
    )
    saved = json.loads((env.hermes_home / "brain.json").read_text(encoding="utf-8"))
    assert saved == {"project": "life", "top_recall": 3}

    fresh = BrainMemoryProvider()
    fresh.initialize("s2", hermes_home=str(env.hermes_home))
    assert fresh._config["project"] == "life"
    assert fresh._config["top_recall"] == 3


def test_config_coercion_bounds(env):
    provider = env.make_provider(top_recall=999, auto_reinforce="yes")
    assert provider._config["top_recall"] == 25
    assert provider._config["auto_reinforce"] is True


# ---------------------------------------------------------------------------
# Identity / misc lifecycle
# ---------------------------------------------------------------------------


def test_name_and_availability(env):
    provider = env.make_provider()
    assert provider.name == "brain"
    assert provider.is_available()


def test_pre_compress_reminder(env):
    provider = env.make_provider()
    assert "brain_memorize" in provider.on_pre_compress([])


def test_backup_paths_points_at_brain_dir(env):
    provider = env.make_provider()
    assert provider.backup_paths() == [str(env.brain_home)]


# ---------------------------------------------------------------------------
# brain_recall tool: result mapping, body reads, reinforce invocation
# ---------------------------------------------------------------------------


def _recall_results():
    return [
        {
            "id": "mem_a",
            "title": "Marathon training plan",
            "path": "personal/fitness/marathon-plan.md",
            "type": "goal",
            "score": 0.82,
            "relevance": 0.7,
            "decayed_strength": 0.8,
            "context_match": 0.5,
            "spreading_bonus": 0.1,
            "confidence": 0.9,
            "tags": ["fitness"],
        },
        {
            "id": "mem_b",
            "title": "Knee pain flare-up",
            "path": "personal/health/knee-pain.md",
            "type": "observation",
            "score": 0.44,
            "confidence": 0.3,
            "tags": ["health"],
        },
    ]


@pytest.fixture
def recall_env(env):
    env.write_memory(
        "personal/fitness/marathon-plan.md", "Target: sub-4h in October. Long runs Sundays."
    )
    env.write_memory("personal/health/knee-pain.md", "Left knee acts up past 15km.")
    env.fake_run.responses["recall"] = json.dumps(_recall_results())
    env.fake_run.responses["reinforce"] = "{}"
    return env


def test_recall_bodies_and_metadata_returned(recall_env):
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {"query": "marathon"})

    assert "Marathon training plan" in out
    assert "sub-4h in October" in out  # body, frontmatter stripped
    assert "id: mem_x" not in out  # frontmatter not leaked
    assert "Knee pain flare-up" in out
    assert "low confidence" in out  # 0.3 < 0.5 flagged
    assert "~/.brain/personal/fitness/marathon-plan.md" in out


def test_recall_cli_invocation(recall_env):
    provider = recall_env.make_provider(project="life-admin", top_recall=4)
    provider.handle_tool_call("brain_recall", {"query": "marathon"})
    argv, kwargs = recall_env.fake_run.calls_for("recall")[0]
    assert argv == ["brain", "recall", "marathon", "--project", "life-admin", "--top", "4"]
    assert kwargs.get("env", {}).get("BRAIN_AGENT") == "hermes"


def test_recall_top_argument_overrides_config(recall_env):
    provider = recall_env.make_provider()
    provider.handle_tool_call("brain_recall", {"query": "marathon", "top": 2})
    argv, _ = recall_env.fake_run.calls_for("recall")[0]
    assert argv[-1] == "2"


def test_recall_auto_reinforce_invoked(recall_env):
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {"query": "marathon"})
    calls = recall_env.fake_run.calls_for("reinforce")
    assert len(calls) == 1
    argv, _ = calls[0]
    assert argv == ["brain", "reinforce", "mem_a", "mem_b"]
    assert "Reinforced 2 memories" in out


def test_recall_auto_reinforce_disabled_by_config(recall_env):
    provider = recall_env.make_provider(auto_reinforce=False)
    provider.handle_tool_call("brain_recall", {"query": "marathon"})
    assert recall_env.fake_run.calls_for("reinforce") == []


def test_recall_reinforce_arg_overrides_config(recall_env):
    provider = recall_env.make_provider(auto_reinforce=False)
    provider.handle_tool_call("brain_recall", {"query": "marathon", "reinforce": True})
    assert len(recall_env.fake_run.calls_for("reinforce")) == 1

    recall_env.fake_run.calls.clear()
    provider2 = recall_env.make_provider(auto_reinforce=True)
    provider2.handle_tool_call("brain_recall", {"query": "marathon", "reinforce": False})
    assert recall_env.fake_run.calls_for("reinforce") == []


def test_recalled_ids_tracked(recall_env):
    provider = recall_env.make_provider()
    provider.handle_tool_call("brain_recall", {"query": "marathon"})
    assert provider._recalled_ids == ["mem_a", "mem_b"]


def test_recall_no_matches(recall_env):
    recall_env.fake_run.responses["recall"] = "[]"
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {"query": "unicorns"})
    assert "No memories matched" in out
    assert recall_env.fake_run.calls_for("reinforce") == []


def test_recall_missing_query(recall_env):
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {})
    assert "brain error" in out


def test_recall_traversal_path_in_results_is_not_read(recall_env):
    results = _recall_results()
    results[0]["path"] = "../../etc/passwd.md"
    recall_env.fake_run.responses["recall"] = json.dumps(results)
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {"query": "marathon"})
    # Entry rendered (title known) but no body escapes the store.
    assert "Marathon training plan" in out
    assert "root:" not in out


def test_reinforce_tool(recall_env):
    provider = recall_env.make_provider()
    out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a", "mem_b"]})
    argv, _ = recall_env.fake_run.calls_for("reinforce")[0]
    assert argv == ["brain", "reinforce", "mem_a", "mem_b"]
    assert "Reinforced 2" in out


def test_reinforce_tool_validates_ids(recall_env):
    provider = recall_env.make_provider()
    for bad in ({}, {"ids": []}, {"ids": "mem_a"}, {"ids": [1]}):
        out = provider.handle_tool_call("brain_reinforce", bad)
        assert "brain error" in out
    assert recall_env.fake_run.calls_for("reinforce") == []


# ---------------------------------------------------------------------------
# Prefetch
# ---------------------------------------------------------------------------


@pytest.fixture
def prefetch_env(env):
    env.write_memory("personal/fitness/marathon-plan.md", "Target: sub-4h in October.")
    env.fake_run.responses["recall"] = json.dumps(_recall_results()[:1])
    return env


def test_prefetch_returns_compact_block(prefetch_env):
    provider = prefetch_env.make_provider()
    out = provider.prefetch("marathon training")
    assert "Brain recall" in out
    assert "Marathon training plan" in out
    assert len(out) < 2000


def test_queue_prefetch_then_consume(prefetch_env):
    provider = prefetch_env.make_provider()
    provider.queue_prefetch("marathon training")
    thread = provider._prefetch_thread
    assert thread is not None
    thread.join(timeout=5)
    recall_calls = len(prefetch_env.fake_run.calls_for("recall"))
    out = provider.prefetch("marathon training")
    assert "Marathon training plan" in out
    # Consumed from cache — no second recall subprocess.
    assert len(prefetch_env.fake_run.calls_for("recall")) == recall_calls


def test_prefetch_does_not_reinforce(prefetch_env):
    provider = prefetch_env.make_provider()
    provider.prefetch("marathon training")
    assert prefetch_env.fake_run.calls_for("reinforce") == []


# ---------------------------------------------------------------------------
# brain_memorize tool: payload validation
# ---------------------------------------------------------------------------


def _valid_memory(**overrides):
    mem = {
        "title": "Sleep routine that works",
        "type": "learning",
        "path": "personal/health/sleep-routine.md",
        "content": "# Sleep routine\n\nWinding down at 22:30 works best.",
    }
    mem.update(overrides)
    return mem


def _assert_rejected(env, provider, memories, fragment):
    result = provider.handle_tool_call("brain_memorize", {"memories": memories})
    assert "brain error" in result
    assert fragment in result
    assert env.fake_run.calls_for("memorize") == [], "CLI must not be called"


def test_memorize_required_fields(env):
    provider = env.make_provider()
    for field in ("title", "type", "path", "content"):
        mem = _valid_memory()
        del mem[field]
        _assert_rejected(env, provider, [mem], field)


def test_memorize_empty_memories_array(env):
    provider = env.make_provider()
    result = provider.handle_tool_call("brain_memorize", {"memories": []})
    assert "brain error" in result


def test_memorize_invalid_type(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(type="fact")], "invalid type")


def test_memorize_invalid_cognitive_type(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(cognitive_type="magical")], "cognitive_type")


def test_memorize_absolute_path_rejected(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(path="/etc/passwd.md")], "relative")


def test_memorize_home_path_rejected(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(path="~/secrets.md")], "relative")


def test_memorize_traversal_rejected(env):
    provider = env.make_provider()
    for bad in ("../outside.md", "personal/../../outside.md", "personal/./x.md"):
        _assert_rejected(env, provider, [_valid_memory(path=bad)], "segments")


def test_memorize_backslash_rejected(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(path="personal\\x.md")], "forward slashes")


def test_memorize_non_md_rejected(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(path="personal/health/routine.txt")], ".md")


def test_memorize_salience_out_of_range(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(salience=1.5)], "salience")


def test_memorize_tags_must_be_string_array(env):
    provider = env.make_provider()
    _assert_rejected(env, provider, [_valid_memory(tags=[1, 2])], "tags")


# ---------------------------------------------------------------------------
# brain_memorize tool: CLI hand-off
# ---------------------------------------------------------------------------


def test_memorize_valid_payload_reaches_cli(env):
    env.fake_run.responses["memorize"] = json.dumps(
        {"stored": [{"id": "mem_new1", "title": "Sleep routine that works"}]}
    )
    provider = env.make_provider()
    result = provider.handle_tool_call(
        "brain_memorize", {"memories": [_valid_memory(salience=0.6, tags=["health"])]}
    )

    calls = env.fake_run.calls_for("memorize")
    assert len(calls) == 1
    argv, kwargs = calls[0]
    assert argv == ["brain", "memorize"]
    assert kwargs.get("env", {}).get("BRAIN_AGENT") == "hermes"

    sent = json.loads(kwargs["input"])
    assert len(sent["memories"]) == 1
    mem = sent["memories"][0]
    assert mem["path"] == "personal/health/sleep-routine.md"
    assert mem["cognitive_type"] == "semantic"  # defaulted
    assert mem["encoding_context"]["project"] == "hermes"  # defaulted
    assert "task_type" in mem["encoding_context"]

    assert "brain error" not in result
    assert "mem_new1" in result
    assert "mem_new1" in provider._created_ids


def test_memorize_unknown_fields_stripped(env):
    env.fake_run.responses["memorize"] = "{}"
    provider = env.make_provider()
    provider.handle_tool_call(
        "brain_memorize",
        {"memories": [_valid_memory(id="evil-id", strength=99, decay_rate=0)]},
    )
    _, kwargs = env.fake_run.calls_for("memorize")[0]
    mem = json.loads(kwargs["input"])["memories"][0]
    assert "id" not in mem
    assert "strength" not in mem
    assert "decay_rate" not in mem


def test_memorize_explicit_encoding_context_preserved(env):
    env.fake_run.responses["memorize"] = "{}"
    provider = env.make_provider()
    provider.handle_tool_call(
        "brain_memorize",
        {
            "memories": [
                _valid_memory(
                    encoding_context={
                        "project": "custom",
                        "topics": ["sleep"],
                        "task_type": "learning",
                    }
                )
            ]
        },
    )
    _, kwargs = env.fake_run.calls_for("memorize")[0]
    ctx = json.loads(kwargs["input"])["memories"][0]["encoding_context"]
    assert ctx["project"] == "custom"
    assert ctx["topics"] == ["sleep"]


def test_memorize_sync_argument(env):
    env.fake_run.responses["memorize"] = "{}"
    provider = env.make_provider()
    provider.handle_tool_call("brain_memorize", {"memories": [_valid_memory()], "sync": True})
    argv, _ = env.fake_run.calls_for("memorize")[0]
    assert "--sync" in argv


def test_memorize_sync_on_memorize_config(env):
    env.fake_run.responses["memorize"] = "{}"
    provider = env.make_provider(sync_on_memorize=True)
    provider.handle_tool_call("brain_memorize", {"memories": [_valid_memory()]})
    argv, _ = env.fake_run.calls_for("memorize")[0]
    assert "--sync" in argv


def test_memorize_no_sync_by_default(env):
    env.fake_run.responses["memorize"] = "{}"
    provider = env.make_provider()
    provider.handle_tool_call("brain_memorize", {"memories": [_valid_memory()]})
    argv, _ = env.fake_run.calls_for("memorize")[0]
    assert "--sync" not in argv


# ---------------------------------------------------------------------------
# system_prompt_block(): session-start formatting and token-budget respect
# ---------------------------------------------------------------------------


def _session_start_payload(recall_count=3, budget=2000):
    return {
        "memory_count": 42,
        "pinned": [
            {
                "id": "mem_pin1",
                "title": "Always answer in metric units",
                "content": "The user prefers metric units in every answer.",
                "scope": "global",
                "priority": 1,
                "tokens": 14,
            },
            {
                "id": "mem_pin2",
                "title": "Weekly review on Sundays",
                "content": "A standing commitment: plan the week every Sunday evening.",
                "scope": "global",
                "priority": 2,
                "tokens": 15,
            },
        ],
        "skills_index": [
            {"name": "trip-planning", "description": "How the user likes trips planned"},
            {"name": "meal-prep", "description": "Weekly meal prep workflow"},
        ],
        "context_recall": [
            {
                "id": f"mem_r{i}",
                "title": f"Recalled memory number {i} with a reasonably long title",
                "path": f"personal/notes/mem-{i}.md",
                "type": "learning",
                "score": 0.9 - i * 0.01,
                "token_estimate": 40,
            }
            for i in range(recall_count)
        ],
        "due_for_review": 3,
        "low_confidence_alerts": [{"id": "mem_lc1", "title": "Shaky fact"}],
        "budget": {"max_tokens": budget},
    }


def test_session_start_status_line_and_sections(env):
    env.fake_run.responses["session-start"] = json.dumps(_session_start_payload())
    provider = env.make_provider()

    block = provider.system_prompt_block()

    assert "◉ Brain active — 42 memories (3 in project context)" in block
    assert "📋 3 memories due for review" in block
    assert "low-confidence" in block
    # Pinned facts
    assert "Always answer in metric units" in block
    assert "metric units in every answer" in block
    # Skills index (names + descriptions)
    assert "trip-planning" in block
    assert "meal-prep" in block
    # Context-recall titles
    assert "Recalled memory number 0" in block
    # Memorize guidance (personal-assistant flavored)
    assert "brain_memorize" in block
    assert "brain_recall" in block
    assert "professional/" in block
    assert "family/" in block


def test_session_start_cli_invocation_shape(env):
    env.fake_run.responses["session-start"] = json.dumps(_session_start_payload())
    provider = env.make_provider()
    provider.system_prompt_block()

    calls = env.fake_run.calls_for("session-start")
    assert len(calls) == 1
    argv, kwargs = calls[0]
    assert argv == ["brain", "session-start", "--project", "hermes"]
    assert kwargs.get("env", {}).get("BRAIN_AGENT") == "hermes"
    assert not kwargs.get("shell", False)
    assert kwargs.get("timeout", 0) <= 15


def test_session_start_project_config_used(env):
    env.fake_run.responses["session-start"] = json.dumps(_session_start_payload())
    provider = env.make_provider(project="life-admin")
    provider.system_prompt_block()
    argv, _ = env.fake_run.calls_for("session-start")[0]
    assert "life-admin" in argv


def test_session_start_non_json_output_degrades_to_empty(env):
    env.fake_run.responses["session-start"] = "boom, not json"
    provider = env.make_provider()
    assert provider.system_prompt_block() == ""


def test_session_start_empty_payload_still_renders_status_and_guidance(env):
    env.fake_run.responses["session-start"] = json.dumps({"memory_count": 0})
    provider = env.make_provider()
    block = provider.system_prompt_block()
    assert "◉ Brain active — 0 memories (0 in project context)" in block
    assert "brain_memorize" in block


def test_session_start_tiny_budget_drops_optional_sections_keeps_essentials(env):
    payload = _session_start_payload(recall_count=60, budget=150)
    env.fake_run.responses["session-start"] = json.dumps(payload)
    provider = env.make_provider()
    block = provider.system_prompt_block()

    # Essentials survive.
    assert "◉ Brain active — 42 memories (60 in project context)" in block
    assert "brain_memorize" in block
    # A 150-token budget cannot fit optional sections at all.
    assert "Relevant past memories" not in block
    assert "Recalled memory number 59" not in block


def test_session_start_large_budget_includes_everything(env):
    payload = _session_start_payload(recall_count=60, budget=8000)
    env.fake_run.responses["session-start"] = json.dumps(payload)
    provider = env.make_provider()
    block = provider.system_prompt_block()
    assert "Recalled memory number 59" in block


def test_session_start_budget_bounds_output_size(env):
    small = _session_start_payload(recall_count=60, budget=150)
    large = _session_start_payload(recall_count=60, budget=8000)
    env.fake_run.responses["session-start"] = json.dumps(small)
    provider = env.make_provider()
    small_block = provider.system_prompt_block()
    env.fake_run.responses["session-start"] = json.dumps(large)
    large_block = provider.system_prompt_block()

    assert len(small_block) < len(large_block)
    # Optional content is capped by the budget: everything beyond the
    # essential header + guidance must fit in max_tokens * 4 chars.
    essential_len = len(brain_module.GUIDANCE_BLOCK) + 300  # header allowance
    assert len(small_block) <= 150 * brain_module.CHARS_PER_TOKEN + essential_len


# ---------------------------------------------------------------------------
# contexts.json session tracking
# ---------------------------------------------------------------------------


def _read_context_entries(env):
    raw = json.loads((env.brain_home / "contexts.json").read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        return raw["sessions"]
    return raw


def test_session_end_entry_schema(env):
    provider = env.make_provider(session_id="sess-42")
    provider.sync_turn("Planning marathon training and nutrition strategy", "ok")
    with provider._state_lock:
        provider._recalled_ids.append("mem_a")
        provider._created_ids.append("mem_new")
    provider.on_session_end([])

    entries = _read_context_entries(env)
    assert len(entries) == 1
    entry = entries[0]
    for key in (
        "session_id",
        "started",
        "ended",
        "project",
        "topics",
        "task_type",
        "memories_created",
        "memories_recalled",
        "notable_unsaved",
    ):
        assert key in entry
    assert entry["session_id"] == "sess-42"
    assert entry["project"] == "hermes"
    assert "marathon" in entry["topics"]
    assert entry["memories_recalled"] == ["mem_a"]
    assert entry["memories_created"] == ["mem_new"]
    assert entry["started"]
    assert entry["ended"]


def test_session_end_second_call_is_idempotent(env):
    provider = env.make_provider()
    provider.on_session_end([])
    provider.on_session_end([])
    assert len(_read_context_entries(env)) == 1


def test_session_switch_reset_allows_new_entry(env):
    provider = env.make_provider(session_id="sess-1")
    provider.on_session_end([])
    provider.on_session_switch("sess-2", reset=True)
    provider.on_session_end([])
    entries = _read_context_entries(env)
    assert len(entries) == 2
    assert entries[1]["session_id"] == "sess-2"


def test_append_context_entry_truncates_to_last_20(env):
    for i in range(25):
        brain_module.append_context_entry({"session_id": f"s{i}"}, directory=env.brain_home)
    entries = json.loads((env.brain_home / "contexts.json").read_text(encoding="utf-8"))
    assert len(entries) == 20
    assert entries[0]["session_id"] == "s5"
    assert entries[-1]["session_id"] == "s24"


def test_append_context_entry_preserves_dict_container_shape(env):
    path = env.brain_home / "contexts.json"
    path.write_text(
        json.dumps({"sessions": [{"session_id": "old"}], "version": 2}), encoding="utf-8"
    )
    brain_module.append_context_entry({"session_id": "new"}, directory=env.brain_home)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    assert data["version"] == 2
    assert [e["session_id"] for e in data["sessions"]] == ["old", "new"]


def test_append_context_entry_recovers_from_malformed_file(env):
    path = env.brain_home / "contexts.json"
    path.write_text("definitely not json", encoding="utf-8")
    brain_module.append_context_entry({"session_id": "s1"}, directory=env.brain_home)
    entries = json.loads(path.read_text(encoding="utf-8"))
    assert [e["session_id"] for e in entries] == ["s1"]


def test_append_context_entry_creates_missing_directory(env):
    target = env.brain_home / "nested"
    brain_module.append_context_entry({"session_id": "s1"}, directory=target)
    assert (target / "contexts.json").exists()


def test_topics_capped_and_stopwords_skipped(env):
    provider = env.make_provider()
    provider.sync_turn("please thanks about really maybe would", "ok")
    assert provider._topics == []
    for i in range(10):
        provider.sync_turn(
            f"discussing keyword{i}alpha keyword{i}beta keyword{i}gamma keyword{i}delta", "ok"
        )
    assert len(provider._topics) <= 12


def test_sync_turn_never_raises(env):
    provider = env.make_provider()
    provider.sync_turn(None, None)
    provider.sync_turn(12345, object())


# ---------------------------------------------------------------------------
# Graceful degradation: missing binary
# ---------------------------------------------------------------------------


def _raise_file_not_found(argv, **kwargs):
    raise FileNotFoundError(argv[0])


@pytest.fixture
def missing_binary_env(env, monkeypatch):
    monkeypatch.setattr(brain_module.shutil, "which", lambda _name: None)
    monkeypatch.setattr(brain_module.subprocess, "run", _raise_file_not_found)
    return env


def test_missing_binary_is_available_false(missing_binary_env):
    provider = missing_binary_env.make_provider()
    assert not provider.is_available()


def test_missing_binary_lifecycle_returns_empty_never_raises(missing_binary_env):
    provider = missing_binary_env.make_provider()
    assert provider.system_prompt_block() == ""
    assert provider.prefetch("anything") == ""
    provider.queue_prefetch("anything")
    provider.on_turn_start(1, "hello")
    provider.sync_turn("u", "a")
    assert provider.on_pre_compress([]) == ""
    provider.on_memory_write("append", "MEMORY.md", "x" * 100)
    provider.shutdown()


def test_missing_binary_tools_return_error_strings(missing_binary_env):
    provider = missing_binary_env.make_provider()
    out = provider.handle_tool_call("brain_recall", {"query": "x"})
    assert "brain error" in out
    assert "not installed" in out
    out = provider.handle_tool_call(
        "brain_memorize",
        {
            "memories": [
                {
                    "title": "t",
                    "type": "learning",
                    "path": "personal/x.md",
                    "content": "body",
                }
            ]
        },
    )
    assert "brain error" in out
    out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a"]})
    assert "brain error" in out


def test_missing_binary_session_end_still_saves_context(missing_binary_env):
    # contexts.json is direct file IO — works without the CLI.
    provider = missing_binary_env.make_provider()
    provider.on_session_end([])
    assert (missing_binary_env.brain_home / "contexts.json").exists()


# ---------------------------------------------------------------------------
# Graceful degradation: failing CLI
# ---------------------------------------------------------------------------


def test_cli_nonzero_exit_degrades(env, monkeypatch):
    def _fail(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="kaboom")

    monkeypatch.setattr(brain_module.subprocess, "run", _fail)
    provider = env.make_provider()
    assert provider.system_prompt_block() == ""
    assert "No memories matched" in provider.handle_tool_call("brain_recall", {"query": "x"})


def test_cli_timeout_degrades(env, monkeypatch):
    def _timeout(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, kwargs.get("timeout", 15))

    monkeypatch.setattr(brain_module.subprocess, "run", _timeout)
    provider = env.make_provider()
    assert provider.system_prompt_block() == ""
    assert provider.prefetch("x") == ""


def test_cli_binary_vanishes_after_initialize(env, monkeypatch):
    # which() succeeds but exec fails — e.g. binary removed mid-session.
    monkeypatch.setattr(brain_module.subprocess, "run", _raise_file_not_found)
    provider = env.make_provider()
    assert provider.system_prompt_block() == ""
    out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a"]})
    assert "brain error" in out


def test_handle_tool_call_swallows_internal_errors(env, monkeypatch):
    provider = env.make_provider()

    def _boom(argv, **kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(brain_module.subprocess, "run", _boom)
    out = provider.handle_tool_call("brain_recall", {"query": "x"})
    assert isinstance(out, str)
    assert "brain error" in out


# ---------------------------------------------------------------------------
# on_memory_write: mirror built-in MEMORY.md writes with content-hash dedup
# ---------------------------------------------------------------------------

_MIRROR_NOTE = "User is training for the October marathon; long runs happen on Sundays."


@pytest.fixture
def mirror_env(env):
    env.fake_run.responses["memorize"] = json.dumps({"stored": [{"id": "mem_mirror1"}]})
    return env


def _join_mirror(provider):
    thread = provider._mirror_thread
    if thread is not None:
        thread.join(timeout=5)


def test_mirrors_as_observation(mirror_env):
    provider = mirror_env.make_provider()
    provider.on_memory_write("append", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(provider)

    calls = mirror_env.fake_run.calls_for("memorize")
    assert len(calls) == 1
    _, kwargs = calls[0]
    mem = json.loads(kwargs["input"])["memories"][0]
    assert mem["type"] == "observation"
    assert mem["content"] == _MIRROR_NOTE
    assert mem["path"].startswith("professional/agents/hermes/")
    assert mem["path"].endswith(".md")
    assert brain_module.validate_relative_path(mem["path"]) is None


def test_mirror_duplicate_content_written_once(mirror_env):
    provider = mirror_env.make_provider()
    provider.on_memory_write("append", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(provider)
    provider.on_memory_write("append", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(provider)
    assert len(mirror_env.fake_run.calls_for("memorize")) == 1


def test_mirror_dedup_persists_across_instances(mirror_env):
    provider = mirror_env.make_provider()
    provider.on_memory_write("append", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(provider)

    fresh = BrainMemoryProvider()
    fresh.initialize("s2", hermes_home=str(mirror_env.hermes_home))
    fresh.on_memory_write("append", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(fresh)
    assert len(mirror_env.fake_run.calls_for("memorize")) == 1


def test_mirror_short_content_skipped(mirror_env):
    provider = mirror_env.make_provider()
    provider.on_memory_write("append", "MEMORY.md", "tiny")
    _join_mirror(provider)
    assert mirror_env.fake_run.calls_for("memorize") == []


def test_mirror_delete_actions_skipped(mirror_env):
    provider = mirror_env.make_provider()
    provider.on_memory_write("delete", "MEMORY.md", _MIRROR_NOTE)
    _join_mirror(provider)
    assert mirror_env.fake_run.calls_for("memorize") == []
