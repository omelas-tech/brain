#!/usr/bin/env bash
# Shared scaffold: seed the case's fixture.json into a fresh brain in $HOME.
# Each case's seed.sh execs this with its own directory.
set -euo pipefail
CASE_DIR="$1"
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$LIB_DIR/seed.js" "$CASE_DIR/fixture.json"
