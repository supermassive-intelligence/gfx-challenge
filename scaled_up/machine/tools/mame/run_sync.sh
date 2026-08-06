#!/usr/bin/env bash
# run_sync.sh -- MAME-side register capture at the 0x26D9 per-frame sync point.
# Headless, deterministic, no -debug (which pauses on launch). Cold reset, no input.
#
# Usage: ./run_sync.sh [frames] [out.jsonl]
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FRAMES="${1:-1200}"
OUT="${2:-/tmp/cosim_mame.jsonl}"

ROM_PARENT="${REPO_ROOT}/rom"          # contains the 'berzerk' sub-folder
LUA_SCRIPT="${HERE}/sync_capture.lua"

export MAME_SYNC_OUT="$OUT"
export MAME_SYNC_FRAMES="$FRAMES"

mame \
    -window \
    -sound none \
    -nothrottle \
    -rompath "$ROM_PARENT" \
    -cfg_directory "${HERE}/cfg" \
    -nvram_directory "${HERE}/nvram" \
    -autoboot_script "$LUA_SCRIPT" \
    berzerk

echo "run_sync: register snapshots written to $OUT"
