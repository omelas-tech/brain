"""hermes-brain-memory — Brain Memory provider for Hermes Agent.

This package is an *installer + payload*: it vendors the Brain Memory
provider (a Hermes ``exclusive``/memory plugin, stdlib only) and ships the
``hermes-brain-memory`` console script that copies it into
``$HERMES_HOME/plugins/brain/``, where Hermes' user-plugin memory discovery
picks it up.

The provider itself lives in ``_vendor/brain/`` and is deliberately
self-contained — Hermes loads it from the plugins directory, never through
this package's import path.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
