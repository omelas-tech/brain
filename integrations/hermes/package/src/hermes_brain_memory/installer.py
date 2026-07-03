"""Installer CLI for the Brain Memory provider for Hermes Agent.

Mirrors the mechanism established by ``hermes-memori`` (the sanctioned path
for standalone memory providers): a pip package whose console script copies
the provider directory into ``$HERMES_HOME/plugins/<name>/``, where Hermes'
memory-provider discovery (``plugins/memory/__init__.py`` in hermes-agent)
finds it. Activation stays a Hermes concern (``memory.provider: brain``).

Subcommands:

    hermes-brain-memory install [--force]   copy the provider into place
    hermes-brain-memory uninstall           remove it again
    hermes-brain-memory status              show install/activation state

Stdlib only. Exit codes: 0 = success, 1 = failure / action needed.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Iterable, List, Optional

from . import __version__

PROVIDER_NAME = "brain"
_PAYLOAD = Path(__file__).resolve().parent / "_vendor" / "brain"

ACTIVATION_SNIPPET = """\
Activate it (one external memory provider can be active at a time):

    hermes config set memory.provider brain
    hermes memory setup        # optional guided configuration

or add to $HERMES_HOME/config.yaml:

    memory:
      provider: brain

Requires the brain CLI:  npm install -g brain-memory
Verify:                  hermes memory status
"""


# ---------------------------------------------------------------------------
# Paths & helpers
# ---------------------------------------------------------------------------


def hermes_home(override: Optional[str] = None) -> Path:
    """Resolve HERMES_HOME: --hermes-home flag > $HERMES_HOME > ~/.hermes."""
    if override:
        return Path(override).expanduser()
    env = os.environ.get("HERMES_HOME", "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".hermes"


def target_dir(home: Path) -> Path:
    return home / "plugins" / PROVIDER_NAME


def payload_files() -> Iterable[Path]:
    """Relative paths of every payload file (skips bytecode/caches)."""
    for p in sorted(_PAYLOAD.rglob("*")):
        if not p.is_file():
            continue
        if "__pycache__" in p.parts or p.suffix in (".pyc", ".pyo"):
            continue
        yield p.relative_to(_PAYLOAD)


def provider_version() -> str:
    try:
        text = (_PAYLOAD / "plugin.yaml").read_text(encoding="utf-8")
        m = re.search(r"^version:\s*[\"']?([^\s\"']+)", text, re.MULTILINE)
        if m:
            return m.group(1)
    except OSError:
        pass
    return "unknown"


def diff_against(target: Path) -> List[str]:
    """Payload files that are missing from or differ in *target*."""
    diffs: List[str] = []
    for rel in payload_files():
        dst = target / rel
        try:
            if not dst.is_file() or (_PAYLOAD / rel).read_bytes() != dst.read_bytes():
                diffs.append(str(rel))
        except OSError:
            diffs.append(str(rel))
    return diffs


def looks_like_ours(target: Path) -> bool:
    """Heuristic: is the directory a Brain Memory provider install?"""
    manifest = target / "plugin.yaml"
    provider = target / "provider.py"
    init = target / "__init__.py"
    try:
        if manifest.is_file() and re.search(
            r"^name:\s*[\"']?brain\b", manifest.read_text(encoding="utf-8"), re.MULTILINE
        ):
            return True
        for candidate in (provider, init):
            if candidate.is_file() and "BrainMemoryProvider" in candidate.read_text(
                encoding="utf-8", errors="replace"
            ):
                return True
    except OSError:
        pass
    return False


def active_provider(home: Path) -> Optional[str]:
    """Best-effort read of ``memory.provider`` from $HERMES_HOME/config.yaml.

    Deliberately naive (stdlib only, no YAML dependency): scans for a
    top-level ``memory:`` block and its ``provider:`` key.
    """
    cfg = home / "config.yaml"
    try:
        text = cfg.read_text(encoding="utf-8")
    except OSError:
        return None
    in_memory = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            in_memory = line.strip() == "memory:"
            continue
        if in_memory:
            m = re.match(r"\s+provider:\s*[\"']?([A-Za-z0-9_-]+)", line)
            if m:
                return m.group(1)
    return None


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_install(home: Path, force: bool) -> int:
    target = target_dir(home)
    if not _PAYLOAD.is_dir():
        print(f"error: packaged provider payload missing at {_PAYLOAD}", file=sys.stderr)
        return 1

    diffs = diff_against(target) if target.exists() else None
    if target.exists() and not diffs:
        print(f"Brain Memory provider already up to date at {target} "
              f"(provider v{provider_version()}).")
        print()
        print(ACTIVATION_SNIPPET)
        return 0

    if target.exists() and diffs and not force:
        ours = looks_like_ours(target)
        what = "an older/modified Brain Memory provider" if ours else "unrelated files"
        print(f"{target} already exists and contains {what}.", file=sys.stderr)
        print("Files that would be overwritten/added:", file=sys.stderr)
        for rel in diffs:
            print(f"  - {rel}", file=sys.stderr)
        print("\nRe-run with --force to overwrite.", file=sys.stderr)
        return 1

    target.mkdir(parents=True, exist_ok=True)
    for rel in payload_files():
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_PAYLOAD / rel, dst)
    # Drop stale bytecode from previous installs so Hermes never loads it.
    pycache = target / "__pycache__"
    if pycache.is_dir():
        shutil.rmtree(pycache, ignore_errors=True)

    print(f"Installed Brain Memory provider -> {target} (provider v{provider_version()}).")
    print()
    print(ACTIVATION_SNIPPET)
    return 0


def cmd_uninstall(home: Path, force: bool) -> int:
    target = target_dir(home)
    if not target.exists():
        print(f"Brain Memory provider is not installed at {target} — nothing to do.")
        return 0
    if not looks_like_ours(target) and not force:
        print(
            f"{target} does not look like a Brain Memory provider install; "
            "refusing to delete it. Re-run with --force if you are sure.",
            file=sys.stderr,
        )
        return 1
    shutil.rmtree(target)
    print(f"Removed {target}.")
    active = active_provider(home)
    if active == PROVIDER_NAME:
        print(
            "\nNote: memory.provider is still set to 'brain' in config.yaml.\n"
            "Deactivate it with:  hermes memory off   "
            "(or hermes config set memory.provider '')"
        )
    print("\nYour memories are untouched — the store lives in ~/.brain/, not in HERMES_HOME.")
    return 0


def cmd_status(home: Path) -> int:
    target = target_dir(home)
    if not target.exists():
        state = "not installed"
    else:
        diffs = diff_against(target)
        if not diffs:
            state = "installed (up to date)"
        elif looks_like_ours(target):
            state = f"installed (differs from packaged v{provider_version()} — run `install --force` to update)"
        else:
            state = "path occupied by unrelated files"

    brain_bin = os.environ.get("BRAIN_BIN", "").strip() or "brain"
    if os.sep in brain_bin:
        brain_found = os.path.isfile(os.path.expanduser(brain_bin))
        brain_where = brain_bin if brain_found else None
    else:
        brain_where = shutil.which(brain_bin)
        brain_found = brain_where is not None

    active = active_provider(home)

    print(f"package        : hermes-brain-memory {__version__} (provider payload v{provider_version()})")
    print(f"HERMES_HOME    : {home}")
    print(f"provider dir   : {target} — {state}")
    print(f"brain CLI      : {brain_where or 'NOT FOUND (npm install -g brain-memory)'}")
    print(f"memory.provider: {active or '(not set)'}"
          + ("  <- active" if active == PROVIDER_NAME else ""))
    if state == "not installed":
        print("\nInstall with:  hermes-brain-memory install")
    elif active != PROVIDER_NAME:
        print("\nActivate with: hermes config set memory.provider brain")
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hermes-brain-memory",
        description=(
            "Install the Brain Memory provider for Hermes Agent into "
            "$HERMES_HOME/plugins/brain (local-first, cross-agent Markdown "
            "memory in ~/.brain)."
        ),
    )
    parser.add_argument("--version", action="version",
                        version=f"hermes-brain-memory {__version__}")
    parser.add_argument(
        "--hermes-home",
        metavar="PATH",
        help="Hermes home directory (default: $HERMES_HOME, else ~/.hermes)",
    )
    sub = parser.add_subparsers(dest="command")

    p_install = sub.add_parser("install", help="Copy the provider into $HERMES_HOME/plugins/brain")
    p_install.add_argument("--force", action="store_true",
                           help="Overwrite an existing/modified install")

    p_uninstall = sub.add_parser("uninstall", help="Remove the provider from $HERMES_HOME/plugins")
    p_uninstall.add_argument("--force", action="store_true",
                             help="Delete the directory even if it doesn't look like ours")

    sub.add_parser("status", help="Show install and activation status")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2
    home = hermes_home(args.hermes_home)
    if args.command == "install":
        return cmd_install(home, force=args.force)
    if args.command == "uninstall":
        return cmd_uninstall(home, force=args.force)
    if args.command == "status":
        return cmd_status(home)
    parser.print_help()
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
