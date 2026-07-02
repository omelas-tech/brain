"""Shell-hook glue (_brain_hook.py): context injection and contexts.json append."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from testutil import INTEGRATION_ROOT, completed, load_hook_module

HOOK_PATH = INTEGRATION_ROOT / "agent-hooks" / "_brain_hook.py"


class HookTestCase(unittest.TestCase):
    def setUp(self):
        self.mod = load_hook_module()
        self.tmp = Path(tempfile.mkdtemp(prefix="brain-hook-test-"))
        self._saved_env = {
            k: os.environ.pop(k, None) for k in ("BRAIN_DIR", "BRAIN_PROJECT", "BRAIN_BIN")
        }
        os.environ["BRAIN_DIR"] = str(self.tmp)
        self._orig_run = self.mod.subprocess.run

    def tearDown(self):
        self.mod.subprocess.run = self._orig_run
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestContextInjection(HookTestCase):
    PAYLOAD = {
        "memory_count": 7,
        "pinned": [{"title": "Metric units", "content": "Always metric."}],
        "skills_index": [{"name": "trip-planning", "description": "Trips"}],
        "context_recall": [{"title": "Past trip to Rome", "type": "experience"}],
        "due_for_review": 0,
    }

    def _patch_brain(self):
        calls = []

        def fake_run(argv, **kwargs):
            calls.append((list(argv), kwargs))
            return completed(argv, stdout=json.dumps(self.PAYLOAD))

        self.mod.subprocess.run = fake_run
        return calls

    def test_first_turn_injects_context(self):
        calls = self._patch_brain()
        response = self.mod.handle_context({"extra": {"is_first_turn": True}})
        self.assertIn("context", response)
        self.assertIn("◉ Brain active — 7 memories (1 in project context)", response["context"])
        self.assertIn("Metric units", response["context"])
        self.assertIn("trip-planning", response["context"])
        self.assertIn("Past trip to Rome", response["context"])
        argv, kwargs = calls[0]
        self.assertEqual(argv[1:], ["session-start", "--project", "hermes"])
        self.assertEqual(kwargs["env"]["BRAIN_AGENT"], "hermes")

    def test_later_turns_are_silent(self):
        calls = self._patch_brain()
        response = self.mod.handle_context({"extra": {"is_first_turn": False}})
        self.assertEqual(response, {})
        self.assertEqual(calls, [])

    def test_top_level_flag_also_honored(self):
        calls = self._patch_brain()
        self.assertEqual(self.mod.handle_context({"is_first_turn": False}), {})
        self.assertEqual(calls, [])


class TestSessionEndHook(HookTestCase):
    def test_appends_entry(self):
        response = self.mod.handle_session_end({"session_id": "sess-9", "completed": True})
        self.assertEqual(response, {})
        entries = json.loads((self.tmp / "contexts.json").read_text(encoding="utf-8"))
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["session_id"], "sess-9")
        self.assertEqual(entries[0]["project"], "hermes")
        for key in ("started", "ended", "topics", "task_type", "notable_unsaved"):
            self.assertIn(key, entries[0])

    def test_keeps_last_20(self):
        for i in range(25):
            self.mod.handle_session_end({"session_id": f"s{i}"})
        entries = json.loads((self.tmp / "contexts.json").read_text(encoding="utf-8"))
        self.assertEqual(len(entries), 20)
        self.assertEqual(entries[-1]["session_id"], "s24")


class TestEndToEnd(HookTestCase):
    """Run the hook as Hermes would: JSON on stdin, JSON on stdout, exit 0 —
    even with garbage input and a missing brain binary."""

    def _run(self, mode, stdin_text):
        env = dict(os.environ)
        env["BRAIN_DIR"] = str(self.tmp)
        env["BRAIN_BIN"] = "/nonexistent/definitely-not-brain"
        proc = subprocess.run(
            [sys.executable, str(HOOK_PATH), mode],
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        return proc

    def test_context_mode_never_crashes(self):
        proc = self._run("context", "this is not json")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout), {})

    def test_session_end_mode(self):
        proc = self._run("session-end", json.dumps({"session_id": "e2e", "completed": True}))
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout), {})
        entries = json.loads((self.tmp / "contexts.json").read_text(encoding="utf-8"))
        self.assertEqual(entries[0]["session_id"], "e2e")

    def test_unknown_mode_is_silent(self):
        proc = self._run("bogus", "{}")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout), {})


if __name__ == "__main__":
    unittest.main()
