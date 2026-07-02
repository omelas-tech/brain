"""CLI commands for the Brain Memory provider.

Registered via ``register_cli(subparser)`` — commands appear under
``hermes memory ...`` only when ``memory.provider: brain`` is active.
Stdlib only; shells out to the ``brain`` CLI (brain-memory npm package).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

try:
    from .provider import BrainMemoryProvider, brain_dir
except ImportError:  # pragma: no cover — standalone loading
    import importlib.util as _ilu

    _spec = _ilu.spec_from_file_location(
        "hermes_brain_memory_provider_cli",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "provider.py"),
    )
    _mod = _ilu.module_from_spec(_spec)
    assert _spec.loader is not None
    _spec.loader.exec_module(_mod)
    BrainMemoryProvider = _mod.BrainMemoryProvider
    brain_dir = _mod.brain_dir


def _brain_bin() -> str:
    return os.environ.get("BRAIN_BIN", "brain")


def _cmd_status(args) -> int:
    bin_name = _brain_bin()
    found = shutil.which(bin_name) or (os.path.isfile(os.path.expanduser(bin_name)) and bin_name)
    store = brain_dir()
    index = store / "index.json"
    print(f"brain CLI     : {found or 'NOT FOUND (npm install -g brain-memory)'}")
    print(f"store         : {store} ({'present' if store.exists() else 'missing'})")
    print(f"index.json    : {'present' if index.exists() else 'missing'}")
    if found and index.exists():
        try:
            env = dict(os.environ)
            env["BRAIN_AGENT"] = "hermes"
            proc = subprocess.run(
                [bin_name, "session-start", "--project", os.environ.get("BRAIN_PROJECT", "hermes")],
                capture_output=True,
                text=True,
                timeout=15,
                env=env,
            )
            if proc.returncode == 0:
                payload = json.loads(proc.stdout)
                print(f"memories      : {payload.get('memory_count', '?')}")
                print(f"pinned        : {len(payload.get('pinned') or [])}")
                print(f"skills        : {len(payload.get('skills_index') or [])}")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            print("memories      : (could not query)")
    return 0


def _cmd_recall(args) -> int:
    provider = BrainMemoryProvider()
    provider.initialize("cli", hermes_home=os.environ.get("HERMES_HOME", ""))
    print(
        provider.handle_tool_call(
            "brain_recall",
            {"query": " ".join(args.query), "reinforce": False},
        )
    )
    return 0


def _dispatch(args) -> int:
    command = getattr(args, "brain_command", None)
    if command == "status":
        return _cmd_status(args)
    if command == "recall":
        return _cmd_recall(args)
    print("usage: hermes memory {status|recall <query>}")
    return 1


def register_cli(subparser) -> None:
    """Attach brain subcommands to the `hermes memory` parser."""
    subs = subparser.add_subparsers(dest="brain_command")
    subs.add_parser("status", help="Show Brain Memory store status")
    recall = subs.add_parser("recall", help="Recall memories from ~/.brain")
    recall.add_argument("query", nargs="+", help="What to recall")
    subparser.set_defaults(func=_dispatch)
