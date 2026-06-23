# Berzerk Z80→JS Port — Executive Summary

**One line:** a high-fidelity JavaScript port of the arcade game **Berzerk** (Z80, Stern
1980), built through a 10-phase pipeline that is *itself* the deliverable — designed to
work on any Z80 ROM, including ones with no published source.

**Status (2026-06-22):** Phases 1–8 complete; Phase 9 at its "Scope-A" ceiling — 37
routines ported to JS and validated, the game playable as a hybrid. Two small items remain
to call Scope-A done (a play-session sign-off and committing MAME goldens). Phase 10 (the
fully core-free build) is deliberately deferred as "Scope B." See `cdoc/done-definition.md`
for the exact finish line and `cdoc/architecture-review.md` for the full how/why.

---

## What was implemented

The architecture is **one emulator, three roles** — the same JS machine serves as an
emulation platform, then a trace-capture platform, then a port scaffold. **MAME is used
unmodified as a black-box oracle** (stock binary + Lua only), so any agreement between our
machine and MAME is meaningful.

Phase by phase, what exists:

1. **Disassembler** — a structured "decode oracle" of the ROM + byte-accounting; cross-checked against the independent SkoolKit disassembler.
2. **JS machine** — Z80 core (vendored DrGoldfire/Z80.js, one bug patched, validated by ZEXALL + ~1.6M SingleStepTests), full memory map, video + the 74181 magic-RAM ALU, interrupt/timing, input/DIPs, sample-based sound, and a no-build browser shell. Boots the real ROM and plays.
3. **Validation vs MAME** — a replayable input-script format, a MAME Lua harness, and per-frame video-hash comparison (the golden-frame gate).
4. **Trace capture** — a two-tier model: a *lightweight* trace (inputs) drives deterministic re-emulation that produces *heavyweight* per-routine traces (registers + ordered reads/writes).
5. **Determinism / entropy audit** — a full catalog of every nondeterministic read; the one timing-locked source is port 0x4E (V256), feeding the RNG.
6. **Annotation** — names, contracts, and a RAM map for all 83 trace-reachable routines, derived *from traces alone*, then scored against the reference source (65% exact / 96% right-subsystem — a real measure of the source-less method).
7. **Test generation** — per-routine hermetic test cases, validated by re-execution against the real ROM.
8. **Hermetic bench (Gate 2)** — runs those cases against JS ports with no emulator in the loop; catches per-routine errors.
9. **Porting** — a live "hook" runs a JS port in place of a Z80 routine, sharing memory; **37 routines ported**, each validated by the bench and/or live byte-for-byte transparency. The result is a **hybrid that plays Berzerk** with those 37 routines as pure JS and the rest on the validated core.

**Reusability:** only phases 1–2 and 6 are game-specific; the rest of the pipeline carries to the next title.

---

## The one course-change worth knowing

The plan originally treated the golden-frame match vs MAME as a single master "≡ hardware"
gate. Reality forced **two gates**: the JS machine matches MAME byte-for-byte only for the
first ~258 frames (boot), then diverges — not from a bug, but from unavoidable cycle-timing
drift between two correct Z80 cores, surfacing through the RNG. So **Gate 1** = boot/integration
regression (vs MAME), and **Gate 2** = the hermetic per-routine bench for gameplay
correctness. The fidelity bar is therefore **behavioral, not cycle-exact** — a deliberate
choice that shaped everything downstream.

## Limits we hit — and the choice each one forced

Each limit is paired with the decision it drove and the reason. (These were previously two
sections, "limits" and "punts"; a punt is just the choice a limit forces — same category — so
they're listed together.)

- **Cycle-timing drift** between our (correct) core and MAME — exact-frame parity holds only for the ~258-frame boot window.
  *Choice made:* adopt **behavioral, not cycle-exact, fidelity** (two gates instead of one) and **skip** a cycle-accurate MAME-equivalent core.
  *Why:* the drift is inherent to two independently-correct cores, not a bug; a cycle-accurate core is ~1–2 months with a long debugging tail and buys parity the behavioral bar never needs.

- **The RNG is timing-seeded** (port 0x4E/V256) — gameplay diverges run-to-run between machines even though each is internally deterministic.
  *Choice made:* prove correctness **per-routine in the hermetic bench (Gate 2)**, not by long-run frame matching.
  *Why:* the divergence is unbounded to chase and adds no assurance — a routine that reproduces its own captured trace is correct regardless of which entropy stream the machine is on.

- **~10 routines can't be hooked** under the current model (coroutine/stack-swap "job" system, interrupt dispatcher, jump-table dispatchers, inline-parameter routines, WZ-flag exposers), and **long routines** (longer than the ~4000-cycle inter-interrupt gap) must stay on the core or they'd mis-time interrupts.
  *Choice made:* **ship the 37-routine hybrid now; defer the fully core-free build (Phase 10) to Scope B.**
  *Why:* the holdouts need a JS cooperative-yield / interrupt-interleaving substrate that can only be validated system-level — open-ended work, while the hybrid already captures essentially all the value.

- **Input scripts never credit a coin** (the CPU doesn't sample inputs until ~frame 573), so automated validation ran on the attract demo.
  *Choice made:* **validate on attract; park the interactive recorder and downgrade credited-gameplay scripts to marginal.**
  *Why:* attract already exercises the full engine, so extra scripts added ~zero coverage — the blocker was routine structure, not script coverage.

- **Two items are deferred scope, not forced limits:** **audio samples** (T2.8b) — cosmetic, and the golden gate hashes video not sound; and **committing MAME golden fixtures** — a user-side TODO, so the external golden regression is currently inert (the live hooked==un-hooked check covers porting in the meantime).

## Finish line

- **Scope A (ship — nearly done):** the validated emulator + the 37-routine hybrid port + the reusable pipeline + docs. Remaining: a human spot-play of the hooked build and committing MAME goldens.
- **Scope B (deferred):** the fully core-free native target — a worthy, research-grade continuation, explicitly out of the "wrap up now" scope.

**Where to look:** `architecture-review.md` (detailed narrative + decision-reversal ledger),
`decisions.md` (append-only log), `port-pipeline.png` (one-page diagram, status-tagged),
`done-definition.md` (Scope A vs B), `PLAY.md` (how to play the hooked build).
