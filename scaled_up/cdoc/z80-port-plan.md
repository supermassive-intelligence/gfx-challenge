# Z80 Arcade → JavaScript Port Pipeline (v4)

Goal: behaviorally faithful JS ports of Z80 arcade games (mechanics, feel,
gameplay). First target: Berzerk. Pipeline must generalize to games with no
published disassembly/source, so annotation is trace-driven from scratch;
Berzerk's published Frenzy source is used only to *grade* the method.

Task IDs per phase: `cdoc/phase-task-map.md`. Status: `tasks/STATUS.md` only.

## Architecture decision
Exactly ONE machine is built: the JS machine — the Berzerk-specific hardware
(memory map, magicram video, interrupts, input, sound latches) assembled
around a REUSED, ZEX-validated Z80 CPU core (Z80.js or equivalent; we never
write a CPU core). "One machine" rules out the alternatives debated earlier:
a separate tools-side trace emulator, or patching MAME for tracing. The JS
machine serves three roles in sequence — emulation platform, trace-capture
platform, then port scaffold.

MAME is an unmodified black-box ground truth (stock binary; Lua scripts only
for golden-frame dumps and input injection; optionally a single-driver build
via `make SOURCES=src/mame/stern/berzerk.cpp`). We read one MAME source file
per game (the driver) as documentation — extracting the hardware contract,
not porting C++. Correctness is anchored to this external oracle before any
trace is trusted (wrong-oracle risk eliminated).

---

## Phase 1 — Disassembler
- **Goal:** trustworthy machine-readable decode of the ROM with every byte
  accounted for.
- **Inputs:** ROM (user-supplied); decode oracles (skoolkit/Tunstall).
- **Tactical actions:** disassemble; validate decode against oracles;
  byte-accounting audit (opcode/operand/unknown partition); later, reconcile
  against execution traces to resolve unknowns (coverage feedback loop).
- **Outputs:** disassembled files; `coverage_report.json`; eventually a
  code/data-separated listing.
- **Ability at end:** navigate the ROM knowing exactly which bytes are
  decoded code and which are unresolved — with an enumerated work list of
  unknowns instead of invisible gaps.

## Phase 2 — JS machine (emulator first, port scaffold later)
- **Goal:** a playable JS emulation of the full Berzerk machine, built around
  a borrowed CPU core.
- **Inputs:** MAME driver file (read as spec); ZEX-validated Z80 core; ROM;
  user-supplied speech/sound samples.
- **Tactical actions:** extract hardware contract into
  `cdoc/hardware-berzerk.md`; scaffold `machine/`; integrate core behind a
  thin interface + ZEXDOC/ZEXALL gate; memory subsystem mirroring the
  original address map (with read/write taps designed in); video (VRAM,
  magicram 74181 ops, color RAM, intercept flag); deterministic
  cycle-counted scheduler with NMI/IRQ cadence; input ports + DIPs; sound
  via samples keyed on port writes; browser shell; boot the real ROM.
- **Outputs:** `cdoc/hardware-berzerk.md`; working machine in `machine/`;
  browser shell.
- **Ability at end:** play Berzerk in the browser under full emulation.
  (Necessary but not sufficient — fidelity unproven until Phase 3.)

## Phase 3 — Validate JS machine vs MAME
- **Goal:** prove the JS machine is bit-faithful to MAME before any trace
  from it is trusted.
- **Inputs:** frozen input-script schema; scenario script library (human-
  recorded); stock MAME; the Phase 2 machine.
- **Tactical actions:** freeze `cdoc/schemas/input-script.md`; build script
  recorder/player in JS; MAME Lua harness (inject inputs, hash VRAM+colorRAM
  per frame); identical hashing on JS side; diff tool; drive divergences to
  zero; commit MAME hash streams as goldens.
- **Outputs:** golden hash fixtures; `npm run golden` standing regression
  suite; pinned MAME version.
- **Ability at end:** mechanically prove "the JS machine behaves exactly
  like the real game" for any recorded scenario — and re-prove it after
  every future change. THE trust gate for everything downstream.

## Phase 4 — Trace capture on the JS machine
- **Goal:** rich, replayable execution data for comprehension and testing.
- **Inputs:** scenario input scripts (lightweight traces); validated machine.
- **Tactical actions:** instrument CALL/RET dispatch and memory taps;
  capture per invocation: entry PC, regs_in, ORDERED read-set, regs_out,
  write-set, cycles, caller (call graph for free); per-instruction mode on
  demand; verify byte-identical traces on replay.
