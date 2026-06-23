# Scope A — final accounting (wrap)

**Status (2026-06-22):** Scope A is at the finish line. The deliverable is built and
verified; only two Sudnya-side items remain to call it formally DONE (§5). This doc is the
closeout record — what ships, what's proven, what's deferred, and where to look.

## 1. What ships

A faithful, independently-validated Berzerk port **plus the reusable pipeline that produced
it**. Concretely, a **hybrid machine**: 37 routines run as pure JavaScript (hooked in place),
the rest run on the validated Z80 core, and the whole thing plays byte-identically to the
un-hooked emulator. The game boots the real RC31 ROM and **plays correctly end-to-end** —
coin, start, movement, firing, robot kills, scoring, death/respawn, and game-over were
play-verified after the renderer fix (§4).

It is deliberately **not** the fully core-free pure-JS build — that is Scope B (§6).

## 2. Validation ledger (what is actually proven, and how)

The fidelity model is **two gates**, not one (cycle-exact parity vs MAME holds only for the
~258-frame boot window; behavioral fidelity is the bar thereafter):

- **Z80 core** — validated by ZEXALL + ~1.6M SingleStepTests.
- **Whole machine vs MAME** — byte-for-byte on the boot window (Gate 1, frames 0–258), via
  per-frame video hashing. *(The external regression is armed once the MAME goldens are
  committed — §5.)*
- **Hybrid hooked ≡ un-hooked** — byte-identical across the scenario scripts; the 37 ports
  are transparent (live dispatch counter proves they fire).
- **Per-routine correctness (Gate 2)** — hermetic bench runs each port against its captured
  trace with no emulator in the loop; X/Y undocumented flags masked, everything else strict.
- **Gameplay** — Sudnya play-verified core gameplay; `traces/scripts/kill_robots.jsonl` is a
  credited run proving coin → start → 10 kills (score `000500`) → deaths → game-over.

Independently re-verified by the planner this cycle: the score/lives RAM addresses, the
coverage numbers, the renderer geometry, and the long-routine pilots (§4) — reproduced and
mutation-tested, not taken on report.

## 3. Coverage accounting

"Validated" has two honest senses:

- **Playable correctness (what ships): ~100%.** Every routine the game executes runs on the
  ZEXALL/SST-validated core under the boot-window gate; the hybrid plays correctly.
- **Reimplemented as validated pure JS: 37 routines.** That is the **portable ceiling under
  the current hook** — the remaining routines need the Scope-B substrate.

Reachable-routine universe: **83 via attract; 95 with credited gameplay** (the kill_robots
run reached 12 routines attract never touches). Of the porting universe, **37 ported** and
**10 enumerated Tier-3 hazards** deferred (coroutine/stack-swap, IM2 dispatcher,
jump-table/inline-param, SP-dependent). Caveat: the 83/95 are *trace-reached* counts;
credited coverage of maze-transition / Evil-Otto is not yet captured.

## 4. Developments this cycle (closeout work)

- **Renderer crop bug — FIXED.** `renderToRGBA` painted VRAM rows [0,224); the real visible
  window is [VBEND=0x20, VBSTART=0x100) = [32,256). The score strip was being cropped and
  the top stack/var band painted as garbage. Fixed by mapping VRAM scanline `vy → vy−32`.
  Same 256×224 output, correct rows. Video suite green. **This is what unblocked visible,
  correct play.**
- **Credited gameplay captured.** kill_robots.jsonl — the first credited-input trace;
  expands the reachable universe 83 → 95.
- **Long-routine validation pilots — GREEN (de-risks Scope B's biggest unknown).** Proved a
  long routine can be checkpointed at interrupt boundaries and re-entered deterministically
  (V1 lossless segmentation 20/20 over 73 segments; V2 per-segment snapshot-sufficiency
  73/73) and run as a resumable pure-JS coroutine that's output-faithful and cycle-accurate
  (V3 20/20). An interrupt-dependency probe (25,130 interrupts / 391,347 invocations) showed
  the only true ISR-output entanglement is confined to ~5 routines already classed Tier-3 —
  so "long routines" moved from a Scope-B research risk to a mechanical track.
- **Scope-B substrate designed.** `cdoc/scope-b-cooperative-scheduler-plan.md` — the
  cooperative scheduler that replaces the core, with a milestone build order.

## 5. Remaining to call Scope A DONE (both Sudnya-side)

1. **Flip the HUMAN-GATE spot-play.** Core gameplay is play-verified; the PLAY.md checklist
   also lists maze-transition and Evil-Otto, which the kill_robots run didn't exercise —
   confirm those or accept core-gameplay verification, then flip T9.2 → done. (Only Sudnya
   flips this.)
2. **Generate + commit the MAME golden hashes** into `machine/fixtures/goldens/` (needs the
   stock MAME binary + ROMs). This re-arms the external boot-window regression
   (`node tools/golden.js`) and seeds the Scope-B oracle. *(CC is readying the tooling +
   exact instructions.)*

Mechanical closeout (coverage report, RAM-map relabels, status-tracker updates, goldens
tooling/instructions) is in flight with Claude Code under `cdoc/scope-a-wrapup-workorder.md`.

## 6. Deferred to Scope B (optional, research-grade — not required to ship)

The **NATIVE build target** (Z80 omitted from *its* run path) shipped **alongside the
retained emulator target** — two build targets from one codebase, *not* a removal of the
scaffold (decisions.md 2026-06-18; the emulator stays first-class as oracle/regeneration/
debug). It needs a JS **cooperative-yield / interrupt-interleaving substrate** for the 10
Tier-3 hazards and the long "always-decline" composites (the latter now de-risked by the §4
pilots). Validation is system-level only (native ≡ emulator ≡ MAME), which is the open-ended
tail — hence deferred. Build order and design in
`cdoc/scope-b-cooperative-scheduler-plan.md`; first steps scoped in
`cdoc/milestone1-conductor-workorder.md` and `cdoc/credited-gameplay-capture-workorder.md`.

## 7. Reusability

The pipeline is game-agnostic except Phases 1–2 (disassembler + machine bring-up) and
Phase 6 (annotation). The rest — trace capture, entropy audit, test-plan generation,
hermetic bench, port-hook harness, transparency tool, the segment-chain method — carries to
the next Z80 title.

## 8. Where to look

- `project-summary.md` — what was built, phase by phase (exec summary).
- `architecture-review.md` — detailed narrative + decision-reversal ledger.
- `done-definition.md` — Scope A vs B finish line + acceptance checklist.
- `decisions.md` — append-only design log (authoritative).
- `long-routine-validation-plan.md` + the pilot work orders — the segment/coroutine method.
- `scope-b-cooperative-scheduler-plan.md` — the deferred native-runtime design.
- `machine/PLAY.md` — how to play and spot-check the hooked build.
