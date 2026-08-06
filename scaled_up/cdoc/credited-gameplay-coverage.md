# Credited-gameplay coverage report (Scope-A closeout)

**Deliverable for:** `cdoc/credited-gameplay-capture-workorder.md`.
**Capture:** `traces/scripts/kill_robots.jsonl` (5013 frames) — a human-recorded credited
session (recorder revived in the browser shell; recorded absolute-from-boot frames so the
replay reproduces the played session deterministically). Replayed headlessly via
`tools/heavy_trace_capture.js` / `tools/scenario_check.mjs`.

This is the first trace that actually enters **credited** play (the prior automated scripts
all released coin/start before POST ≈ frame 573, so they never credited; the attract trace
only ever runs the demo). Verified credited: port `0x48` (player joystick/fire) read
**87,778×** — never read in attract.

## Per-scenario state-change proofs (RAM map)

All addresses per `cdoc/ram-map-berzerk.md`. Frame numbers are from the deterministic replay.

| Scenario | Indicator | Observed | Verdict |
|---|---|---|---|
| Coin credited | credits `0x08A3` | `0 → 1` @f1018 | **CONFIRMED** |
| Game started (1P) | `0x4344` current_player `0→1`; credit consumed `0x08A3 1→0` @f1419 | start at f1419, lives `0x434c` set to 5 | **CONFIRMED** |
| **(1) Kill a robot** | player score `0x433E–0x4340` (3-byte BCD) | `000000 → 000500` in 10 steps of **+50** (f1688, 1922, 1998, 2080, 2310, 2579, 3345, 3761, 4260, 4409) | **CONFIRMED — 10 robot kills** |
| **(2)(3) Death** | lives `0x434c` | `5 → 4 → 3 → 2 → 1` (f1516, 3052, 3677, 4067) = **4 deaths** | **CONFIRMED** (cause — bolt vs wall vs contact — not isolated) |
| **(6) Game over** | lives `0x434c`, `0x4344` | at f4812 lives reset `1 → 5` and `0x4344 1 → 2`, with abnormal heavy `0x48` polling f4400–4799 | **PARTIAL / inconclusive** — a terminal state transition consistent with game-over, but the lives counter resets to the config value (5) rather than visibly passing through 0; not cleanly isolated to `lives → 0` |
| (4) Maze transition | maze/level counter | not reached (player did not clear a maze) | **NOT captured** |
| (5) Evil Otto | Otto actor present | not reached (player did not dawdle past the spawn timer) | **NOT captured** |

Net: capture scenarios **1 (kill) and 2/3 (death) are cleanly proven**; **game-over is only
partial** (terminal transition observed, not a clean `lives→0`); **maze-transition and
Evil-Otto remain uncaptured** (need a longer/maze-clearing or dawdle session — a follow-on
recording, not a blocker for Scope A).

## Coverage diff — new routines reached

Distinct routine entry PCs reached by `kill_robots.jsonl`: **95**. Attract-reachable
baseline (`traces/segmented/attract-only.entrypcs.json`): **83**. The script is a superset —
it reaches all 83 attract routines plus **12 new**:

```
0x1851 0x186a 0x18b2 0x18f1 0x18f7   (score / credit display subtree: digit draw, READ_BCD field draw)
0x2b6b 0x2b97 0x2c51 0x2db3 0x2dce   (credited start / game-init / per-player setup cluster)
0x33a7 0x361c                         (start/sound/config cluster)
```

**Reachable-routine universe: 83 (attract-only) → 95 (with credited gameplay), +12.**

These 12 are credit/start/score-accounting routines the attract demo never executes (the
demo plays the engine but never credits, starts a real game, or accrues a player score).
**Per the work order they are NOT ported here** — that is a separate follow-on; this task
only makes them trace-reachable so they can be benched/ported through the existing pipeline.

## Notes / honesty caveats

- The score field is `0x433E–0x4340` (player-1 BCD), **not** `0x089C–0x089E` (that is the
  attract/demo counter, which stayed 0 the whole credited game). The on-screen draw of the
  demo counter `0x197b` reads `0x089C`; the player score is drawn by `0x2341`
  ADD_AND_DRAW_SCORE → `PRINT_DIGITS 0x2a40` (HL=`0x433E`) to the bottom status strip.
- The score was being computed and drawn correctly all along; it only failed to *appear*
  because of the renderer crop bug (visible window was rows 0–223 instead of [32,256)),
  fixed in `src/video.js` — see `cdoc/decisions.md` 2026-06-22. The score now renders at
  screen rows 213–221 and Sudnya play-confirmed it on screen.
- Determinism: same script + cold boot ⇒ identical run (hooked == un-hooked, byte-identical).
