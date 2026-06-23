# Work order — Credited-gameplay trace capture (coverage expansion)

**For:** Claude Code. **Author:** planner/reviewer. **Date:** 2026-06-22.
**Why:** the automated traces only ever ran *attract* (the old coin-timing bug meant nothing
credited), so the trace-reachable universe is 83 **attract-reachable** routines and
genuinely gameplay-only routines are unreached. The play harness now credits coins after
POST (~frame 573, `decisions.md` 2026-06-22). This task captures credited gameplay so those
routines get heavy-trace records and become bench-able / portable through the existing
pipeline. Pure coverage; no engine changes.

## Goal

A set of **credited-gameplay input scripts** that exercise the major contingencies, run
through the existing capture, expanding the set of routines with trace records — and a
report of exactly which **new** routines (not seen in attract) each scenario reaches.

## Scenarios (priority order — capture what you can; partial is still valuable)

1. **Coin + start + enter maze + move + fire + kill a robot** (unlocks the bulk: player
   movement, player-bolt, collision, robot death, score-on-kill).
2. **Die to a robot bolt** → death + respawn (or game-over).
3. **Die to wall contact**, and **die to robot contact**.
4. **Clear/leave a maze → next-maze transition.**
5. **Evil Otto appears** (dawdle past the spawn timer) and **kills the player.**
6. **Game over** (lose all lives) → back to attract.

1–3 are high-value and easy; 4–6 are stretch (need more play skill / longer scripts).

## How (two acceptable approaches)

- **Hand-authored scripts** (preferred for determinism): frame-stamped input records in the
  existing input-script JSONL schema (`cdoc/schemas/input-script.md`, FROZEN — author to it,
  do not change it), with inputs applied **after** POST per the credited-play timing in
  `machine/PLAY.md` / `decisions.md`. The machine is deterministic given inputs + boot, so a
  script replays identically.
- **Reluctantly revive the parked recorder** only if hand-authoring a given scenario is
  impractical — drive the shell, play, dump the script. (Recorder was parked; keep any
  revival minimal and harness-only.)

Put scripts in `traces/scripts/credited-*.jsonl`. Reuse `tools/heavy_trace_capture.js` for
capture; outputs to `traces/test-plans/` and/or a clearly-named credited file (do **not**
overwrite the frozen attract/committed plans).

## Validation (each scenario must be *proven* to have happened, not assumed)

Don't trust "I pressed the keys." Assert on game state via the RAM map
(`cdoc/ram-map-berzerk.md`) that the contingency actually occurred, e.g.:

- coin credited (credits CMOS 0x08A4/0x08A5 0→1), game started (P1 joystick port 0x48
  begins polling);
- a kill (score digits change), a death (lives counter decrements), a maze transition
  (maze/level counter advances), Otto present (its actor/job exists).

Pick the exact addresses from the RAM map; if an indicator isn't mapped, find and document
it. A scenario that doesn't move its indicator is **not** captured — report it as a miss,
don't count it.

## Deliverable report (paste)

- Per scenario: script file, frames, the asserted state-change proving it happened, and the
  **count + list of NEW routine entryPCs** reached (diff the captured entryPCs against the
  attract-reachable 83).
- The updated coverage number: attract-reachable routines vs total-with-credited-gameplay.

## Verification

```sh
cd machine
# capture each credited script
node tools/heavy_trace_capture.js ../traces/scripts/credited-<scenario>.jsonl /tmp/<scenario>.jsonl
# (plus a small node/test script that asserts the state-change indicators per scenario)
```

Paste the capture line (invocations/frames) and the per-scenario state-change assertions.

## Out of scope

- No engine / port / `PORT_META` / `scheduler.js` changes; this is capture only.
- Do not edit the frozen input-script schema or the committed attract/exclusive plans or any
  golden. New scripts + new capture files only.
- Porting the newly-reached routines is a **separate** follow-on (this task only makes them
  reachable); do not port here.
- No `git commit`/`push`.

## Definition of done

At least scenarios 1–3 captured with proven state-changes, the NEW-routine coverage diff
reported, and the updated reachable-routine count recorded. Append a one-line result to
`cdoc/decisions.md` listing the new coverage. Scenarios 4–6 are best-effort; report which
were achieved and which remain.

**Findings are valid:** if a scenario can't be driven deterministically (e.g. enemy layout
depends on entropy that a fixed script can't reliably beat), report it and what would be
needed (e.g. a seed-aware script or the recorder) rather than faking the indicator.
