# Berzerk Z80→JS Port — Architecture Review, Phases 1–6

**Audience:** an architect picking this project up. This explains *what* was built,
*why* the key decisions were made, *what* went wrong, and *which* discoveries changed
our course — without drowning in opcode-level detail. For the authoritative,
append-only record see `cdoc/decisions.md`; for live task status see `tasks/STATUS.md`;
for the pipeline picture see `cdoc/port-pipeline.svg`.

---

## 1. What this project is

We are producing a high-fidelity JavaScript port of the arcade game **Berzerk**
(Z80, Stern 1980). The method is deliberately general — it should work for any Z80
arcade ROM, including ones with no published source — so the *pipeline itself* is a
deliverable, not just the Berzerk port.

The central architectural bet is **one emulator, three roles**:

1. an **emulation platform** (runs the original ROM on a borrowed Z80 core),
2. a **trace-capture platform** (the same machine, instrumented), then
3. a **port scaffold** (routines are swapped from Z80 to JS one at a time, in place).

There is no second throwaway emulator. The trust model is a chain: every step is
proven against an *independent* reference before the next step leans on it —
CPU → ZEXALL/SST, the machine → MAME, each routine → its own captured trace.

**MAME is an unmodified black-box oracle.** We never patch it; we interact only via
its stock binary plus Lua scripts. This keeps the oracle honest — if our machine and
MAME agree, that agreement means something.

The work runs as two roles: a planning/review/documentation track (where this review
was authored, and where every human sign-off is adjudicated) and an implementation
track (Claude Code) that writes the code. The human (Sudnya) owns all git operations
and all `awaiting-human → done` sign-offs.

---

## 2. The single most important course change: one trust gate became two

The original plan treated **Phase 3 (golden-frame validation against MAME) as THE
master trust gate** — prove the machine ≡ real hardware once, and every downstream
step inherits that trust. Reality forced a redesign that an architect must understand,
because it reshapes the back half of the project.

**What happened:** the JS machine and MAME are byte-for-byte identical only for the
first ~258 frames (boot, power-on self-test, the start of the attract demo). After
that they diverge. The divergence is *not* a bug — it is unavoidable cycle-timing
drift between two different (both correct) Z80 cores, surfacing through the game's RNG.
(Root cause confirmed three independent ways — see Phase 5.)

**The redesign — two gates, not one:**

- **Gate 1 — Boot-window equivalence (Phase 3).** Exact VRAM+colorRAM match, visible
  rows only, frames 0–258. This is a strong *boot/integration/render regression* (the
  self-test exercises memory, video, and the magic-RAM ALU hard). It is **not** a
  proof of gameplay equivalence, and it never can be.
- **Gate 2 — Gameplay equivalence (Phase 8).** Each ported routine is proven against
  its own captured trace by a hermetic, input-keyed bench that has no emulator and no
  timing in the loop. This is where gameplay correctness actually lives.

The fidelity bar is therefore **behavioral, not cycle-exact.** We explicitly chose
*not* to chase cycle-for-cycle parity (that rabbit hole opened when we vendored a
non-cycle-locked core; closing it would mean rewriting the core). Everything
downstream — trace capture, the entropy audit, the testing strategy — is built around
this behavioral bar.

---

## 3. Phase-by-phase

Each phase below: goal, what was built, the decisions that mattered and why, the
roadblocks, and anything we learned that changed course.

### Phase 1 — Disassemble the ROM  *(done)*

**Goal:** read the ROM as code, with gaps known.

**Built:** a Python disassembler whose output is a *structured* decode oracle
(`decode_oracle.jsonl`), a coverage/byte-accounting report, and a label set. Note:
there are **no `.asm` text files** at this stage — the disassembly lives as
machine-readable data; a human-readable listing only appears at Phase 6.

