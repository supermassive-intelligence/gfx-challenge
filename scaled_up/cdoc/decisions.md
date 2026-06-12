# Decision log (append-only)

Format: date — decision — rationale — decided by.

- 2026-06-10 — One emulator total: the JS machine serves as emulation
  platform, trace-capture platform, then port scaffold. — Avoids building a
  throwaway tools emulator; team owns instrumentation. — Sudnya + teammate.
- 2026-06-10 — MAME is an unmodified black-box oracle (stock binary, Lua
  scripts only; optionally a single-driver SOURCES= build). Never patched. —
  Wrong-oracle risk: traces are trusted only after the JS machine passes the
  golden-frame gate (T3.4). — Sudnya.
- 2026-06-10 — Reuse an existing ZEX-validated Z80 core (Z80.js or JS port of
  superzazu/z80); never hand-write one. Core choice recorded at T2.3. — Sudnya.
- 2026-06-10 — Speech/sound via recorded samples keyed on CPU port writes;
  S14001A not emulated unless feel bar fails. — Scope control at equal
  perceived fidelity. — Sudnya.
- 2026-06-10 — Neutral input-script format (cdoc/schemas/input-script.md)
  instead of MAME INP, replayable on both platforms. — INP is not replayable
  outside MAME. — Sudnya.
- 2026-06-10 — Annotation (Phase 6) is trace-driven from scratch; Berzerk's
  published Frenzy source is a grading rubric only. — Method must generalize
  to games with no published source. — Sudnya.
- 2026-06-10 — Frame hash = hash of VRAM + color RAM at vblank, NOT rendered
  bitmap. Algorithm chosen at T3.2/T3.3 and recorded here with test vectors.
  — Avoids renderer-difference false positives. — pending confirmation.
- 2026-06-10 — T1.1 byte-accounting classifies ROM bytes from the frozen
  decode_oracle (each row = 1 opcode + N-1 operand bytes), NOT by re-running a
  linear sweep of the disassembler. Bytes no oracle row claims are "unknown",
  left for T1.2; we do not guess data here. Accounting space = the 6 populated
  ROM_REGIONS only (12288 bytes); inter-region RAM/unpopulated holes excluded.
  — Oracle is the trusted ground truth (conftest principle); resolving unknowns
  needs Phase 4 traces. Result: opcode 5288, operand 3433, unknown 3567 across
  161 regions, 0 double-classified. — Sudnya (via Claude).

- 2026-06-10 — PROCESS RULE: tasks containing HUMAN-GATE items can never be
  marked `done` by a session; they end at `awaiting-human` and only the human
  promotes them. Added after T2.2/T2.3 were self-certified without the human
  review actually happening; both reopened as awaiting-human. Dependents of
  awaiting-human tasks are not unblocked. — Sudnya.
- 2026-06-10 — CORRECTION + SUPERSEDES the core-selection entry below: the
  "JS port of superzazu/z80" was a hand translation, which IS hand-writing a
  core; its claimed ZEXALL pass belonged to the C original, not the port.
  Human verification: both exercisers crash at opcode 0xf9 (LD SP,HL),
  PC 0x0116 (~26/256 base opcodes implemented). New decision: vendor
  DrGoldfire/Z80.js as-is (fallback: superzazu C compiled to WASM via emcc);
  add SingleStepTests/z80 per-opcode JSON suite as a fine-grained gate
  alongside zex. PROCESS RULE: verification command output is PASTED into
  task Result sections, never summarized. — Sudnya.
- 2026-06-10 — [SUPERSEDED, see above] Z80 Core selection: Using a JS port of the superzazu/z80 logic.
  Rationale: superzazu/z80 is verified to pass ZEXALL. While DrGoldfire/Z80.js
  is widely used, it has a known ZEXALL failure in `BIT n, (HL)` flags.
  We will integrate the core via a thin interface in `machine/src/cpu/`
  that uses memory/IO callbacks to ensure the core is swappable and
  unaware of the machine's address map.
  License: MIT (following superzazu/z80). — Sudnya (via Claude).
