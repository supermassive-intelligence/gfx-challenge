# Work order — Wrap up Scope A

**For:** Claude Code. **Author:** planner/reviewer. **Date:** 2026-06-22.
**Authority on "done":** `cdoc/done-definition.md` (Scope-A acceptance checklist).

Scope A is at the finish line: the 37-routine hybrid plays, the renderer crop bug is fixed,
and Sudnya has play-verified core gameplay (coin → start → 10 kills → deaths → game-over,
score visible). What remains is mechanical closeout + readying the MAME goldens. The final
**wrap/accounting doc** (checklist item 5) is being written separately by the planner — do
NOT write it here.

Reviewer note (already independently verified, build on it — don't re-litigate): score
lives at `0x433e–0x4340` (BCD, ended `000500` = 10 kills), lives at `0x434c` (decrements
3→0 into game-over), and `traces/scripts/kill_robots.jsonl` reaches **95 distinct routines
vs attract's 83 = 12 new**: `0x1851 0x186a 0x18b2 0x18f1 0x18f7 0x2b6b 0x2b97 0x2c51 0x2db3
0x2dce 0x33a7 0x361c`.

## Tasks

### 1. Finalize the credited-gameplay coverage report
Against `cdoc/credited-gameplay-capture-workorder.md`'s deliverable spec, using
`traces/scripts/kill_robots.jsonl`:
- Per-scenario state-change proofs from the RAM map: kill (score 0x433e–0x4340 increments),
  death (lives 0x434c decrements), game-over (lives → 0). This satisfies capture scenarios
  1–3 + game-over; note maze-transition / Evil-Otto as not-yet-captured.
- The 12 new entryPCs and the reachable-universe change 83 → 95.
- Append the one-line coverage result to `cdoc/decisions.md`.

### 2. RAM-map relabels (`cdoc/ram-map-berzerk.md`)
- `0x433e–0x4340` → player score (was "score_ptr"); `0x434c` → lives (was "level counter").
- Mark each as **gameplay-confirmed** vs the surrounding scalars that are still
  **attract-only inferred**, and sweep the neighboring `0x433x–0x434x` band for the same
  stale-label risk (flag, don't guess). Provenance must be explicit.

### 3. Update the status trackers
- `tasks/STATUS.md` and the `cdoc/done-definition.md` checklist: record the renderer fix
  landed and that Sudnya play-verified coin/start/kills/deaths/score/game-over.
- **Do NOT flip the HUMAN-GATE.** Only Sudnya flips T9.2 → done. Note in the checklist that
  the PLAY.md spot-play list also includes maze-transition and Evil-Otto, which the
  kill_robots run did not exercise — left to Sudnya's judgment whether to confirm those
  before flipping or accept core-gameplay verification as sufficient.

### 4. Ready the MAME goldens (the one real remaining external-regression item)
- Confirm `node tools/golden.js` runs and the JS side produces hashes for every scenario
  including the boot window (frames 0–258, Gate 1). `--update` regenerates the JS hashes
  only; with `fixtures/goldens/` empty the diff run will report missing goldens — that is
  expected; document it.
- Write Sudnya **exact** generate-and-commit instructions for the MAME side using the
  `tools/mame/` Lua harness (the stock MAME + ROMs run is Sudnya-side): the precise command
  to produce each golden hash file into `fixtures/goldens/`, then `node tools/golden.js` to
  confirm JS ≡ MAME. Optionally add a `golden` npm script for convenience.
- Do NOT fabricate golden files or hashes.

## Verification (paste actual output)
```sh
cd machine
node --test tests/*.test.js                 # full suite green (note any ROM-path-dependent tests)
node tools/golden.js || true                # expected: reports missing goldens (documents the gap)
# coverage re-confirm (entryPC diff kill_robots vs attract): 95 vs 83, 12 new
```
Report: the coverage numbers, the suite result, the golden.js output, and the exact MAME
instructions written.

## Out of scope
- No flipping the HUMAN-GATE (Sudnya-only). No fabricated goldens.
- No `git commit`/`push`.
- No changes to the 37 ports, `PORT_META`, frozen schemas, committed plans.
- Do NOT port the 12 newly-reached routines (separate follow-on).
- Do NOT write the wrap/accounting doc (planner is doing it).
- No Scope-B work (conductor/entropy) in this task.

## Definition of done
Tasks 1–4 complete, decisions.md one-liners appended, trackers updated, MAME instructions
written, output pasted. After this, the only open Scope-A items are both **Sudnya-side**:
(a) flip the HUMAN-GATE spot-play, (b) generate + commit the MAME goldens. Summarize what
changed and STOP.
