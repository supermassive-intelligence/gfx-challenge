# Phase → Task index

Pure index: which task files implement each plan phase. Phase substance
(goal, inputs, tactical actions, outputs, ability unlocked) lives in
`cdoc/z80-port-plan.md`. Task status lives ONLY in `tasks/STATUS.md`.

When Phases 4–10 are broken down into task files (triggered by T3.4's
definition of done), add their task IDs here in the same commit.

| Phase | Tasks |
|-------|-------|
| 1. Disassembler | T1.1, T1.2 (T1.2 unblocks after Phase 4) |
| 2. JS machine | T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T2.7, T2.8, T2.9 |
| 3. Validate vs MAME | T3.1, T3.2, T3.3, T3.4 |
| 4. Trace capture | broken down after T3.4 |
| 5. Determinism audit | broken down after T3.4 |
| 6. Annotation | broken down after T3.4 |
| 7. Test plans | broken down after T3.4 |
| 8. Test bench | broken down after T3.4 |
| 9. Port routines | broken down after T3.4 |
| 10. Remove scaffold | broken down after T3.4 |
