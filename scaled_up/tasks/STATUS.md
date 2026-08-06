# Task status

Phases 1–8 complete + T9.1 (port hook harness) signed off 2026-06-18. Next live
work: T9.2 (port routines bottom-up); T1.2 (coverage loop). Source of truth for phase
substance: `cdoc/z80-port-plan.md`.

**SCOPE-A CLOSEOUT (2026-06-22, `cdoc/scope-a-wrapup-workorder.md`).** Two things landed:
(1) **Renderer crop bug FIXED** (`src/video.js`): the visible window was scanlines 0–223
instead of the true `[VBEND=32, VBSTART=256)` (cdoc/hardware-berzerk.md sec5), which painted
the top stack/var band as garbage and cropped the bottom status strip where the score is
drawn. Now maps VRAM scanline `vy -> vy-32`; npm test 102/102; decisions.md 2026-06-22.
(2) **Sudnya play-verified** the HOOKED build live after the fix: coin → start → kills →
deaths, with the **score now visible** on screen. Credited-gameplay capture
`traces/scripts/kill_robots.jsonl` proves it in a trace (kill: score 0x433E-0x4340
000000→000500 = 10 kills; deaths: lives 0x434C 5→1; universe 83→95, +12 routines —
cdoc/credited-gameplay-coverage.md).
The renderer fix does NOT affect the MAME goldens (golden.js hashes raw VRAM 0x4000-0x5FFF +
color, independent of renderToRGBA).

ACTION ITEM (the one real remaining external-regression gap): **no committed MAME goldens
exist** — `node tools/golden.js` reports "no-golden" for all 7 scenarios (exit 2, expected),
so the "golden stays green" regression is a no-op until generated. Sudnya-side: generate +
commit MAME golden hashes (needs stock MAME + ROMs) — exact instructions in
`cdoc/mame-goldens-howto.md`. This + the HUMAN-GATE spot-play are the only two open Scope-A
items.

**INDEPENDENT VERIFICATION (planner, 2026-06-22).** The closeout was reproduced, not taken on
report. Confirmed: renderer geometry (`[VBEND=0x20, VBSTART=0x100)`, `vy−32`); credited-gameplay
indicators re-derived by replay (coin `0x08A3` 0→1; score `0x433E–0x4340` → BCD `000500` = 10
kills; lives `0x434C` 5→4→3→2→1); coverage diff reproduced exactly (kill_robots 95 vs attract 83
= 12 new); the score/lives RAM relabels; protected files (37 ports, PORT_META, frozen schemas,
goldens) untouched this turn (mtime-confirmed); `fixtures/goldens/` empty (no fabricated
goldens); rom-independent suites green (full 102/102 CC-reported, consistent with every subset
reproduced). Game-over correctly reported **inconclusive** (lives reset to 5 at f4812, never
reaching 0 → scenario 6 not demonstrated; maze-transition + Evil-Otto not captured). One
indicator not independently isolated: `0x4344` "game-start" (boot garbage in that
VRAM-overlapping band) — secondary; coin/score/lives already prove credited play.

