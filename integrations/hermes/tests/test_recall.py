"""brain_recall tool: result mapping, body reads, and reinforce invocation."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase


def recall_results():
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


class TestRecallMapping(BrainTestCase):
    def setUp(self):
        super().setUp()
        self.write_memory(
            "personal/fitness/marathon-plan.md", "Target: sub-4h in October. Long runs Sundays."
        )
        self.write_memory("personal/health/knee-pain.md", "Left knee acts up past 15km.")
        self.fake_run.responses["recall"] = json.dumps(recall_results())
        self.fake_run.responses["reinforce"] = "{}"

    def test_bodies_and_metadata_returned(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {"query": "marathon"})

        self.assertIn("Marathon training plan", out)
        self.assertIn("sub-4h in October", out)  # body, frontmatter stripped
        self.assertNotIn("id: mem_x", out)  # frontmatter not leaked
        self.assertIn("Knee pain flare-up", out)
        self.assertIn("low confidence", out)  # 0.3 < 0.5 flagged
        self.assertIn("~/.brain/personal/fitness/marathon-plan.md", out)

    def test_recall_cli_invocation(self):
        provider = self.make_provider(project="life-admin", top_recall=4)
        provider.handle_tool_call("brain_recall", {"query": "marathon"})
        argv, kwargs = self.fake_run.calls_for("recall")[0]
        self.assertEqual(
            argv,
            ["brain", "recall", "marathon", "--project", "life-admin", "--top", "4"],
        )
        self.assertEqual(kwargs.get("env", {}).get("BRAIN_AGENT"), "hermes")

    def test_top_argument_overrides_config(self):
        provider = self.make_provider()
        provider.handle_tool_call("brain_recall", {"query": "marathon", "top": 2})
        argv, _ = self.fake_run.calls_for("recall")[0]
        self.assertEqual(argv[-1], "2")

    def test_auto_reinforce_invoked(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {"query": "marathon"})
        calls = self.fake_run.calls_for("reinforce")
        self.assertEqual(len(calls), 1)
        argv, _ = calls[0]
        self.assertEqual(argv, ["brain", "reinforce", "mem_a", "mem_b"])
        self.assertIn("Reinforced 2 memories", out)

    def test_auto_reinforce_disabled_by_config(self):
        provider = self.make_provider(auto_reinforce=False)
        provider.handle_tool_call("brain_recall", {"query": "marathon"})
        self.assertEqual(self.fake_run.calls_for("reinforce"), [])

    def test_reinforce_arg_overrides_config(self):
        provider = self.make_provider(auto_reinforce=False)
        provider.handle_tool_call("brain_recall", {"query": "marathon", "reinforce": True})
        self.assertEqual(len(self.fake_run.calls_for("reinforce")), 1)

        self.fake_run.calls.clear()
        provider2 = self.make_provider(auto_reinforce=True)
        provider2.handle_tool_call("brain_recall", {"query": "marathon", "reinforce": False})
        self.assertEqual(self.fake_run.calls_for("reinforce"), [])

    def test_recalled_ids_tracked(self):
        provider = self.make_provider()
        provider.handle_tool_call("brain_recall", {"query": "marathon"})
        self.assertEqual(provider._recalled_ids, ["mem_a", "mem_b"])

    def test_no_matches(self):
        self.fake_run.responses["recall"] = "[]"
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {"query": "unicorns"})
        self.assertIn("No memories matched", out)
        self.assertEqual(self.fake_run.calls_for("reinforce"), [])

    def test_missing_query(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {})
        self.assertIn("brain error", out)

    def test_traversal_path_in_results_is_not_read(self):
        results = recall_results()
        results[0]["path"] = "../../etc/passwd.md"
        self.fake_run.responses["recall"] = json.dumps(results)
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {"query": "marathon"})
        # Entry rendered (title known) but no body escapes the store.
        self.assertIn("Marathon training plan", out)
        self.assertNotIn("root:", out)

    def test_reinforce_tool(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a", "mem_b"]})
        argv, _ = self.fake_run.calls_for("reinforce")[0]
        self.assertEqual(argv, ["brain", "reinforce", "mem_a", "mem_b"])
        self.assertIn("Reinforced 2", out)

    def test_reinforce_tool_validates_ids(self):
        provider = self.make_provider()
        for bad in ({}, {"ids": []}, {"ids": "mem_a"}, {"ids": [1]}):
            out = provider.handle_tool_call("brain_reinforce", bad)
            self.assertIn("brain error", out)
        self.assertEqual(self.fake_run.calls_for("reinforce"), [])


class TestPrefetch(BrainTestCase):
    def setUp(self):
        super().setUp()
        self.write_memory("personal/fitness/marathon-plan.md", "Target: sub-4h in October.")
        self.fake_run.responses["recall"] = json.dumps(recall_results()[:1])

    def test_prefetch_returns_compact_block(self):
        provider = self.make_provider()
        out = provider.prefetch("marathon training")
        self.assertIn("Brain recall", out)
        self.assertIn("Marathon training plan", out)
        self.assertLess(len(out), 2000)

    def test_queue_prefetch_then_consume(self):
        provider = self.make_provider()
        provider.queue_prefetch("marathon training")
        thread = provider._prefetch_thread
        self.assertIsNotNone(thread)
        thread.join(timeout=5)
        recall_calls = len(self.fake_run.calls_for("recall"))
        out = provider.prefetch("marathon training")
        self.assertIn("Marathon training plan", out)
        # Consumed from cache — no second recall subprocess.
        self.assertEqual(len(self.fake_run.calls_for("recall")), recall_calls)

    def test_prefetch_does_not_reinforce(self):
        provider = self.make_provider()
        provider.prefetch("marathon training")
        self.assertEqual(self.fake_run.calls_for("reinforce"), [])


if __name__ == "__main__":
    unittest.main()
