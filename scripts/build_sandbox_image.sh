#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

IMAGE_NAME="${SANDBOX_IMAGE:-gfx-challenge-sandbox:latest}"

echo "Building sandbox image: ${IMAGE_NAME}"
docker build \
    -t "${IMAGE_NAME}" \
    -f "${PROJECT_ROOT}/sandbox/Dockerfile.sandbox" \
    "${PROJECT_ROOT}"

echo "Done. Image: ${IMAGE_NAME}"
