#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

SANDBOX_IMAGE="${SANDBOX_IMAGE:-gfx-challenge-sandbox:latest}"

# Check if sandbox image exists, build if missing
if ! docker image inspect "$SANDBOX_IMAGE" &>/dev/null; then
    echo "Sandbox image not found. Building..."
    bash scripts/build_sandbox_image.sh
fi

exec python generate.py