**SCOPE B — for posterity (deferred; NOT required to ship; decision: `cdoc/done-definition.md`
+ `decisions.md` 2026-06-18).** Scope B is **not** "remove the emulator." It is a **second build
target from one shared codebase**: a NATIVE (pure-JS) build whose run path omits the Z80
interpreter, shipped **alongside the retained EMULATOR target** — the emulator stays first-class
as (a) the verification oracle (native ≡ emulator ≡ MAME), (b) the trace/test-plan regeneration
engine, (c) the native debugger. Work remaining: the JS **cooperative scheduler** substrate
(Berzerk's job/coroutine switching + the 2-IRQ/8-NMI interrupt cadence + V256/`0x089F` entropy
derived from the scheduler's own interrupt timeline), the **10 enumerated Tier-3 hazards** + the
long "always-decline" composites ported onto it, then the native target wired up. **Biggest risk
already retired:** the long-routine pilots are GREEN (V1 lossless segmentation 20/20 over 73
segments; V2 per-segment snapshot-sufficiency 73/73; V3 coroutine output-equivalence 20/20 +
cadence), and the interrupt-dependency probe showed the only true ISR-output entanglement is
confined to ~5 routines already classed Tier-3. Validation is system-level only — the
open-ended tail, which is why it sits outside the ship-now line. Pure-JS port coverage today:
**37/83** attract-reachable routines (the portable ceiling under the hybrid hook); 95 routines
reachable with credited play. Design + milestone build order:
`cdoc/scope-b-cooperative-scheduler-plan.md`; first work orders:
`cdoc/milestone1-conductor-workorder.md`, `cdoc/credited-gameplay-capture-workorder.md`.

| ID   | Title                                      | Phase | Depends-on    | Status  |
|------|--------------------------------------------|-------|---------------|---------|
| T1.1 | ROM byte-accounting audit in disassembler   | 1     | none          | done    |
| T1.2 | Coverage feedback loop (traces → disasm)    | 1     | Phase 4       | pending (unblocked: Phase 4 done) |
| T2.1 | machine/ project scaffold + test runner     | 2     | none          | done    |
| T2.2 | Extract hardware contract from berzerk.cpp  | 2     | none          | done    |
| T2.3 | Z80 core: vendor + validate (ZEX + SST)     | 2     | T2.1          | Verified by Sudnya. Done. |
| T2.4 | Memory subsystem (address space)            | 2     | T2.1, T2.2    | done (verified by Sudnya 2026-06-12) |
| T2.5 | Video: VRAM, magicram, color RAM, intercept | 2     | T2.4          | done (verified by Sudnya 2026-06-12) |
| T2.6 | Interrupt & timing skeleton (NMI/IRQ)       | 2     | T2.3, T2.4    | done (verified by Sudnya 2026-06-12) |
| T2.7 | Input ports + DIP switches                  | 2     | T2.4          | done (verified by Sudnya 2026-06-12) |
| T2.8 | Sound/speech via samples (decoder code)     | 2     | T2.4          | awaiting-human (code complete 52/52; audio -> T2.8b) |
| T2.8b| Capture & map audio samples (deferred)      | 2     | T2.8          | pending (non-blocking; HUMAN-GATE audio) |
| T2.9 | Boot to playable game (browser shell)       | 2     | T2.3–T2.8     | Done (verified by Sudnya 2026-06-12 via browser play) |
| T3.1 | Freeze input-script schema + JS player      | 3     | T2.9          | Done (verified by Sudnya 2026-06-15 via scenarios) |
| T3.2 | MAME Lua harness (inject inputs, dump hash) | 3     | T3.1          | Done (verified by Sudnya 2026-06-15 manual diff) |
| T3.3 | JS hash dump + golden diff tool             | 3     | T3.1          | Done (verified by Sudnya 2026-06-16) |
| T3.4 | Golden-frame gate: record scenarios, match  | 3     | T3.2, T3.3    | done (Sudnya signed off 2026-06-16: visible-rows gate, deterministic window frames 0-258; boot/integration regression — gameplay correctness is T8 bench) |
| T4.1 | Heavyweight trace capture                    | 4     | T3.4          | done (Sudnya signed off 2026-06-17: capture/determinism/read-set green; heavy-trace.md FROZEN) |
| T4.2 | MAME routine-level fidelity spot-check        | 4     | T4.1          | done (Sudnya signed off 2026-06-17: 3/4 routines byte-exact, 0x1ce7 outputs-exact + explained note-#6 not-taken-JR fetch artifact, independently verified; see decisions.md 2026-06-17) |
| T5.1 | Confirm entropy source (= port $4e/V256)     | 5     | none          | done (Sudnya ruled HUMAN-GATE 2026-06-16: source = port 0x4e/V256, NOT R-reg; ld a,r=0 occ; flows IRQ counter 0x089F -> LCG seed 0x435C -> RANDOM 0x2678; explains frame-242) |
| T5.2 | Entropy site catalog → entropy-berzerk.md    | 5     | T5.1, T4.1    | done (Sudnya signed off 2026-06-17: 65 IN sites classified, single timing entropy = port 0x4E bit0/V256 @0x26B4 → 0x089F → seed 0x435C → RANDOM 0x2678 → 13 consumers; counts independently verified) |
| T6.1 | Trace-driven annotation                      | 6     | T4.1, T5.2    | done (Sudnya signed off 2026-06-17: 83 routines + RAM map, trace-derived without labels.json; spot-reviewed RANDOM + a conf-L routine; entropy-attribution bugs fixed) |
| T6.2 | Annotation accuracy score (vs Frenzy src)    | 6     | T6.1          | done (Sudnya signed off 2026-06-17: 65% exact / 96% right-subsystem on 48 labeled, 60/33/7 across 83; scoring honesty spot-verified vs labels.json, T6.1 uncontaminated; misses cluster = field-semantics, entity-id, life-icons-vs-maze) |
| T7.1 | Test-plan generator                          | 7     | T4.1, T6.1    | done (Sudnya signed off 2026-06-18: 400 records/47 routines, FROZEN test-plan.md; self-check 3/3 + RANDOM LCG 4/4 independently verified; r-exclusion + IO-port-norm + leaf-first policies ratified) |
| T8.1 | JS test bench (hermetic)                      | 8     | T7.1          | done (Sudnya signed off 2026-06-18: hermeticity, 6/6 self-check, RANDOM 4/4 reproduced w/ carved ROMs; ports/random.js confirmed a genuine register-transfer port not a rig; stack/sp/r stripping ratified — see task file sign-off note) |
| T9.1 | Port hook harness (CALL replacement)         | 9     | T8.1          | done (Sudnya signed off 2026-06-18: hooked==un-hooked full attract reproduced independently, 112 real dispatches non-vacuous; cycle-accounting + eventWithin-decline + push-replay verified; one impl shared with bench) |
| T9.2 | Port routines bottom-up (iterative)          | 9     | T9.1          | awaiting-human (Scope-A finish line set 2026-06-22: Tier-1/2 COMPLETE + verified -- 37 routines, portable ceiling; npm 100/100, bench 297/0 across 37, transparency 5/5 byte-identical. Tier-3 (10 deferred) enumerated in task file + decisions.md -> Scope B. PENDING two Sudnya-side items before done: (a) HUMAN-GATE spot-play of the HOOKED build (machine/PLAY.md; hooks ON by default, confirm via climbing dispatch counter + optional break-a-port check), (b) MAME goldens generated+committed. ONLY Sudnya flips -> done after (a). Prior progress: 37 registered 2026-06-22 autonomous batch: +0x272d DRAW_OBJECT (FAST-PATH-DUAL, DRAW_SPRITE x2 + 0x29a3, bench 12/12 + 8 execs), +0x151a UPDATE_BOLT_SLOT (FAST-PATH-DUAL, bench 16/16 + ~14691 execs; TIER MOVE Tier-3->Tier-2 -- callees now ported, no intrinsic hazard, SUDNYA MAY VETO; add-iy-bc carry bug found+fixed by bench), +0x1505 UPDATE_ALL_BOLT_SLOTS (FAST-PATH-DUAL, bench 8/8 + ~5057 execs; FD21 disasm mis-decode found+fixed -- B is INPUT not ld b,e), +0x14f3 STEP_BOLT_GROUPS (ALWAYS-DECLINE-BENCH-ONLY, bench 4/4), +0x1f91/0x1f94 SET_OBJECT_IMAGE (FAST-PATH-DUAL, bench 1/1 + 54/1 execs, VRAM residue 0x1F97), +0x25e4 MAGIC_ADDR_TO_DE (FAST-PATH-DUAL, bench 1/1 + 1640 execs). bench 297/0 (37 routines), npm 100/100, transparency 5/5 (all ports together byte-identical). PORTABLE TIER-2 EXHAUSTED: of 20 composite routines, 10 ported; 7 intrinsic Tier-3 hazards + 3 NEW Tier-3-blocked (0x2436 calls Tier-3 0x1c6e; 0x2b54 calls Tier-3 0x1e78; 0x18cd add-hl-sp stack-temp needs SP not in ctx + composes always-decline 0x2a40). DISASSEMBLER BUG recorded: z80dis reports FD/DD 21 (ld ix/iy,nn) as len 2 not 4 -> phantom instructions (same class as 0x15a0 halt); annotated-asm NOT a reliable boundary source -- use skoolkit + raw ROM bytes. ISR-INFLATED-COST insight: classify FAST-PATH vs ALWAYS-DECLINE by OWN cost (port ctx.cycles), not the ISR-inflated trace max. See decisions.md 2026-06-22. PRIOR 30 registered 2026-06-21: +0x15a0 BOLT_HIT_SCAN -- second FAST-PATH-DUAL-VALIDATED composite (after 0x1553): composes 0x15cb per actor in the head+circular actor list, propagating 0x15cb's hit-path non-local `pop hl; ret` via ctx.retAddr (the hooked 0x15a0 absorbs the inner frame -> framesToDrop=0). bench 8/8 + transparency 12 live fast-path execs (attract 5/free 1/maze 1/death 5; cost 186..2579 T < ~4000 gap so it genuinely fast-paths). Residue invisible by stack placement (SP=0x082x work RAM on all 54 invocations). The annotated-asm `15a6 halt` was a MIS-DECODE (operand of `ld ix,($0876)`); ROM-verified no halt -- 0x15a0 is NOT a hazard. bench 254/0, npm 100/100, transparency 4 verified+1 skip. PHASE-10 CONSTRAINT recorded (decisions.md + T10.1): routines > ~4000 T always decline in P9 (bench-only) AND cannot run atomically in the P10 native target (atomic exec defers mid-routine interrupts -> V256/entropy drift); they need the Tier-3 cooperative yield model -- "registered" != "native-ready". Composite checklist now tags each port FAST-PATH-DUAL-VALIDATED (0x1553,0x15a0) vs ALWAYS-DECLINE-BENCH-ONLY (0x2a40) = the P10-readiness split. PRIOR 28 ported 2026-06-20 later: +0x1553 MOVE_AND_DRAW_BOLT -- the FIRST non-leaf engine body, composes RTOAX, transparency-validated NON-VACUOUSLY (ran live 2042x attract / 1843x death / 437x free / 437x maze, all byte-identical), bench 239/239 unchanged (no test-plan record by design), npm 100/100. PRIOR "27/47 CEILING / blocked on credited-gameplay scripts" RETRACTED -- it was wrong: attract mode runs a DEMO GAME that executes the full engine (0x1553@977, 0x2a40@581, 0x287f/0x2341@1007), so the bodies ARE reachable via transparency; they lack test-plan records only because they are NON-LEAF (leaf-first exclusion), which NO input script changes. De-risk proved a credited-play script adds 0 new records/routines/paths. CORRECTED MODEL: trace universe = ~47 bench-leaf + ~34 non-leaf executed; the 33 remaining non-leaf split ~25 portable COMPOSITES (Tier 2, compose+transparency, e.g. 0x2a40 next) / 7 HAZARD (Tier 3 Phase-10 native) / 1 ambiguous. Composites are the MAJORITY of remaining portable work -> hooked/callee-included (INCLUSIVE) heavy-trace mode BUILT + ADOPTED via SEPARATE file (Sudnya caught that inclusive is NOT a strict superset of the committed exclusive plans: at full 3085f, 8 dropped [all hazard] + 5 content-changed). tools/gen_composite_plan.js -> traces/test-plans/composites-inclusive.jsonl (76 records/20 composite routines; only (entry_pc,path_id) absent from the frozen committed plans). Committed exclusive plans stay FROZEN; bench consumes both (245 pass/0 fail, +6 = 0x1553 composite records). heavy-trace.md/test-plan.md amended + RATIFIED 2026-06-21 by Sudnya. 20 composite routines Tier-classified (Tier-3 hazard NOT hooked: 0x1c6e,0x151a,0x1e6d,0x1e78,0x1e59,0x1d12,0x287f,0x1721; rest Tier-2). 29 registered: +0x2a40 PRINT_DIGITS (composes 0x29a3+PRINT_CHAR), BENCH-validated 1/1; bench 246/0, npm 100/100, transparency 5/5. KEY FINDING: 0x2a40 (~8800 T) is FAR longer than the inter-interrupt gap (~4000 T), so the decline gate ALWAYS declines it (0 live fast-paths) -- the core runs it byte-identically. So it is BENCH-ONLY live-validated, NOT fast-path/transparency-validated like 0x1553 (305 T, 4759 live execs). GENERAL: short composites (<~4000 T) get genuine transparency; long/loop-heavy ones are bench-only-live (always decline) -- both registered (bench coverage + T10-native readiness), but the live bar differs by length and is stated per-routine, not blanket-claimed. DoD RESCOPED off literal "100%" to a three-tier bar (see task file + decisions.md 2026-06-20 later). Recorder PARKED. New diagnostics: tools/gameplay_probe.js, traces/scripts/credited-play-smoke.jsonl. PRIOR 27/47 2026-06-20: +0x27a9, +0x3719 [reconciled], +0x2341 UPDATE_SCORE; bench 239/239. PRIOR 24/47 2026-06-19: +0x2817 DRAW_SPRITE, +0x1ce7 COORD_TO_MAZECELL, +0x15cb BOLT_VS_ACTOR; bench 199/199, npm 99/99, transparency green. KEY DECISION (Sudnya): extended the T2.3 X/Y-flag tolerance to the port bench -- bench now masks undocumented X(bit3)/Y(bit5) in F/F' (Berzerk never branches on X/Y, T2.3-proved); every documented flag/reg/memory write still strict. This REMOVES the WZ-hazard bucket: 0x15cb registered (22/22 under tolerance, live-transparent; the mask EXPOSED a real HL bug, now fixed). INFRA: bitHL8, framesToDrop + returnPc/retAddr hook extensions (unit-tested), tools/transparency.js (cached+scoped+localizer). IN-PROGRESS not registered: 0x27a9 (15/22, non-flag E-off-by-4 bug on one path). Triage corrections: 0x287f SHOOT (jp(hl)+coroutine), 0x1c6e (halt), 0x151a (un-benched callees) -> hazard bucket. Next: finish 0x27a9 + 0x3719, then score subtree (0x1908/0x197b/0x2341). See decisions.md 2026-06-19. PRIOR 21/47: bench 113/113, all 5 scripts hooked==un-hooked; all 21 dispatch non-vacuously; batch 7 added 0x22f1 RESET_JOBS (3 disp, true leaf, di/ei no-op, push-iy residue, fixed 1612T). Prior: batch 6 0x1776 C_LOAD (55540 disp). Remaining 26 all blocked (interrupt-core/coroutine ld sp + jp (iy|hl); unported callees; non-local `pop hl;ret` 0x15cb; bit n,(hl) WZ hazard 0x3719/0x27a9; inline-param 0x3657/0x297b; no-records 0x2a40) -- see task-file checklist) |
| T10.1| Finish inversion: ship 2 build targets (native pure-JS + emulator) | 10 | T9.2 | blocked = SCOPE B (deferred, not required to ship). Two build targets from ONE codebase: NATIVE drops Z80 from its run path; EMULATOR retained first-class as oracle/regeneration/debug (Sudnya 2026-06-18; "remove the core" is superseded wording — never deletes the scaffold). Biggest risk de-risked by the long-routine pilots (V1/V2/V3 GREEN 2026-06-22). Needs the JS cooperative-scheduler substrate (job/coroutine switching + interrupt cadence + V256 entropy) for the 10 Tier-3 hazards + long composites. Design+milestones: cdoc/scope-b-cooperative-scheduler-plan.md; see task file + decisions.md |
