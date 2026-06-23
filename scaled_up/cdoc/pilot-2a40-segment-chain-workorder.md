# Work order — Pilot: segment-chain capture + per-segment validation for 0x2a40

**For:** Claude Code (implementer). **Author:** planner/reviewer. **Date:** 2026-06-22.
**Approved approach:** `cdoc/long-routine-validation-plan.md` (Sudnya sign-off in
`cdoc/decisions.md`, 2026-06-22).

This is a **pilot**. Its job is to prove the "interrupts as recorded yield boundaries"
mechanism end-to-end **at the data level**, on one long clean routine, with the least new
code and **no port rewrite**. If it goes green, it justifies the coroutine-port follow-on.

## Why 0x2a40 (PRINT_DIGITS)

It is the canonical long, clean, ALWAYS-DECLINE routine (~8800 T > the ~4000 T
inter-interrupt gap, so the core always runs it; bench-validated 1/1 but never live
fast-paths). Confirmed reachable and genuinely sliced in attract:

> attract-only (3085f): **0x2a40 invoked 20×, 19 span ≥1 interrupt, up to 7 interrupts
> in a single invocation** (i.e. up to 8 segments). Verified via
> `machine/tools/isr_dep_probe.mjs` methodology.

It also has **zero strict ISR-dependence** (the probe: no PORTED routine consumes an
interrupting ISR's fresh writes), so it is exactly the "clean" case the pilot should
prove.

## Goal (two claims, both at byte-exactness)

- **V1 — lossless segmentation.** A long invocation can be split at its interrupt
  boundaries into a *segment chain* such that the chain (segments + the interrupting ISR
  invocations) reconstructs the whole invocation's effect: concatenated write-sets and
  final `regs_out` match the un-segmented capture exactly.
- **V2 — per-segment snapshot-sufficiency (the prize).** Each segment, replayed **on a
  fresh core seeded only with its entry snapshot + its recorded read-set**, reproduces its
  `regs_out` and `write_set` byte-exact. If every segment self-validates hermetically, the
  segments are independent pure functions — the resumed code depends on **nothing** that
  wasn't captured at the boundary (a per-routine, byte-exact confirmation of the probe's
  global finding).

V1 + V2 are the whole pilot. **Do not** rewrite `print_digits.js` as a coroutine — that
is the follow-on task, gated on this pilot passing.

## Entry criteria (check first; STOP and report if any fail)

1. `disassembler/oracle/berzerk_flat.bin` exists (ROM0 = `flat[0x0000:0x0800]`,
   ROM_MAIN = `flat[0x1000:0x3800]`; the machine loads via
   `m.loadRoms({ROM0, ROM_MAIN})`).
2. `traces/scripts/attract-only.jsonl` exists (3085 frames, no inputs).
3. `machine/tools/heavy_trace_capture.js` imports and runs (it is the scaffold).
4. Re-confirm the reachability numbers above before building (cheap; reuse the probe).

## What to build

### 1. Segmented capture — `machine/tools/gen_segmented_trace.js` (new file)

Reuse `heavy_trace_capture.js`'s frame-tracking technique verbatim (SP-depth returns,
`pendingISR` entry flag, wrapped mem/IO callbacks, the opcode-peek suppression). Add, for
a **target entryPC** (param; 0x2a40 for the pilot), emission of a **segment chain** per
target invocation:

- Boundaries are: target invocation entry; each point an ISR frame **opens** on top of the
  target (interrupt start); each point that ISR frame **closes** (resume); target exit.
- A **segment** is the target's own execution between consecutive boundaries (ISR time
  excluded — use the existing **exclusive** attribution so a segment's read/write sets are
  the target's accesses only).
- Per segment record: `target_pc`, `invocation_id`, `seg_index`, `entry_regs` (full
  snapshot via the existing `snapshot()`), `read_set`, `write_set`, `regs_out`,
  `end_boundary` (`'interrupt'` | `'exit'`), `boundary_pc`, informational `cycle_count`.
- Also emit, interleaved, the interrupting **ISR invocation** records (the existing tool
  already produces these; tag them so V1 can fold them in).

Output to a **separate file** `traces/segmented/attract-only.0x2a40.jsonl`. Do **not**
touch the frozen exclusive plans, `composites-inclusive.jsonl`, or any golden.

**WZ caveat (important):** the vendored core does **not** model the WZ register, so
`entry_regs` cannot include a real WZ. This is fine for 0x2a40 (clean; no WZ-derived flag
dependence) — proceed without WZ. Do **not** invent a WZ value. (Real WZ capture is only
needed for the WZ-exposer *hazards*, which are Scope-B and would require core changes;
out of scope here. Note this limitation in the file header.)

### 2. Verification test — `machine/tests/segment_chain_2a40.test.js` (new file)

Using `node:test`. Capture once (or load the segmented file + an un-segmented
`heavy_trace_capture` of the same run), then assert:

- **V1:** for every 0x2a40 invocation, the union/concatenation of its segment `write_set`s
  **plus** the folded ISR `write_set`s equals the whole-invocation `write_set` from a
  plain `heavy_trace_capture` (inclusive mode) of the same deterministic run; and the last
  segment's `regs_out` equals the whole-invocation `regs_out`.
- **V2:** for every segment, build a hermetic case from `entry_regs` + `read_set`
  (the same construction `generate_test_plan.js` / `bench.js` use for whole routines, at
  segment granularity) and replay it on a fresh `Z80CPU`/core seeded with exactly that
  state; assert `regs_out` and `write_set` reproduce **byte-exact** (apply the existing
  X/Y-flag mask used in `bench.js`, nothing looser).

Both assertions must hold for **all** captured 0x2a40 invocations (expect ~20, ~19
multi-segment).

## Verification (done iff exit 0; PASTE actual output into the result)

```sh
cd machine
node tools/gen_segmented_trace.js traces/scripts/attract-only.jsonl 0x2a40 \
     traces/segmented/attract-only.0x2a40.jsonl
node --test tests/segment_chain_2a40.test.js
```

Report: number of 0x2a40 invocations captured, number multi-segment, total segments,
V1 pass count, V2 pass/fail per segment. A summarized result is treated as unverified —
paste the runner output.

## Out of scope (do not cross)

- No changes to the 37 ports or `PORT_META`; no changes to `print_digits.js`.
- No coroutine/resumable rewrite of any port (that is the follow-on).
- No edits to frozen schemas, committed exclusive plans, `composites-inclusive.jsonl`, or
  any golden. New data goes only to `traces/segmented/`.
- No WZ fabrication; no cycle-exact modeling.
- No `git commit`/`push` (human-only).

## Definition of done

V1 and V2 both green for all 0x2a40 invocations, output pasted. Then append a one-line
result to `cdoc/decisions.md` and STOP — the coroutine-port follow-on is a separate task,
to be scoped only after this passes. If V2 fails for any segment, that is a **finding**
(a hidden input the boundary snapshot missed): capture the offending `(seg, addr)` and
report — do not paper over it.
