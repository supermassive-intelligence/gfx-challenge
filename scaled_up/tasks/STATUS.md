# Task status

Phases 1–8 complete (T8.1 hermetic bench signed off 2026-06-18). Next live work:
T9.1 (port hook harness) + T9.2 (port routines bottom-up); T1.2 (coverage loop)
also available. NOTE: test coverage is bounded by input scripts that don't yet
credit play (frame-573 gap) — re-timed scripts remain the standing follow-up to
reach gameplay routines. Source of truth for phase substance:
`cdoc/z80-port-plan.md`.

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
| T9.1 | Port hook harness (CALL replacement)         | 9     | T8.1          | pending (unblocked: T8.1 done) |
| T9.2 | Port routines bottom-up (iterative)          | 9     | T9.1          | blocked |
| T10.1| Remove the scaffold (pure-JS runtime)        | 10    | T9.2          | blocked |
