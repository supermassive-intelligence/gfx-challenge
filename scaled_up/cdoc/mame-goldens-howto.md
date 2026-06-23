# Generating + committing the MAME golden hashes (Sudnya-side)

The last real external-regression gap for Scope A. `fixtures/goldens/` is empty, so
`node tools/golden.js` reports "no-golden" for every scenario (exit 2 — expected, not a
failure). This restores the JS ≡ MAME regression and seeds the Scope-B oracle.

**This is Sudnya-side** because it needs stock MAME + the real ROMs (never committed). Claude
cannot fabricate these hashes — they must come from a real MAME run.

## What the golden is

For each scenario script `traces/scripts/<name>.jsonl`, a file
`machine/fixtures/goldens/<name>.hashes` containing one line per frame:
```
<frame>,0x<fnv1a32>
```
The hash is FNV-1a 32-bit over **VRAM `0x4000-0x5FFF` (8 KB) + color RAM `0x8000-0x87FF`
(2 KB)** — read straight from MAME's memory each frame. The JS side
(`tools/replay_hash.js`, used by `golden.js`) hashes the identical bytes, so the two are
directly comparable. (NB: this is the *full-VRAM* hash, including the bottom status strip —
distinct from the `replay_hash_visible.*` rows-0–223 variant. Use `replay.lua`, below, which
matches `replay_hash.js`.)

The renderer crop fix (`src/video.js`, 2026-06-22) does **not** affect these hashes — the
hash reads raw VRAM memory, not `renderToRGBA` output.

## Prerequisites

- Stock MAME on PATH as `mame` (e.g. `brew install mame`). No MAME patches.
- ROMs at `<repo>/rom/berzerk/` (the `run_mame.sh` harness expects
  `<repo>/scaled_up/rom/berzerk` — adjust `-rompath` to wherever your `rom/berzerk` lives).
- The Lua harness: `machine/tools/mame/replay.lua` (reads env vars `MAME_INPUT_SCRIPT`,
  `MAME_HASH_OUT`; injects inputs per frame; writes the per-frame hash; calls
  `manager.machine:exit()` at the last frame).

## Generate one golden (per scenario)

From `scaled_up/machine/tools/mame/`, for each `<name>` in `attract-only`,
`coin-start-first-maze`, `credited-play-smoke`, `free-play`, `kill_robots`,
`maze-transition`, `player-death`:

```sh
cd <repo>/scaled_up/machine/tools/mame

export MAME_INPUT_SCRIPT="<repo>/scaled_up/traces/scripts/<name>.jsonl"
export MAME_HASH_OUT="<repo>/scaled_up/machine/fixtures/goldens/<name>.hashes"

mame \
  -debug \
  -window \
  -sound none \
  -rompath "<repo>/rom/berzerk" \
  -autoboot_script "$(pwd)/replay.lua" \
  berzerk
```

MAME runs the script and exits when the Lua hits the last frame (the hash file is written to
`$MAME_HASH_OUT`). `run_mame.sh` is the same invocation with `attract-only` + `/tmp` paths
hardcoded — copy it and swap the two env vars per scenario, or loop:

```sh
cd <repo>/scaled_up/machine/tools/mame
for name in attract-only coin-start-first-maze credited-play-smoke free-play \
            kill_robots maze-transition player-death; do
  MAME_INPUT_SCRIPT="<repo>/scaled_up/traces/scripts/$name.jsonl" \
  MAME_HASH_OUT="<repo>/scaled_up/machine/fixtures/goldens/$name.hashes" \
  mame -debug -window -sound none -rompath "<repo>/rom/berzerk" \
       -autoboot_script "$(pwd)/replay.lua" berzerk
done
```

## Confirm JS ≡ MAME, then commit

```sh
cd <repo>/scaled_up/machine
node tools/golden.js            # or: npm run golden
```

Expected once goldens exist: every scenario `✅ PASS` (exit 0). The **boot window (frames
0–258, Gate 1)** is the load-bearing part — JS ≡ MAME there is the established boot/POST
regression. If a *gameplay* scenario diverges past the boot window, that is a real finding
(report the first-diff frame `golden.js` prints — do not paper over it).

When green, commit the golden files (Sudnya does all git):
```sh
git add scaled_up/machine/fixtures/goldens/*.hashes
git commit -m "Add MAME golden hashes for <N> scenarios"
```

## Notes
- `fixtures/goldens/` is otherwise empty by design until this is run — do not hand-author or
  fabricate `.hashes` files.
- `npm run golden` is wired in `package.json` as a convenience alias for `node tools/golden.js`.
- If `replay.lua` errors on a MAME version (the Lua API moves between releases), the
  per-frame hook is `emu.add_machine_frame_notifier` and memory is
  `manager.machine.devices[":maincpu"].spaces["program"]:read_u8(addr)`; adjust to your MAME.
