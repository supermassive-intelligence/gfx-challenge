#!/usr/bin/env bash
# --------------------------------------------------------------
# run_mame.sh – one-click wrapper for the MAME Lua replay harness
# --------------------------------------------------------------
# What it does:
#   * Sets minimal environment variables for MAME.
#   * Uses the repository’s ROM directory: <repo>/scaled_up/rom/berzerk.
#   * Exports MAME_INPUT_SCRIPT and MAME_HASH_OUT for the Lua script.
#   * Loads the Lua script via MAME’s -autoboot_script flag.
#   * Runs the Berzerk driver (berzerk) and exits when the Lua
#     script calls emu.exit().
# --------------------------------------------------------------

set -euo pipefail

# ---------- 1. Repository root ----------
REPO_ROOT="$(git rev-parse --show-toplevel)"

# ---------- 2. Basic environment ----------
export MAMEHOME="${MAMEHOME:-$(brew --prefix mame)}"
export PATH="${PATH}:${MAMEHOME}/bin"

# ---------- 3. ROM directory (fixed to the repo location) ----------
ROM_DIR="${REPO_ROOT}/scaled_up/rom/berzerk"

# ---------- 4. Paths ----------
LUA_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/replay.lua"
INPUT_SCRIPT="${REPO_ROOT}/scaled_up/traces/scripts/attract-only.jsonl"
HASH_OUT="/tmp/berzerk-replay.hashes"

# ---------- 5. Sanity checks ----------
if [[ ! -x "$(command -v mame)" ]]; then
    echo "❌ Error: 'mame' executable not found in PATH."
    exit 1
fi
if [[ ! -f "$LUA_SCRIPT" ]]; then
    echo "❌ Error: Lua script not found at $LUA_SCRIPT"
    exit 1
fi
if [[ ! -f "$INPUT_SCRIPT" ]]; then
    echo "❌ Error: Input script not found at $INPUT_SCRIPT"
    exit 1
fi
if [[ ! -d "$ROM_DIR" ]]; then
    echo "❌ Error: ROM directory not found at $ROM_DIR"
    exit 1
fi

# ---------- 6. Export env vars for the Lua script ----------
export MAME_INPUT_SCRIPT="$INPUT_SCRIPT"
export MAME_HASH_OUT="$HASH_OUT"

# ---------- 7. Run MAME ----------
echo "🚀 Launching MAME – Berzerk (replay mode)…"
echo "   Using ROM directory: $ROM_DIR"
mame \
    -debug \
    -window \
    -sound none \
    -rompath "$ROM_DIR" \
    -autoboot_script "$LUA_SCRIPT" \
    berzerk

echo "✅ MAME replay finished – hashes written to $HASH_OUT"
