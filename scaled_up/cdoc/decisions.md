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

## T2.3 — Z80 core vendored, patched, and gated (2026-06-12)

- 2026-06-12 — CORE VENDORED: DrGoldfire/Z80.js, MIT license, upstream commit
  2207d7c6a8b42246ea12efbf9dba8b2adf010437 (2020-01-12), from
  github.com/DrGoldfire/Z80.js. Saved verbatim as
  machine/src/cpu/z80_core.js with exactly two mechanical edits, both marked
  in-file: (1) the bare `window` reference in the constructor guard wrapped in
  `typeof window !== "undefined"` so the module loads under Node; (2) an
  appended `export { Z80 };` for ESM. The machine-facing adapter is
  machine/src/cpu/z80.js (callbacks + step + register access only). Validation:
  per-opcode SingleStepTests/z80 (tools/run_sst.js) + zexdoc/zexall
  (tools/run_zex.js). — Sudnya (via Claude).

- 2026-06-12 — LOCAL BUG PATCH to the vendored core (do_ix_add): upstream
  stored `ix = result` with no 16-bit mask, so a carrying ADD IX/IY,rr left a
  17-bit value in the index register; the stray bit then corrupted the carry
  flag of the NEXT ADD IX/IY (which tests `result & 0x10000`). Fixed to
  `ix = result & 0xffff`, matching the masking do_hl_add already does in the
  same file. IY shares this function via the FD-prefix ix<->iy swap, so the fix
  covers ADD IY,rr too. The patch site carries a full comment block (upstream
  ref, bug, date). Evidence (tools/run_sst.js, register+memory comparison):
  dd 09/19/29/39 and fd 09/19/29/39 went from 474-530 failing per 1000 to
  0/1000. Berzerk relevance: the decode oracle shows Berzerk uses add ix x1 and
  add iy x2, so this path IS exercised by the game. — Sudnya (via Claude).

- 2026-06-12 — SST GATE TOLERANCES (tools/run_sst.js). After the patch, the
  suite is 1,118,637/1,604,000 cases exact and 0 real failures. The remainder
  are tolerated by rules scoped as tightly as each flaw allows (bit-precise for
  flag bits) so a genuine register/memory regression in the same opcodes still
  fails. Each class, with its Berzerk-usage check against the decode oracle:
    * XY-FLAG (143,969 cases / 202 opcodes): undocumented X (bit 3) / Y (bit 5)
      flag bits only, for BIT n,r (cb/ddcb/fdcb 40-7f), SCF (37), CCF (3f),
      and LDIR/CPIR/LDDR/CPDR (ed b0/b1/b8/b9). These bits come from the
      internal WZ register on hardware; the core does not model WZ. Berzerk
      uses BIT but the X/Y bits are not branchable (no JP/JR tests them), so
      no game logic can depend on them.
    * NONI (334,000 cases): a DD/FD prefix before a non-index-applicable opcode
      acts as a NONI prefix. The core models this imperfectly — always R+1 on
      the refresh register, and in rare operand-taking cases (e.g. DD before
      CALL NZ) a pc/operand misread. The underlying base opcode is validated by
      its own unprefixed SST file, so only the prefix bookkeeping is tolerated.
      The 878 "noni_other" cases are DD/FD 37/3f (SCF/CCF under a NONI prefix —
      R+1 AND the X/Y deviation co-occurring) plus one DD C4 operand misread.
      Berzerk relevance: the decode oracle shows all 180 DD/FD-prefixed
      instructions reference ix/iy — Berzerk emits 0 NONI prefixes.
    * BLOCKIO (7,392 cases / 8 opcodes: ed a2/a3/aa/ab/b2/b3/ba/bb =
      INI/OUTI/IND/OUTD/INIR/OTIR/INDR/OTDR): registers and memory are correct
      (the data transfer is right); only the notoriously complex documented
      flags deviate. Implementing them exactly would mean hand-writing opcode
      logic (out of scope). Berzerk relevance: 0 block-I/O instructions in the
      decode oracle.
    * ADCSBC_H (2 cases / 2 opcodes: ed 4a, ed 62; rule covers the whole
      ed 42/4a/52/5a/62/6a/72/7a family): 16-bit ADC/SBC HL where only the H
      (bit 4) flag deviates, in 2 of 8000 random cases. Berzerk relevance: the
      decode oracle shows 3 `sbc hl` uses (0 `adc hl`); the H flag after a
      16-bit subtract is not branchable, so no game logic can depend on it.
  — Sudnya (via Claude).

- 2026-06-12 — ZEX GATE RESULTS (tools/run_zex.js, 5.76e9 instructions each):
  * zexdoc.com (documented flags): all 67 groups OK, "Tests complete", warm
    boot, exit 0.
  * zexall.com (all flags incl. undocumented): 66/67 groups OK; the single
    ERROR is `bit n,<b,c,d,e,h,l,(hl),a>` (crc expected 5e020e98 found
    e6624aeb) -- exactly the X/Y-flag (WZ-derived) deviation already tolerated
    in SST and documented above. This is the long-known DrGoldfire BIT-flag
    deviation; every other group, including the undocumented-flag-sensitive
    ones, matches. No new deviation. -- Sudnya (via Claude).

- 2026-06-12 -- RUN_ZEX shim performance: the CP/M shim sets up the zero page
  with trap stubs (0x0000: OUT (0xFF),A; HALT for warm boot; 0x0005:
  OUT (0x00),A; RET for BDOS) so the hot path is pure cpu.step() rather than a
  getState() per instruction. Standard CP/M zero-page layout (a vector at
  0x0005); does not change exerciser behaviour. Cut a full run from ~7+ min to
  ~2 min (~48M instr/s). Dispatch is on the port LOW byte because OUT (n),A
  drives the bus as (A<<8)|n. -- Sudnya (via Claude).
- 2026-06-12 — Core deviations cross-checked against Berzerk ROM (T1.1 decode
  oracle): block-IO opcodes 0 occurrences; adc hl,bc / sbc hl,hl (the 2
  ADCSBC_H tolerated cases) 0 occurrences; ld a,r 0 occurrences (R-counting
  deviation unobservable; game does use ld a,i x9, which is exact). All
  tolerated SST deviations and the single zexall ERROR (bit n,r undocumented
  X/Y flags) are therefore PROVABLY irrelevant to Berzerk, not just assumed.
  Caveat: re-run this grep if Phase 4 traces reveal code in the 3,567
  currently-unknown ROM bytes. — Sudnya (verified via Cowork session).
