#!/usr/bin/env bash
# cosim_run.sh -- one-shot 0x26D9 drift detector: capture JS + MAME, then diff.
#
# This is a DRIFT DETECTOR, not an equivalence gate (see cdoc/decisions.md
# 2026-06-16): register-at-IRQ over-specifies vs the behavioral-fidelity bar
# (cycle-exactness was deferred when the Z80 core was vendored). The equivalence
# gate is the VRAM-hash golden-frame gate (T3.4). This run fails only on drift
# REGRESSION against the pinned baseline.
#
# Usage: ./cosim_run.sh [frames]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACHINE_DIR="$(cd "${HERE}/.." && pwd)"
FRAMES="${1:-1200}"
BASELINE="${MACHINE_DIR}/fixtures/cosim/sync_26d9_baseline.json"

echo "[1/3] JS capture (${FRAMES} frames)"
node "${MACHINE_DIR}/tools/cosim_capture_js.js" "${FRAMES}" /tmp/cosim_js.jsonl

echo "[2/3] MAME capture (${FRAMES} frames)"
bash "${HERE}/mame/run_sync.sh" "${FRAMES}" /tmp/cosim_mame.jsonl >/dev/null

echo "[3/3] diff vs baseline"
node "${MACHINE_DIR}/tools/cosim_diff.js" /tmp/cosim_js.jsonl /tmp/cosim_mame.jsonl --baseline "${BASELINE}"
