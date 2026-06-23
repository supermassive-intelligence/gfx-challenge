# Validating long / interrupted routines via deterministic snapshot segments

**Status:** APPROVED (2026-06-22, Sudnya sign-off; recorded in `cdoc/decisions.md`).
Empirically grounded by an interrupt-dependency probe (below). The §3 schema change is
authorized: it is added as a **separate segmented-trace file**, leaving the frozen
exclusive plans and existing goldens untouched.

## 0. Problem

Some routines run longer than the inter-interrupt gap, so on hardware an interrupt
fires *mid-routine*. The hybrid handles this by declining to hook them (the Z80 core
keeps running them, and the core naturally provides correct interrupt-slicing). To
reach a core-free pure-JS build (Scope B) we must instead validate and port these
routines as JavaScript that can be preempted at the same points — without re-introducing
cycle-exact emulation.

The proposed mechanism: treat each interrupt as a **recorded yield boundary**. Split a
long invocation into **segments** (entry→first interrupt, interrupt→interrupt, last
interrupt→exit). Each segment is a pure function of a state snapshot; the interrupting
ISR is its own already-benchable invocation between segments. If that holds, long
routines become per-segment benchable and portable as coroutines.

The open worry was: *does a resumed segment depend on what the interrupt wrote while it
was suspended?* If yes, segments aren't independent and you'd have to reproduce the
ISR's (timing-seeded) output exactly. We measured this.

## 1. Empirical foundation — the interrupt-dependency probe

Probe: `outputs/isr_dep_probe.mjs` (re-emulates `traces/scripts/attract-only.jsonl`
deterministically from `disassembler/oracle/berzerk_flat.bin`; reuses the
`heavy_trace_capture` frame-tracking technique). Run: 3085 frames.

Two signals were measured per memory address:

- **GLOBAL provenance dep** — a mainline read whose *most-recent writer* was an ISR
  (i.e. the routine reads state the ISR maintains). Superset signal.
- **STRICT spanning dep** (the real test) — a routine that was open when an interrupt
  fired reads, *after the ISR returns*, an address that ISR wrote *during the split*,
  *before the routine overwrote it*. This is exactly "the interrupted routine consumes
  the interrupt's fresh side-effects." If this is empty for a routine, its segments are
  independent.

### Results

- Scale: **25,130 interrupts** serviced (8.15/frame — matches the hardware model of
  2 IRQ + 8 NMI scheduled per frame, a faithfulness check on interrupt detection);
  **391,347** mainline invocations tracked.
- **STRICT spanning deps: 645 reads total, in exactly 5 routines** — and **zero of the
  37 cleanly-ported routines**:

  | reader | class | strict reads |
  |--------|-------|--------------|
  | 0x1e78 | Tier-3 hazard | 525 |
  | 0x1c6e | Tier-3 hazard | 87 |
  | 0x287f | Tier-3 hazard | 15 |
  | 0x2436 | Tier-3 hazard | 8 |
  | 0x188b | ATTRACT_DEMO_LOOP (top-level driver) | 10 |

- Every strict-dependent address is in **VRAM (0x40xx–0x43xx)** — the region where the
  stack overlaps VRAM and the cooperative "job" scheduler operates. The strict
  dependency is the **signature of the coroutine substrate**, not of ordinary computation.
- Cleanly-ported routines (0x151a, 0x272d, 0x3719, 0x1505, 0x1776, 0x27a9, 0x14f3, …)
  show *heavy* GLOBAL provenance deps (tens of thousands of reads) but **zero STRICT
  deps**. They read state the ISR maintains, but only as **stable prior-frame values**,
  which the existing trace already captures as recorded inputs — which is why they bench
  cleanly today.

### Positive controls

ISR footprint confirms the detector fires: the RNG-phase counter `0x089f/0x08a0` is
ISR-written (2510×), the ISR scratch `0x082c/0x082d` 42732×. RNG `0x2678` shows *no*
ISR provenance — a true negative: it reads its own mainline-written seed; ISR-derived
entropy enters only via the phase counter at seeding time, not on every call.

### Independent corroboration

This dynamic data-flow method, given **no** knowledge of the structural hazard
classification, **rediscovered essentially the same hazard set** the porting effort
identified by hand (0x1e78/0x1c6e/0x287f/0x2436). Two independent methods converging is
strong evidence the hazard boundary is real and correctly drawn. The probe additionally
flagged `0x188b` — confirmed to be the top-level attract driver loop, which becomes
hand-written driver code in a JS port (not a portable leaf).

### Honest caveat

The SP-depth frame tracker is unreliable **inside** coroutine stack-swaps (the
preempted-routine histogram showed phantom entryPCs in RAM/VRAM and is discarded). But
that unreliability is confined to the hazard regions; for clean routines (no stack
swaps — the regime the heavy-trace tool was validated on) tracking is reliable, so
"**strict = 0 for clean routines**" is trustworthy, and any undercount of strict deps
falls *within the already-excluded hazard set*. The caveat explains the robustness; it
doesn't weaken the conclusion.

