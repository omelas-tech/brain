"""Test harness shim: run the hermes-agent Brain provider suite against the
*packaged* provider payload.

``test_brain_provider.py`` is the suite from the hermes-agent tree and
imports the provider as ``plugins.memory.brain`` (the in-tree layout, where
the whole provider lives in ``__init__.py``). The packaged payload keeps the
user-installed split layout (``__init__.py`` + ``provider.py`` with the
ImportError shim), so this conftest:

1. loads ``src/hermes_brain_memory/_vendor/brain/`` as a real package under
   the name ``plugins.memory.brain`` (synthetic parent packages, same trick
   hermes-agent's own loader uses), and
2. re-exports the ``provider`` submodule's module-level names onto the
   package object so harness accesses like ``brain_module.shutil`` /
   ``brain_module.subprocess`` / ``brain_module.validate_relative_path``
   resolve exactly as they do against the in-tree single-file layout.

No test is modified; the code under test is byte-identical to what
``hermes-brain-memory install`` copies into ``$HERMES_HOME/plugins/brain``.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import sys
from pathlib import Path

VENDOR = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "hermes_brain_memory"
    / "_vendor"
    / "brain"
)


def _register_synthetic_package(name: str) -> None:
    if name in sys.modules:
        return
    spec = importlib.machinery.ModuleSpec(name, None, is_package=True)
    spec.submodule_search_locations = []
    sys.modules[name] = importlib.util.module_from_spec(spec)


def _load_packaged_provider() -> None:
    if "plugins.memory.brain" in sys.modules:
        return
    for parent in ("plugins", "plugins.memory"):
        _register_synthetic_package(parent)

    spec = importlib.util.spec_from_file_location(
        "plugins.memory.brain",
        VENDOR / "__init__.py",
        submodule_search_locations=[str(VENDOR)],
    )
    assert spec and spec.loader, f"cannot load packaged provider from {VENDOR}"
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["plugins.memory.brain"] = pkg
    spec.loader.exec_module(pkg)

    provider_mod = sys.modules.get("plugins.memory.brain.provider")
    if provider_mod is None:  # __init__ fell back to its ImportError shim
        pspec = importlib.util.spec_from_file_location(
            "plugins.memory.brain.provider", VENDOR / "provider.py"
        )
        assert pspec and pspec.loader
        provider_mod = importlib.util.module_from_spec(pspec)
        sys.modules["plugins.memory.brain.provider"] = provider_mod
        pspec.loader.exec_module(provider_mod)

    # Mirror the in-tree single-file namespace: everything provider.py
    # defines at module level becomes visible on plugins.memory.brain.
    for name, value in vars(provider_mod).items():
        if name.startswith("__"):
            continue
        if not hasattr(pkg, name):
            setattr(pkg, name, value)


_load_packaged_provider()
