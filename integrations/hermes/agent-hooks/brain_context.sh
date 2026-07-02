#!/usr/bin/env bash
# Brain Memory — pre_llm_call hook.
# On the first turn of a session, injects the `brain session-start` payload
# into the LLM context via {"context": "..."} on stdout.
# Install: copy this file + _brain_hook.py to ~/.hermes/agent-hooks/
# and wire it under `hooks: pre_llm_call:` in ~/.hermes/config.yaml.
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_brain_hook.py" context
