# Work order — Pilot V3: coroutine-ize the 0x2a40 JS port + validate the yield/cadence model

**For:** Claude Code (implementer). **Author:** planner/reviewer. **Date:** 2026-06-22.
**Builds on:** the V1/V2 pilot (`cdoc/pilot-2a40-segment-chain-workorder.md`, GREEN +
independently re-verified) and `cdoc/long-routine-validation-plan.md` (APPROVED).

This is the **porting** step the data pilot de-risked: prove a long routine can run as a
**resumable pure-JS coroutine** that yields so interrupts interleave at the correct
cadence — the capability Scope B (core-free build) rests on. Pilot routine: `0x2a40`
PRINT_DIGITS.

## Read this first — what the bar is, and is NOT (important)

The recorded interrupt boundaries for 0x2a40 are **scattered across ~37 distinct PCs**
throughout the routine and its callees (0x29a3–0x2a8d), including mid-`PRINT_CHAR`. They
do **not** cluster in one loop.

Consequence: **do NOT require the JS port to reproduce the exact per-segment write
partition or mid-routine register state.** Matching the Z80's exact yield points would
force an instruction-by-instruction transliteration — the opposite of a clean port.

Why a weaker bar is *correct here*, not a shortcut: the interrupt-dependency probe proved
0x2a40 is **clean** — it consumes none of the interrupting ISR's fresh writes (strict
deps = 0), and V2 proved its segments are pure functions of their entry snapshot. So the
routine's **output is independent of exactly when it is preempted.** Two things therefore
fully define correctness:

1. **Output equivalence** — the coroutine, drained, produces the **same total ordered
   write sequence and same final `regs_out`** as the validated whole-routine port (and the
   inclusive whole capture). Yielding must not change the result.
2. **Cadence correctness** — over the routine's cycle span the coroutine yields **the
   recorded number of times** (so global timers/entropy/the ISR advance at the right rate
   relative to everything else). Exact yield *positions* are an implementation detail; the
   *count over the span* is what must be right.

Exact per-segment partition agreement is a **diagnostic to report**, not a pass condition.

## Goal

A generator-based coroutine variant of the 0x2a40 port whose **output is byte-identical
to the existing whole-routine port** and whose **cycle-budget yields reproduce the
recorded interrupt cadence** across all 20 attract invocations.

## Entry criteria (check; STOP and report if any fail)

1. V1/V2 pilot green: `node --test machine/tests/segment_chain_2a40.test.js` passes.
2. `traces/segmented/attract-only.0x2a40.jsonl` present (20 invocation_summary / 53 isr /
   73 segment records; each segment carries `cycle_count`, `n_instructions`, `read_set`,
   `write_set`, `regs_out`, `boundary_pc`, `end_boundary`).
3. The shipped port `machine/ports/print_digits.js` + its whole-routine bench are green.

## What to build

### 1. Coroutine variant of the port (do NOT disturb the shipped port)

Add a **generator** export (e.g. `machine/ports/print_digits_coro.js`, or a new
`*runCoro(ctx)` export) that computes exactly what `print_digits.js` does but `yield`s a
checkpoint when an **internal approximate Z80-cycle budget** crosses the next yield
threshold. Use a generator (`function*`) so resume is automatic within the routine's
loops — no manual state machine.

- **Cycle budget:** the coroutine accumulates an approximate per-step Z80 cost as it runs
  (a small cost table or per-emitted-operation estimate). It is the *only* place cycle
  accounting re-enters — coarse, just enough to place yields. Document the cost model.
- **Yield granularity:** yield at natural seams (per character / per inner-loop iteration).
  Atomic within a seam is fine; you do **not** need sub-seam (mid-`PRINT_CHAR`) resume.
- **Preserve the shipped port:** leave `print_digits.js` and `PORT_META` **unchanged**.
  Either keep both implementations, or make `print_digits.js` a thin wrapper that *drains*
  the generator to one shot — but only if draining is proven byte-identical (see V3a).

### 2. Driver + validation test — `machine/tests/coro_2a40.test.js`

Reuse the V2 hermetic harness style (fresh mem seeded from each invocation's reads, FLAT
ROM). For each of the 20 invocations:

- **V3a — output equivalence (pass/fail).** Drive the generator to completion with
  cycle-budget yields; collect its full ordered write list and final regs. Assert it is
  **byte-identical** to the same invocation's whole capture (`write_set` ordered + `regs_out`,
  bench X/Y mask). I.e., yielding does not alter output. Also assert the plain
  `print_digits.js` path is unchanged (regression).
- **V3b — cadence correctness (pass/fail).** Assert the number of yields over the
  invocation equals the recorded `n_interrupts` for that invocation **within ±1**, for all
  20. Report the per-invocation (recorded vs produced) counts.
- **V3c — partition agreement (DIAGNOSTIC, report only).** For interest, report what
  fraction of yields land in the same inter-boundary interval as the recorded boundaries
  (by cumulative cycle offset). Do **not** assert on it.

## Verification (done iff exit 0; PASTE actual output)

```sh
cd machine
node --test tests/segment_chain_2a40.test.js     # V1/V2 still green (regression)
node --test tests/coro_2a40.test.js              # V3a + V3b
node --test tests/bench.test.js                  # whole-routine port bench still green
```

Report: V3a pass/total, V3b pass/total with the recorded-vs-produced yield counts per
invocation, and the V3c diagnostic. A summary instead of pasted runner output is treated
as unverified.

## Out of scope (do not cross)

- Other routines; the Tier-3 hazards; the coroutine *driver* for the full machine (this
  pilot drives one routine in isolation).
- No change to `print_digits.js` output behavior, `PORT_META`, the 37 ports, frozen
  schemas, committed plans, `composites-inclusive.jsonl`, or any golden.
- No porting/integration of the ISR itself — drive cadence from the recorded chain; a
  core-free ISR-interleaving driver is a later task.
- No WZ fabrication; no cycle-exact modeling (coarse budget only).
- No `git commit`/`push`.

## Definition of done

V3a and V3b green for all 20 invocations, V1/V2 and the whole bench still green, output
pasted. Append a one-line result to `cdoc/decisions.md` and STOP.

**Findings are a valid outcome, not a failure to hide.** If the coarse cycle budget can't
hit ±1 cadence on all 20, report the actual error distribution and what granularity/cost
model would close it — that is the real engineering result and tells us how faithful the
cycle model must be for the Scope-B driver. Do not loosen the tolerance silently to force
green; if you change ±1, say so and justify it in the result.
```
