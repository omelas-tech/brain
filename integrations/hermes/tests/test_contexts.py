"""contexts.json session tracking: append, schema, truncation, container shapes."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase


class TestOnSessionEnd(BrainTestCase):
    def _read_entries(self):
        raw = json.loads((self.brain_home / "contexts.json").read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw["sessions"]
        return raw

    def test_entry_schema(self):
        provider = self.make_provider(session_id="sess-42")
        provider.sync_turn("Planning marathon training and nutrition strategy", "ok")
        with provider._state_lock:
            provider._recalled_ids.append("mem_a")
            provider._created_ids.append("mem_new")
        provider.on_session_end([])

        entries = self._read_entries()
        self.assertEqual(len(entries), 1)
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
            self.assertIn(key, entry)
        self.assertEqual(entry["session_id"], "sess-42")
        self.assertEqual(entry["project"], "hermes")
        self.assertIn("marathon", entry["topics"])
        self.assertEqual(entry["memories_recalled"], ["mem_a"])
        self.assertEqual(entry["memories_created"], ["mem_new"])
        self.assertTrue(entry["started"])
        self.assertTrue(entry["ended"])

    def test_second_call_is_idempotent(self):
        provider = self.make_provider()
        provider.on_session_end([])
        provider.on_session_end([])
        self.assertEqual(len(self._read_entries()), 1)

    def test_session_switch_reset_allows_new_entry(self):
        provider = self.make_provider(session_id="sess-1")
        provider.on_session_end([])
        provider.on_session_switch("sess-2", reset=True)
        provider.on_session_end([])
        entries = self._read_entries()
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[1]["session_id"], "sess-2")


class TestAppendContextEntry(BrainTestCase):
    def test_truncates_to_last_20(self):
        for i in range(25):
            self.mod.append_context_entry({"session_id": f"s{i}"}, directory=self.brain_home)
        entries = json.loads((self.brain_home / "contexts.json").read_text(encoding="utf-8"))
        self.assertEqual(len(entries), 20)
        self.assertEqual(entries[0]["session_id"], "s5")
        self.assertEqual(entries[-1]["session_id"], "s24")

    def test_preserves_dict_container_shape(self):
        path = self.brain_home / "contexts.json"
        path.write_text(
            json.dumps({"sessions": [{"session_id": "old"}], "version": 2}), encoding="utf-8"
        )
        self.mod.append_context_entry({"session_id": "new"}, directory=self.brain_home)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertIsInstance(data, dict)
        self.assertEqual(data["version"], 2)
        self.assertEqual([e["session_id"] for e in data["sessions"]], ["old", "new"])

    def test_recovers_from_malformed_file(self):
        path = self.brain_home / "contexts.json"
        path.write_text("definitely not json", encoding="utf-8")
        self.mod.append_context_entry({"session_id": "s1"}, directory=self.brain_home)
        entries = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual([e["session_id"] for e in entries], ["s1"])

    def test_creates_missing_directory(self):
        target = self.brain_home / "nested"
        self.mod.append_context_entry({"session_id": "s1"}, directory=target)
        self.assertTrue((target / "contexts.json").exists())


class TestTopicTracking(BrainTestCase):
    def test_topics_capped_and_stopwords_skipped(self):
        provider = self.make_provider()
        provider.sync_turn("please thanks about really maybe would", "ok")
        self.assertEqual(provider._topics, [])
        for i in range(10):
            provider.sync_turn(
                f"discussing keyword{i}alpha keyword{i}beta keyword{i}gamma keyword{i}delta", "ok"
            )
        self.assertLessEqual(len(provider._topics), 12)

    def test_sync_turn_never_raises(self):
        provider = self.make_provider()
        provider.sync_turn(None, None)  # type: ignore[arg-type]
        provider.sync_turn(12345, object())  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
