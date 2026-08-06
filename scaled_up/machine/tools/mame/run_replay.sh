#!/usr/bin/env bash
# run_replay.sh – wrapper for the MAME Lua replay harness (T3.2)
# Usage:
#   ./run_replay.sh <path/to/input.jsonl> <output_hashes.txt>
#   (MAME must be in your PATH as `mame`.)

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <input_script.jsonl> <output_hashes.txt>"
    exit 1
fi

INPUT_SCRIPT=$1
HASH_OUT=$2

# Path to the Berzerk ROM directory – adjust if your ROMs live elsewhere.
ROM_DIR="$(git rev-parse --show-toplevel)/rom/berzerk"

# Path to the Lua script (relative to the current directory).
LUA_SCRIPT="$(pwd)/replay.lua"

# MAME binary – assumes "mame" is on the PATH.
# We run headless (`-window` is optional) and disable sound for determinism.
# -debug enables Lua; -luascript loads the script; the driver name (`berzerk`) is last.
mame \
    -debug \
    -window \
    -sound none \
    -rompath "$ROM_DIR" \
    -luascript script="$LUA_SCRIPT" \
    -input_script "$INPUT_SCRIPT" \
    -hash_out "$HASH_OUT" \
    berzerk

# When the Lua script calls emu.exit(), MAME will terminate and this wrapper will return.
