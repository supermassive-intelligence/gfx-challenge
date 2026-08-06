#!/usr/bin/env bash
# extract_samples.sh — capture Berzerk audio from MAME and split into clips.
#
# WHY THIS SHAPE: the speech "ROM" is S14001A-compressed allophone data, not
# audio. The only faithful way to turn it into sound is to let MAME's S14001A
# emulation play it. So: (1) record gameplay/attract to a WAV with MAME's
# built-in -wavwrite, (2) split that WAV into per-clip files on silence.
# The clips are derived from YOUR ROMs via YOUR pinned MAME = provenance-clean
# and guaranteed to match the Phase-3 oracle.
#
# Requires: mame on PATH, ffmpeg on PATH (brew install ffmpeg).
# Usage:
#   tools/extract_samples.sh record   # launch MAME writing berzerk_capture.wav
#   tools/extract_samples.sh split    # split that WAV into clips/ on silence
#   tools/extract_samples.sh both
#
# After 'record': play through attract mode + a game so every phrase/effect
# fires (Intruder Alert, The humanoid must not escape, Chicken/fight like a
# robot, laser, robot hit, player death, Evil Otto). Then quit MAME (Esc).

set -euo pipefail

ROMPATH="${ROMPATH:-$HOME/checkout/smi/gfx-challenge/rom}"
WAV="${WAV:-berzerk_capture.wav}"
OUTDIR="${OUTDIR:-clips}"
# silence params: a gap >= 0.35s below -45dB separates clips. Tune if needed.
SIL_DUR="${SIL_DUR:-0.35}"
SIL_DB="${SIL_DB:--45dB}"

record() {
  command -v mame >/dev/null || { echo "mame not on PATH"; exit 1; }
  echo "Recording to $WAV. Play attract + one game so every sound fires, then Esc to quit."
  echo "MAME version (pin this in cdoc/decisions.md):"
  mame -version || true
  mame berzerk -rompath "$ROMPATH" -wavwrite "$WAV" -window
  echo "Wrote $WAV ($(du -h "$WAV" | cut -f1))."
}

split() {
  command -v ffmpeg >/dev/null || { echo "ffmpeg not on PATH (brew install ffmpeg)"; exit 1; }
  [ -f "$WAV" ] || { echo "No $WAV — run 'record' first."; exit 1; }
  mkdir -p "$OUTDIR"

  echo "Detecting silence boundaries (gap>=${SIL_DUR}s, floor=${SIL_DB})..."
  # Parse ffmpeg silencedetect to get the spoken/active segments between silences.
  mapfile -t ENDS < <(ffmpeg -i "$WAV" -af "silencedetect=noise=${SIL_DB}:d=${SIL_DUR}" -f null - 2>&1 \
      | grep 'silence_start' | sed -E 's/.*silence_start: ([0-9.]+).*/\1/')
  mapfile -t STARTS < <(ffmpeg -i "$WAV" -af "silencedetect=noise=${SIL_DB}:d=${SIL_DUR}" -f null - 2>&1 \
      | grep 'silence_end' | sed -E 's/.*silence_end: ([0-9.]+).*/\1/')

  # Segment i = from STARTS[i-1] (or 0) to ENDS[i]. Build [start,end] pairs.
  echo "Found ${#ENDS[@]} silence starts, ${#STARTS[@]} silence ends."
  local idx=0 segstart=0
  # active segment before each silence_start:
  for i in "${!ENDS[@]}"; do
    local segend="${ENDS[$i]}"
    local dur
    dur=$(awk "BEGIN{print $segend - $segstart}")
    # skip ultra-short blips (< 0.15s = likely noise, not a real clip)
    if awk "BEGIN{exit !($dur >= 0.15)}"; then
      printf -v name "%s/clip_%02d_%05.2fs.wav" "$OUTDIR" "$idx" "$dur"
      ffmpeg -nostdin -loglevel error -y -i "$WAV" -ss "$segstart" -to "$segend" "$name"
      echo "  $name  (${dur}s)"
      idx=$((idx+1))
    fi
    # next active segment starts at this silence's end
    segstart="${STARTS[$i]:-$segend}"
  done
  echo "Wrote $idx clips to $OUTDIR/. Now AUDITION each, rename to its event"
  echo "(speech_intruder_alert.wav, sfx_laser.wav, ...) and move into"
  echo "machine/fixtures/samples/. Record the MAME version + which in-game action"
  echo "produced each clip in cdoc/decisions.md (T2.8 provenance)."
}

case "${1:-both}" in
  record) record ;;
  split)  split ;;
  both)   record; split ;;
  *) echo "usage: $0 {record|split|both}"; exit 1 ;;
esac
