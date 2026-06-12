# Task status

Phases 4–10 are intentionally not broken down yet — their entry criteria
depend on artifacts produced by Phases 1–3. Break them down when Phase 3's
golden-frame gate passes. Source of truth for later phases: `cdoc/z80-port-plan.md`.

| ID   | Title                                      | Phase | Depends-on    | Status  |
|------|--------------------------------------------|-------|---------------|---------|
| T1.1 | ROM byte-accounting audit in disassembler   | 1     | none          | done    |
| T1.2 | Coverage feedback loop (traces → disasm)    | 1     | Phase 4       | blocked |
| T2.1 | machine/ project scaffold + test runner     | 2     | none          | done    |
| T2.2 | Extract hardware contract from berzerk.cpp  | 2     | none          | done    |
| T2.3 | Z80 core: vendor + validate (ZEX + SST)     | 2     | T2.1          | awaiting-human |
| T2.4 | Memory subsystem (address space)            | 2     | T2.1, T2.2    | pending |
| T2.5 | Video: VRAM, magicram, color RAM, intercept | 2     | T2.4          | pending |
| T2.6 | Interrupt & timing skeleton (NMI/IRQ)       | 2     | T2.3, T2.4    | pending |
| T2.7 | Input ports + DIP switches                  | 2     | T2.4          | pending |
| T2.8 | Sound/speech via samples                    | 2     | T2.4          | pending |
| T2.9 | Boot to playable game (browser shell)       | 2     | T2.3–T2.8     | pending |
| T3.1 | Freeze input-script schema + JS player      | 3     | T2.9          | pending |
| T3.2 | MAME Lua harness (inject inputs, dump hash) | 3     | T3.1          | pending |
| T3.3 | JS hash dump + golden diff tool             | 3     | T3.1          | pending |
| T3.4 | Golden-frame gate: record scenarios, match  | 3     | T3.2, T3.3    | pending |
