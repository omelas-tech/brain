"""on_memory_write: mirror built-in MEMORY.md writes with content-hash dedup."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase

NOTE = "User is training for the October marathon; long runs happen on Sundays."


class TestMemoryMirror(BrainTestCase):
    def setUp(self):
        super().setUp()
        self.fake_run.responses["memorize"] = json.dumps({"stored": [{"id": "mem_mirror1"}]})

    def _join(self, provider):
        thread = provider._mirror_thread
        if thread is not None:
            thread.join(timeout=5)

    def test_mirrors_as_observation(self):
        provider = self.make_provider()
        provider.on_memory_write("append", "MEMORY.md", NOTE)
        self._join(provider)

        calls = self.fake_run.calls_for("memorize")
        self.assertEqual(len(calls), 1)
        _, kwargs = calls[0]
        mem = json.loads(kwargs["input"])["memories"][0]
        self.assertEqual(mem["type"], "observation")
        self.assertEqual(mem["content"], NOTE)
        self.assertTrue(mem["path"].startswith("professional/agents/hermes/"))
        self.assertTrue(mem["path"].endswith(".md"))
        self.assertIsNone(self.mod.validate_relative_path(mem["path"]))

    def test_duplicate_content_written_once(self):
        provider = self.make_provider()
        provider.on_memory_write("append", "MEMORY.md", NOTE)
        self._join(provider)
        provider.on_memory_write("append", "MEMORY.md", NOTE)
        self._join(provider)
        self.assertEqual(len(self.fake_run.calls_for("memorize")), 1)

    def test_dedup_persists_across_instances(self):
        provider = self.make_provider()
        provider.on_memory_write("append", "MEMORY.md", NOTE)
        self._join(provider)

        fresh = self.mod.BrainMemoryProvider()
        fresh.initialize("s2", hermes_home=str(self.hermes_home))
        fresh.on_memory_write("append", "MEMORY.md", NOTE)
        self._join(fresh)
        self.assertEqual(len(self.fake_run.calls_for("memorize")), 1)

    def test_short_content_skipped(self):
        provider = self.make_provider()
        provider.on_memory_write("append", "MEMORY.md", "tiny")
        self._join(provider)
        self.assertEqual(self.fake_run.calls_for("memorize"), [])

    def test_delete_actions_skipped(self):
        provider = self.make_provider()
        provider.on_memory_write("delete", "MEMORY.md", NOTE)
        self._join(provider)
        self.assertEqual(self.fake_run.calls_for("memorize"), [])


if __name__ == "__main__":
    unittest.main()
