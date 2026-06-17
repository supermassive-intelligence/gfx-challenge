# Phase → Task index

Pure index: which task files implement each plan phase. Phase substance
(goal, inputs, tactical actions, outputs, ability unlocked) lives in
`cdoc/z80-port-plan.md`. Task status lives ONLY in `tasks/STATUS.md`.

Phases 4–10 broken down 2026-06-16. Phase 5 (entropy/determinism audit) is
promoted ahead of Phase 4 via T5.1, which informs how T3.4 is scoped.

| Phase | Tasks |
|-------|-------|
| 1. Disassembler | T1.1, T1.2 (T1.2 unblocks after Phase 4) |
| 2. JS machine | T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T2.7, T2.8, T2.8b, T2.9 |
| 3. Validate vs MAME | T3.1, T3.2, T3.3, T3.4 |
| 4. Trace capture | T4.1 |
| 5. Determinism audit | T5.1, T5.2 |
| 6. Annotation | T6.1, T6.2 |
| 7. Test plans | T7.1 |
| 8. Test bench | T8.1 |
| 9. Port routines | T9.1, T9.2 |
| 10. Remove scaffold | T10.1 |
