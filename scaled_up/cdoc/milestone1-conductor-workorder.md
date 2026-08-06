# Work order — Scope-B Milestone 1: conductor sources interrupt cadence from the live scheduler

**For:** Claude Code. **Author:** planner/reviewer. **Date:** 2026-06-22.
**Plan:** `cdoc/scope-b-cooperative-scheduler-plan.md` §5 Milestone 1. Builds on the V3
coroutine pilot (`machine/ports/print_digits_coro.js`, `machine/tests/coro_2a40.test.js`,
GREEN).

Lowest-risk first step toward the cooperative scheduler: prove the interrupt schedule that
drives the coroutine can come from the **live `scheduler.js` event table** rather than the
recorded chain — and that doing so reproduces the recorded cadence exactly. No ISR is
ported, no job system, no core removal.

## Goal

A `Conductor` that, driving the existing `0x2a40` coroutine, sources interrupt timing from
`FRAME_EVENTS` (the live per-frame 2-IRQ + 8-NMI table in `machine/src/scheduler.js`) and:

- reproduces, for all 20 attract invocations, the **same interrupt count and own-cycle
  boundary positions** the recorded segment chain has (so "schedule from the scheduler" ≡
  "schedule from the recording"); and
- leaves the coroutine's **output byte-identical** (V3a still holds).

## Background the implementer must use

- `scheduler.js` exports `FRAME_EVENTS` (sorted `{type:'irq'|'nmi', vpos, cycle}`, cycle =
  absolute offset within a frame), `CYCLES_PER_FRAME`, and a `frameCycle` position that
  carries across frames. This is the authoritative interrupt timeline.
- The V3 coroutine accumulates own-cycles (`cyc`) and `yield`s at seams; `driveCoro`
  currently services a passed-in array of **own-cycle boundaries** taken from the recorded
  chain. Milestone 1 replaces the *source* of those boundaries with the conductor.
- **Own-cycle vs frame-cycle (the crux this milestone surfaces deliberately):** wall-clock
  frame position advances by the routine's own-cycles **plus** the duration of each ISR
  already serviced. To map a routine's own-cycle progress onto `FRAME_EVENTS`, the
  conductor must advance a frame clock by `own-cycles + serviced-ISR-durations`. For this
  milestone, take each serviced interrupt's duration from the **recorded chain's ISR
  records** (the real ISR port arrives in Milestone 3). State this assumption in code.

## What to build

### 1. `machine/src/conductor.js` (new)

A `Conductor` that, given a routine coroutine, its **start frame-cycle** (from the recorded
invocation), and a source of ISR durations, drives the coroutine to completion: it walks
`FRAME_EVENTS` (wrapping across frame boundaries via `CYCLES_PER_FRAME`), and whenever the
coroutine's advancing frame-clock crosses the next scheduled event, it suspends at the
current seam, "services" the interrupt (Milestone 1: just record it + advance the clock by
the recorded ISR duration; do **not** run a real ISR), then resumes. Expose the serviced
interrupt list (own-cycle position + type) so the test can compare to the recording.

Keep it schedule-driven and routine-agnostic (no 0x2a40 specifics). IFF gating can be
stubbed permissive for this milestone (note it).

### 2. `machine/tests/conductor_m1_2a40.test.js` (new)

For each of the 20 recorded `0x2a40` invocations (read `traces/segmented/attract-only.0x2a40.jsonl`;
the invocation_summary carries the start position / frame context, the segments carry
own-cycle `cycle_count` and the ISR records carry durations):

- **M1a — output equivalence.** Drive `0x2a40` under the Conductor; assert writes + regs_out
  are byte-identical to the shipped `PRINT_DIGITS` (reuse the V3 hermetic ctx + X/Y mask).
- **M1b — cadence faithfulness.** Assert the conductor-derived serviced interrupts match the
  recorded chain: **same count** (`n_interrupts`) and **same own-cycle boundary positions**
  (the cumulative segment boundaries), for all 20. Report per-invocation recorded-vs-derived.

## Verification (done iff exit 0; PASTE actual output)

```sh
cd machine
node --test tests/conductor_m1_2a40.test.js     # M1a + M1b
node --test tests/coro_2a40.test.js             # V3 regression (unchanged)
node --test tests/segment_chain_2a40.test.js    # V1/V2 regression (needs ROM dir)
```

Report: M1a pass/20, M1b pass/20 with recorded-vs-derived interrupt counts/positions per
invocation, and any invocation where the scheduler-derived schedule diverges from the
recording.

## Out of scope

- No ISR porting (durations come from the recorded chain); no job/coroutine system; no
  jump-table/inline-param work; no core removal.
- No change to `scheduler.js` behavior, the shipped ports, `PORT_META`, frozen schemas,
  committed plans, goldens. `conductor.js` is new and standalone.
- No cycle-exact modeling; no WZ.
- No `git commit`/`push`.

## Definition of done

M1a 20/20 and M1b 20/20 green, V3 + V1/V2 regressions green, output pasted. Append a
one-line result to `cdoc/decisions.md` and STOP.

**Findings are a valid outcome.** If the own-cycle↔frame-cycle mapping can't reproduce the
recorded boundary positions for some invocations, that is the key Milestone-1 finding (it
tells us exactly what the conductor's clock model must account for before Milestone 2's
entropy work). Report the discrepancy precisely; do not fudge the mapping to force green.
