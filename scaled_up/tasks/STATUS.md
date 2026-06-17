# Task status

Phases 4–10 broken down into task files (2026-06-16, this session). Most are
`blocked` pending T3.4's scoped close + their upstream artifacts. T5.1 is the
exception: it depends on nothing and informs how T3.4 is scoped, so it can run
now. Source of truth for phase substance: `cdoc/z80-port-plan.md`.

| ID   | Title                                      | Phase | Depends-on    | Status  |
|------|--------------------------------------------|-------|---------------|---------|
| T1.1 | ROM byte-accounting audit in disassembler   | 1     | none          | done    |
| T1.2 | Coverage feedback loop (traces → disasm)    | 1     | Phase 4       | blocked |
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
| T4.1 | Heavyweight trace capture                    | 4     | T3.4          | pending |
| T5.1 | Confirm entropy source (= port $4e/V256)     | 5     | none          | done (Sudnya ruled HUMAN-GATE 2026-06-16: source = port 0x4e/V256, NOT R-reg; ld a,r=0 occ; flows IRQ counter 0x089F -> LCG seed 0x435C -> RANDOM 0x2678; explains frame-242) |
| T5.2 | Entropy site catalog → entropy-berzerk.md    | 5     | T5.1, T4.1    | blocked |
| T6.1 | Trace-driven annotation                      | 6     | T4.1, T5.2    | blocked |
| T6.2 | Annotation accuracy score (vs Frenzy src)    | 6     | T6.1          | blocked |
| T7.1 | Test-plan generator                          | 7     | T4.1, T6.1    | blocked |
| T8.1 | JS test bench (hermetic)                      | 8     | T7.1          | blocked |
| T9.1 | Port hook harness (CALL replacement)         | 9     | T8.1          | blocked |
| T9.2 | Port routines bottom-up (iterative)          | 9     | T9.1          | blocked |
| T10.1| Remove the scaffold (pure-JS runtime)        | 10    | T9.2          | blocked |