### Conclusion (the hypothesis holds, with a sharp boundary)

For every cleanly-portable routine, the interrupt is exactly "real-time scheduling whose
side-effects it does not consume mid-execution." **Segments of clean routines are
independent pure functions.** The only true entanglement with fresh ISR output is
quarantined to the coroutine-substrate hazards already on the Scope-B track.

**Consequence for the plan:** for long-but-clean routines we do **not** need to
reproduce the ISR's (timing-seeded) content at the yield boundary. We only need to run
the ISR (or even just advance the timers/counters it maintains) and resume; segment
correctness is independent of the interrupt's fresh writes.

## 2. The model — interrupts as recorded yield boundaries

Define a **segment** as the run of a routine's instructions between two consecutive
yield boundaries (entry, each interrupt, exit). Claim, now evidence-backed for clean
routines: `segment(state_in) -> (state_out, write_set)` is a pure function. The ISR
between two segments is its own invocation, already benchable as an ordinary routine.

## 3. Schema change (pending sign-off)

Extend `cdoc/schemas/heavy-trace.md` so an invocation can carry its interrupt
boundaries. Per boundary, record: approximate cycle offset, the boundary PC, a full
register snapshot **including the hidden WZ register**, and the live-memory snapshot
needed to re-enter. Mark ISR entry/return.

Governance: the committed exclusive plans stay **FROZEN**. This is added as a **separate
segmented-trace file** (mirroring `composites-inclusive.jsonl`) so existing goldens are
untouched. **Approved by Sudnya on 2026-06-22** and recorded in `cdoc/decisions.md`.

## 4. Validation pipeline (per long routine)

1. **Capture.** Re-emulate the durable lightweight trace; for the target routine emit a
   *segment chain*: snapshot at entry, at each interrupt boundary, and at exit, plus each
   segment's read/write set, plus the interrupting ISR invocations.
2. **Segment bench.** Feed each segment its entry snapshot, run the JS port from the
   matching resume point, require **byte-exact** registers + write-set at the next
   boundary. For clean routines a segment benches **in isolation** from its snapshot
   alone (independence proven in §1).
3. **ISR bench.** The ISR is benched as an ordinary routine (already in scope).
4. **Composition / system check.** Assemble `segment → ISR → segment …` under the
   cycle-budget driver and validate at the **system level** against the boot-window
   golden / behavioral bar (Gate 1 + behavioral fidelity).

## 5. Porting model — coroutine + coarse cycle budget

- The JS port carries an **approximate Z80-cycle budget**; when the budget crosses the
  next scheduled interrupt boundary it **yields**; the driver runs the ported ISR; then
  resumes. This is the only place cycle accounting re-enters — coarse, just enough to
  *place* yields, not cycle-exact.
- **Resumability via the escape hatch:** only the loops where interrupts actually land
  need to be yield-capable. Because clean-routine segment correctness is independent of
  ISR fresh output (§1), a yield can be modeled as "run ISR effects, resume" without
  threading ISR-produced values back into the segment.
- **Timer cadence (matching the emulator):** the driver fires interrupts at the
  documented 2-IRQ + 8-NMI scanline positions; the probe confirms ~8 delivered/frame.
  This is what the polling routines (e.g. the 0x0852/0x0853 timer poll in C_LOAD
  `0x1776`) need — a ticking counter, not exact cycles.

## 6. What stays Scope B (the quarantine)

The five strict-dependent routines — `0x1e78`, `0x1c6e`, `0x287f`, `0x2436`, and the
`0x188b` driver loop — genuinely consume the interrupting ISR's fresh writes through the
shared VRAM/stack. They need the full cooperative-yield substrate and system-level
validation, and the probe independently confirms they are the real entanglement. They
remain on the Scope-B coroutine track; this plan does **not** claim to make them
per-segment benchable.

## 7. Risks / open items

- Frame-tracker reliability inside coroutine regions — use a better boundary source
  (skoolkit + raw ROM bytes, or PC-range tagging) when capturing the substrate routines.
- Exact session replay still needs a cycle model for V256 entropy — out of scope under
  behavioral fidelity; only relevant if byte-for-byte trace replay is ever required.
- WZ must be captured in the boundary snapshot (it is part of the schema change) so the
  rare WZ-flag routines can be benched at boundaries.

## 8. Recommended first step

Pilot on **one** long-but-clean routine — `0x2a40 PRINT_DIGITS` (~8800 T, today
ALWAYS-DECLINE / bench-only) is the natural candidate: build the segment chain behind a
flag, bench each segment from its snapshot, and confirm the chain reassembles byte-exact.
A green pilot converts "long routines" from a Scope-B blocker into a mechanical,
verifiable porting track, leaving only the §6 quarantine as genuine Scope B.

---

*Probe artifact:* `outputs/isr_dep_probe.mjs` (re-runnable: `node isr_dep_probe.mjs 3085`).
*Data source:* `traces/scripts/attract-only.jsonl` + `disassembler/oracle/berzerk_flat.bin`.
