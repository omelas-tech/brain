#!/usr/bin/env bash
# Brain Memory — on_session_end hook.
# Appends a session entry to ~/.brain/contexts.json (last 20 kept).
# Install: copy this file + _brain_hook.py to ~/.hermes/agent-hooks/
# and wire it under `hooks: on_session_end:` in ~/.hermes/config.yaml.
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_brain_hook.py" session-end
