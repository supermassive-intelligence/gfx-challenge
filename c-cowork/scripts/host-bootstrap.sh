#!/usr/bin/env bash
# Idempotent host bootstrap for the Berzerk emulator on a Docker-less k8s pod.
# Re-running is a no-op if all required packages are already installed.
set -euo pipefail
PKGS=(
  build-essential
  noweb
  texlive-latex-base texlive-latex-recommended
  libsdl2-dev
  gdb
  python3
)
echo "Checking host packages..."
MISSING=()
for p in "${PKGS[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p")
done
if [ ${#MISSING[@]} -eq 0 ]; then
  echo "All required packages already installed."
  exit 0
fi
echo "Installing: ${MISSING[*]}"
sudo apt-get update -y
sudo apt-get install -y "${MISSING[@]}"
echo "Done."
