# Project finish line — Scope A (ship now) vs Scope B (deferred)

Purpose: lock the done-line so "wrap up" is concrete and chasing literal 100% routine
coverage is not a trap. Decided 2026-06-22 (Sudnya) to prioritize shipping.

## Scope A — the deliverable (SHIP THIS)

A faithful, independently-validated Berzerk port **plus the reusable pipeline**. What it
is, concretely: a **hybrid** machine — 37 routines run as pure JavaScript (hooked in
place), the remainder run on the validated Z80 core — that plays byte-identically to the
un-hooked emulator. (It is deliberately NOT yet the pure-JS, core-removed target; that is
Scope B.)

Components, all done or nearly:
1. **Emulator target (Phases 1–8, done):** boots the real RC31 ROM, plays, proven ≡ MAME
   on the boot window (Gate 1, frames 0–258 visible-rows). The verification oracle.
2. **JS routine port (Phase 9, T9.1 + T9.2 Tier-1/2):** 37 routines ported & validated —
   leaves with hermetic bench + live transparency; portable composites by composition +
   transparency (and hermetic bench via the inclusive Option-2 plan). Hooked machine ≡
   un-hooked across all 5 scripts, byte-identical. **This is the portable ceiling under
   the current hook** — the remaining routines need Scope B.
3. **Reusable pipeline (game-agnostic except Phases 1–2 & 6):** disassembler + coverage
   loop, hardware contract, two-tier trace capture, entropy audit, trace-driven
   annotation + accuracy score, test-plan generator, hermetic bench, port-hook harness,
   transparency tool.
4. **Documentation:** `architecture-review.md`, `decisions.md`, the frozen schemas,
   `hardware-berzerk.md`, `entropy-berzerk.md`, `annotated-asm-berzerk.md`, `ram-map-berzerk.md`.

### Scope-A acceptance checklist (this = DONE)
- [x] T9.2 Tier-1 + Tier-2: every hook-portable routine ported + validated (37; portable
      ceiling reached this batch).
- [ ] Tier-3 enumerated — the deferred routines listed authoritatively in the T9.2
      checklist + `decisions.md` (not left implicit). _(Listed in the T9.2 status line +
      decisions.md 2026-06-22; left for Sudnya/planner to check off.)_
- [ ] **MAME golden hashes generated + committed** (Sudnya-side; restores the external
      regression so `npm run golden` is real, and seeds the Scope-B oracle).
      _Status 2026-06-22: `node tools/golden.js` runs and produces JS hashes for all 7
      scenarios incl. the boot window; reports "no-golden" (exit 2) because `fixtures/goldens/`
      is empty — EXPECTED. Exact generate+commit instructions: `cdoc/mame-goldens-howto.md`.
      Renderer fix does NOT affect goldens (hash reads raw VRAM, not the render output)._
- [ ] **HUMAN-GATE: Sudnya spot-plays the HOOKED machine** and confirms it plays a normal
      game (move/shoot/robots/score/death) indistinguishably. This is the gate that flips
      T9.2 → done. **Only Sudnya flips this — left UNCHECKED.**
      _Status 2026-06-22: Sudnya play-verified the HOOKED build live after the renderer fix —
      coin → start → kills → deaths, with the **score now visible** on screen (the crop bug
      that hid it is fixed; `src/video.js`, decisions.md 2026-06-22). Core gameplay confirmed.
      NOTE: the `machine/PLAY.md` spot-play list also includes **maze-transition** and **Evil
      Otto**, which the kill_robots session did NOT exercise — Sudnya's judgment whether to
      confirm those too before flipping, or accept core-gameplay verification as sufficient._
- [ ] Final wrap doc / accounting written (what ships, what's deferred).
      _(Being written separately by the planner — not in scope for the closeout task.)_

When all are checked, **the project is DONE for Scope A.** As of 2026-06-22 the only OPEN
items are both **Sudnya-side**: (a) flip the HUMAN-GATE spot-play, (b) generate + commit the
MAME goldens. (Plus the planner's wrap doc.)

## Scope B — deferred (optional continuation; NOT required to ship)

The **full pure-JS native target** (Phase 10 complete): the Z80 core removed from the
native run path, the game driven by the rAF loop + JS interrupt cadence. It requires a
**native cooperative-yield / interrupt-interleaving substrate in JS** for:
- the enumerated **Tier-3 routines** — coroutine / stack-swap, the IM2 interrupt
  dispatcher, computed-jump / jump-table dispatchers, inline-parameter routines, and the
  SP-dependent ones (e.g. 0x18cd needs `HL=SP`, free in native). Authoritative list lives
  in the T9.2 checklist + `decisions.md` (2026-06-22) — referenced, not duplicated here,
  so it can't go stale.
- the **long "always-decline" composites** (e.g. 0x2a40): atomic JS execution defers the
  interrupts that should fire mid-routine → V256/entropy drift, so they need the same
  yield model. "Registered" ≠ "native-ready" for these.

Validation for Scope B is **system-level only** (native ≡ emulator ≡ MAME); the substrate
has no per-routine bench, so it's the "chase the last divergence against a system oracle"
tail — open-ended (see the architecture review's Phase-10 estimate). The **emulator target
is retained** as its oracle and regeneration engine (the two-build-target decision).

Scope B is a worthy, research-grade continuation. It is explicitly **out of the ASAP
wrap** — do not let it reopen the Scope-A finish line.
