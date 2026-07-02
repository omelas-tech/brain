"""system_prompt_block(): session-start formatting and token-budget respect."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase


def make_payload(recall_count=3, budget=2000):
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


class TestSessionStartFormatting(BrainTestCase):
    def test_status_line_and_sections(self):
        payload = make_payload()
        self.fake_run.responses["session-start"] = json.dumps(payload)
        provider = self.make_provider()

        block = provider.system_prompt_block()

        self.assertIn("◉ Brain active — 42 memories (3 in project context)", block)
        self.assertIn("📋 3 memories due for review", block)
        self.assertIn("low-confidence", block)
        # Pinned facts
        self.assertIn("Always answer in metric units", block)
        self.assertIn("metric units in every answer", block)
        # Skills index (names + descriptions)
        self.assertIn("trip-planning", block)
        self.assertIn("meal-prep", block)
        # Context-recall titles
        self.assertIn("Recalled memory number 0", block)
        # Memorize guidance (personal-assistant flavored)
        self.assertIn("brain_memorize", block)
        self.assertIn("brain_recall", block)
        self.assertIn("professional/", block)
        self.assertIn("family/", block)

    def test_cli_invocation_shape(self):
        self.fake_run.responses["session-start"] = json.dumps(make_payload())
        provider = self.make_provider()
        provider.system_prompt_block()

        calls = self.fake_run.calls_for("session-start")
        self.assertEqual(len(calls), 1)
        argv, kwargs = calls[0]
        self.assertEqual(argv, ["brain", "session-start", "--project", "hermes"])
        self.assertEqual(kwargs.get("env", {}).get("BRAIN_AGENT"), "hermes")
        self.assertFalse(kwargs.get("shell", False))
        self.assertLessEqual(kwargs.get("timeout", 0), 15)

    def test_project_config_used(self):
        self.fake_run.responses["session-start"] = json.dumps(make_payload())
        provider = self.make_provider(project="life-admin")
        provider.system_prompt_block()
        argv, _ = self.fake_run.calls_for("session-start")[0]
        self.assertIn("life-admin", argv)

    def test_non_json_output_degrades_to_empty(self):
        self.fake_run.responses["session-start"] = "boom, not json"
        provider = self.make_provider()
        self.assertEqual(provider.system_prompt_block(), "")

    def test_empty_payload_still_renders_status_and_guidance(self):
        self.fake_run.responses["session-start"] = json.dumps({"memory_count": 0})
        provider = self.make_provider()
        block = provider.system_prompt_block()
        self.assertIn("◉ Brain active — 0 memories (0 in project context)", block)
        self.assertIn("brain_memorize", block)


class TestSessionStartBudget(BrainTestCase):
    def test_tiny_budget_drops_optional_sections_keeps_essentials(self):
        payload = make_payload(recall_count=60, budget=150)
        self.fake_run.responses["session-start"] = json.dumps(payload)
        provider = self.make_provider()
        block = provider.system_prompt_block()

        # Essentials survive.
        self.assertIn("◉ Brain active — 42 memories (60 in project context)", block)
        self.assertIn("brain_memorize", block)
        # A 150-token budget cannot fit optional sections at all.
        self.assertNotIn("Relevant past memories", block)
        self.assertNotIn("Recalled memory number 59", block)

    def test_large_budget_includes_everything(self):
        payload = make_payload(recall_count=60, budget=8000)
        self.fake_run.responses["session-start"] = json.dumps(payload)
        provider = self.make_provider()
        block = provider.system_prompt_block()
        self.assertIn("Recalled memory number 59", block)

    def test_budget_bounds_output_size(self):
        small = make_payload(recall_count=60, budget=150)
        large = make_payload(recall_count=60, budget=8000)
        self.fake_run.responses["session-start"] = json.dumps(small)
        provider = self.make_provider()
        small_block = provider.system_prompt_block()
        self.fake_run.responses["session-start"] = json.dumps(large)
        large_block = provider.system_prompt_block()

        self.assertLess(len(small_block), len(large_block))
        # Optional content is capped by the budget: everything beyond the
        # essential header + guidance must fit in max_tokens * 4 chars.
        mod = self.mod
        essential_len = len(mod.GUIDANCE_BLOCK) + 300  # header allowance
        self.assertLessEqual(len(small_block), 150 * mod.CHARS_PER_TOKEN + essential_len)


if __name__ == "__main__":
    unittest.main()
