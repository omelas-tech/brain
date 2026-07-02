"""brain_memorize tool: payload validation and CLI hand-off."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase


def valid_memory(**overrides):
    mem = {
        "title": "Sleep routine that works",
        "type": "learning",
        "path": "personal/health/sleep-routine.md",
        "content": "# Sleep routine\n\nWinding down at 22:30 works best.",
    }
    mem.update(overrides)
    return mem


class TestMemorizeValidation(BrainTestCase):
    def assert_rejected(self, provider, memories, fragment):
        result = provider.handle_tool_call("brain_memorize", {"memories": memories})
        self.assertIn("brain error", result)
        self.assertIn(fragment, result)
        self.assertEqual(self.fake_run.calls_for("memorize"), [], "CLI must not be called")

    def test_required_fields(self):
        provider = self.make_provider()
        for field in ("title", "type", "path", "content"):
            mem = valid_memory()
            del mem[field]
            self.assert_rejected(provider, [mem], field)

    def test_empty_memories_array(self):
        provider = self.make_provider()
        result = provider.handle_tool_call("brain_memorize", {"memories": []})
        self.assertIn("brain error", result)

    def test_invalid_type(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(type="fact")], "invalid type")

    def test_invalid_cognitive_type(self):
        provider = self.make_provider()
        self.assert_rejected(
            provider, [valid_memory(cognitive_type="magical")], "cognitive_type"
        )

    def test_absolute_path_rejected(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(path="/etc/passwd.md")], "relative")

    def test_home_path_rejected(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(path="~/secrets.md")], "relative")

    def test_traversal_rejected(self):
        provider = self.make_provider()
        for bad in ("../outside.md", "personal/../../outside.md", "personal/./x.md"):
            self.assert_rejected(provider, [valid_memory(path=bad)], "segments")

    def test_backslash_rejected(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(path="personal\\x.md")], "forward slashes")

    def test_non_md_rejected(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(path="personal/health/routine.txt")], ".md")

    def test_salience_out_of_range(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(salience=1.5)], "salience")

    def test_tags_must_be_string_array(self):
        provider = self.make_provider()
        self.assert_rejected(provider, [valid_memory(tags=[1, 2])], "tags")


class TestMemorizeHandoff(BrainTestCase):
    def test_valid_payload_reaches_cli(self):
        self.fake_run.responses["memorize"] = json.dumps(
            {"stored": [{"id": "mem_new1", "title": "Sleep routine that works"}]}
        )
        provider = self.make_provider()
        result = provider.handle_tool_call(
            "brain_memorize", {"memories": [valid_memory(salience=0.6, tags=["health"])]}
        )

        calls = self.fake_run.calls_for("memorize")
        self.assertEqual(len(calls), 1)
        argv, kwargs = calls[0]
        self.assertEqual(argv, ["brain", "memorize"])
        self.assertEqual(kwargs.get("env", {}).get("BRAIN_AGENT"), "hermes")

        sent = json.loads(kwargs["input"])
        self.assertEqual(len(sent["memories"]), 1)
        mem = sent["memories"][0]
        self.assertEqual(mem["path"], "personal/health/sleep-routine.md")
        self.assertEqual(mem["cognitive_type"], "semantic")  # defaulted
        self.assertEqual(mem["encoding_context"]["project"], "hermes")  # defaulted
        self.assertIn("task_type", mem["encoding_context"])

        self.assertNotIn("brain error", result)
        self.assertIn("mem_new1", result)
        self.assertIn("mem_new1", provider._created_ids)

    def test_unknown_fields_stripped(self):
        self.fake_run.responses["memorize"] = "{}"
        provider = self.make_provider()
        provider.handle_tool_call(
            "brain_memorize",
            {"memories": [valid_memory(id="evil-id", strength=99, decay_rate=0)]},
        )
        _, kwargs = self.fake_run.calls_for("memorize")[0]
        mem = json.loads(kwargs["input"])["memories"][0]
        self.assertNotIn("id", mem)
        self.assertNotIn("strength", mem)
        self.assertNotIn("decay_rate", mem)

    def test_explicit_encoding_context_preserved(self):
        self.fake_run.responses["memorize"] = "{}"
        provider = self.make_provider()
        provider.handle_tool_call(
            "brain_memorize",
            {
                "memories": [
                    valid_memory(
                        encoding_context={
                            "project": "custom",
                            "topics": ["sleep"],
                            "task_type": "learning",
                        }
                    )
                ]
            },
        )
        _, kwargs = self.fake_run.calls_for("memorize")[0]
        ctx = json.loads(kwargs["input"])["memories"][0]["encoding_context"]
        self.assertEqual(ctx["project"], "custom")
        self.assertEqual(ctx["topics"], ["sleep"])

    def test_sync_argument(self):
        self.fake_run.responses["memorize"] = "{}"
        provider = self.make_provider()
        provider.handle_tool_call("brain_memorize", {"memories": [valid_memory()], "sync": True})
        argv, _ = self.fake_run.calls_for("memorize")[0]
        self.assertIn("--sync", argv)

    def test_sync_on_memorize_config(self):
        self.fake_run.responses["memorize"] = "{}"
        provider = self.make_provider(sync_on_memorize=True)
        provider.handle_tool_call("brain_memorize", {"memories": [valid_memory()]})
        argv, _ = self.fake_run.calls_for("memorize")[0]
        self.assertIn("--sync", argv)

    def test_no_sync_by_default(self):
        self.fake_run.responses["memorize"] = "{}"
        provider = self.make_provider()
        provider.handle_tool_call("brain_memorize", {"memories": [valid_memory()]})
        argv, _ = self.fake_run.calls_for("memorize")[0]
        self.assertNotIn("--sync", argv)


if __name__ == "__main__":
    unittest.main()
