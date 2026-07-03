"""Brain Memory provider plugin for Hermes Agent.

Local-first, human-readable Markdown memory (~/.brain) shared across Hermes,
Claude Code, Gemini CLI, Codex, OpenCode, and OpenClaw. See README.md.
"""

try:
    # Normal case: loaded as a package (in-tree plugins/memory/brain or
    # $HERMES_HOME/plugins/brain when the loader imports the package).
    from .provider import BrainMemoryProvider
except ImportError:  # pragma: no cover
    # Fallback: some loaders exec __init__.py as a standalone module, which
    # breaks relative imports. Load provider.py from the same directory.
    import importlib.util as _ilu
    import os as _os

    _spec = _ilu.spec_from_file_location(
        "hermes_brain_memory_provider",
        _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "provider.py"),
    )
    _mod = _ilu.module_from_spec(_spec)
    assert _spec.loader is not None
    _spec.loader.exec_module(_mod)
    BrainMemoryProvider = _mod.BrainMemoryProvider

__all__ = ["BrainMemoryProvider", "register"]


def register(ctx) -> None:
    """Register Brain Memory as a memory provider plugin."""
    ctx.register_memory_provider(BrainMemoryProvider())
