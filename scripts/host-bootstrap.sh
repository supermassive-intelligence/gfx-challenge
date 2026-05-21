#!/usr/bin/env bash
# Idempotent host bootstrap for the Berzerk emulator on a Docker-less k8s pod.
# Run once before the first build:
#   sudo bash scripts/host-bootstrap.sh
# Re-running is a no-op.
set -euo pipefail

PKGS=(
  build-essential                                  # g++, make
  noweb                                            # notangle, noweave
  texlive-latex-base texlive-latex-recommended     # pdflatex (for weave)
  libsdl2-dev                                      # SDL backend headers/libs
  gdb                                              # debugging
  python3                                          # scripts/z80_disasm.py
)

OPTIONAL_VISUAL_PKGS=(
  xvfb x11vnc novnc websockify                     # only if Phase E Option 2 is requested
)

echo "==> Checking required host packages..."
MISSING=()
for p in "${PKGS[@]}"; do
  if ! dpkg -s "$p" >/dev/null 2>&1; then
    MISSING+=("$p")
  fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "==> All required packages already installed."
else
  echo "==> Installing: ${MISSING[*]}"
  sudo apt-get update -y
  sudo apt-get install -y "${MISSING[@]}"
fi

echo
echo "==> Verifying toolchain reachability (no commands that read stdin):"
g++ --version | head -1
pdflatex --version | head -1
python3 --version
# notangle/noweave have no --version or --help; they read stdin if invoked bare.
# Use `which` to confirm they're on PATH instead of running them.
for bin in notangle noweave; do
  path="$(command -v "$bin" || true)"
  if [ -n "$path" ]; then
    echo "$bin: $path"
  else
    echo "$bin: MISSING (apt install noweb)"
    exit 1
  fi
done

echo
echo "==> Bootstrap done. Next: make tangle && make build"

# Visual stack is opt-in. Uncomment ONLY if user explicitly approves §1.7 Option 2.
# echo "==> (optional) installing visual stack: ${OPTIONAL_VISUAL_PKGS[*]}"
# sudo apt-get install -y "${OPTIONAL_VISUAL_PKGS[@]}"