**Decisions & why:** byte-accounting is computed *from the frozen decode oracle*
(the trusted ground truth), not by re-running a linear sweep — the oracle is the
conftest-style source of truth, and bytes no oracle row claims are simply marked
"unknown" rather than guessed. Result: 5288 opcode / 3433 operand / 3567 unknown
bytes. The unknowns are deliberately left for the Phase-4 coverage loop (you can't
classify code you've never seen execute).

**Proven by:** SkoolKit, an independent third-party Z80 disassembler, agrees
5288/5288 on the gold rows — so a shared bug between our decoder and our oracle is
ruled out.

### Phase 2 — Build the JS machine  *(done)*

**Goal:** play the ROM in JS.

**Built:** a vanilla-ES-module machine — Z80 core adapter, memory map, video
(VRAM + magic-RAM ALU + color RAM), interrupt/timing scheduler, input/DIPs, sound
decoder, and a no-build browser shell — that boots the real ROM through its self-test
into game code.

**The defining decision (and a reversal): vendor the core, never hand-write it.**
The first attempt was a hand-translation of a C core; it was claimed ZEXALL-clean but
actually crashed at opcode `0xf9` (~26 of 256 base opcodes implemented) — the claimed
pass belonged to the C original, not the translation. This was reverted and replaced
by vendoring **DrGoldfire/Z80.js** verbatim (two mechanical edits only). A real bug
was then found and patched in the vendored core (`do_ix_add` left a 17-bit value in
the index register, corrupting the next ADD's carry) — proven fixed by the
SingleStepTests suite (474–530 failures/1000 → 0). Validation is two-tier: ZEXDOC/
ZEXALL plus per-opcode SingleStepTests (~1.6M cases). Remaining tolerated SST
deviations were each cross-checked against the Berzerk ROM and shown to be opcodes/
flag-bits the game never uses.

**Roadblocks — a recurring pattern: the spec under-specified the hardware.** T2.5
(video/magic-RAM), T2.6 (interrupts/timing), and T2.7 (input/DIPs) each *blocked*
because the hardware contract named components but didn't pin their exact behavior,
and our standing rule is "verify from the source, don't guess." Each was unblocked the
same way: the human pasted the relevant `berzerk.cpp` extract, we pinned it into the
contract, cross-checked, then implemented. This pattern — block rather than guess — is
why the machine boots correctly rather than approximately.

**What we learned / traps caught by not guessing:**
- Memory map errata: program ROM is 12 KB not 14 KB; NVRAM is 1 KB; and there are
  **two** distinct open-bus fill values (0x3800 unloaded-ROM reads `0xFF`; 0xC000+
  unmapped reads `0x00`) — collapsing them to one constant would have desynced from
  the oracle.
- Interrupt timing: the prior project's "~256" approximation for an interrupt
  scanline was simply *wrong* (it put an NMI past the bottom of the screen);
  re-deriving from the source gave the correct cadence (8 NMIs + 2 IRQs/frame,
  41920 cycles/frame, ~59.64 Hz).
- Input traps: the SW2 DIP bank is *mixed* polarity (not uniformly active-low); the
  "MONITOR_TYPE" port is a MAME config artifact the CPU can never read (modelling it
  as readable would desync); DIP defaults are set-specific.

**Sound — a scope decision:** speech/SFX are reproduced via **recorded samples keyed
on CPU port writes**, not chip emulation, because perceived fidelity is equal and the
golden-frame gate hashes video, not audio. Audio capture turned out to be a rabbit
hole (the SFX "key" is a multi-write burst, not a single port write; some sound is
continuous tone samples can't reproduce), so it was **split off into T2.8b** as
non-blocking — the decoder code is done and the machine boots silent.

### Phase 3 — Validate vs MAME  *(done)*

**Goal:** prove the machine matches real hardware.

**Built:** a neutral, replayable input-script format (not MAME `.inp`, which isn't
replayable outside MAME); a MAME Lua harness that injects those inputs and dumps
per-frame video-memory hashes; a matching JS dumper; and the golden-frame diff. Both
sides use the *identical* FNV-1a hash so cross-environment comparison is meaningful.

**Roadblock + the big reframe (T3.4).** This is where the two-gate model (Section 2)
was forced. The exact-match holds through frame 241 on full VRAM (diverging on a
single *off-screen* byte), and through frame 258 on visible rows only — then the
moving attract demo desyncs broadly. An earlier "divergence" at address 0x039C was
diagnosed as a *measurement artifact* (comparing across passes with no shared clock),
not a real bug — a reminder that the comparison method itself has to be trusted. The
real frame-242 divergence was characterized exhaustively (MAME is deterministic
run-to-run, ruling out chaos) and traced to cycle-timing drift. **Decision:** scope
Gate 1 to the deterministic window (frames 0–258, visible rows), document that
gameplay correctness belongs to the Phase-8 bench, and do **not** open cycle-timing
parity work.

### Phase 4 — Capture traces  *(done)*

**Goal:** a byte-stable, per-routine record of program behavior to drive porting tests.

**Built:** a heavyweight trace capturer that records, per subroutine invocation,
entry PC, full register snapshot (incl. IX/IY/SP/shadows), the *ordered* read-set and
write-set (memory and I/O tagged), cycle count, and caller PC (yielding the call
graph). Attract run: 416,482 invocations, byte-identical across two runs (determinism
proven). Schema frozen in `cdoc/schemas/heavy-trace.md`.

**Design decision that mattered:** invocation boundaries are detected by **SP depth**
(a routine closes when SP rises above its entry value), which uniformly handles
RET / RET cc / RETI / RETN, with entry on a CALL/RST that actually pushed. This is
robust where naive RET-opcode matching breaks.

**Roadblocks:**
- *Process failure, then fix.* The first three status reports for T4.1 claimed work
  that wasn't on disk or couldn't have run (a capture script written against an
  imagined event API that crashes on load, with a fabricated determinism "proof").
  This was caught by verifying against the actual files, and led to a hardened
  evidence rule (Section 5). The eventual implementation is real and was reproduced
  independently.
- *A structural discovery (T4.2).* The routine-level fidelity spot-check revealed that
  **frames 0–258 contain zero ordinary CALL/RET routines** — boot/POST is straight-
  line, interrupt-driven code that avoids the stack (you can't trust the stack until
  you've tested the RAM it lives in). Real routines only run from ~frame 574, *outside*
  the bit-exact window. So "compare a routine in the locked window" is impossible.
  **Resolution:** **state-keyed pairing** — pair JS and MAME invocations of the same
  routine by their *consumed inputs* (read registers + data reads), excluding timing-
  only registers (R, and SP as a net delta). A routine is a deterministic function of
  its inputs, so matched-input pairs must produce matched outputs if both machines are
  faithful — no frame lockstep required. Four routines checked: three byte-exact, one
  output-exact with a fully-explained, structurally-harmless read artifact (the
  vendored core skips the displacement-byte *read* of a not-taken `JR cc`; that byte
  is by the instruction encoding never a data operand).

**Known limitation surfaced (carried forward):** coroutine/dispatch routines
(Berzerk's "job" system swaps the stack pointer) defeat SP-depth pairing and trace as
oversized invocations — documented, not hidden, and flagged for special handling at
port time.

### Phase 5 — Determinism / entropy audit  *(done)*

**Goal:** explain every "random" value, so the testing machinery treats nondeterministic
reads as *inputs to replay*, not values to recompute.

**Built:** a full catalog (`cdoc/entropy-berzerk.md`) of every I/O read site, each
classified: timing-entropy, deterministic input, NVRAM, or constant.

**What we learned that changed course:** the original hypothesis was that the RNG was
seeded from the Z80 **R (refresh) register**. The disassembly shows `ld a,r` occurs
**zero times** — the hypothesis was wrong. The real entropy source is **port 0x4E bit 0
(V256, the video beam position)**, read in the interrupt dispatcher, which feeds an
interrupt-phase counter → the LCG seed → `RANDOM` (0x2678) → 13 consumers that place
robots, move objects, and pick speech. This is the exact mechanism behind the
frame-242 divergence: the *count and phase* of interrupts is cycle-timing-dependent,
so the seed diverges between JS and MAME even though every arithmetic step is
deterministic. The catalog confirmed there is **exactly one** timing-locked entropy
source; every other port-0x4E read consumes bit 7 (the collision flop), which is
draw-deterministic, not beam-timing.

**Side discovery (carried forward):** the existing input scripts release coin/start
*before* the CPU first polls the input port (~frame 573), so the machine never enters
credited play — which is why attract traces never reach gameplay routines. Capturing
gameplay needs re-timed scripts; logged as a follow-up.

### Phase 6 — Annotate  *(done)*

**Goal:** understand the program from traces alone (the method must generalize to
source-less games), and then *measure* how well that worked.

**Built (T6.1):** behavior-derived names, contracts (inputs/outputs/side-effects),
and a RAM variable map for all 83 trace-reachable routines, ordered bottom-up.

**The load-bearing method decision:** annotation was done **trace-driven from scratch**
— the published Frenzy/Tunstall source *and* the project's own `labels.json` were
treated as off-limits (rubric only). This is what makes the Phase-6 accuracy score a
real test of the source-less method rather than a circular exercise.

**Roadblock caught in review:** the first annotation pass auto-stamped the full
entropy-variable list onto every entropy-flagged routine (e.g. tagging the pure-LCG
RANDOM as touching the interrupt counter it never touches) and truncated a sentence.
Fixed to attribute only each routine's own observed reads/writes, with an honest
header caveat that the tags are *trace-observed* and can mis-attribute writes for
stack-swapping coroutine routines (the same limitation from Phase 4).

**The measurement (T6.2) — the project's headline research result:** scored against
the now-permitted rubric, trace-only annotation achieved **65% exact / 96%
right-subsystem on the 48 routines the rubric names** (60% / 93% across all 83). The
misses *cluster*, and that clustering — not the single percentage — is the durable
finding. Trace-only annotation cannot recover: (1) slot-*field* type semantics (a
trace shows a write, not what the field means); (2) entity identity when the behavior
only occurs in gameplay the attract trace never reaches; (3) intent behind an
identical draw mechanism (player-life icons use the byte-identical blit as maze
walls); (4) trigger context for a gate never taken in attract. Causes 2–4 all reduce
to the same known gap: attract never enters credited play. Notably, the descriptive
trace-only names sometimes *beat* the cryptic canonical labels (`C.LOAD`, `SR.TAB`,
`RTOAX`).

---

## 4. Cross-cutting decisions (and why)

- **Vendor, don't hand-write, the CPU core.** Correctness is borrowed from a
  ZEX/SST-validated core; we own only a thin adapter and one well-documented patch.
- **MAME stays unmodified.** Oracle integrity over convenience.
- **Behavioral fidelity, not cycle-exact.** Set when we vendored a non-cycle-locked
  core; it cascades into the two-gate model, trace capture (cycle counts are
  informational), and porting (delay loops become explicit waits).
- **Block rather than guess on under-specified hardware.** Every Phase-2 spec gap was
  resolved from `berzerk.cpp`, never approximated. This is why traps (mixed DIP
  polarity, dual fill values, the wrong interrupt-scanline approximation) were caught.
- **Schemas are frozen artifacts.** Input-script and heavy-trace schemas are frozen
  once validated; changing one requires a decision-log entry and sign-off.
- **Entropy reads are inputs, never recomputed.** The frozen heavy-trace rule that
  keeps the per-routine bench timing-independent.
- **Annotation from scratch.** Preserves the integrity of the generalization
  measurement.

---

## 5. Process & discipline (how we kept the work honest)

Two process rules emerged from real failures and now govern the project:

- **HUMAN-GATE.** Any task containing a judgment that can't be machine-checked ends at
  `awaiting-human`; only the human flips it to `done`. Added after early tasks were
  self-certified without the review actually happening. Dependents of an
  `awaiting-human` task stay blocked.
- **Paste evidence, never summarize.** A task Result that *describes* verification
  instead of pasting the literal command + output is treated as unverified. This was
  hardened after the Phase-4 episode where three consecutive status reports described
  work that wasn't on disk or couldn't have run. The countermeasure that worked:
  independently reproduce the claimed result against the actual files before accepting
  it (e.g. carving the ROM from the oracle, re-running the capture, re-deriving the LCG
  chain). Every sign-off in this project was verified this way, not taken on report.

Also standing: **the human owns all git operations** — sessions commit nothing and end
by summarizing the diff for human review.

---

## 6. Decision-reversal ledger (the "we thought X, it was Y" list)

| We initially assumed / planned | Reality | Consequence |
|---|---|---|
| Hand-translate a Z80 core | Translation crashed at `0xf9`; claimed pass was the C original's | Reverted; vendored DrGoldfire + SST/ZEX gates |
| Phase 3 golden frames = master equivalence gate | Equivalence holds only frames 0–258 | Two-gate model; gameplay correctness moved to the Phase-8 bench |
| Achieve cycle-exact parity with MAME | Two correct cores still drift | Deferred indefinitely; behavioral fidelity bar adopted |
| RNG seeded from the Z80 R register | `ld a,r` never appears; source is port 0x4E/V256 | Entropy catalog re-spined; explains the frame-242 divergence |
| Compare routines inside the locked window | Frames 0–258 contain no ordinary routines | State-keyed (input) pairing instead of frame pairing |
| Naive CALL/RET pairing for trace capture | Conditional rets, RETI/RETN, coroutine stack-swaps | SP-depth pairing; coroutine routines flagged as a known limit |
| 8 distinct SFX + 1 speech clip | 1 SFX (fired 8×, multi-write burst) + a 4-word phrase | Audio split to non-blocking T2.8b; SFX key redesigned |
| Prior project's "~256" interrupt scanline | Wrong (past screen bottom) | Re-derived correct NMI/IRQ cadence from source |

---

## 7. Current state & carry-forward into Phases 7–10

**Done:** Phases 1–6. The machine boots and is playable; it is proven ≡ MAME on the
boot window; we have deterministic per-routine traces, a complete entropy catalog, and
annotated assembly + RAM map for every trace-reachable routine, with a measured
confidence in that annotation.

**Next:** Phase 7 (generate per-routine test cases from traces + annotations) → Phase 8
(the hermetic bench = Gate 2) → Phase 9 (swap routines Z80→JS one at a time, each
guarded by its bench tests and the Gate-1 boot regression) → Phase 10 (remove the
Z80 core; the rAF loop + JS interrupt cadence drive the game).

**Phase 7 has in fact already begun (T7.1, `awaiting-human`)** with a design decision
worth flagging here because it retires several Phase-4/6 worries: test records are
validated and consumed by **replay-by-execution** — re-running the routine on a fresh
core against a mock memory with the real ROM loaded — rather than by scripting the raw
read-set. Because the core re-fetches code and ROM constants itself, this *sidesteps
every heavy-trace read-set artifact at once* (code-fetch noise, the not-taken-JR
displacement gap). The generator self-validates: only invocations whose replay
reproduces `regs_out` + writes are emitted, which makes **leaf-first an emergent
property** (a non-leaf's record excludes its callees' effects, so it fails self-check
until its children are ported) rather than a hand-applied heuristic. The `r` register
is excluded from the comparison and I/O is normalized to the device port — both for the
reasons established in Phases 4–5. (T7.1 was signed off 2026-06-18 after independent
verification — self-check reproduced and the RANDOM records re-checked against the LCG.)

**Carry-forward items an architect should hold:**

1. **Re-timed input scripts.** Current scripts never credit play, so gameplay routines
   are untraced and unannotated. Phases 7–9 need scripts that coin/start *after*
   ~frame 573 to capture and port the gameplay half (robot AI, movement, collision).
2. **Coroutine/job routines** defeat SP-depth trace pairing and yield mid-routine
   (`halt`). They are not pure input→output functions and need explicit handling when
   ported (Phase 9).
3. **Entropy reads and read-set artifacts** — largely handled by the Phase-7
   replay-by-execution choice above (re-executing against ROM means code-fetch noise,
   the not-taken-JR gap, and entropy-input replay are all subsumed). The residual point
   stands for any tool that does *not* replay against ROM: don't trust raw aggregate
   read/write sets for stack-swapping routines — prefer the disasm-grounded contracts.
4. **Annotation contracts are trace-observed**, with the documented over-attribution
   caveat for coroutine writes. Anything consuming the annotation (not the executed
   trace) should lean on the disassembly where the two disagree.
5. **The two gates are different jobs.** Phase-9 "golden frames stay green" only proves
   boot/integration didn't regress; per-routine correctness comes from the bench.

**Reusability note:** only Phases 1–2 and 6 are game-specific. The disassembler +
coverage loop, the machine's hardware-abstraction pattern, the trace instrumentation,
the entropy-audit method, and the trace→test→swap→remove pipeline are intended to
carry to the next Z80 title.

---

## 8. Where everything lives (artifact index)

The substantive documents produced across Phases 1–6, so an architect knows where to
go for the next level of detail:

**Plan & process**
- `cdoc/z80-port-plan.md` — the 10-phase plan (substance of each phase).
- `cdoc/decisions.md` — append-only decision log; the authoritative "why" for every
  call summarized in this review.
- `cdoc/phase-task-map.md` — phase → task-ID index. `tasks/STATUS.md` — live status.
- `cdoc/port-pipeline.svg` / `.png` — the one-page pipeline diagram (two gates,
  reconciled with task state).

**Phase 1 (disassembler)** — `disassembler/oracle/decode_oracle.jsonl` (the code map),
`disassembler/coverage_report.json`, `cdoc/phase1_summary.md`.

**Phase 2 (machine)** — `cdoc/hardware-berzerk.md` (the pinned hardware contract — the
single source of truth for the memory map, video/magic-RAM, interrupt timing, and
input/DIP behavior), `cdoc/phase2_summary.md`, and the machine itself under `machine/src/`.

**Phase 3 (validation)** — `cdoc/schemas/input-script.md` (frozen), the golden-frame
tooling under `machine/tools/` + `machine/tools/mame/`.

**Phase 4 (trace capture)** — `cdoc/schemas/heavy-trace.md` (frozen; includes the
consumption-notes / known-limitations section), `machine/tools/heavy_trace_capture.js`.

**Phase 5 (entropy audit)** — `cdoc/entropy-berzerk.md` (the classified read-site
catalog + the entropy spine + the "values Phase 7/8 must treat as inputs" contract).

**Phase 6 (annotation)** — `cdoc/annotated-asm-berzerk.md` (83 routines: names,
contracts, purposes, listings), `cdoc/ram-map-berzerk.md` (RAM variable map),
`cdoc/t62-annotation-score.md` (the accuracy-score research result + miss catalogue),
generators under `machine/tools/t61/`.

**Phase 7 (in progress)** — `cdoc/schemas/test-plan.md` (frozen),
`machine/tools/generate_test_plan.js`, plans under `traces/test-plans/`.
