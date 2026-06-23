# Scope-B plan — the JS cooperative scheduler (core-free native runtime)

**Status:** DRAFT design (2026-06-22). The substrate that replaces the Z80 core in the
native run path. Builds on the long-routine validation pilots (V1/V2/V3 GREEN) and
`cdoc/long-routine-validation-plan.md`. The emulator target is **retained** as oracle and
regeneration engine (two-build-target decision).

## 0. What this is — and is NOT

It is a single-threaded JavaScript runtime that runs the ported routines directly (no Z80
interpretation) and reproduces Berzerk's **cooperative multitasking + interrupt cadence**
so the game behaves correctly. It is **not** cycle-exact, and it is **not** validated
against the emulator forever — only on the boot window (Gate 1, where both are
deterministic) and **behaviorally** thereafter (it must play a correct Berzerk, not match
the emulator frame-for-frame, because the emulator itself diverges from MAME after boot
via the same entropy timing). The bar is the project's standing **behavioral fidelity**.

Why a scheduler at all, settled earlier: JS cannot preempt a running function (single
thread, run-to-completion; timers/Workers don't give atomic interrupt semantics over
shared memory). So interrupts must be delivered by **cooperative yields** — this runtime
is the thing that owns the yields.

## 1. The Berzerk runtime it must reproduce (from the ROM)

- **Cold start** `0x1666`: di, stash return at 0x4400, boot stack 0x4300, spawn the first
  coroutine (`0x1E22`).
- **Cooperative job system** (the actors — player, robots, bolts, Evil Otto):
  - spawn `0x1E22` SPAWN_ACTOR_COROUTINE (+ variant `0x1FD4`); dispatcher/runner `0x1E78`
    (with `0x1E59`/`0x1E6D`/`0x24F7`); job-list head `$0870/$0871`, current-job `$0876`;
    teardown `0x22F1` RESET_JOBS (already ported).
  - **Switch mechanism:** `ld sp,nn` (swap to a job's stack) + `jp (hl)/jp (iy)` (resume
    its PC). Per-job stacks live in **low VRAM** 0x4300/0x4400 (and 0x0840/0x085E/0x0870);
    scalar job vars 0x4344–0x437A. Cooperative: jobs run, then yield back.
- **IM2 IRQ** (2/frame, level-held, vector 0xFC) → `0x26AB` → `0x26B0` (`di; ld sp,$0840;
  push af; in a,($4E)` = **V256**; `rra; jr c`): selects bottom-of-screen vs mid-screen,
  bumps the **interrupt-phase counter `0x089F/0x08A0`**. `0x26AB` "ties draw + objects +
  entropy together each frame" — it is effectively the per-frame game tick.
- **NMI** (8/frame, edge) → `0x0066` → (boot-flag check) → `0x1721` NMI_SOUND_SERVICE on a
  private stack 0x085E: tick the SFX engine `0x1D12` (→ jump-table dispatch `0x1D22`/table
  0x1D31), push the 6840 image `0x1776`, drain the speech queue `0x0898` to port 0x44.
- **Entropy:** V256 is read only at `0x26B4`; it perturbs `0x089F/0x08A0` and thence the
  RNG seed `0x435C` (`seed = 7·seed + 0x3153`, RANDOM `0x2678`). This is the one
  timing-locked input.

## 2. Architecture of the scheduler

A single JS event loop ("the conductor") owns simulated CPU time and decides who runs:

