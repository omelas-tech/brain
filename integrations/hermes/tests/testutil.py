"""Shared helpers for the Brain × Hermes integration tests.

No __init__.py in this directory on purpose: `python3 -m unittest discover -s
integrations/hermes/tests` inserts the start dir on sys.path, so test modules
import this file as a plain top-level module. The provider and hook modules
are loaded by file path (they are plugin files, not an installed package).
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
INTEGRATION_ROOT = HERE.parent

_ENV_KEYS = (
    "BRAIN_DIR",
    "BRAIN_PROJECT",
    "BRAIN_BIN",
    "BRAIN_TOP_RECALL",
    "BRAIN_AUTO_REINFORCE",
    "BRAIN_SYNC_ON_MEMORIZE",
    "HERMES_HOME",
)


def _load(name: str, relpath: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, INTEGRATION_ROOT / relpath)
    assert spec and spec.loader, f"cannot load {relpath}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def load_provider_module():
    return _load("brain_provider_under_test", "plugins/memory/brain/provider.py")


def load_hook_module():
    return _load("brain_hook_under_test", "agent-hooks/_brain_hook.py")


def completed(argv, stdout="", returncode=0, stderr=""):
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
        return completed(argv, stdout=resp)

    def calls_for(self, sub):
        return [(a, k) for (a, k) in self.calls if len(a) > 1 and a[1] == sub]


class BrainTestCase(unittest.TestCase):
    """Isolated env: temp BRAIN_DIR + HERMES_HOME, brain binary 'found', and a
    patched subprocess.run so the real brain CLI is never invoked."""

    def setUp(self):
        self.mod = load_provider_module()
        self.tmp = Path(tempfile.mkdtemp(prefix="brain-hermes-test-"))
        self.brain_home = self.tmp / "brain"
        self.brain_home.mkdir()
        (self.brain_home / "index.json").write_text("{}", encoding="utf-8")
        self.hermes_home = self.tmp / "hermes"
        self.hermes_home.mkdir()

        self._saved_env = {k: os.environ.pop(k, None) for k in _ENV_KEYS}
        os.environ["BRAIN_DIR"] = str(self.brain_home)

        self._orig_which = self.mod.shutil.which
        self.mod.shutil.which = lambda _name: "/fake/bin/brain"
        self._orig_run = self.mod.subprocess.run
        self.fake_run = FakeRun()
        self.mod.subprocess.run = self.fake_run

    def tearDown(self):
        self.mod.shutil.which = self._orig_which
        self.mod.subprocess.run = self._orig_run
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_provider(self, session_id="sess-test", **config):
        if config:
            (self.hermes_home / "brain.json").write_text(json.dumps(config), encoding="utf-8")
        provider = self.mod.BrainMemoryProvider()
        provider.initialize(session_id, hermes_home=str(self.hermes_home))
        return provider

    def write_memory(self, rel_path: str, body: str, frontmatter: str = "id: mem_x\ntype: learning"):
        path = self.brain_home / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\n{frontmatter}\n---\n\n{body}\n", encoding="utf-8")
        return path
