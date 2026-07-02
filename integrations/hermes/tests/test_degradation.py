"""Graceful degradation: missing binary or failing CLI never raises into the agent."""

from __future__ import annotations

import unittest

from testutil import BrainTestCase


class TestBinaryMissing(BrainTestCase):
    def setUp(self):
        super().setUp()
        self.mod.shutil.which = lambda _name: None

        def _raise(argv, **kwargs):
            raise FileNotFoundError(argv[0])

        self.mod.subprocess.run = _raise

    def test_is_available_false(self):
        provider = self.make_provider()
        self.assertFalse(provider.is_available())

    def test_lifecycle_returns_empty_never_raises(self):
        provider = self.make_provider()
        self.assertEqual(provider.system_prompt_block(), "")
        self.assertEqual(provider.prefetch("anything"), "")
        provider.queue_prefetch("anything")
        provider.on_turn_start(1, "hello")
        provider.sync_turn("u", "a")
        self.assertEqual(provider.on_pre_compress([]), "")
        provider.on_memory_write("append", "MEMORY.md", "x" * 100)
        provider.shutdown()

    def test_tools_return_error_strings(self):
        provider = self.make_provider()
        out = provider.handle_tool_call("brain_recall", {"query": "x"})
        self.assertIn("brain error", out)
        self.assertIn("not installed", out)
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
        self.assertIn("brain error", out)
        out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a"]})
        self.assertIn("brain error", out)

    def test_session_end_still_saves_context(self):
        # contexts.json is direct file IO — works without the CLI.
        provider = self.make_provider()
        provider.on_session_end([])
        self.assertTrue((self.brain_home / "contexts.json").exists())


class TestCliErrors(BrainTestCase):
    def test_nonzero_exit_degrades(self):
        def _fail(argv, **kwargs):
            import subprocess

            return subprocess.CompletedProcess(argv, 1, stdout="", stderr="kaboom")

        self.mod.subprocess.run = _fail
        provider = self.make_provider()
        self.assertEqual(provider.system_prompt_block(), "")
        self.assertIn("No memories matched", provider.handle_tool_call("brain_recall", {"query": "x"}))

    def test_timeout_degrades(self):
        import subprocess as sp

        def _timeout(argv, **kwargs):
            raise sp.TimeoutExpired(argv, kwargs.get("timeout", 15))

        self.mod.subprocess.run = _timeout
        provider = self.make_provider()
        self.assertEqual(provider.system_prompt_block(), "")
        self.assertEqual(provider.prefetch("x"), "")

    def test_binary_vanishes_after_initialize(self):
        # which() succeeds but exec fails — e.g. binary removed mid-session.
        def _raise(argv, **kwargs):
            raise FileNotFoundError(argv[0])

        self.mod.subprocess.run = _raise
        provider = self.make_provider()
        self.assertEqual(provider.system_prompt_block(), "")
        out = provider.handle_tool_call("brain_reinforce", {"ids": ["mem_a"]})
        self.assertIn("brain error", out)

    def test_handle_tool_call_swallows_internal_errors(self):
        provider = self.make_provider()

        def _boom(argv, **kwargs):
            raise RuntimeError("unexpected")

        self.mod.subprocess.run = _boom
        out = provider.handle_tool_call("brain_recall", {"query": "x"})
        self.assertIsInstance(out, str)
        self.assertIn("brain error", out)


if __name__ == "__main__":
    unittest.main()