1. **CPU-time budget.** A monotonic `cyc` counter (the V3 coarse cost model, already shown
   to reproduce a routine's own-cycle total exactly for 0x2a40). Routines and the ISRs are
   **generators** that `yield` at seams carrying their accumulated `cyc`.
2. **Interrupt schedule = the conductor, not a predictor.** Per frame the conductor fires
   2 IRQ + 8 NMI at the documented scanline positions (already in `scheduler.js`'s event
   table). Pilot finding V3b: cadence MUST come from this schedule, never from a
   routine-internal gap. When the running coroutine's `cyc` crosses the next scheduled
   interrupt, the conductor suspends it at its current seam and runs the ISR generator to
   completion, then resumes. IFF1/IFF2 gating + held-IRQ model carry over from
   `scheduler.js`.
3. **V256 / entropy from the clock, not from cycles-exact.** The conductor derives V256 and
   the `0x089F/0x08A0` phase counter from the **scheduled interrupt position** (which
   scanline the IRQ landed on) — exactly as hardware derives V256 from the raster. This is
   how entropy stays faithful **without** cycle-exact emulation: V256 is a function of the
   conductor's own interrupt timeline. (Linchpin — see §4.)
4. **Job table = JS coroutines.** Each job is a generator with its own local state; the
   conductor holds the job list (mirroring `$0870`) and current job (`$0876`). `ld sp,job`
   becomes "select this job's generator"; `jp (hl)` resume becomes `.next()`; a job
   yielding becomes `yield`. Per-job VRAM "stacks" become explicit JS state objects (the
   RAM map already flags 0x4300/0x4400 as coroutine stacks, not bitmap).
5. **Memory + I/O** stay the existing shared `Memory`/`io` model the ports already mutate
   through `ctx` — unchanged, so every one of the 37 validated ports runs as-is.

## 3. How each Tier-3 class maps onto the substrate

- **Coroutine / stack-swap (`0x1E22/0x1E59/0x1E6D/0x1E78/0x1FD4`, and consumers
  `0x2436→0x1c6e`, `0x2b54→0x1e78`):** become job generators + the spawn/switch primitives
  above. `0x1E78` is the hard core — it reads ISR-written low-VRAM state (the strict-dep
  finding), so it only works once the job state + ISR interleaving are faithful; it is the
  last thing to fall, not the first.
- **IM2 / NMI dispatchers (`0x26AB`, `0x0066/0x1721`):** ported as the conductor's two ISR
  generators. They are long/composite → use the V3 coroutine model internally.
- **Jump-table dispatchers (`0x1AED` language, `0x1D22` sound-seq, table 0x1D31):** a JS
  dispatch map `index → handler`. Mechanical once the index source is known.
- **Inline-parameter routines (`0x3657`/`0x297b` class):** callers pass the "bytes after
  the call" as explicit JS arguments. Mechanical.
- **SP-dependent (`0x18cd` needs `HL = SP`):** SP is explicit scheduler/job state in JS, so
  `HL = SP` is just reading it — free in native, as `done-definition.md` notes.

## 4. The entropy linchpin and the validation strategy

Everything hard reduces to one thing: **does the conductor's V256/phase model evolve the
RNG seed the way the hardware does?** If yes, robot placement / movement / Otto behave
correctly. If the cadence is off, gameplay diverges. Two consequences:

- **Build entropy first and validate it in isolation** (Milestone 2 below) against the
  emulator over the boot window, where both are deterministic and we have goldens.
- **Behavioral, not identical, downstream.** After boot, the native build need not match
  the emulator run-for-run (neither matches MAME). Validation is: (a) **byte-exact vs the
  emulator on the boot window** (Gate 1), and (b) **behavioral** on credited-gameplay
  traces — plays a correct game, no glitches/freezes, score/death/level-transition all
  work. There is **no per-routine bench for the substrate itself**; it is the "differential
  against a system oracle" tail, which is the open-ended part (and why this is Scope B).

**Dependency:** the behavioral checks need the credited-gameplay traces (the separate
coverage task — complete a level, die various ways). That task feeds this one.

## 5. Incremental build order (each milestone independently validatable)

1. **Conductor + cadence driver.** Generalize V3's `driveCoro` so the schedule comes from
   the live `scheduler.js` event table, not a recorded chain. Drive the one already-ported
   long routine (`0x2a40`) under it. *Validate:* output unchanged + interrupts fire at the
   scheduled scanlines. (Pure extension of a GREEN pilot — lowest risk first.)
2. **V256 / phase-counter model.** Derive V256 + `0x089F/0x08A0` from the conductor's
   interrupt timeline; evolve the RNG seed `0x435C`. *Validate:* seed trajectory matches the
   emulator across the boot window (we can diff against a heavy trace of `0x2678`/the phase
   counter). This is the make-or-break milestone — do it early.
3. **ISR ports.** Port `0x26AB` (IM2: draw+objects+entropy) and `0x0066/0x1721` (NMI
   sound) as conductor ISR generators. *Validate:* their per-invocation effects match the
   emulator's ISR heavy-trace records (we already capture ISR invocations).
4. **Job substrate.** Job table + generators + spawn/switch; port `0x1E22/0x1E59/0x1E6D`,
   then `0x1E78`. *Validate:* a spawned actor's observable behavior matches the emulator
   (system-level differential on a short scripted scenario).
5. **Stragglers.** Jump-table, inline-param, SP-dependent routines — mechanical once 1–4
   exist.
6. **Wire up the NATIVE build target** — the Z80 interpreter is omitted from *its* run path
   (the EMULATOR target is **retained first-class** as oracle/regeneration/debug; two build
   targets from one codebase, per decisions.md 2026-06-18 — *not* deleting the scaffold).
   *Validate:* native ≡ emulator on the boot window + behavioral pass on the full
   credited-gameplay trace set.

Order rationale: 1 is a proven extension; 2 is the linchpin and cheapest to falsify; 3–4
are the substance; 6 is gated on everything. Each milestone fails loudly against an oracle
before the next leans on it — the project's standing "never trust, anchor to a reference"
rule.

## 6. Risks / open questions

- **Entropy fidelity (highest).** If the conductor's interrupt timeline can't reproduce the
  hardware V256 well enough, the seed drifts and gameplay diverges. Mitigation: Milestone 2
  validates this in isolation before any job work; fallback is to source V256 from the
  scheduler's exact scanline model (already present) rather than a cycle estimate.
- **`0x1E78`'s ISR entanglement.** It consumes fresh ISR low-VRAM writes (strict-dep
  finding). Faithful only when job state + ISR interleaving are exact; it is the genuine
  hard core, sequenced last.
- **No per-routine oracle for the substrate.** Validation is system-level differential —
  the open-ended tail. Bounded by: keeping the emulator as a frame-accurate oracle, and the
  boot-window golden as a hard gate.
- **Coverage dependency.** Behavioral validation is only as good as the credited-gameplay
  traces; thin traces = thin assurance.

## 7. First step

Milestone 1 as a Claude Code work order: generalize `driveCoro` to pull cadence from
`scheduler.js`'s event table and drive `0x2a40` under the live schedule, with an
output-equivalence + scheduled-cadence test (the V3 harness, schedule source swapped).
Then Milestone 2 (entropy) — the linchpin — before any job-substrate work.