- **Outputs:** heavyweight traces (`cdoc/schemas/heavy-trace.md`); call
  graph; determinism proof.
- **Ability at end:** turn any play session into a byte-stable record of
  everything every subroutine did.

## Phase 5 — Determinism & RNG audit
- **Goal:** know every source of nondeterminism before annotating or porting.
- **Inputs:** heavyweight traces; hardware contract.
- **Tactical actions:** hunt entropy sources — frame counters, Z80 R
  register, free-running timers, input-timing seeds; document each read site.
- **Outputs:** nondeterministic-read-site doc.
- **Ability at end:** explain every "random" value in the game — the classic
  port-divergence bugs are now a checklist instead of surprises.

## Phase 6 — Trace-driven annotation
- **Goal:** understand the program: name every reachable routine and RAM
  variable, from traces alone (method must generalize to source-less games).
- **Inputs:** heavyweight traces + call graph + disassembly.
- **Tactical actions:** walk call graph bottom-up; infer routine purpose
  from read/write addresses (cross-referenced with the hardware contract),
  argument registers, observed effects; name, label, comment. Berzerk-only:
  afterwards diff against Frenzy source / seanriddle berzerk.asm and score
  accuracy (research result, not an input).
- **Outputs:** annotated asm; RAM variable map (addr → name → meaning);
  method-accuracy score.
- **Ability at end:** read the game's code like reviewed source — every
  trace-reachable routine has a name and a contract.

## Phase 7 — Test-plan generation
- **Goal:** convert traces into hermetic per-routine test cases.
- **Inputs:** heavyweight traces + annotations.
- **Tactical actions:** emit one JSONL per trace, one record per kept
  invocation (`cdoc/schemas/test-plan.md`); dedupe; prefer distinct branch
  paths per routine; self-check by replaying records on the JS machine.
- **Outputs:** JSONL test plans.
- **Ability at end:** for any routine, produce real captured input/output
  cases on demand — the port's acceptance tests, generated not hand-written.

## Phase 8 — JS test bench
- **Goal:** run test plans against JS implementations with no emulator in
  the loop.
- **Inputs:** test-plan JSONL + frozen schema.
- **Tactical actions:** ~200-line bench — mock memory from ordered read-set,
  call JS routine, diff regs_out + write-set.
- **Outputs:** test bench wired into `npm test`.
- **Ability at end:** millisecond hermetic feedback on whether a JS routine
  behaves exactly like its Z80 original.

## Phase 9 — Incremental subroutine replacement (bottom-up)
- **Goal:** port the game one verified routine at a time, never breaking
  playability.
- **Inputs:** annotated asm; test plans; the JS machine as scaffold.
- **Tactical actions:** per routine, leaves of the call graph first:
  implement in JS by intent (delay loops → explicit waits) → pass bench →
  hook its CALL address (Z80 core still executes the rest) → full
  golden-frame suite must still pass. Per-routine hazard check:
  self-modifying code, computed jumps, jump tables, timing-contract
  routines, Phase 5 nondeterminism list.
- **Outputs:** growing set of JS routines; game playable at every commit;
  regressions localized to the last swap.
- **Ability at end:** swap any Z80 routine for JS with mechanical proof
  nothing changed.

## Phase 10 — Remove the scaffold
- **Goal:** finish the inversion: a JS game, not an emulator with patches.
- **Inputs:** machine at 100% routine coverage.
- **Tactical actions:** delete Z80 core from the runtime path (it stays in
  the repo for game #2 and debug builds); re-anchor main loop + interrupt
  cadence to requestAnimationFrame/audio clock at original frame rate; flush
  test — full golden suite + long play session with no interpreter to fall
  back on; side-by-side feel test vs MAME.
- **Outputs:** the truly ported JS game; reusable pipeline (disassembler +
  coverage loop, machine HAL pattern, trace instrumentation, annotation
  workflow, schemas, bench) for the next title.
- **Ability at end:** a pure-JS Berzerk indistinguishable in play from the
  arcade original — debuggable with real stack traces — plus a repeatable
  method for the next Z80 game.

---

## Decision log
Architectural decisions and their rationale: `cdoc/decisions.md` (append-only).
Plan version history: v1 user draft → v2 (cut tools emulator + hand-written
core; added golden frames, determinism audit) → v3 (trace capture moved onto
the JS machine; MAME strictly black-box) → v4 (per-phase goal/inputs/actions/
outputs/ability structure; phase-task-map slimmed to an index).
