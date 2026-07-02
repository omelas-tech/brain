"""Tool schema validity and handle_tool_call routing; config schema shape."""

from __future__ import annotations

import json
import unittest

from testutil import BrainTestCase


class TestToolSchemas(BrainTestCase):
    def test_json_serializable(self):
        provider = self.make_provider()
        schemas = provider.get_tool_schemas()
        json.dumps(schemas)  # must not raise

    def test_expected_names_and_shape(self):
        provider = self.make_provider()
        schemas = provider.get_tool_schemas()
        names = [s["name"] for s in schemas]
        self.assertEqual(len(names), len(set(names)), "tool names must be unique")
        self.assertEqual(set(names), {"brain_recall", "brain_memorize", "brain_reinforce"})
        for schema in schemas:
            self.assertIsInstance(schema.get("description"), str)
            self.assertTrue(schema["description"])
            params = schema.get("parameters")
            self.assertIsInstance(params, dict)
            self.assertEqual(params.get("type"), "object")
            self.assertIsInstance(params.get("properties"), dict)
            self.assertIsInstance(params.get("required"), list)

    def test_every_schema_name_is_routed(self):
        self.fake_run.responses.update({"recall": "[]", "memorize": "{}", "reinforce": "{}"})
        provider = self.make_provider()
        for schema in provider.get_tool_schemas():
            out = provider.handle_tool_call(schema["name"], {})
            self.assertIsInstance(out, str)
            self.assertNotIn("unknown tool", out)

    def test_unknown_tool(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_dream", {"query": "x"})
        self.assertIn("unknown tool", out)

    def test_garbage_args_never_raise(self):
        provider = self.make_provider()
        for args in (None, [], "nope", {"memories": "not-a-list"}, {"ids": {}}):
            for name in ("brain_recall", "brain_memorize", "brain_reinforce"):
                out = provider.handle_tool_call(name, args)  # type: ignore[arg-type]
                self.assertIsInstance(out, str)


class TestConfigSchema(BrainTestCase):
    def test_shape_and_keys(self):
        provider = self.make_provider()
        schema = provider.get_config_schema()
        json.dumps(schema)
        keys = {field["key"] for field in schema}
        self.assertEqual(
            keys, {"project", "top_recall", "auto_reinforce", "brain_bin", "sync_on_memorize"}
        )
        for field in schema:
            self.assertIn("description", field)
            self.assertIn("default", field)

    def test_save_and_reload_config(self):
        provider = self.make_provider()
        provider.save_config({"project": "life", "top_recall": 3, "junk": "dropped"}, str(self.hermes_home))
        saved = json.loads((self.hermes_home / "brain.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, {"project": "life", "top_recall": 3})

        fresh = self.mod.BrainMemoryProvider()
        fresh.initialize("s2", hermes_home=str(self.hermes_home))
        self.assertEqual(fresh._config["project"], "life")
        self.assertEqual(fresh._config["top_recall"], 3)

    def test_config_coercion_bounds(self):
        provider = self.make_provider(top_recall=999, auto_reinforce="yes")
        self.assertEqual(provider._config["top_recall"], 25)
        self.assertIs(provider._config["auto_reinforce"], True)


class TestMisc(BrainTestCase):
    def test_name_and_availability(self):
        provider = self.make_provider()
        self.assertEqual(provider.name, "brain")
        self.assertTrue(provider.is_available())

    def test_pre_compress_reminder(self):
        provider = self.make_provider()
        reminder = provider.on_pre_compress([])
        self.assertIn("brain_memorize", reminder)

    def test_backup_paths_points_at_brain_dir(self):
        provider = self.make_provider()
        self.assertEqual(provider.backup_paths(), [str(self.brain_home)])


if __name__ == "__main__":
    unittest.main()
