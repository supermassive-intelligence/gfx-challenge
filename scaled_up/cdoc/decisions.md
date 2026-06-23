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

## T2.4 — Memory subsystem (2026-06-12)

- 2026-06-12 — CONTRACT ERRATUM (hardware-berzerk.md §1/§2), found while
  implementing T2.4 and corrected against the driver berzerk_map + the RC31A
  ROM-loading table:
  * Program ROM is 12 KB populated, not 14 KB. ROM1-5 is 0x1000-0x37FF (10 KB,
    five 2 KB ROMs) [L670], not 0x1000-0x3FFF (12 KB). 0x3800-0x3FFF is the
    empty ROM6 socket: berzerk_map has no entry for it, so it falls through to
    unmapped and reads the open-bus fill value; the RC31A table lists 0x3800 as
    unpopulated.
  * NVRAM at 0x0800-0x0BFF is 1 KB (0x400 bytes), mirrored by mask 0x0400 to
    0x0C00-0x0FFF [L669] — the old "2 KB" label was wrong.
  * Color RAM at 0x8000-0x87FF (2 KB) is mirrored by mask 0x3800, responding
    through 0xBFFF [L673]. 0xC000-0xFFFF is unmapped/noprw [L674].
  These ranges are permanent API (ported routines bake in absolute addresses),
  so the map is the single source of truth: MAP lives in machine/src/memory.js
  and tests/memory.test.js parses the §2 table and asserts MAP agrees with it.
  — Sudnya (via Claude).

- 2026-06-12 — RESOLVED (was OPEN): the "nothing there" fill bytes are MAME
  debugger-verified, and there are TWO of them, not one. Sudnya ran (berzerk
  loaded): `print b@3800` -> 0xFF and `print b@c000` -> 0x00. Two mechanisms:
    * 0x3800-0x3FFF is the empty ROM6 socket -- a mapped ROM region with no ROM
      loaded, which MAME fills with 0xFF. -> ROM_UNLOADED_FILL = 0xFF.
    * 0xC000-0xFFFF is noprw() (truly unmapped); reads return the address
      space's default 0x00. -> UNMAPPED_FILL = 0x00.
  The session's provisional 0xFF was right for 0x3800 but WRONG for 0xC000 --
  collapsing both into one 0xFF constant would have diverged from the oracle on
  any stray read at/above 0xC000. This is exactly why the value was verified
  rather than assumed. Both constants + pinning tests are in
  machine/src/memory.js / tests/memory.test.js, and hardware-berzerk.md §2
  distinguishes the two rows (ROM vs unmapped). — Sudnya (verified in MAME).

## T2.5 — Video/magicram (BLOCKED on spec gap, 2026-06-12)

- 2026-06-12 — BLOCKER (not a decision yet; awaiting Sudnya): T2.5's DoD
  requires table-driven tests "hand-derived from the spec doc" for each magicram
  control value, citing spec sections. But the authoritative spec
  hardware-berzerk.md §4 only NAMES the components ("two 74181 ALUs and a barrel
  shifter") -- it does not pin: (a) the port-0x4B control-register encoding,
  (b) the magicram write pipeline, (c) the 74181 logic-mode truth table,
  (d) the collision/intercept flag set+read+clear mechanism (§3 only documents
  0x4E as the V256/frame-interrupt clear, not the collision flag), or (e) the
  color-RAM block granularity / attribute format. Per standing rule #1 (spec is
  authoritative) and #2 (verify, don't assume) I will not guess these or copy
  the original noweb implementation unverified. The full MAME-derived behavior
  EXISTS in the original project's cdoc/phase6_maze_robots_difficulty.md §4
  (control format, 7-step pipeline, gate-level 74181 equations incl. the
  historical bug fix `F = 1 XOR (NOT(P) AND G)`, and a 16-entry truth table) and
  noweb/video.nw -- it just needs to be pinned into the authoritative §4 and
  MAME-spot-checked before implementation. T2.5 set to blocked pending Sudnya's
  decision on how to pin §4. — Sudnya (via Claude).

## T2.5 — Video/magicram (UNBLOCKED + implemented, 2026-06-12)

- 2026-06-12 — §4 PINNED from berzerk.cpp (Sudnya pasted magicram_w L449-483,
  magicram_control_w L486-493, intercept_v256_r L496-504, video_start L442-446,
  machine_reset L423-432, screen_update L527-576). hardware-berzerk.md §4 now
  pins: the 0x4B control encoding (S3-S0=bits7-4, flip=bit3, shift=bits2-0); the
  6-step magicram write pipeline; the 74181 logic-mode (M=1) table; the
  intercept flop; and the 4x4 color-block formula. Supersedes the old terse §4.
- 2026-06-12 — 74181 TABLE CROSS-CHECK (required stop-gate): phase6 §4.3's
  "74181 F (active-high)" column was compared entry-by-entry against the
  standard 74181 positive-logic datasheet table. All 16 selects AGREE
  (0->A', 6->A^B, 9->XNOR, C->1, F->A, etc.), and phase6's "F XOR $FF" column
  matches the source's inverted store. No disagreement -> proceeded without
  stop-ask. video.js implements the table directly as byte-parallel bitwise ops.
- 2026-06-12 — SUBTLE BITS pinned (each a would-be future bug): store is
  inverted (`vram = aluF ^ 0xFF`); last_shift_data keeps only 7 bits and is the
  across-byte-boundary shift source; the intercept flop is SET by control writes
  and only ever RESET by collisions (J/K, J low); port 0x4E read returns it
  INVERTED in bit 7 (bit7=1 means "collision since last control write") OR'd with
  V256, and does NOT clear the flop (it separately clears the frame IRQ — T2.6);
  the 0x6000-0x7FFF window shares the 0x4000 VRAM backing store; control resets
  to 0. The task's DoD wording "intercept set on collision" is the OBSERVABLE
  read (bit7=1), not the flop state — implemented per source, tested per source.
- 2026-06-12 — DESIGN: Video (machine/src/video.js) owns the VRAM+color backing
  store and is tested standalone; wiring it into the memory address space
  (0x4000/0x6000/0x8000 windows via the T2.4 device hooks) and the I/O ports
  (0x4B/0x4E) is deferred to T2.9 machine assembly (Z80 wiring is T2.5 out of
  scope). Replaced the prior placeholder video.js (its ALU returned 0, bitswap
  was a no-op, renderToRGBA all-black). Pre-existing orphan src/cpu/alu74181.js
  is now unused by video.js; left in place (not deleting pre-existing code).
- 2026-06-12 — DISPLAY-ONLY APPROXIMATION (flagged, not guessed): the exact RGBI
  pen intensity levels (resistor-network values) are NOT in the source extract.
  renderToRGBA uses level 0xFF (intensity bit set) / 0x80 (clear) as a documented
  approximation, to be confirmed visually at T2.9. The Phase-3 frame hash is over
  VRAM+color RAM bytes, not rendered pixels, so no gate depends on the pen levels.
- 2026-06-12 — EMPIRICAL GATE noted in §4: Berzerk's ROM power-on Magic RAM
  self-test exercises this exact hardware, so a magicram error will fail the
  game's own self-test at T2.9 boot, before golden frames. — Sudnya (via Claude).

## T2.6 — Interrupts/timing (BLOCKED on vsync-counter mapping, 2026-06-12)

- 2026-06-12 — BLOCKER (awaiting Sudnya source): T2.6's DoD needs exact
  cycles-per-frame and exact NMI/IRQ firing positions. Solidly derivable from
  the spec + clocks: CYCLES_PER_FRAME = 41920 (HTOTAL 320 / 2 px-per-Tstate x
  VTOTAL 262; pixel clock = MASTER/2 = 5 MHz, CPU = MASTER/4 = 2.5 MHz), and the
  8 V256=0 interrupts fire at scanline = V-counter (NMI 48/80/112/144/176/208/240,
  IRQ 128), cycle = scanline*160. NOT pinned: the vpos<->vsync-chain-counter
  mapping. §5 gives interrupt positions in (V-counter, V256) space, but the
  counter != scanline in the V256=1 region, so the exact firing scanlines of the
  two V256=1 interrupts (IRQ1 @ V-counter 0xDA, NMI7 @ 0xF0) are unknown. The
  original project's analysis (cdoc/architecture.md, noweb/interrupts.nw) marks
  these "~256"/"~vblank" and uses "approximately 256+(Vcounter-0xE8)", which
  breaks (NMI7 -> scanline 264 > VTOTAL 262). The same mapping is needed to make
  the V256/counter readback correct (T2.5's readIntercept(v256) consumes it).
  Per rule #2 I will not guess the counter function. Requested from Sudnya: the
  berzerk.cpp (a) screen/clock config (set_raw / pixel clock / HTOTAL/VTOTAL) to
  confirm 41920, (b) full vpos_to_vsync_chain_counter + vsync_chain_counter_to_vpos,
  (c) the IRQ/NMI timer scheduling (how each (V-counter,V256) position is armed,
  e.g. via screen.time_until_pos). T2.6 set to blocked pending these. — Sudnya (via Claude).

- 2026-06-12 — RESOLVED (T2.6 blocker above): Sudnya pasted the berzerk.cpp
  timing extracts (clocks/geometry L166-179, trigger tables L181-185, the
  verbatim vpos<->vsync-chain conversion L230-265, IRQ HOLD+vector L283-302,
  NMI pulse L360-379, NMI enable/disable on read+write of 0x4C/0x4D L332-357,
  machine_reset L423-432). Pinned into §5. Key resolutions:
  * CYCLES_PER_FRAME = 41920 (HTOTAL 320 / 2 px-per-Tstate * VTOTAL 262;
    PIXEL=MASTER/2=5MHz, CPU=MASTER/4=2.5MHz). Frame ~59.64 Hz.
  * The 0xF0 "duplicate" is (counter, v256): vsync_chain_counter_to_vpos(0xf0,0)
    = line 240; (0xf0,1) = 0xf0-0xda+0x100 = 0x116 >= VTOTAL -> -0x106 = line 16.
    So the 8 NMIs are at vpos 16,48,80,...,240 (every 32 lines). IRQ (0xda,1) ->
    line 256, (0x80,0) -> line 128. The original project's "~256/256+(Vc-0xE8)"
    approximation was WRONG (put NMI7 at ~256; it is actually line 16) -- verifying
    instead of trusting the prior analysis caught a real error.
  * WIRING TRAPS pinned: IRQ line is HELD (level) with data-bus byte 0xFC during
    ack (matters in IM2: jump via (I<<8)|0xFC); NMI is a PULSE (edge, ->0x0066).
    Modeled with held-IRQ-pending serviced when iff1 allows (the vendored core
    services maskable IRQ only if iff1, drops otherwise; NMI always). v256 in the
    0x4E read is ONE BIT (0/1), not the chain counter -- the scheduler passes the
    single vblank bit to Video.readIntercept. — Sudnya (via Claude).

- 2026-06-12 — T2.6 REVIEW FIXES (Sudnya review, before flip):
  (1) setIrqEnable(false) must NOT clear irqPending. MAME's HOLD_LINE survives
      irq_enable_w(0): the enable only gates whether a NEW trigger asserts the
      line; an already-held IRQ is still delivered once iff1 allows. Removed the
      clearing clause in scheduler.js; added a regression test (IRQ held with
      iff1=0, setIrqEnable(false), then iff1=1 -> IRQ delivered with vector 0xFC).
  (2) The 0x4E-read "clears pending frame IRQ" is a schematic/address-map note
      that MAME does NOT implement (intercept_v256_r L496-504 has no clear; the
      §3 table already said "not in intercept_v256_r"). Per match-the-oracle
      (0x3800 precedent), corrected §5.4 and the §4.4 parenthetical to say MAME
      implements no 0x4E-read clear; a held IRQ is cleared only by the CPU's
      interrupt acknowledge. scheduler.js ackIrq() kept as a HARDWARE-NOTE-ONLY
      method (records the schematic note; not to be wired into the 0x4E read at
      T2.9). npm test 35/35. — Sudnya (via Claude).

## T2.7 — Input/DIPs (BLOCKED on MAME INPUT_PORTS, 2026-06-12)

- 2026-06-12 — BLOCKER (awaiting Sudnya source): T2.7's DoD needs every field's
  exact bit + active-low polarity + DIP factory defaults, with field NAMES that
  "must match the MAME driver exactly" (the input-script schema resolves names
  on both platforms via the Lua injector). The authoritative spec §3/§6 pins
  none of this -- it only names ports 0x48/0x49/0x4a, the joystick directions,
  the DIP banks (F2-F6,SW2 @ 0x60-0x65, "mirror 0x18"), and the coinage macro.
  The original project's cdoc/architecture.md "Input System" section is a strong
  MAME-derived reference (P1 0x48: L/R/U/D=bit0-3, Fire=4; P2 0x4a: same +bit7
  cabinet; SYSTEM 0x49: Start1/2=bit0/1, Coin3/2/1=bit5/6/7, all active-low;
  F2 color-test+bonus-life; F3 input-test/crosshair/language; F4/F5/F6 coin-chute
  coinage 16-setting table; SW2 free-game/bookkeeping), but it does NOT give the
  exact MAME PORT field-name tags or the factory DEFAULT settings. Per rules #1/#2
  I will not guess names-that-must-match-MAME or defaults. Requested from Sudnya:
  INPUT_PORTS_START(berzerk) + the BERZERK_COINAGE macro (PORT_BIT/IPT/ACTIVE_LOW
  lines, all PORT_DIPNAME/PORT_DIPSETTING with the default-marked setting), and
  confirmation of the "mirror 0x18" DIP-read aliasing. Then pin §3/§6 with names
  + defaults, cross-check vs architecture.md, and implement. T2.7 set to blocked.
  — Sudnya (via Claude).

- 2026-06-12 — RESOLVED (T2.7 blocker above): Sudnya pasted INPUT_PORTS_START
  (berzerk) [L751-843] + BERZERK_COINAGE [L730-747]. §6 pinned with exact field
  names, per-bit polarity, and factory defaults. Three traps recorded:
  * TRAP 1 (mixed polarity): SW2 is NOT all-active-low. SERVICE1 (bit0) and
    SERVICE2 (bit7) are IP_ACTIVE_HIGH; bits 1-6 are active-low unused. input.js
    packs polarity PER-BIT, not per-port (P1/P2/SYSTEM are uniformly active-low;
    SW2 is not). Default SW2 read = 0x7E.
  * TRAP 2 (fake port): MONITOR_TYPE (Wells-Gardner/Electrohome) is a MAME CONFIG
    port, NOT CPU-readable. It only weights renderer pens (T2.5). It is absent
    from input.js and from the §6.1 read-port map; modelling it as a readable
    port would desync against the oracle (which never lets the CPU read it).
  * TRAP 3 (set-specific defaults): defaults are for the BASE `berzerk` set
    (English; F3 Language=0x00). Clones (berzerkf/g/...) override only that
    default and use different speech ROMs. Our ROM set is base RC31 berzerk, so
    English/0x00 is correct -- recorded so a clone's different defaults don't
    cause confusion later.
  input.js field names (P1/SYSTEM/P2/F2-F6/SW2, IPT_COIN1 etc.) are the canonical
  names the input-script schema resolves on both platforms; setField() throws on
  any unknown name -- load-bearing for T3.1/T3.2 replay, not decoration. A test
  asserts all 16 coinage nibbles map (no gaps). npm test 44/44. — Sudnya (via Claude).

## T2.8 — Sound/speech via samples (2026-06-12)

- 2026-06-12 — Implemented machine/src/sound.js: decode CPU audio-port writes
  per §7 and emit events to a pluggable backend (RecordingBackend for tests/
  headless -- no audio files; WebAudio backend wired at T2.9). NOT chip emulation
  (S14001A/6840 internals out of scope; samples opt-in to real emulation only if
  the feel bar fails). Decisions/approximations:
  * EVENT NAMING is spec-pure: events are keyed by the §7-decoded S14001A word
    ADDRESS ({speech,play,address}) and the raw SFX port/data, NOT by semantic
    names. §7 does not pin word-address->utterance or 6840-write->effect names;
    the 30-word vocabulary (disassembly_analysis.md §4.2: 0x08 ALERT, 0x12
    INTRUDER, ...) is a reference for naming the supplied sample files, not baked
    into the decoder. Avoids guessing a mapping §7 doesn't pin.
  * STATUS READ (0x44): §7 does NOT pin the read. Sample playback is
    fire-and-forget, so readStatus() returns READY (bit6 set; original-analysis
    convention bit6=1 ready / 0 busy). TIMING APPROXIMATION: no per-utterance
    busy window, so the CPU's busy-poll loops exit immediately and speech events
    can queue back-to-back. Acceptable at the feel bar; if T2.9 boot shows the
    game depends on a busy->ready transition, model a busy duration then.
  * 6840 SFX: raw register writes are emitted as-is; decoding which write pattern
    == which effect needs 6840 modeling (out of scope) -- deferred to the sample
    manifest / T2.9.
  * HUMAN-GATE (entry criterion): sample audio files are user-supplied into
    machine/fixtures/samples/ and never committed (added a .gitignore + README
    documenting the event keys). The machine-checkable code + tests need no
    files (silent/recording backend); per the HUMAN-GATE protocol T2.8 ends at
    awaiting-human pending the files (and the T2.9 WebAudio wiring). npm test
    52/52. — Sudnya (via Claude).

- 2026-06-12 — T2.8 SAMPLE NAMING = option (a) (Sudnya): sound.js stays
  address-keyed and spec-pure (no vocabulary table in the decoder). Event->file
  mapping lives in machine/fixtures/samples/manifest.json (committed; format
  documented in that dir's README): speech keys are the S14001A word address as
  "0x"+hex, values are sample filenames; sfx mapping TBD. The T2.9 WebAudio
  backend loads the manifest. PROVENANCE PENDING: Sudnya will capture
  address<->clip via a MAME Lua hook on the 0x44 speech-write (logging word
  address as each phrase plays), then audition, then supply (1) `mame -version`,
  (2) the addr->identity->filename table -- which I will then write into both
  this log and manifest.json. T2.8 remains awaiting-human until the .wav files +
  populated manifest are in place. — Sudnya (via Claude).

- 2026-06-12 — T2.8 PROVENANCE (partial capture) + MODEL CORRECTION. Source:
  machine/speechlog.txt (Lua hook machine/tools/mame/speechlog.lua tapping io
  0x40-0x47). MAME version 0.288 (log header). VERIFIED findings from the log
  (650,723 lines), which CORRECT the initial "8 distinct SFX + 1 speech" model:
  * SPEECH: 4 words, not 1 -- addresses 0x10, 0x09, 0x0b, 0x11 over t=12.8-14.0s,
    i.e. one ~1.56s PHRASE (the single speech clip = 4 word events). Identities
    NOT yet provided (the log marks each "identify this sound"); do not guess.
  * SFX: ONE distinct triggered effect, fired 8x (not 8 distinct effects). The
    only non-continuous writes are the burst signature {0x40=0x82, 0x42=0x01,
    0x43=0x01, 0x46=0x47}, each appearing exactly 8 times in the first ~9s. So a
    single port+data key cannot identify an SFX -- an SFX is a multi-write BURST.
  * CONTINUOUS TONE: the high-count writes (0x42=0x00 x139428, 0x40=0x00 x92960,
    the 0x46 sweeps x46476 each, etc.) are ambient/continuous sound, NOT discrete
    sample triggers. Sample-based sound does not reproduce continuous tone; this
    is a known limitation of the samples approach (acceptable at the feel bar;
    revisit with chip emulation if it proves wrong).
  * NO .wav files are present in machine/fixtures/samples/ yet.
  CONSEQUENCE: manifest.json cannot be populated yet (no files; SFX count and
  speech identities unresolved). SFX manifest key format defined as a burst
  signature (see samples/README.md), provisional pending the T2.9 backend's
  burst-detection design. T2.8 remains awaiting-human pending: the .wav files,
  the speech word identities (0x10/0x09/0x0b/0x11 -> words; the phrase), and a
  decision on whether the 8 identical SFX bursts collapse to one sample.
  — Sudnya (capture) + Claude (log analysis).

- 2026-06-12 — T2.8 SPLIT (Sudnya): audio capture deferred, not a blocker.
  Rationale: samples are cosmetic -- the golden-frame gate (T3.4) hashes
  VRAM+color RAM, NOT audio -- and the capture is a rabbit hole; the decoder
  code is done + green. So T2.8 = decoder CODE only (sound.js + tests 52/52,
  silent backend default) -> ready to flip done. New task T2.8b "Capture & map
  audio samples" (pending, non-blocking) holds the HUMAN-GATE: .wav files,
  speech identities, manifest rows, AND the SFX-burst key design (the port+data
  key model is wrong -- SFX are multi-write bursts; left for T2.8b). T2.9's
  dependency on audio is removed: it boots with the silent / sample-optional
  WebAudio backend, which loads whatever manifest rows exist (zero is fine).
  speechlog.txt (24.8MB) gitignored (regenerable via tools/mame/speechlog.lua),
  not committed. — Sudnya (via Claude).

## T2.9 — Boot to playable (Phase-2 integration, 2026-06-12)

- 2026-06-12 — COMPOSITION (machine/src/machine.js): CPU + memory + video +
  scheduler + input + sound wired together. Memory device-handlers route the
  VRAM (0x4000-0x5FFF), Magic RAM (0x6000-0x7FFF) and Color RAM (0x8000-0xBFFF,
  incl. the 0x3800 mirror) windows to the Video object, so Video owns the single
  backing store the CPU and renderer share. I/O dispatch (port mask 0xFF) per
  §3/§5: 0x40-0x47 sound (0x44 read = status), 0x48/0x49/0x4a input, 0x4b magic
  control, 0x4c/0x4d NMI enable/disable (on read AND write), 0x4e intercept|v256,
  0x4f IRQ enable (bit 0), 0x60-0x65 DIP (0x18 mirror), 0x66/0x67 LED. ROM layout
  (machine/src/roms.js): ROM0 + ROM_MAIN (rom1-5 concatenated) per the RC31 table;
  voice ROMs are sound-board, not loaded on the Z80 bus.
- 2026-06-12 — HEADLESS BOOT GATE (machine/tests/machine.test.js): boots the
  real RC31 ROM and runs 600 frames. RESULT: boots cleanly through the power-on
  self-test (VRAM fully filled at ~frame 240 = the RAM/video test pattern) into
  game code -- by frame 600 pc=0x1517 (game ROM), sp in work RAM, VRAM ~520
  non-zero + color RAM 1792/2048. The Magic RAM ALU self-test (which wedged the
  original port at PC 0x0458 when the 74181 was wrong) PASSES. No cross-component
  bug surfaced in the headless boot. The test skips gracefully if ROMs absent
  (BERZERK_ROM_DIR, defaults to repo-root rom/berzerk). npm test 54/54.
- 2026-06-12 — SHELL (machine/shell/): no-build static page. The scheduler stays
  wall-clock-free; the shell accumulates real time and calls runFrame() at the
  original 59.64 Hz (CPU_CLOCK/CYCLES_PER_FRAME), decoupled from display refresh,
  then blits renderToRGBA once per rAF. Keyboard -> input.setField (arrows/Space|Z/
  1/2/5). Audio is sample-OPTIONAL: WebAudio backend loads samples/manifest.json
  + referenced .wav; with the manifest empty (audio deferred to T2.8b) it is
  silent. ROMs load via file picker (not committed/served) with an auto-boot
  fallback if served at fixtures/rom/.
- 2026-06-12 — HUMAN-GATE: the play session (attract visible, coin/start, full
  game loop, sample firing) is Sudnya's; the headless boot is necessary, not
  sufficient. Pixel bit-order, color (RGBI pen levels), and feel/timing are what
  a play session surfaces -- T2.9 ends at awaiting-human. — Sudnya (via Claude).

- 2026-06-15 — T3.1 INPUT-SCRIPT SCHEMA FROZEN (cdoc/schemas/input-script.md).
  Open questions resolved: (1) initial state = cold boot from reset only, no
  snapshot/resume -- keeps the format self-contained, no machine-state file
  dependency; (2) frame-0 inputs apply before any CPU cycles of frame 0 run
  (via the scheduler vblankCallback), so the ROM samples them during POST;
  (3) DIP overrides live in the header (keyed "PortName.FieldName" -> setting
  name), not per-frame, since DIPs don't change during play and this simplifies
  the T3.2 Lua injector; (4) multi-player ports use explicit port field
  (P1.LEFT vs P2.LEFT), no aliases. Application timing is the VBlank boundary so
  CPU sampling is deterministic.
- 2026-06-15 — T3.1 PLAYER (machine/src/script-player.js): parseScript() +
  ScriptPlayer. Field names validated against T2.7's PORTS registry at
  CONSTRUCTION (not during replay) so a script typo throws before any frame
  runs -- the typo guard from input.js is the cross-platform contract. applyFrame
  (frameIndex) is driven by scheduler.frameCount as the vblankCallback. Player
  mutates the machine's Input; it does not own it. Determinism test in npm test:
  replaying the same script twice from reset yields identical per-frame port
  snapshots. npm test 70/70.
- 2026-06-15 — T3.2 HASH ALGORITHM (cdoc/decisions.md): Selected FNV‑1a 64‑bit for per‑frame video memory hashing. Both the JS player (script-player.test.js) and the MAME Lua script (replay.lua) implement the exact same algorithm (multiply by 0x100000001b3, XOR each byte, mod 2^64). This ensures cross‑environment determinism for the golden‑frame gate (T3.4).
- 2026-06-16 — COSIM SYNC POINT (0x26D9) IS TIMING-SENSITIVE, NOT a clean
  equivalence gate. Built JS-side (tools/cosim_capture_js.js, via a new
  scheduler.onStep hook) and MAME-side (tools/mame/sync_capture.lua, read-tap on
  program 0x26D9) capture of full Z80 register state at every BOTTOM_OF_SCREEN
  IRQ entry, plus tools/cosim_diff.js. Findings from a cold-reset/no-input run
  (1200 frames, 625 hits each): (a) gross timing matches -- POST completes and
  the first steady once-per-frame hit lands at JS frame 573 / MAME frame 574;
  (b) MAME has one extra stray hit (frame 34) because 0x26D9 is ALSO reachable
  via `jr c,$26d9` (oracle addr 0x26B7), so 0x26D9 is dual-entry, not purely the
  IRQ vector -- the diff aligns on the steady once-per-frame run; (c) register
  state diverges from the FIRST steady sync point (bc/hl off by 2 while the
  foreground is in a loop) and amplifies; (d) the foreground interrupt point
  (top-of-stack phase fingerprint) matches on only 66/624 hits. Conclusion: the
  IRQ fires at a fixed scanline, so register-at-IRQ captures a free-running
  foreground sampled at a timing-dependent position. A small per-instruction
  T-state / IRQ-delivery difference between DrGoldfire's Z80 and MAME's Z80
  accumulates over the ~573 POST frames into a ~2-iteration phase skew, then
  amplifies. So this comparison will report divergence whenever the two cores
  are not cycle-locked, even if architecture is correct. It is a good DRIFT
  DETECTOR but NOT a pass/fail architectural-equivalence gate until cycle-timing
  parity is established (or the methodology is changed to a timing-robust point,
  e.g. instruction-count-indexed comparison or a provably-at-rest foreground
  PC). — Sudnya + session.
- 2026-06-16 — DESIGN RULE: register-at-IRQ (0x26D9 co-sim) is a DRIFT DETECTOR,
  NOT an equivalence gate -- by design. It over-specifies relative to our
  behavioral-fidelity bar: cycle-exactness was deferred when we vendored the
  DrGoldfire Z80 core, so the two cores are not cycle-locked and the scanline IRQ
  samples a free-running foreground at timing-dependent positions. Wired in as a
  non-blocking drift detector (tools/cosim_run.sh; fails only on regression vs
  fixtures/cosim/sync_26d9_baseline.json). The equivalence gate is GOLDEN FRAMES
  (T3.4): exact VRAM+colorRAM match adjudicates whether timing drift affects
  visible output. Do NOT hunt the T-state source now; escalate to timing work
  only if T3.4 shows per-frame VRAM divergence traceable to interrupt delivery.
  Golden frames decide. — Sudnya.
- 2026-06-16 — T3.4 GOLDEN-FRAME GATE: attract-only EXACT MATCH BREAKS at frame
  242, root cause = accumulated core cycle-timing drift (the deferred work).
  Method per Sudnya: cold reset, no input, frame-0 alignment, zero tolerance.
  Findings (MAME 0.288): first fully-drawn frame is 173 on BOTH sides, so the
  frame-0 alignment offset is 0 (the co-sim's ~1-frame IRQ offset does NOT
  propagate to the VRAM stream; the existing same-index diff_hashes.js is the
  correct comparator). VRAM+colorRAM (FNV-1a32) matches frame-for-frame through
  241, then diverges at frame 242 by EXACTLY ONE BYTE: VRAM 0x5DE3, JS=0x00 vs
  MAME=0xFF, re-agreeing at 243. Byte-level trace of 0x5DE3 over frames 238-246:
  both hold 0xFF for 239-241; JS clears it to 0x00 at frame 242, MAME clears it
  at frame 243. Identical content, one-frame phase shift on a single erase-write.
  This is the SAME cycle-timing drift the 0x26D9 co-sim measured independently
  (JS reaches the first steady IRQ at frame 573 vs MAME 574 -- JS runs slightly
  ahead); by frame 242 the accumulated lead pushes this near-boundary write
  across the frame edge. NOT a capture-convention artifact (two independent
  measurements agree the cores drift). Over the full 3085-frame run only
  569 frames match; after frame 242 the moving attract demo desyncs broadly
  (4 resync runs, max 203). CONCLUSION: timing drift is NOT intra-frame-harmless
  -- it produces visible single-frame VRAM differences at frame boundaries, so
  per the T3.4 escalation rule this triggers the deferred cycle-timing work
  (per-instruction T-states / IRQ delivery). T3.4 is NOT met; awaiting Sudnya's
  decision to open the timing-parity effort. Tools added: tools/dump_frame_js.js,
  tools/mame/dump_frame.lua, tools/mame/trace_byte.lua. — session; Sudnya to rule.

## T5.1 — Entropy source confirmed (2026-06-16, awaiting-human)

- 2026-06-16 — ENTROPY SOURCE = port 0x4E (V256/beam), NOT the Z80 R register.
  Grepped the frozen decode oracle (disassembler/oracle/decode_oracle.jsonl;
  bytes are DECIMAL there, so the task's literal `ED 5F|DB 4E` grep matches
  nothing -- ran the decimal equivalents [237,95] / [219,78]). Findings:
  * `ld a,r` (ED 5F): 0 occurrences -- the ROM never reads R. The "R-register-
    seeded RNG" prime suspect is ELIMINATED (corroborates the T2.3 cross-check
    note "ld a,r 0 occurrences").
  * `in a,($4e)` (DB 4E): 10 occurrences (0x023B,0x0246,0x0281,0x04A9,0x050C,
    0x0522,0x0608,0x157A,0x26B4,0x279D). The load-bearing one is 0x26B4 in the
    IRQ dispatcher (0x26B0 di; ld sp,$0840; push af; in a,($4e); rra; jr c,$26d9):
    V256 selects BOTTOM_OF_SCREEN_INTERRUPT vs the mid-screen path, which bumps a
    2-byte interrupt-phase counter at 0x089F/0x08A0 (mixing port 0x49).
  * Gameplay RNG = LCG `RANDOM` @0x2678 (seed@0x435C: seed=7*seed+0x3153, return
    high byte), deterministic in its seed; 13 callers (movement/collision/speech).
    Timing enters via the seed: COLLISION_DETECTION @0x15CF clears 0x089F at game
    start (0x1645) and rewrites seed 0x435C (0x169A/0x16B9) then calls RANDOM
    (0x16BC). So interrupt-phase timing perturbs the seed -> placement.
  * MAN_INIT(0x1FD4)/CREATE_JOB(0x1E22)/LTABLE(0x1AED) are job/dispatch
    scaffolding; none calls RANDOM directly (hypothesis named them; reported as
    found). Stub: cdoc/entropy-berzerk.md.
  T3.4 SCOPE NOTE: this confirms the entropy MECHANISM (V256, not R). It does NOT
  prove the specific frame-242 single-byte VRAM shift (0x5DE3) flows through the
  RNG vs being a direct IRQ-timing draw artifact -- both share the same root
  cause (cycle-timing / interrupt-phase drift, the deferred work). HUMAN-GATE:
  Sudnya to agree this source explains frame-242 before T3.4 is scoped/closed;
  T3.4 stays in-progress until then. — session; Sudnya to rule.

- 2026-06-16 — T5.1 HUMAN-GATE RULED: Sudnya AGREES port 0x4E (V256/beam) →
  interrupt-phase counter 0x089F → LCG seed 0x435C → RANDOM 0x2678 adequately
  explains the frame-242 divergence. The R-register theory is closed (ld a,r =
  0 occurrences). What this ratifies: the frame-242 break is timing-locked
  deterministic entropy, NOT a data/machine bug, and reduces to the already-
  deferred cycle-timing drift. T5.1 → done. CONSEQUENCE: T3.4's exact-match gate
  may now be scoped to the deterministic window (bit-exact boot→241 already
  proven) with gameplay/attract validated behaviorally in Phase 5+, rather than
  reopening cycle-timing parity. The visible-rows-only rehash (0x5DE3 is an
  off-screen byte) is still OPEN as a possible free extension of the bit-exact
  window before T3.4 is flipped. — Sudnya.

- 2026-06-16 — T3.4 SCOPED + DONE (Sudnya signed off). Gate = VISIBLE rows only
  (VRAM 0x4000-0x5BFF + color 0x8000-0x87FF), zero tolerance, deterministic
  window **frames 0-258**. Measurement: visible-only first diff = frame 259
  (570/3085 match); full-VRAM first diff = frame 242 (569/3085 match), that byte
  being the off-screen 0x5DE3. The visible-rows experiment extended the window
  only 242->258 (~17 frames / +1 matching frame) -- marginal, so the question is
  settled, not worth further optimization. Adopted visible-only because it is
  strictly more correct (off-screen phantom bytes should not gate visible
  output) and the work was already done.
  PURPOSE RULE (so no future session re-litigates the narrow window): the
  golden-frame gate is the BOOT / POST / INTEGRATION / RENDER regression
  (POST hammers memory, video, magicram ALU). It is NOT and cannot be a gameplay
  validator -- bit-exact gameplay is impossible under the deferred timing drift
  (confirmed three ways: 0x26D9 co-sim, full-VRAM frame-242, visible-only
  frame-259). GAMEPLAY-ROUTINE correctness lives in the Phase 7/8 per-routine
  trace bench (hermetic, exact inputs->outputs, timing-independent). Two layers,
  two jobs. Phase-9 `npm run golden` asserts frames 0-258. T4.1 unblocked. —
  Sudnya.

## T4.1 — Heavy-trace capture (2026-06-17, in_progress)

- 2026-06-17 — HEAVY-TRACE built against the REAL JS-machine API (no invented
  event API). Mechanism, all verified against src/ on disk:
  * mem/IO capture = wrap the live `machine.cpu.callbacks.{readByte,writeByte,
    readPort,writePort}` (the core dispatches through these by property lookup);
    mem vs io tagged in each record. The adapter's extra opcode-peek
    (z80.js step() does `callbacks.readByte(pc)` and the core re-fetches the same
    byte) is suppressed once per step so read_set is the core's true sequence.
  * per-instruction boundary = `scheduler.onStep` (fires before each cpu.step()).
  * registers = `cpu.getState()`; F composed from the flag struct (no F byte in
    the core). regs_in/out include a,f,b,c,d,e,h,l,ix,iy,sp,i,r + shadow set.
  * cycles = sum of step() returns (core's cycle_counter resets per instruction,
    z80_core.js L276-277, so it is NOT monotonic); informational only.
- 2026-06-17 — INTERRUPT HANDLING (schema decision, frozen): an ISR is its OWN
  invocation (is_isr:true, callerPC = interrupted PC, entryPC = handler). Not
  merged into the interrupted invocation. Observed ISR entry vectors in attract:
  0x0066 (NMI), 0x26ab (IM2 IRQ dispatcher), 0x0509 (early POST frame-IRQ
  self-test handler — `out($4f); ei; jr self` waits, IRQ vectors to 0x0509).
- 2026-06-17 — INVOCATION PAIRING = SP-depth, not blind pop-on-RET. Entry = a
  CALL/CALL cc/RST that actually pushed (opcode in set AND SP-=2); exit = SP
  rises above entry SP (covers RET/RET cc/RETI/RETN). KNOWN LIMITATION recorded
  in the schema: routines that defeat stack discipline (MAN_INIT/LTABLE pop-then-
  jp dispatch; CREATE_JOB 0x1E22 coroutine stack-swaps) are best-effort and may
  mis-nest (the attract main loop surfaces as one oversized invocation,
  entryPC=0x188b, >170k reads incl. a ~7k-iteration port-0x65 poll). Leaf/
  arithmetic routines (RANDOM 0x2678) trace cleanly; coroutine scaffolding flagged
  for explicit handling at port time.
- 2026-06-17 — EVIDENCE (pasted into task Result + this session): CLI over
  attract-only 3085 frames = 416,482 invocations; npm test 81/81 incl. the
  determinism test (two runs byte-identical) and the read-set-order test;
  correctness cross-check vs the frozen decode oracle = 0/391,352 non-ISR
  callerPCs that are NOT a CALL/RST opcode. SCHEMA NOT YET FROZEN: the MAME
  routine-level fidelity spot-check (DoD item) is still owed; T4.1 stays
  in_progress (not awaiting-human/done) until it passes. — session; Sudnya to rule.
- 2026-06-17 — INDEPENDENT VERIFICATION (Cowork review session): the above
  evidence was reproduced from scratch, not taken on report. ROMs carved from
  disassembler/oracle/berzerk_flat.bin (address-mapped 0x0000-0x3FFF) into the
  five RC31 files; with BERZERK_ROM_DIR set: capture exit 0 / 416,482 invocations
  (exact match), two independent runs byte-identical (cmp clean), heavy-trace.test
  2/2 green (not skipped), and the callerPC cross-check reproduced exactly
  (391,352 non-ISR / 25,130 ISR; 0 bad caller opcodes; ISR vectors 0x66 x20105,
  0x509 x7, 0x26ab x5018). Script confirmed to use only real APIs. Verdict: T4.1
  capture work is sound; proceed to the MAME fidelity spot-check.
- 2026-06-17 — CONSUMPTION CAVEATS for T7/T8 added to schema §"Consumption notes"
  (5 known characteristics, not bugs, to be honored before freeze): (1) read_set
  includes instruction-fetch bytes (T7 decides whether to filter); (2) return-
  address stack push/pop appears as stack noise; (3) magic-RAM (0x6000-0x7FFF)
  writes record the CPU-written byte, NOT the post-74181-ALU stored byte (bench
  needs the T2.5 model); (4) nested sub-call position is not marked in the parent
  record (call graph via callerPC only); (5) stack-discipline-defeating routines
  trace unreliably (use leaf routines for the spot-check). — Sudnya (via Cowork
  review).

## T4.2 — MAME routine-level fidelity spot-check (2026-06-17, awaiting-human)

- 2026-06-17 — WINDOW REALITY (evidence, not the task's assumption): frames 0-258
  (the T3.4 deterministic golden window) contain ZERO ordinary CALL/RET
  invocations -- it is pure POST. JS heavy-trace cap sweep over attract-only:
  cap=259/300/500 -> 0 invocations; cap=560 -> 21 (all ISRs: 0x0509 x7, 0x0066
  x14); first ordinary routines ~frame 574. RANDOM 0x2678 first runs ~frame 982
  and only 115x in the whole 3085-frame run. Frame indexing is identical to the
  golden gate (both do reset(); for f {applyFrame(f); runFrame()}). So the task's
  "pick routines wholly inside 0-258" is unsatisfiable, and routines that DO run
  are past the deterministic window where the cores drift. — session; Sudnya ruled.
- 2026-06-17 — PAIRING METHOD = STATE-KEYED (Sudnya): do NOT pair JS<->MAME by
  frame/index (they drift after the window). Pair invocations of the same routine
  by CONSUMED INPUTS (input registers the routine reads + its data reads), then
  assert outputs match. Exclude R from key and diff (refresh counter). Treat SP as
  net-delta, not absolute (and MAME updates SP mid-RET, so SP is excluded from the
  verdict). Strip stack accesses (SP-window) and compare; for read_set, compare
  data-only or account for note #6. This matches the T3.4 design rule that
  gameplay-routine correctness is a hermetic, timing-INDEPENDENT bench.
- 2026-06-17 — ROUTINES (4), all verified leaf + no-IO against the decode oracle:
  RANDOM 0x2678 (LCG, required), 0x18e0 (pure leaf, two NVRAM reads -> A),
  0x1ce7 (input regs H,L + djnz loop + ex af,af'), 0x287f (table scan, push/pop).
- 2026-06-17 — LITERAL COMMANDS (reproducible):
  JS:   BERZERK_ROM_DIR=<repo>/rom/berzerk node machine/tools/heavy_trace_capture.js \
          traces/scripts/attract-only.jsonl /tmp/jsfull.jsonl   (416,482 invocations)
  MAME: MAME_RT_OUT=/tmp/mame_rt_full.jsonl MAME_RT_TARGETS="6368,7399,9848,10367" \
          MAME_RT_FRAMES=3085 mame -window -sound none -nothrottle -rompath <repo>/rom \
          -cfg_directory ./cfg -nvram_directory ./nvram \
          -autoboot_script ./routine_trace.lua berzerk
          (machine/tools/mame/routine_trace.lua; 136,805 records:
           6368:71162 7399:54597 9848:117 10367:10929)
  DIFF: node machine/tools/routine_fidelity_diff.js /tmp/mame_rt_full.jsonl 3
  MAME hook detail: whole-program read/write taps; entry only on a genuine opcode
  fetch (PC == fetch addr -- rejects the POST ROM-checksum reading routine bytes
  as data); SP-depth exit.
- 2026-06-17 — VERDICT = PASS. RANDOM 0x2678, 0x18e0, 0x287f: ALL matched pairs
  byte-EXACT on read_set (instruction fetches included), regs_out (excl R/SP), and
  write_set. RANDOM LCG chain confirmed JS==MAME across seed states
  0x0202 -> 0x3F61 -> 0xECFA -> 0xAC29 (16-bit seed @0x435C little-endian;
  return = high byte). 0x1ce7: regs_out + write_set EXACT; read_set differed ONLY
  by the not-taken conditional-relative-branch displacement bytes -- the schema
  note #6 artifact (z80_core.js do_conditional_relative_jump; harmless, the byte
  is unused when not taken). Pinned by machine/tests/jr-displacement.test.js
  (npm test 83/83, 0 skipped, ROMs present).
- 2026-06-17 — CONSEQUENCE: heavy-trace.md marked FROZEN; note #6 added. T4.1 and
  T4.2 set to awaiting-human (HUMAN-GATE: Sudnya signs the freeze; neither flipped
  to done by the session). Committed nothing. — session; Sudnya to ratify.

## T5.2 — Full nondeterministic-read-site catalog (2026-06-17, awaiting-human)

- 2026-06-17 — CATALOG built static + dynamic + reconciled into
  cdoc/entropy-berzerk.md (supersedes the T5.1 stub). STATIC sweep of the frozen
  decode oracle (decimal bytes): 65 IN instructions total = 54 `in a,(n)`
  (DB nn = [219,nn]) + 11 `in a,(c)` (ED 78 = [237,120]). DYNAMIC capture wrapped
  the live cpu.callbacks.readPort/readByte (same path the FROZEN heavy-trace
  uses) over 4 scripts (attract 3085f / coin-start 942f / free-play 1276f w/
  P1 joy+fire / aggressive start+hold 2600f), recording the exact reading PC
  (= static_site+1) and value of every IO read plus mem reads of 0x089F/0x08A0/
  0x435C. Heavy-trace reproduced T4.1 exactly (attract = 416,482 invocations).
  RECONCILIATION: every dynamic IO read maps to a static site (PC-1); every
  non-firing static site is explained by exactly 3 buckets, none entropy:
  (a) operator service menus (COLOUR_TEST/INPUT_TEST/BOOKKEEPING, incl. ports
  0x62/0x63/0x64 and all 11 `in a,(c)`); (b) active-gameplay routines not reached
  (port 0x48 all sites; 0x4A in V.LOOP/MOVE_PLAYER); (c) the 6 `in a,($ff)` sites
  at 0x1273+ are mis-disassembled DATA (0xFF is not a real port; 0 dynamic
  reads). — session; Sudnya to ratify.
- 2026-06-17 — ENTROPY = exactly one timing-locked source: port 0x4E **bit 0
  (V256)**, consumed ONLY at the IM2 dispatcher 0x26B4 (`in a,($4e); rra; jr c`).
  REFINEMENT vs T5.1: the OTHER port-0x4E reads do NOT read V256 — MOVE_AND_DRAW_
  BOLT (0x157A `rlca`) and WRITE_PATTERN (0x279D `bit 7,a`) read **bit 7 = the
  collision flop**, which is draw-deterministic (T2.5: set by control writes,
  reset by overlapping pixels), NOT beam entropy. Bit layout confirmed from
  video.js readIntercept: `((intercept^1)<<7) | (v256 & 0x7f)`. So the entropy
  spine is V256(bit0)@0x26B4 → 2-byte interrupt-phase counter 0x089F/0x08A0
  (advanced every non-vblank IRQ, mixing port 0x49) → LCG seed 0x435C → RANDOM
  0x2678 → 13 consumers (movement V.LOOP, spawn SR.TAB/ROBOT_ANIMATION_TABLES,
  game-start COLLISION_DETECTION, 3 speech routines). — session.
- 2026-06-17 — CORRECTION to the T5.1 stub wording: COLLISION_DETECTION @0x1642
  initializes the 0x089F/0x08A0 counter to **NOT(port 0x49)**, not to zero
  (`in a,($49); cpl; ld (hl),a; ld (hl),a`). In attract with no coin/start
  0x49=0xFF so NOT=0x00, which is why it *looked* like zeroing. entropy-berzerk.md
  §3 states the general form. — session.
- 2026-06-17 — FINDING (coverage limitation, evidence): NONE of the 4 stock
  scripts credits the JS machine. The CPU does not poll the SYSTEM port (0x49)
  until **frame 573** (POST completion; matches the cosim "first steady IRQ at JS
  frame 573"), but every script injects coin/start at frames 60-530 and RELEASES
  them before frame 573, so no credit registers, the game never leaves attract,
  MOVE_PLAYER (0x1EE1) never runs, and port 0x48 is never read. Input PLUMBING is
  verified correct (setField COIN1/START1/RIGHT toggle the right active-low bits),
  so 0x48 etc. are confirmed deterministic INPUT sites, not dead code. CONSEQUENCE
  for Phase 7/8: re-time coin/start to land after frame ~573 to capture the
  port-0x48 gameplay reads. This is the deferred timing-parity work surfacing in
  script authoring; it does not change any classification. — session.
- 2026-06-17 — PHASE 7/8 INPUT CONTRACT (entropy-berzerk.md §6): the values a port
  bench MUST replay (not recompute) are exactly (1) port 0x4E bit0 @0x26B4 (V256),
  (2) the 0x089F/0x08A0 counter, (3) LCG seed 0x435C. Everything else is
  reproducible from (cold reset + input script + DIPs + NVRAM): ports 0x48/0x49/
  0x4A (inputs), DIPs 0x60-0x65, NVRAM 0x0800-0x0BFF (clear for hermetic bench),
  0x44 (constant READY in our model; gates speech pacing only, never reaches
  placement), 0x4C/0x4D (side-effect-only reads), and 0x4E bit7 (collision flop,
  needs the T2.5 model not a replayed input). HUMAN-GATE: T5.2 ends at
  awaiting-human; Sudnya signs that the catalog is complete. Committed nothing.
  — session; Sudnya to ratify.

## T6.1 — Annotation method + scope (2026-06-17)

- 2026-06-17 — T6.1 METHOD RULE (Sudnya): annotate TRACE-DRIVEN FROM SCRATCH.
  Names/contracts derived only from observed behavior (read/write addresses
  cross-referenced to hardware-berzerk.md + entropy-berzerk.md, argument
  registers, call-graph position, effects). The published Berzerk/Frenzy source,
  seanriddle berzerk.asm, AND the existing disassembler/oracle/labels.json are
  the T6.2 GRADING RUBRIC ONLY — not inputs. Refines the 2026-06-10 "Frenzy =
  rubric" decision by explicitly adding labels.json to the rubric side, so the
  T6.2 accuracy score stays a real test of the source-less method.
- 2026-06-17 — T6.1 SCOPE (Sudnya): annotate the 81 distinct routines the
  current attract trace reaches (work bottom-up, leaves first). Gameplay routines
  (robot AI/movement/collision) are NOT trace-reachable yet — the scripts release
  coin/start before frame ~573 so the machine never enters credited play
  (entropy-berzerk.md §4). Capturing gameplay needs re-timed scripts; that is a
  FOLLOW-UP (widens coverage for a second annotation pass), NOT a blocker on T6.1.

- 2026-06-17 — T6.1 RESULT/DECISIONS (session; Sudnya to ratify at the HUMAN-GATE):
  - Deliverables: cdoc/annotated-asm-berzerk.md (83 routines: name + contract +
    purpose + entropy flag + disasm) and cdoc/ram-map-berzerk.md (RAM variable
    map). Generators + a validated Z80 disassembler in machine/tools/t61/.
  - COUNT: the attract trace reaches 83 distinct entry PCs, not exactly 81. The
    delta is 8 SHARED-TAIL SECONDARY ENTRY POINTS (0x1505<-0x14F3, 0x1E78<-0x1E6D,
    0x1F94<-0x1F91, 0x22F1<-0x22EB, 0x29A3<-0x29A1, 0x2A4A<-0x2A40, 0x2B3D<-0x2B39,
    0x2BE4<-0x2BDE) — a normal Z80 multi-entry idiom, confirmed by disasm-span
    containment. Counting shared bodies once ~= 75; counting all entry points = 83.
    "81" in the scope note was approximate; nothing was invented or dropped.
  - DISASSEMBLER: wrote a Z80 disassembler (machine/tools/t61/z80dis.js) validated
    5286/5288 vs decode_oracle.jsonl. The 2 diffs are the oracle printing signed
    decimal `cp -2`/`cp -4` where the canonical form is `cp $fe`/`cp $fc` — the
    disassembler is correct; flagging in case T1.2/T6.2 compare against the oracle.
  - VRAM-AS-VARIABLES: the low VRAM band 0x4000-0x43FF is reused as coroutine
    STACKS (SP set to 0x4300/0x4400/0x0840/0x085E/0x0870) and scalar game vars
    (0x4344-0x437A), NOT visible bitmap. Documented in the RAM map so a future
    porter doesn't mistake these for screen writes.
  - ENTROPY cross-check: 8 routines flagged entropy-touching, all consistent with
    entropy-berzerk.md (V256 dispatcher 0x26AB; collision-flop draws 0x1553/0x272D
    — deterministic; RANDOM 0x2678; seed/RANDOM consumers 0x1685/0x2540/0x25EB/0x1E59).
  - Confidence flags: conf H/M/L; the conf-L routines (higher-level game label is a
    best guess) are listed in the doc header and must NOT be treated as authoritative.
  - Committed nothing. T6.1 ends at awaiting-human.

## T6.2 — Annotation accuracy score (2026-06-18)

- 2026-06-18 — T6.2 RESULT (session; Sudnya to ratify at HUMAN-GATE). Scored the
  trace-only T6.1 names against the now-permitted rubric (labels.json + Scott
  Tunstall's commented src/berzerk.asm, which carries Frenzy's ported comments).
  Full analysis + per-routine verdict table: cdoc/t62-annotation-score.md.
  Reproduce: `node machine/tools/t61/score.js`.
- METHODOLOGY: map each of my 83 entry PCs to the canonical label at that exact
  address (or the enclosing label + Tunstall comment if none); assign HIT
  (semantic match) / PARTIAL (right subsystem+mechanism, wrong specific
  role/entity/field) / MISS (wrong meaning) / NOLABEL (rubric has no distinct
  label there -- my method split finer; judged by behavioural consistency).
- SCORE: of the 48 routines the rubric names distinctly -> HIT 31 (65% exact),
  PARTIAL 15, MISS 2; i.e. 96% landed in the correct subsystem, 4% (2) outright
  wrong. Across all 83 (incl. 35 finer-grained-than-rubric): 60% correct, 33%
  partial, 7% wrong. Entropy spine (T5.2) independently 100% correct.
- NOTABLE MISSES (what trace-only CANNOT recover -- the generalizable result):
  1. Slot-FIELD semantics: 0x2B3D SET_VELOCITY (writes VECTOR.X/Y) read as
     SET_ANIM_FRAME -- a trace shows the write, not the field's type; the
     consumer runs only in gameplay. (The 2 hard MISSes: 0x2B39/0x2B3D.)
  2. Entity identity from attract-only: credits-vs-score (0x18E0/0x18CD/0x1908
     are CMOS_CREDITS, I said score), player-vs-robot (0x1F91
     CHANGE_PLAYER_DIRECTION said robot -- mechanism right, entity wrong).
  3. Identical draw mechanism / different intent: 0x25CA/0x25D4/0x264C/0x2662
     draw PLAYER LIFE ICONS via the same magic-RAM blit shape as maze walls ->
     I labelled them DRAW_MAZE_* (4 NOLABEL "wrong"). Needs data-table content.
  4. Trigger context: 0x2BE4 TRY_SPEAK_ON_PLAYER_LEAVING_ROOM -- got "random
     speech" right, missed the trigger (gate 0x4371 never taken in attract).
  Root cause of (2)-(4): the attract trace never enters credited play
  (entropy-berzerk.md sec4); a re-timed gameplay script would recover most.
- RECOVERED WELL: full bolt engine, magic-RAM draw pipeline, interrupt structure,
  RANDOM (exact LCG), sound-effect triggers, job/coroutine creation, screen
  clears, score-pointer select -- INCLUDING cases where the canonical label is
  cryptic and the descriptive trace-name beat it (C.LOAD, RTOAX, SR.TAB, LTABLE,
  CLEAR_CHYRON, SHOWO): a token-match scorer would under-credit these.
- CAVEAT: HIT/PARTIAL/MISS are semantic judgement calls; the single percentage is
  indicative, the cluster analysis is the durable finding. Committed nothing.

## T7.1 — Test-plan generator + selection policy (2026-06-18)

- 2026-06-18 — T7.1 (session; Sudnya to ratify). Tool:
  machine/tools/generate_test_plan.js; schema FROZEN at cdoc/schemas/test-plan.md;
  self-check: machine/tests/test-plan.test.js (in `npm test`); plans in
  traces/test-plans/*.jsonl (one per input script).
- REPLAY-BY-EXECUTION (design decision). A record is validated/consumed by
  EXECUTING the routine on a fresh Z80 core against a mock memory (real ROM loaded
  + writable-region reads seeded + IO served from an ordered per-port FIFO), not by
  scripting the raw read_set. Consequence: the record's `reads` carry ONLY
  writable-memory + IO reads; ROM code/operand fetches and ROM constant tables come
  from the loaded ROM. This SIDESTEPS every heavy-trace read_set artifact:
  code-fetch noise (note #1), the not-taken-JR displacement gap (note #6) -- the
  core re-fetches from ROM so the gap never matters.
- SELF-VALIDATING SELECTION (the selection policy). Every candidate invocation is
  replayed during generation; ONLY records that reproduce regs_out + writes are
  emitted. The plan therefore contains exclusively records proven replayable.
- LEAF-FIRST is the EMERGENT consequence, not a heuristic. An invocation's
  heavy-trace read/write sets EXCLUDE its callees' accesses (note #4), but a
  standalone replay executes callees inline -- so a record self-validates only when
  the invocation made no effectful sub-calls (a leaf, or a routine that took an
  early-return path). Non-leaf invocations fail the self-check and are excluded.
  This is exactly the Phase-9 bottom-up order; non-leaves become testable as their
  children are ported (T9). Interrupted invocations are also excluded (the
  interrupt's return-address push to sp-2 pollutes the write_set -- note #2).
- `r` EXCLUDED from the regs comparison (kept in the record). The refresh register
  is inflated by any interrupt that fired during the captured invocation and is
  never load-bearing in Berzerk (entropy = port 0x4E/V256, not `ld a,r`; T5.1).
  Without this, ~all interrupted-but-otherwise-clean leaf invocations would be
  rejected on `r` alone (measured: dropped the false-mismatch count by ~75%).
- IO normalized to the device port (low byte). The Z80 puts A (or B) on the high
  address byte during IN/OUT; capture records the 16-bit bus addr. The schema and
  self-check compare on (device-port, value), since the high byte is incidental
  register content, not IO semantics.
- DEDUP + CAP. path_id = FNV-1a of the executed PC sequence (precise control-flow
  path). Keep one record per distinct path_id; cap at N distinct paths per routine
  (default 8) to bound size; the cap is reported in stats, never silent.
- STEP CAP MAX=50000 only bounds how fast non-returning (coroutine/stack-swap)
  invocations are rejected; kept (returning) records are far shorter -- the
  generator reports maxKeptPath so this stays verifiable (no legit routine is cut).
- Committed nothing. T7.1 ends at awaiting-human (self-check green; Sudnya reviews
  coverage + ratifies the leaf-first/`r`-exclusion policy before done).

## T8.1 — Hermetic JS test bench (2026-06-18)

- 2026-06-18 — T8.1 (session; Sudnya to ratify). Bench: machine/tools/bench.js;
  sample port: machine/ports/random.js + ports/index.js registry; self-check:
  machine/tests/bench.test.js (in `npm test`).
- HERMETIC (DoD). bench.js imports ONLY node builtins + src/roms.js (a pure ROM
  byte assembler, zero imports). No z80 core, no Machine. Verified by grep.
- PORT CONTRACT. A ported routine is `port(ctx)` mutating ctx in place:
  ctx.regs {a,b,c,d,e,h,l,ix,iy,+shadows}, ctx.flags/flags_p {S,Z,Y,H,X,P,N,C},
  ctx.mem {r8,w8,r16,w16}, ctx.io {in,out}. The bench builds the mock memory from
  the case (ROM image if available + writable read-seeds) and the IO FIFO, runs
  the port, and diffs regs_out + writes. ports/index.js maps entry_pc -> port;
  Phase 9 grows it bottom-up. Unported routines' cases are reported "skipped".
- WHAT A REGISTER-TRANSFER PORT MUST NOT REPRODUCE (3 stripped quantities):
  1. STACK scaffolding -- the routine's own push/pop of saved regs + the CALL
     return address. The bench strips the contiguous block of mem accesses
     descending from sp+1 (data lives at fixed addresses far from the live stack,
     so the run stops at the first gap -- exact, no magic window). Only DATA writes
     are compared.
  2. `sp` -- a `ret` pops the return address, so captured regs_out.sp = regs_in.sp+2;
     a register-transfer port leaves sp alone. Excluded from the regs compare.
  3. `r` -- refresh register (same reason as T7.1).
  EVERYTHING ELSE the port MUST match, including flags (full F byte incl.
  undocumented Y/X) and registers the routine clobbers (e.g. RANDOM ends with
  `ld de,$3153`, so a correct port sets DE=0x3153 -- the bench caught this exact
  omission during bring-up, proving it is a real check, not a rubber stamp).
- IO vs MEM writes compared as SEPARATE ordered streams: heavy-trace.md note #4
  does not record the interleave order of a routine's mem-writes relative to its
  io-writes, so the bench compares the two streams independently (each in order).
- ROM is DATA, not the emulator: loaded as a byte image so ports that read ROM
  constant tables work; optional (RANDOM needs none). Loading it does not violate
  "no machine imported".
- SAMPLE: RANDOM @0x2678 ported flag-accurate (S,Z,P preserved by ADD HL,rr; H,C
  from the add; Y,X from the result high byte) -> passes 4/4 committed cases; a
  deliberately-broken port exits non-zero (DoD). 396 other cases correctly skipped.
- Committed nothing. T8.1 ends at awaiting-human.

## Trace architecture — two tiers + seeding (2026-06-18, clarification)

- 2026-06-18 — TWO-TIER TRACE MODEL (Sudnya, clarifying the intended design;
  interactive capture not yet built). Tracing is two stages:
  * LIGHTWEIGHT trace = an interactive, user-driven capture: the input/event log
    only, NO per-PC detail, cheap enough to record during live play. This is the
    tier that reaches genuine gameplay (a human credits a coin and plays), and it
    is the DURABLE, hard-to-regenerate artifact. The hand-authored input scripts
    in traces/scripts/ are lightweight traces by another name (same pipeline slot).
  * HEAVYWEIGHT trace = produced by deterministically RE-EMULATING a lightweight
    trace through the instrumented machine to extract per-invocation detail. It is
    a REGENERABLE cache, not a precious recording.
- 2026-06-18 — PER-PC COMPONENT FIDELITY COMES FROM SEEDED RE-EMULATION, NOT
  LOGGING. Because the heavyweight pass re-emulates a live, fully-stateful machine,
  it reproduces every emulated-component state change PC-by-PC by executing — IF
  the lightweight trace seeds a bit-identical run and the emulator is deterministic
  and faithful. So the real obligation is on the SEED:
  * The lightweight trace MUST seed a bit-identical re-emulation. From cold reset
    that is just (cold reset + input/event sequence). If interactive capture ever
    starts from a non-cold state (resume point, or battery-backed NVRAM contents),
    the lightweight trace MUST additionally snapshot the initial state the run
    depends on — INCLUDING component latch state at the start point — or the
    re-emulation diverges and the PC-by-PC component changes won't match. This is
    the actual "to be safe" content of the lightweight trace.
  * Corollary: the heavyweight trace being "regenerable" is an argument against
    panicking over data loss, NOT an argument for recording less. Any field
    (incl. component latches) is re-extractable from the lightweight trace by
    re-running heavyweight capture, WITHOUT re-doing the interactive session.
- 2026-06-18 — RECORD COMPONENT TRANSITIONS ONLY FOR CONSUMERS THAT CANNOT
  RE-EMULATE. Two such consumers exist: (1) the Phase-8 bench is intentionally
  HERMETIC (no full machine), so to test a routine whose result depends on a
  stateful component (the magic-RAM 74181 ALU: control register + shift latch;
  collision flop is read-observable so already captured) it needs EITHER the T2.5
  ALU model present OR the captured component transitions handed in as ground
  truth; (2) CROSS-MACHINE comparison can't reproduce MAME's run from our
  lightweight trace, so localizing a JS<->MAME divergence at component granularity
  requires logging on both sides. Everywhere else, seed + re-emulation gives the
  fidelity with nothing stored.
- 2026-06-18 — DRAW-CORRECTNESS GAP IS A HERMETIC-CONSUMER GAP, NOT A CAPTURE GAP.
  Heavyweight capture already reproduces magic-RAM state (full machine). The hole
  is that the bench has no ALU model and the trace records the pre-ALU CPU byte
  (heavy-trace.md note #3), so a ported draw routine could pass its test yet render
  wrong pixels (and golden frames don't reach gameplay draws past frame 258). FIX:
  give the hermetic bench either the T2.5 ALU model or the recorded component
  transitions. FIRST verify whether generate_test_plan.js/bench.js already wire in
  the ALU model. NOTE: option (b) — recording component transitions — touches the
  FROZEN cdoc/schemas/heavy-trace.md schema, so it needs its own decisions entry +
  sign-off and a regeneration of heavyweight traces + test plans from the existing
  lightweight traces (cheap, non-destructive). — Sudnya (via Cowork review).

- 2026-06-18 — CORRECTION to the "DRAW-CORRECTNESS GAP" entry above (verified
  against the actual code + test-plan records). It is NOT a real gap. bench.js
  uses a flat mock and compares pre-ALU CPU writes — but a routine's contract is
  its BUS OUTPUT, not pixels. Evidence: PRINT_CHAR (0x29db) writes its own magic
  control 0x4B=0x94 (captured + compared); DRAW_SPRITE (0x2817) writes magic bytes
  with NO control writes (it inherits the caller's control). A draw routine's byte
  choices are independent of the control register / shift latch (those govern only
  the downstream 74181 transform), so the bench fully verifies the routine from
  (regs+reads)->(writes). Pixel correctness = per-routine bus correctness (Gate 2)
  + caller sets the control (tested when that routine is verified) + the shared
  74181 ALU (validated by Gate 1's boot self-test, inside frames 0-258) + preserved
  call order (Phase 9); post-ALU read-backs are seeded from the read-set, and
  DRAW_SPRITE's self-validation into the plan confirms it doesn't depend on
  re-reading transformed VRAM. CONSEQUENCE: the bench needs NO ALU model and NO
  component-transition recording for draw correctness; the heavy-trace schema does
  NOT need to change for this. The only genuine residual is the absence of an
  END-TO-END gameplay-pixel gate (golden frames stop at 258) — i.e. the existing
  re-timed-scripts/gameplay-coverage item, not an ALU issue. Component-transition
  logging remains optional and useful only for cross-machine (MAME) divergence
  localization. — Sudnya (via Cowork review; code-verified).

## 2026-06-18 — T9.1 port hook harness (cycle accounting + two divergence fixes)

The Phase-9 dispatcher (`machine/src/port-hook.js`) runs a registered JS port in
place of the Z80 routine at a CALL target, sharing the live machine's memory/IO,
returning as if `ret`. Decisions a future session should not re-litigate:

1. **Charge the displaced routine's own cycle cost.** A native JS port runs in 0
   Z80 cycles; the dispatcher returns the routine's heavy-trace `cycle_count`
   (entry..ret inclusive; RANDOM = 140, matching every RANDOM test-plan `cycles`)
   to the scheduler exactly as `cpu.step()` would. This preserves interrupt cadence
   and the timing-locked V256/entropy phase (T5.1/T5.2). Charging 0 (or a wrong
   count) shifts interrupts and diverges. Per-routine cycle costs live in
   `ports/index.js` `PORT_META`.

2. **Interrupt-granularity decline.** Charging the cost ATOMICALLY (one step)
   defers an interrupt that, un-hooked, would be serviced MID-routine to AFTER it
   (~1 scanline later), shifting the ISR's port-0x4E V256 read and perturbing the
   0x089F counter → LCG seed 0x435C → object placement. Measured divergence before
   the fix: attract frame 2090. FIX: a port-agnostic `scheduler.eventWithin(cycles)`
   query; the hook fast-paths ONLY when no interrupt event splits the window,
   otherwise returns null so the core runs the real routine (byte-identical to
   un-hooked). When nothing splits the window, atomic charge == the sub-steps.

3. **Stack overlaps VRAM — the hook must replay entry pushes.** Berzerk's stack is
   inside the 0x4000-0x5FFF screen RAM (observed sp 0x42f2). RANDOM's `push hl`
   therefore writes HL onto VRAM (0x42f0/0x42f1, visible row 23) — transient stack
   noise the real machine and MAME both produce (the T3.4 visible golden matched it
   through frame 258). A register-only port omits the push, so the hooked machine
   diverged from un-hooked at exactly those bytes on frames 2090 and 2149 (each
   reconverging the next frame as the next draw overwrote them). FIX: each port
   declares its entry pushes in `PORT_META.pushes`; the hook replays them into live
   memory (pop/ret only read, so the push bytes are the sole observable stack-frame
   memory effect; `push X..pop X;ret` leaves net sp = entry_sp+2). This is a new
   porting hazard for T9.2 — see the T9.1 hazard checklist.

Evidence: full attract (3085 frames, full VRAM) hooked == un-hooked byte-for-byte;
RANDOM bench 4/4; visible-rows 0-258 identical with hook active and RANDOM never
reached during boot (hook inert); `npm test` 96/96. NOTE: no committed MAME goldens
exist (`tools/golden.js` reports no-golden for all scenarios), so the boot
regression is the visible-rows 0-258 self-consistency, not a MAME match. — pending
Sudnya sign-off (T9.1 is awaiting-human).

## Phase 10 — two build targets (2026-06-18, decision)

- 2026-06-18 — PHASE 10 SHIPS TWO SEPARATE BUILD TARGETS from one codebase
  (Sudnya), NOT a single artifact that loses emulation, and NOT a one-target
  mode switch:
  * NATIVE (pure-JS) target — the Z80 interpreter is NOT in the run path; the rAF
    loop + JS interrupt cadence (T2.6 schedule) drive the ported routines. The
    shippable Berzerk.
  * EMULATOR target — the Z80 core in the loop (the machine as of Phase 9),
    retained as a FIRST-CLASS build.
  Both build from the shared machine code (memory/video/scheduler/ported
  routines); the only difference is whether the Z80 interpreter is wired into the
  loop. RATIONALE: the emulator target is load-bearing, not a debug afterthought —
  it is (a) the continuing ORACLE the native port is verified against (native ≡
  emulator ≡ MAME), (b) the engine that REGENERATES heavyweight traces / test
  plans from lightweight traces, and (c) the way to DEBUG the native port (run the
  same input on both targets and diff). "Remove the core" (older plan wording)
  means the NATIVE target omits it from its run path — it never means the project
  loses emulation. The flush test applies to the NATIVE target only (no
  interpreter fallback → any unported routine errors loudly = the 100%-coverage
  proof). T10.1 updated accordingly. — Sudnya.

## Phase 9 — T9.2 porting mechanics (2026-06-18)

- 2026-06-18 — T9.2 PORT FLAG MODEL: ports compute the Z80 F byte via a shared
  `machine/ports/z80flags.js` (sub/cp/and/or/xor/add/inc/dec/addHL16). The
  undocumented X(bit3)/Y(bit5) flags ARE load-bearing (records captured from a real
  Z80 via MAME) and CP takes X/Y from the OPERAND, not the result. The bench
  compares F exactly, so the helpers are validated against captured records, not
  asserted by hand.
- 2026-06-18 — T9.2 PATH-DEPENDENT CYCLE COST: T9.1 charged a single fixed
  PORT_META.cycles (correct only for straight-line routines like RANDOM). Branching
  routines (ret cc, jr cc) cost different amounts per path, and the live hook must
  charge the ACTUAL taken-path cost or the interrupt cadence (V256/entropy phase,
  T5.1/T5.2) shifts. RESOLUTION: a port may set `ctx.cycles` to its taken-path cost;
  `PORT_META.maxCycles` (>= every path) is used for the eventWithin decline gate.
  Since actual <= gate and we only fast-path when no interrupt lands within the
  gate window, the fast-path is provably interrupt-free, so atomic charge of the
  actual cost stays byte-transparent. Confirmed: all 5 scripts hooked==un-hooked.
- 2026-06-18 — T9.2 VERIFICATION (golden.js is a no-op until MAME goldens exist):
  per-routine gate = (a) bench behavioral exactness on every captured record, (b)
  the hook is dispatched live and non-vacuous (counted), (c) hooked==un-hooked
  full-frame hashes byte-identical across all 5 scripts. A coin-start-first-maze
  hooked==un-hooked case was added to port-hook.test.js because the gameplay ports
  (sound/velocity/credits) are never reached in attract.
- 2026-06-18 — T9.2 BOTTOM-UP COMPOSITION: a routine that falls into / would CALL an
  already-ported leaf is ported by invoking that leaf's port fn (0x2b39 ->
  SET_VELOCITY). This is the intended leaf-first order; a routine stays unported
  until its effectful callees are ported.
- 2026-06-18 — T9.2 INNER-CALL VRAM RESIDUE (batch 2): a port that elides a
  routine's inner `call X` must still replay the 2-byte residue that the real
  `call` writes onto the VRAM-overlapping stack (the pushed return address). The
  matching `ret` pops sp, but the two bytes it wrote persist on screen as transient
  noise the real machine/MAME produce. SYMPTOM: 0x1997's fast-path diverged from
  un-hooked at coin-start frame 584 (the 2-visible-byte stack-in-VRAM signature),
  even though its registers/flags/cycles matched the bench exactly and always-decline
  was transparent -- isolating the cause to the elided inner `call $18E0` (pushes
  0x199A). RESOLUTION: PORT_META.pushes now accepts a NUMBER (a literal residue =
  the last inner call's return address) alongside register names; the dispatcher
  writes it descending from entry sp like an entry push (residue only -- it does not
  change the ret's sp math). 0x1997 -> pushes:[0x199a]; 0x157e (inner `call $1597`,
  residue 0x1593) had passed transparency WITHOUT it by luck (the bytes fell outside
  the rendered window) and is now declared so it matches the real machine
  deterministically rather than coincidentally. General rule: any ported routine that
  makes an inner CALL must declare that call's return-address residue.
- 2026-06-18 — T9.2 NON-VACUOUS-DISPATCH IS A REAL GATE: 0x2c1f
  (SAY_GOT_THE_HUMANOID) is bench-exact (1/1) and stays hooked==un-hooked, but it
  fires only on killing the humanoid/Otto, which none of the 5 scenario scripts
  reach -> 0 live dispatches. It is registered (correct + transparent) but explicitly
  NOT counted as meeting the full per-routine bar (its live path is unexercised). It
  must be re-confirmed when a script reaches that game event. Recorded so a future
  session does not mistake "transparent" (vacuously true when never called) for
  "verified live".
- 2026-06-18 — T9.2 SHARED-BODY ROUTINES (batch 3): RTOAX (0x29a1) is literally
  `ld b,$90` followed by a fall-through into CALCULATE_MAGIC_IMAGE_RAM_ADDRESS
  (0x29a3) -- identical body, only B differs on entry. Ported as ONE implementation
  (ports/magic_image_addr.js `body`): the 0x29a1 export sets b=0x90, runs the shared
  body, and charges +7 cycles for the extra `ld b`. Both are leaves (no calls/pushes),
  both dispatch heavily live (29a3=7546, 29a1=5236 over the 5 scripts), both bench-exact.
  New z80flags helpers introduced and validated by the bench: srl8, rr8 (rotate-right-
  through-carry), sbcHL16 (16-bit subtract-with-borrow, all flags incl. undoc Y/X).
- 2026-06-18 — T9.2 INLINE-PARAMETER ROUTINES NOT HOOKABLE YET (batch 3): COLOUR_FILL
  (0x3657) and PRINT_STRING_297B (0x297b) begin with `pop hl` to fetch the return
  address, read data bytes that sit INLINE after the `call`, advance hl past them, and
  `ret` to that advanced address. The T9.1 hook's RET model returns to the bytes AT
  entrySp -- i.e. straight into the inline data, which it would then execute as code.
  These cannot be hooked without a per-routine "return address += N inline bytes"
  adjustment to the dispatcher. DECISION: leave them unported and bucketed as an
  INLINE-PARAM hazard until the hook grows that adjustment; do NOT force them through
  the current model. (Distinct from the stack/coroutine hazards: the divergence here
  is the return TARGET, not residue.)
- 2026-06-18 — T9.2 BENCH-UNEXERCISED BRANCH (batch 3): the magic-image routines have
  a FLIP/cocktail path (taken when 0x4379 != 0) that none of the captured records
  exercise (all have 0x4379 == 0). It is implemented from the disassembly but is NOT
  bench-covered; only the live hooked==un-hooked regression would catch a bug there,
  and only if a script flips the screen. Flagged in the port file so it is not mistaken
  for bench-verified.
- 2026-06-18 — T9.2 PORTABILITY HAZARD: `bit n,(hl)` UNDOCUMENTED FLAGS ARE WZ-DRIVEN
  (batch 4, reusable triage rule). A routine that does `bit n,(hl)` immediately
  followed by a return (`ret z`/`ret nz`) exposes the undocumented X(bit3)/Y(bit5)
  flags of that `bit` instruction in its return F. Empirically (0x3719 record #0:
  hl=0x0000 so (hl)=ROM[0]=0x00, yet f_out Y=1) these bits come from the Z80's
  internal WZ/memptr register, NOT from the data byte and NOT from the address --
  the port abstraction models neither, so the return F is not reproducible. RULE:
  routines that `ret` directly after `bit n,(hl)` are NOT portable under the current
  ctx (no WZ). This defers 0x3719 UNCOLOUR_MAN (early `bit 4,(hl); ret z`) and 0x27a9
  (early `bit 2,(hl); ret z`). NOTE the contrast: `bit n,(iy+d)` takes X/Y from the
  HIGH BYTE of the computed (iy+d) address, which IS known, so it is reproducible;
  and a `bit n,(hl)` that is purely a mid-routine branch (never the last flag op
  before a ret) is fine because its F is never observed. — found via Claude, recorded
  for the next session's triage.
- 2026-06-18 — T9.2 batch 4: ported WALK_OBJECT_TIMERS (0x27f5,
  ports/walk_object_timers.js) -> 18/47. Circular object-list walk (head 0x0872):
  per node, tick the bit1 countdown (`dec (P+1)`) and on expiry flip state bits
  (`res 1`/`set 0`); follow the back-link at [P-2,P-1] until the walk wraps to the
  head. Portable because every RETURN path exits via `or l` (empty list) or `cp e`
  (loop done) -- both fully-defined ALU flags; the loop's `bit 1,(hl)` only drives a
  branch and is never the last flag op (see WZ hazard above). No inner call/push, so
  no VRAM stack residue. Cost is list-length dependent: the port accumulates exact
  Z80 T-states into ctx.cycles (verified: the 127-cycle short path reconstructs as
  prologue 37 + one bit1-clear node 90). PORT_META maxCycles=1242 = observed worst
  case over the 5 scripts; since the test-plan records are generated from those same
  5 scripts the live regression replays, actual cycles there are bounded by 1242, so
  the decline gate (which only ever errs toward MORE declines, never divergence) is
  safe. Verified: bench 35/35 (8 distinct cases), all 5 scripts hooked==un-hooked
  byte-identical, 3878 live dispatches. The empty-list early-ret path (head==0) is
  never taken by the records -- implemented from disassembly, bench-unexercised.
- 2026-06-18 — T9.2 HOOK FIX: PUSH RESIDUE CAPTURED FROM THE OUTPUT BANK (batch 5).
  The T9.1 dispatcher replays a routine's entry pushes onto the VRAM-overlapping stack
  (PORT_META.pushes). It originally captured the pushed register values from the ENTRY
  bank (before the port ran). That is only coincidentally correct: for a BALANCED
  `push X ... pop X` frame the residue byte left in VRAM equals X at PUSH time, and the
  matching `pop X` restores exactly that value into X, so residue == X_OUT. Entry-bank
  capture (X_in) matches only when X_out == X_in -- true for every routine ported so
  far because they push registers they do not modify (RANDOM push hl; sound push af
  first; the literal-number residues are bank-independent). PRINT_CHAR breaks the
  coincidence: it `push af` AFTER an ADD HL chain has modified F, so the residue F-byte
  is f_out, not f_in. CHANGE (src/port-hook.js): capture pushVals AFTER applyCtx, from
  the OUTPUT bank. Proven equivalent for all prior ports (full npm test 97/97 and all
  5 scripts hooked==un-hooked still byte-identical) and necessary for PRINT_CHAR.
  Measured before the fix: coin-start diverged at frame 582 (f_in 0x2C vs f_out 0x34
  at the af residue byte). entrySp is still captured before the port; only the register
  VALUES are read post-write-back.
- 2026-06-18 — T9.2 batch 5: ported PRINT_CHAR (0x29db, ports/print_char.js) -> 19/47.
  A TRUE LEAF (no CALL): computes a ROM font address ($2F1E + offset from BC), then
  blits 9 rows (one masked byte + a 0x00 spacer per row, `out ($4b),a` per row). Ported
  by faithful instruction-by-instruction transcription (NOT "by intent") because the
  return flags and the SHADOW bank are load-bearing and subtle: f_out is the ADD HL
  chain result saved by `push af` (S/Z/P preserved from entry, H/N/C/Y/X from the final
  `add hl,bc`); the routine carries the 9-row counter in the SHADOW AF via `ex af,af'`,
  so a_p_out = the last masked glyph byte and f_p_out = the last `add hl,bc` flags --
  both compared by the bench. Simulating the real opcodes with the z80flags helpers
  makes these exact rather than hand-derived. The FLIP/cocktail path ($4379 != 0) is
  implemented from the disassembly but BENCH-UNEXERCISED (all records have $4379 == 0).
  Cost is path-dependent (fixed 9-row loop + sign branch + flip branch); ctx.cycles is
  exact (positive-upright path reconstructs to the captured 1276), maxCycles=1302
  (flip+negative worst case). Pushes hl/de/af -> VRAM residue (see hook fix above).
  Verified: bench 10/10, npm test 97/97, all 5 scripts hooked==un-hooked byte-identical,
  384 live dispatches. UNBLOCKS the text/score subtree: 0x2a40 (digit/string blit) now
  has its only missing leaf, which in turn unblocks 0x18cd / 0x2314 / 0x197b / 0x2341.
- 2026-06-18 — T9.2 batch 6: ported C_LOAD (0x1776, ports/c_load.js) -> 20/47. A TRUE
  LEAF (no CALL): reads a 13-byte parameter block at $0878 and streams it to the Exidy
  6840 PTM / sound-control ports $40-$47 via `out (c),r`. Ported by faithful
  transcription. Three points made it safe rather than tricky: (1) `out (c),r` writes
  the port held in C and Berzerk decodes only the low 8 bits -- the bench masks the
  port to 0xFF and the captured io writes match (ports walk 0x41->0x40->...->0x46);
  (2) `res`/`set n,r` on a register and `djnz` do NOT affect flags, so the only
  ret-visible F comes from the second loop's `add a,$40` (with a=0xc0 -> 0x00, giving
  f_out=0x41: Z=1,C=1) -- modeled with add8/and8/or8; (3) both djnz counts are
  IMMEDIATES (3 then 4) and no branch depends on data, so the path is FIXED at 642
  T-states (hand-summed instruction-by-instruction, matches the record `cycles`
  exactly -- which also confirms the disassembly is complete). No push/call -> no
  VRAM-stack residue (pushes:[]). All 5 captured records are the identical path
  (acb5adb0). Verified: bench 5/5 (total 112/112), npm test 97/97, all 5 scripts
  hooked==un-hooked byte-identical, 55540 live dispatches (one of the most-called
  ports -- sound register loading). Candidate triage this batch: examined the two
  other high-record TODOs and DEFERRED both for cause -- 0x15cb (22 records) ends with
  `pop hl; ret`, a NON-LOCAL return that drops two stack levels on its success path
  (returns to the grandparent), which the T9.1 hook's single-RET model cannot
  reproduce; it ALSO opens with `bit 2,(ix+$00); ret z` needing a bit-indexed flag
  helper. Both are infrastructure, not a port -- left for a hook extension. 0x2a40
  (digit/string blit, the PRINT_CHAR unblock) was NOT picked: it has no test-plan
  records of its own (reached only via callers), so it cannot meet the full bench bar
  this batch -- it would need composition + caller-regression instead.
- 2026-06-18 — T9.2 observation (not a decision): a fresh full-5-script dispatch probe
  shows 0x2c1f SAY_GOT_THE_HUMANOID now fires ONCE in attract-only (the attract demo
  kills a humanoid), not 0 as recorded in batches 2/5. The attract script was retimed
  since then (frame-573 gap work). So 0x2c1f's live path is now exercised AND
  transparent (attract-only stays byte-identical hooked==un-hooked). Upgrading its note
  from "unexercised / 0 dispatches" to "1 live dispatch (attract-only)".
- 2026-06-18 — T9.2 batch 7: ported 0x22f1 RESET_JOBS (machine/ports/reset_jobs_22f1.js),
  bringing the count to 21/47. A clean leaf job/coroutine-teardown: `push iy; pop hl`
  to grab IY, write IY into its own (iy-1)/(iy-2) frame slots, zero the job-list head
  ($0870) and current-job pointer ($0876), `di`-bracketed clear of a 56-byte table at
  $437B, then `ld a,($4379); or a; ei; ret`. Faithful transcription. THREE points worth
  recording: (1) IFF is NOT modeled -- `di`...`ei` nets to no change and IFF is not a
  compared register; the live hook charges the full displaced window (1612 T-states)
  and DECLINES if an interrupt event would split it, so interrupt cadence is preserved
  without a flip-flop. (2) `push iy` leaves IY as residue on the VRAM-overlapping stack
  (matched-pop balanced); IY is unchanged across the routine so output-bank == input-bank
  and PORT_META pushes:['iy'] replays it correctly. (3) The 1612-cycle cost is fixed
  (single path; the only loop's djnz count is the immediate $38=56) and hand-summed
  instruction-by-instruction matches the record `cycles` exactly -- the key gotcha was
  `pop hl`=10 T-states (not 14), which reconciled an initial 1616 to the recorded 1612
  (also a disassembly-completeness check). Verified: bench 1/1 (total 113/113), npm test
  97/97, all 5 scripts hooked==un-hooked byte-identical, 3 live dispatches (attract-only
  2 + player-death 1; a rarely-called init routine, but genuinely non-vacuous -- it
  fast-paths live and stays transparent). Candidate triage this batch: 0x22f1 was the
  ONLY remaining clean leaf with records -- the other low-record routines are blocked
  (0x1666/0x26ab are interrupt-core / stack-swap with `ld sp,nn` + `jp (hl)`; 0x1e59/
  0x1fd4/0x200e do `ld sp`/`jp (iy)` coroutine switches, not `ret`; 0x197b/0x2be4 call
  not-yet-ported callees 0x1908/0x18cd / 0x2b6b).

- 2026-06-19 — T9.2 standing-plan infra sprint (decisions ratified by Sudnya, executed
  autonomously). FOUR settled calls, recorded so they are not re-litigated:
  (1) HAZARD STRATEGY = B+A HYBRID. The 12 control-flow routines (9 coroutine/
      stack-switch: 0x1666 0x1e22 0x1e59 0x1e6d 0x1e78 0x1fd4 0x200e 0x24f7 [+0x1c6e,
      see correction below]; 1 interrupt core 0x26ab; 2 computed jump-table 0x1aed
      0x1d22) PLUS the 2 WZ-hazard routines (0x27a9 0x3719) are LEFT ON THE Z80 CORE
      permanently -- they are the scheduler/interrupt/dispatch SUBSTRATE, not leaf
      logic, and the hook already declines them transparently. They are deferred to
      the Phase-10 native re-architecture (T10.1) and run on the emulator target
      meanwhile. We do NOT attempt to CALL-hook them and we do NOT build a `wz` hook
      extension (it would require capturing WZ in the heavy trace -- disproportionate
      for 2 routines). Strategy A is applied ONLY to the data-leaf hazards via two
      small hook extensions: framesToDrop (non-local `pop hl; ret`) and returnPc/
      retAddr (inline-parameter routines). This caps the hookable ceiling well below
      a naive 35; see the corrected portable set below.
  (2) TRANSPILER = NO-GO. With a small number of mechanically-similar leaves left to
      port by hand and the bench (MAME records) as an exact per-routine oracle, a
      decode-oracle->JS transpiler's correctness burden exceeds hand-porting. Not built.
  (3) MAME GOLDENS = USER-SIDE, NON-BLOCKING. golden.js remains a no-op until Sudnya
      generates+commits MAME golden hashes. The live transparency guard for T9.2 is
      bench-exactness + hooked==un-hooked over the 5 scripts; that is sufficient to
      gate each batch and does not block on goldens.
  (4) HOOK EXTENSIONS ADDED (src/port-hook.js): ctx.framesToDrop=N drops N extra return
      words before the final ret (non-local return to an ancestor N levels up:
      pc=mem[entrySp+2N], sp=entrySp+2+2N); ctx.returnPc=ADDR resumes at a port-computed
      absolute address (inline-param `jp (hl)` / ret-past-inline) with sp=entrySp+2; and
      ctx.retAddr exposes the CALL return address so inline-param ports can fetch the
      constant bytes that follow their call site. Unit-tested in port-hook.test.js
      (framesToDrop non-local ret; returnPc+retAddr inline-param) and the bench ctx
      mirrors retAddr (tools/bench.js) so such ports are caller-agnostic.

- 2026-06-19 — T9.2 TRIAGE CORRECTIONS (found by reading the actual disassembly before
  porting; the 2026-06-19 triage table over-classified three routines as portable
  leaves). All three are reclassified to the hazard bucket (stay on the Z80 core):
  * 0x287f SHOOT/SPAWN_ROBOT_SHOT -- NOT a leaf. Ends `pop hl; inc hl; inc hl; pop af;
    pop bc; ld c,$10; jp (hl)` (a non-local COMPUTED return that pops three frames and
    vectors via jp(hl)), and contains `call $1e6d` (ACTOR_YIELD, a blocked coroutine).
    Neither the single-ret model nor framesToDrop/returnPc covers a 3-frame jp(hl) that
    also nests a coroutine. The pre-existing machine/ports/shoot.js (partial, with a
    hand-waved `g.f=0x42`) is NOT registered and should not be -- it cannot reproduce
    either control-flow feature. Deferred to Phase 10.
  * 0x1c6e SCORE_S_SAVE -- contains `halt` (0x1c72). The real routine blocks until the
    next interrupt, so its end-to-interrupt timing is locked to the interrupt phase, NOT
    to an instruction count. The live hook charges a FIXED displaced cycle cost, which
    would desync interrupt cadence (the V256/entropy phase, T5.2). A halt's duration is
    indeterminate for displacement; not transparently hookable. Deferred to Phase 10.
  * 0x151a COLLISION_SENSE -- composes 0x1553 and 0x15a0, both of which have ZERO
    test-plan records (reached only as nested callees). They cannot be bench-verified,
    so 0x151a cannot meet the per-routine bar. Deferred until/unless those callees gain
    coverage.
  Net: the realistic hookable set this plan targets is 0x1ce7, 0x272d, 0x2be4 (no new
  infra), 0x15cb (framesToDrop), the DAA score subtree (0x1908/0x197b/0x2341 with their
  folded callees), and 0x3657/0x297b (returnPc/retAddr) -- materially fewer than the
  "~33" estimate once SHOOT/1c6e/151a are removed. Honest ceiling reported per batch.

- 2026-06-19 — T9.2 z80_core BIT undocumented-flag note (not load-bearing for ports,
  but recorded so the masked validation is not mistaken for a gap): z80_core.js sets the
  undocumented X/Y flags of every BIT n,* instruction by the BIT-NUMBER rule
  (Y=(n==5 && bit set), X=(n==3 && bit set); z80_core.js ~L1762). That is an emulator
  simplification, not the documented-hardware rule, under which BIT n,(ix+d) takes X/Y
  from the HIGH BYTE of the address (ix+d) and BIT n,(hl) from WZ. ports/z80flags.js
  bitIdx8 implements the hardware (address-high-byte) rule, so it disagrees with the core
  only at addrHi values with bit 3/5 set. tools/validate_flags.js therefore masks X/Y for
  bitIdx8/bitHL8 and cross-checks only the documented S/Z/H/P/N/C; the X/Y rule is
  exercised against MAME records via the 0x15cb bench (where the real actor pointers have
  no bit-3/5 in their high byte, so it reduces to X=Y=0 either way). bitHL8 zeroes X/Y by
  construction and is only safe for MID-routine `bit n,(hl)` whose F is overwritten before
  any ret (the WZ hazard for ret-exposed (hl) bits stays in the deferred bucket).

- 2026-06-19 — T9.2 standing-plan execution (bitHL8 + extensions + cheapen-loop + ports):
  * PORTED 0x1ce7 COORD_TO_MAZECELL (machine/ports/coord_to_mazecell.js), 23/47. A clean
    leaf (ends in single ret, no push/call -> no VRAM residue) mapping an (H,L) coord to a
    maze-cell byte via a 3-band L lookup + up-to-5-step H loop into table 0x435e. Ported by
    FAITHFUL TRANSCRIPTION because its return flags are exit-path dependent (jr-c exit
    leaves `cp` flags; djnz-expiry exit leaves `inc e` flags restored through `ex af,af'`)
    and it uses the SHADOW AF bank as the running-threshold scratch (a_p/f_p are the last
    `add a,$30`, not the entry shadow). Verified: bench 32/32, live 4/4 transparent
    (dispatched 47312/8173/17742/47312; coin-start does not reach it), npm test 99/99.
  * MAJOR FINDING -- BENCH ORACLE (MAME) vs LIVE CORE (z80_core.js) DISAGREE ON BIT
    UNDOCUMENTED X/Y FLAGS, which caps the portable set. 0x15cb BOLT_VS_ACTOR opens with
    `bit 2,(ix+$00); ret z`. On that early-exit path the captured MAME record has X/Y=1,1
    (f_out=0x7c) but z80_core.js produces X/Y=0,0 -- z80_core implements the n-based BIT
    rule (X/Y keyed off the bit number; n=2 -> 0,0; ~L1762) and so do MAME-independent
    ports. CONSEQUENCE: a port of any routine that RETURNS directly after a `bit n,*` can
    be either bench-exact (match MAME records) OR live-transparent (match the un-hooked
    z80_core machine) but NOT BOTH, because the un-hooked machine itself does not produce
    the MAME flags. Proven empirically: the 0x15cb port is byte-identical hooked==un-hooked
    on all 4 dispatching scripts (attract 106 / free-play 23 / maze-transition 23 /
    player-death 99) AND passes 14/22 bench records; the only 8 failures are this one
    bit-2 ret-z path's X/Y. Since the T9.2 DOD requires a GREEN bench, 0x15cb is left
    UNREGISTERED (deferred) -- the file machine/ports/bolt_vs_actor_15cb.js is retained with
    a full deferral header. This is the same class as 0x3719/0x27a9 (already deferred). It
    also means the framesToDrop extension's only intended target is blocked by its OPENER
    (not its non-local return); the extension itself is correct + unit-tested and stays for
    Phase 10 / any future clean non-local-ret routine.
    DECISION NEEDED FROM SUDNYA: for routines where MAME and z80_core diverge ONLY on BIT
    undocumented X/Y at a ret, should the bar be (a) live-transparency (accept; the JS
    machine reproduces ITSELF -- which is the actual inversion goal), or (b) MAME-bench-
    exactness (defer, as done now)? Option (a) would immediately register 0x15cb (live-
    transparent today) and likely reopen 0x3719/0x27a9; option (b) keeps them deferred.
  * INFRA: added bitHL8 (z80flags.js, WZ-less mid-routine bit helper, X/Y=0, validated
    masked vs z80_core: 3488/0); framesToDrop + returnPc/retAddr hook extensions
    (port-hook.js, unit-tested) + retAddr mirrored in the bench ctx; transpiler ruled
    NO-GO; hazard strategy B+A ratified (see prior entry). Added tools/transparency.js:
    caches un-hooked frame-hashes per script (invalidated by script/src mtime), scopes the
    hooked==un-hooked run to only the scripts that dispatch a target PC, and localizes a
    divergence (first bad frame + dispatching ports around it + differing VRAM/color bytes).

- 2026-06-19 — T2.3 X/Y-FLAG TOLERANCE EXTENDED TO THE PORT BENCH (Sudnya's call). The
  port bench (tools/bench.js) now MASKS the undocumented X(bit3)/Y(bit5) bits when it
  compares the F and F' bytes, exactly as the T2.3 core-gate already tolerates them for
  BIT/SCF/CCF/block-ops. Rationale (Sudnya): the bench's effective reference is the JS
  core, not MAME -- holding a port to MAME's WZ-derived X/Y would demand behaviour the
  un-hooked z80_core itself does not produce (z80_core does not model WZ; it uses the
  n-based BIT rule). T2.3 already PROVED via the decode oracle that Berzerk never branches
  on X/Y, so they are not behaviourally load-bearing; masking them does NOT weaken the
  bench for anything that matters -- every documented flag (S/Z/H/P/N/C), every register,
  and every memory/IO write is still compared EXACTLY, so a genuine regression still fails.
  Evidence this is safe, not a rug-pull: enabling the mask immediately EXPOSED a real
  register bug in the 0x15cb success path (HL must take the `pop hl` value = ctx.retAddr,
  not the stale computed HL) -- masking X/Y surfaced it rather than hiding it; once fixed,
  0x15cb is 22/22 and live-transparent. This removes the "WZ hazard" portability bucket:
  routines that `ret` straight after `bit n,(hl)` (0x15cb opener, 0x3719 `bit 4,(hl) ret z`,
  0x27a9 `bit 2,(hl) ret z`) are now portable, since the only thing that made them
  unportable was the unreproducible X/Y at the ret. ports/z80flags.js bitHL8 (X/Y=0) is the
  helper for these; the documented flags it sets are exact and the masked bits are ignored.

## 2026-06-20 — T9.2: 0x2341 UPDATE_SCORE ported; T9.2 ceiling characterized
- Ported 0x2341 UPDATE_SCORE (ports/update_score.js) to the full bar: bench 8/8 (both
  paths, shadow a_p/f_p compared), npm 100/100, transparency byte-identical on the 4
  scripts that dispatch it (attract 15 / free-play 4 / maze 5 / player-death 15). It is
  the first NON-degenerate remaining routine: its recorded path runs the full BCD-add
  body, calls only the already-ported 0x2334 (GET_PLAYER_SCORE_PTR) twice, reads the F2
  DIP (port $61) twice from the io FIFO, and uses daa/sla/srl. All helpers already
  existed; no new infra.
- SHADOW-AF MODELING: the digit-index loop `srl b; ex af,af'; inc b; [dec hl; dec e;
  djnz]; ex af,af'` parks the srl-b carry in the live bank and leaves f_p_out = the
  LAST `dec e` flags (a_p unchanged). Reproduced by running the loop's dec8 on a copy of
  flags_p and writing it back at every ret -- the bench compares f_p, so this is
  load-bearing. Cycle accounting double-checks transcription completeness (per-instruction
  T-state sum = recorded cycles, 432 on path1).
- BONUS-AWARD TAIL NOT PORTED (throws, by design): when the score crosses a bonus
  threshold the routine sets XTRAMEN via `bit n,(hl)` (WZ-sourced ret flags), `call
  $3538` (un-ported), then `jp $259A` (non-local -- never returns to the hook). No record
  takes it and transparency confirms no script reaches it live (the throw never fired).
  The port throws on those sub-paths so a future credited-gameplay script that DID award
  a life fails loudly here instead of diverging silently.
- T9.2 CEILING (the durable finding): at 27/47 the cheap, bench-coverable leaves are
  exhausted. The remaining unported-with-records routines split into:
  (1) HAZARD BUCKET (~12): coroutine/ISR/jump-table substrate -- blocked BY DESIGN
      (decision B 2026-06-19: they remain on the Z80 core; the hook declines them
      transparently). 0x287f SHOOT belongs here (jp(hl) computed return + coroutine call).
  (2) GUARD-PATH-ONLY records: 0x272d ERASE_PATTERN, 0x1908 DRAW_DIGIT, 0x197b DRAW_SCORE,
      0x151a COLLISION_SENSE. The 5 attract-derived scripts only ever reach these routines'
      early-ret/inactive guard (HL=0 / score=0 / bolt inactive / credits unchanged), so the
      bench's "body" is a guard and the real bodies (0x2a40 digit blit; 0x1553 bolt engine)
      are unreachable from BOTH the bench AND live transparency. Porting them now is a weak
      bar. Unblocking them needs the standing follow-up: input scripts re-timed past frame
      ~573 to credit coins and play into scored gameplay. Until then, 27/47 is the
      real-bar ceiling and the rest is a T10 / new-scripts decision, not mechanical work.

## 2026-06-20 (later) -- T9.2 ceiling RETRACTED; bolt engine ported via transparency; hooked-heavy-trace mode triggered; recorder parked

CONTEXT: the 2026-06-19/-20 "T9.2 CEILING" entry above (27/47 is the real-bar ceiling;
remaining bodies "unreachable from BOTH bench AND live transparency"; "unblocking needs
new credited-gameplay scripts") is RETRACTED. It was wrong about WHY the gameplay bodies
are unported. Evidence (reproducible; see session_status.md 2026-06-20 (later) + the new
diagnostics tools/gameplay_probe.js and the de-risk run):

1. Berzerk's ATTRACT MODE runs a DEMO GAME. attract-only (zero inputs) executes the full
   engine: 0x1553 bolt engine at frame 977, 0x2a40 digit blitter at 581, 0x2341 / 0x287f
   at 1007. So those bodies are NOT "unreachable from live transparency" -- transparency
   on attract-only already exercises them. coin-start-first-maze missed them only because
   it is 942 frames (they first fire ~954-1007): too SHORT, not mis-credited.
2. 0x1553/0x2a40 have ZERO test-plan records because they are NON-LEAF (0x1553 does
   `call $29A1`), and the generator excludes non-leaf invocations BY DESIGN (leaf-first
   self-validation). This is a property of the routine, not the input script -- NO script
   gives a non-leaf routine a hermetic record. The de-risk (a credited-play script with
   real fire/move, reaching scored play) regenerated -> test plan and produced 0x1553=0,
   0x2a40=0 records, 0 new leaf routines, 0 new path_ids vs the existing 5 scripts.

DECISION A -- credited-gameplay scripts downgraded to MARGINAL. They are no longer a T9.2
blocker. Value: possibly a few new leaf PATHS in already-covered routines (the de-risk
added none). The standing "re-time scripts past frame ~573" action item is closed as
not-the-lever (attract already exercises gameplay).

DECISION B -- the gameplay bodies are ported via COMPOSE + LIVE TRANSPARENCY (the 0x2341
methodology, extended past the leaf set). FIRST one done: 0x1553 MOVE_AND_DRAW_BOLT
(composes the already-ported RTOAX 0x29a1; carry=collision via the live intercept flop,
v256-independent; PORT_META pushes:[0x1578] for the inner-call residue). Validated:
transparency byte-identical on all 5 scripts, NON-VACUOUS (0x1553 ran live 2042x attract,
1843x player-death, 437x free-play, 437x maze-transition). bench 239/239, npm 100/100.

DECISION C -- hooked/callee-included heavy-trace mode TRIGGERED (Option 2). Of the 34
non-leaf routines that execute as CALL targets (vs 47 bench-leaf), a static scan buckets
the 33 remaining as ~25 portable COMPOSITES, 7 HAZARD (ld sp / di / ei -> Tier 3), 1
ambiguous. Composites are the MAJORITY of remaining portable work (vs ~8 clean leaves),
so per the "most -> build" rule we will scope+build a capture mode that records the
parent's read/write closure INCLUSIVE of ported callees so composites self-validate on
the hermetic bench (the bench runs the real callee inline; an inclusive record matches),
restoring a per-routine bench bar on top of transparency. This UNFREEZES heavy-trace.md
(note #4 callee-exclusion) -- amendment + this entry per the schema-freeze discipline.
LIMITATION to flag: only composites whose ENTIRE closure is deterministic-replayable
become bench-able this way; a composite reaching a hazard sub-callee stays transparency-
only. Design to be detailed in the T9.2 task file before implementation.

DECISION D -- the cold-boot interactive recorder is PARKED (not built). Its stated
justification (surface new test-plan records for the gameplay bodies) is refuted by the
de-risk. Remaining merits, to build only on concrete need: (a) capturing the HUMAN-GATE
spot-play session as a regression artifact, (b) deep-state (snapshot-mode) repro per
lightweight-trace.md. The lightweight-trace.md DRAFT stays a draft (unfrozen).

DoD RESCOPE: T9.2 finish line moved off literal "100% of trace-reachable routines" to the
three-tier bar (Tier1 leaf bench+transparency / Tier2 composite compose+transparency,
+hermetic bench where Decision C applies / Tier3 hazard -> Phase-10 native), then
HUMAN-GATE spot-play. See the task file Definition-of-done.

## 2026-06-20 (later 2) -- Option 2 adopted via SEPARATE composite file (inclusive is NOT a superset)

CORRECTION to the "additive/safe" framing in the 2026-06-20 (later) Decision C: that was
verified only at the ROUTINE level (all 47 committed leaf routines retained). Sudnya
independently verified at the RECORD level and found inclusive capture is NOT a strict
superset of the committed exclusive plans. Re-confirmed here at full 3085 frames on
attract-only (record diff keyed on (entry_pc, path_id), which is attribution-independent):
  - 8 DROPPED (in exclusive, not inclusive): 0x1c6e (halt) + 0x1e6d x3 + 0x1e78 x4 -- all
    hazard-bucket; under fold their guard-path subtrees pull in an ISR/coroutine access
    that the interrupt-free self-check cannot reproduce, so inclusive omits them.
  - 5 CONTENT-CHANGED (same key, different reads/writes): 0x157e, 0x197b, 0x1997, 0x2341 x2
    -- composites whose EXCLUSIVE record accidentally self-validated (callees had no net
    writes / self-served reads); inclusive folds in the callee reads.
  - 96 identical, 76 new composite paths.
Also independently confirmed: inclusive capture is un-hooked Z80 truth (the generator runs
the bare core; the fold is pure access-attribution, not behaviour) -- sound, not circular;
and the composite ports bench green against it.

DECISION: adopt Option 2 via a SEPARATE file, NOT by regenerating the committed plans.
  - Committed traces/test-plans/*.jsonl stay FROZEN and exclusive (they hold the 8 dropped
    + 5 content versions; regenerating would lose/alter them).
  - tools/gen_composite_plan.js emits traces/test-plans/composites-inclusive.jsonl =
    inclusive records whose (entry_pc, path_id) is absent from every committed plan (drops
    the 5 content-changed since path_id matches; never needs the 8 dropped). Record format
    unchanged (heavy-trace.md note #4 amendment + test-plan.md amendment, both pending
    ratification).
  - The bench runs committed-exclusive (leaves) + composites-inclusive (composites). Each
    composite port is validated by the hermetic composite record AND live transparency.
  - Inclusive generation is MEMORY-HEAVY (each access duplicated up the frame stack); run
    with NODE_OPTIONS=--max-old-space-size=4096 and/or capped frames in CI.

This keeps the schema-freeze discipline intact (frozen artifacts untouched; additions are
opt-in and separate) while restoring a per-routine hermetic bench bar for the ~25 Tier-2
composites. Next: port 0x2a40 (digit blitter) against its composite record + transparency.

## 2026-06-20 (later 3) -- Tier-2 lesson: composite bench-pass != transparency-pass (residue gates)

Porting 0x2a40 PRINT_DIGITS (composes 0x29a3 + PRINT_CHAR in the BCD digit loop) surfaced a
reusable rule for the remaining ~23 Tier-2 composites: a composite that passes the
inclusive hermetic bench is NOT necessarily live-transparent. 0x2a40 passed its composite
record 1/1 on the first try (register/data effects exact) yet live transparency DIVERGED on
the nested digit-loop VRAM-stack residue (0x42e2-0x42ef). Reason: the bench STRIPS stack
scaffolding (only data writes compared), but Berzerk's stack overlaps VRAM, so the live
machine's transient push residue is observable and must be replayed via PORT_META.pushes.
For a LOOPING composite the residue = the LAST iteration's DEEPEST frame (each iteration
pushes/pops the same slots, so only the final occupant survives) -- here the last digit's
push hl/push bc + `call $29DB` return (0x2A7E) + PRINT_CHAR's own internal push hl/de/af.
CONSEQUENCE: the per-composite workflow is (1) bench-validate the logic against the
composite record (fast, via Option 2), (2) derive PORT_META.pushes (deepest-frame residue)
+ exact path cycles, (3) register + confirm transparency. A composite is only Tier-2-DONE
after (3). Until then, do NOT register it (a non-transparent live port regresses the green
suite); keep it bench-validated and unregistered. 0x2a40 is at step (2).

## 2026-06-21 -- schema amendments RATIFIED; 0x2a40 registered (bench-only live); long-composite decline finding

RATIFIED (Sudnya): the heavy-trace.md + test-plan.md Option-2 amendments are ratified
(separate composite file 76/20, zero key-overlap, frozen exclusive preserved, not-a-
superset confirmed at full 3085 = 8 hazard drops + 5 content-changes). Marked in both docs.

TIER CLASSIFICATION of the 20 composite-file routines (so Tier-3 isn't mistaken for an
adoption target): TIER-3 (hazard, record-only, NOT hooked) = 0x1c6e, 0x151a, 0x1e6d,
0x1e78, 0x1e59, 0x1d12, 0x287f (Sudnya's 7) + 0x1721 (`ld sp,$085E`, from the static
stack-switch scan). TIER-2 portable = 0x1553 (done), 0x2a40 (this entry), and candidates
0x15a0/0x272d/0x1505/0x14f3/0x2436/0x2b54/0x25e4/0x18cd/0x1f91/0x1f94. See task file.

0x2a40 PRINT_DIGITS: ported (print_digits.js, composes 0x29a3 + PRINT_CHAR per digit),
BENCH-validated 1/1 against its composite record, REGISTERED (bench 246/0, npm 100/100,
transparency 5/5).

KEY FINDING -- LONG COMPOSITES ALWAYS DECLINE (so they are bench-only live, not fast-path-
validated like 0x1553): 0x2a40 is ~8800 T-states (6 digits x ~1300), FAR longer than the
inter-interrupt gap (~4000 T = 41666 T/frame / 10 interrupts). The T9.1 decline gate
(eventWithin(maxCycles)) therefore fires on essentially every dispatch -> 0x2a40 NEVER
fast-paths in any of the 5 scripts (0 live dispatches); the Z80 core runs it, byte-
identically by construction. CONSEQUENCES:
  - "Dual-validated like 0x1553" is NOT achievable for long routines. 0x1553 (305 T) fast-
    paths 4759x and is genuinely transparency-validated; 0x2a40 (8800 T) always declines,
    so its live transparency is the core's (vacuously green). Its real validation is the
    BENCH (Option-2 composite record). This is correct hook behaviour, not a deficiency:
    atomic-charging a routine longer than the interrupt gap WOULD mis-time the interrupt,
    which is exactly why the gate declines it.
  - I attempted a runtime VRAM-stack-residue model (ctx.pushWords hook extension) for the
    fast-path, but (a) it was only partially correct on a FORCED fast-path (fixed [-3..-12]
    of the digit frame; [-1:-2] and [-13..-16] still diverged) and (b) it is MOOT because
    0x2a40 never fast-paths. Reverted both the extension and the residue code (no
    speculative/incomplete code). If a future shorter-digit caller (B<=3, < ~4000 T) ever
    fast-paths 0x2a40, transparency will catch it loudly and the residue can be completed
    then.
  - GENERAL RULE for the remaining Tier-2 composites: SHORT ones (< ~4000 T, e.g. 0x15a0,
    0x272d) get genuine fast-path transparency like 0x1553; LONG/loop-heavy ones get
    bench-only live validation (always decline). Both are registered (bench coverage +
    native-target readiness); the validation bar differs by length, and that must be stated
    honestly per routine, not blanket-claimed as "transparency-validated".

## 2026-06-21 -- 0x15a0 dual-validated; Phase-10 atomic-routine constraint; fast-path vs decline split

0x15a0 BOLT_HIT_SCAN: ported (bolt_hit_scan_15a0.js), DUAL-VALIDATED -- bench 8/8 against
its inclusive composite records AND live transparency byte-identical (12 fast-path
executions: attract 5 / free-play 1 / maze 1 / death 5; coin-start dispatches none). It
composes the already-ported 0x15cb once for the head actor ($0876) then once per actor in
the circular list ($0870). Measured cost 186..2579 T over the 5 scripts; 2579 < the inter-
interrupt gap (~4000 T), so it GENUINELY fast-paths (unlike 0x2a40) -- this is a real
Tier-2 dual-validate, the model the user expected. bench 254/0, npm 100/100, transparency
4 verified + 1 skip.

  - NON-LOCAL-RETURN composition: 0x15cb does `pop hl; ret` on a hit (its framesToDrop=1),
    returning straight to 0x15a0's caller. In the JS composition we (a) point ctx.retAddr
    at the INNER call's return address (0x15ab head / 0x15b9 loop) so 0x15cb's `pop hl`
    loads the value the real machine loads (HL_out), and (b) on the hit signal STOP the
    scan and let 0x15a0's own hook return normally. The hooked 0x15a0 never pushed the
    inner `call` frame, so a hit and a clean loop-exit both return to mem[entrySp] ->
    0x15a0's framesToDrop is 0 either way (we clear the inner's signal). bench's 8/8
    confirms this across whatever paths the records captured.
  - DISASSEMBLY ARTIFACT corrected: cdoc/annotated-asm-berzerk.md shows `15a6 halt; 15a7
    ex af,af'` for 0x15a0 -- a MIS-DECODE. The real ROM bytes at 0x15a4 are DD 2A 76 08 =
    `ld ix,($0876)` (4 bytes, 0x15a4-0x15a7); the trace disassembler aligned mid-instruction
    onto the operand bytes 76 08 (which decode as halt; ex af,af') before re-syncing at the
    real `call $15cb` at 0x15a8. There is NO halt -- 0x15a0 is a clean Tier-2 composite, not
    a frame-sync hazard. Verified by reading rom1.1d (offset 0x5a0). Lesson: trust the ROM
    bytes over the trace-derived annotation for instruction boundaries.
  - RESIDUE invisible by STACK PLACEMENT: all 54 invocations run with SP in WORK RAM
    (0x0824/0x0826), so the inner-call return-address residue lands at 0x0822-0x0825,
    outside the 0x4000-0x5FFF rendered window. PORT_META declares no pushes -- the residue
    cannot affect the display hash (structural across all 54 invocations, unlike 0x157e
    which got lucky with VRAM-window placement). The residue is also path-dependent (0x15ab
    BC==0 / BC clean-loop / 0x15b9 loop-hit), which the static output-bank push model could
    not express anyway; here it does not need to.

PHASE-10 CONSTRAINT (the deeper meaning of the 0x2a40 always-decline finding) -- recorded
here and in tasks/P10/T10.1: a routine LONGER than the inter-interrupt gap (~4000 T) always
declines in Phase 9 (bench-only, 0 live fast-path dispatches), and it ALSO CANNOT be run as
atomic JS in the Phase-10 NATIVE target. The native target drops the Z80 core and runs the
ported routines directly under a JS-driven interrupt cadence; if such a routine executes
atomically (as a single JS call), the interrupts that SHOULD fire mid-routine (the real
routine spans several interrupt boundaries) are deferred to AFTER it -> the ISR reads V256
(port 0x4E bit0) at a ~scanline-shifted beam position -> entropy phase (0x089F counter ->
0x435C LCG seed -> RANDOM) drifts -> object placement diverges. So these routines need the
SAME cooperative interrupt-interleaving / yield model as the Tier-3 coroutine substrate:
they must yield at their original interrupt-check points, not run to completion atomically.
KEY: "registered" != "native-ready" for them. The Phase-9 decline gate (which already
declines them) is the symptom; Phase 10 must supply the cooperative scheduler that lets a
ported routine yield mid-body. The fast-path/decline split observed in Phase 9 is exactly
the Phase-10-readiness split: a routine that genuinely fast-paths (< ~4000 T: 0x1553,
0x15a0) can run atomically in native; one that always declines (0x2a40, and any future
long/loop-heavy composite) needs the yield model. The T9.2 coverage checklist now tags each
composite fast-path-dual-validated vs always-decline-bench-only to mark this split.

## 2026-06-22 -- Autonomous Tier-2 batch: 7 composites ported; disassembler bug; ISR-inflated-cost insight; portable set EXHAUSTED

Continued T9.2 autonomously through the remaining portable Tier-2 composites. Ported and
dual/bench-validated 7 routines this batch (37 total registered). Full tree green after each:
bench 297/0 (37 routines), npm 100/100, transparency 5/5 (all ports together, byte-identical).

NEW PORTS (with per-routine live bar = Phase-10-readiness tag):
  - 0x272d DRAW_OBJECT -- FAST-PATH-DUAL. Composes DRAW_SPRITE (0x2817) x2 +
    CALCULATE_MAGIC_IMAGE_RAM_ADDRESS (0x29a3). bench 12/12 + transparency 8 fast-path execs.
    Low fast-path RATE (bimodal cost 86..3152; the gate uses worst-case maxCycles for every
    call, so the common 86-cost calls mostly decline -- safe, just fewer fast-paths).
  - 0x151a UPDATE_BOLT_SLOT -- FAST-PATH-DUAL. TIER MOVE Tier-3 -> Tier-2 (see below).
    Composes 0x1553 + 0x15a0 (gated on collision carry) + 0x157e. bench 16/16 + transparency
    ~14691 fast-path execs (validates the whole nested composition inline). BUG FOUND+FIXED by
    the bench: `add iy,bc` sets the carry flag (ADD rr affects C/H/N/Y/X), which a following
    `dec (iy+1); ret nz` exposes; first port modeled the add without flags -> stale C -> 2 fail
    -> fixed with addHL16.
  - 0x1505 UPDATE_ALL_BOLT_SLOTS -- FAST-PATH-DUAL. djnz loop over B (INPUT) bolt slots
    composing 0x151a. bench 8/8 + transparency ~5057 execs.
  - 0x14f3 STEP_BOLT_GROUPS -- ALWAYS-DECLINE-BENCH-ONLY. Composes 0x1505 x3 (3rd via
    fall-through tail). Own worst ~4095 >= ~4000 gap -> 0 live dispatches (confirmed
    "unexercised"). bench 4/4.
  - 0x1f91 / 0x1f94 SET_OBJECT_IMAGE -- FAST-PATH-DUAL. 0x1f91 masks dir & falls into 0x1f94;
    both compose SET_VELOCITY (0x2b3d) then store an image ptr. di/ei = critical section (not
    a coroutine; di..ei nets IFF unchanged, which the hook does not touch). bench 1/1 each +
    transparency 54 / 1 execs. FIRST VRAM-stack fast-path composites this batch: SP in VRAM,
    so the `call $2b3d` return-addr residue 0x1F97 is visible -> pushes:[0x1f97] (validated by
    transparency, confirming the residue model works for VRAM-SP fast-path routines).
  - 0x25e4 MAGIC_ADDR_TO_DE -- FAST-PATH-DUAL. ld b,$10; call $29a3; ex de,hl; ret. bench 1/1
    + transparency 1640 execs. Residue 0x25E9 (VRAM SP).

TIER MOVE 0x151a (Tier-3 -> Tier-2), flagged for Sudnya's review/veto: 0x151a was bucketed
Tier-3 with reason "un-benched callees / coroutine". ROM re-read (skoolkit + raw bytes) shows
NO intrinsic hazard (no ld sp / jp (hl) / halt / coroutine) -- a plain per-slot bolt state
machine with iy-relative state + ordinary early rets. Its three callees (0x1553, 0x15a0,
0x157e) are now all ported (the actual blocker), and all preserve IY (verified). So the
Tier-3 reason was a DEPENDENCY-block, now cleared. Validated to the full bar (bench 16/16 +
transparency ~14691). Sudnya can veto.

DISASSEMBLER BUG (the user's "read the ROM bytes" warning, vindicated): the trace-derived
z80 disassembler (tools/t61 / z80dis.js) reports `ld ix,nn`/`ld iy,nn` (DD/FD 21 nn nn) with
LENGTH 2 instead of 4 -- so it re-decodes the operand bytes as phantom instructions. This is
the same class of artifact as the 0x15a0 "halt". It bit 0x1505: the phantom `ld a,e; ld b,e`
made the first port use B=E (wrong loop count) -> bench 8 fail -> traced to the mis-decode.
The REAL 0x1505 takes its loop count B as an INPUT register. The annotated-asm-berzerk.md is
built with this buggy disassembler and is NOT a reliable boundary source. AUTHORITATIVE DECODE
for the rest of the batch: disassembler/oracle/skoolkit_instructions.jsonl (correct where
present, but has GAPS at DD/FD-prefixed instructions -- FDCB/FD36/FD21 missing) cross-checked
with raw ROM bytes (disassembler/oracle/berzerk_flat.bin) and an FD/DD length rule. The
already-validated ports (0x272d, 0x151a) were re-verified against skoolkit and match exactly.

ISR-INFLATED COST INSIGHT (refines the FAST-PATH vs ALWAYS-DECLINE split): the heavy-trace
`cycle_count` is entry..ret wall-clock, so when an interrupt fires MID-routine the ISR's
cycles are INCLUDED -> the measured MAX over-states the routine's OWN cost. For STRAIGHT-LINE
routines (fixed own cost) the measured max is pure ISR noise; 0x25e4 (own 167, measured max
5085) and 0x1f91/0x1f94 (own 257/246, measured max 1295) were initially mis-labeled
ALWAYS-DECLINE by the measured-max metric but are really FAST-PATH. RULE: classify by OWN
cost (the port's computed ctx.cycles worst case over PATHS, not the ISR-inflated trace max).
For straight-line routines set maxCycles = own cost (fast-paths); for branching routines
maxCycles = measured max is still SAFE (it only over-declines, never under-counts).

PORTABLE TIER-2 COMPOSITES EXHAUSTED. Of the 20 composite-file routines: 10 ported (0x1553,
0x15a0, 0x272d, 0x151a, 0x1505, 0x14f3, 0x1f91, 0x1f94, 0x25e4, 0x2a40); 10 not portable:
  - INTRINSIC Tier-3 hazard (7): 0x1721 (ld sp,$085E), 0x1c6e (halt), 0x1d12 (jp (hl)),
    0x1e59 (ld sp,hl), 0x1e6d (ld sp,$0870), 0x1e78 (ld sp), 0x287f (jp (hl)+coroutine).
  - BLOCKED on a Tier-3 callee (3, NEW assignments this batch):
      * 0x2436 -- `call nz,$1c6e` (conditional call to the Tier-3 halt routine). Also long
        (always-decline). Cannot compose unported 0x1c6e.
      * 0x2b54 -- `call $1e78` (Tier-3 ld sp stack-switch). Cannot compose unported 0x1e78.
      * 0x18cd -- `ld hl,$0000; add hl,sp; ld (hl),a` builds a BCD temp at the live SP then
        passes that SP as a pointer to PRINT_DIGITS (0x2a40). The port ctx deliberately
        EXCLUDES sp (bench buildCtx + live buildLiveCtx both omit it), so HL=SP is not
        computable in a port; and it composes the always-decline 0x2a40. Stack-relative-temp
        hazard -> Tier-3. (Exposing SP in ctx would be an architecture change -- NOT taken;
        left for Sudnya / Phase-10.)
This is autonomous stop-condition (a): portable Tier-2 composites exhausted. Remaining
coverage work needs the Phase-10 native cooperative-yield substrate (Tier-3 + always-decline).

## 2026-06-22 -- Scope-A finish line: hooked play build wired; T9.2 -> awaiting-human

T9.2 set to awaiting-human at the Scope-A ceiling (37 routines; cdoc/done-definition.md).
Verified state (re-run): npm 100/100; bench 297/0 across 37 routines (incl. composite plan);
transparency 5/5 hooked==un-hooked byte-identical. Tier-3 (10 deferred) enumerated in the
T9.2 checklist + the 2026-06-22 batch entry above. Two Sudnya-side Scope-A items remain:
(a) the HUMAN-GATE spot-play, (b) MAME goldens generated+committed.

PLAY BUILD + HOOK-LIVENESS PROOF. The shell (shell/index.html + shell.js) previously ran the
BARE emulator -- it never installed the port hook, so it tested nothing for the gate. Fixed:
the shell now installs makePortHook(PORTS, PORT_META, scheduler) by DEFAULT (the hybrid IS
the Scope-A deliverable). Because the 37 ports are byte-transparent (the game looks identical
hooked vs un-hooked), liveness is surfaced three ways, weakest to strongest:
  1. Boot console line `port hooks: ENABLED (37 routines)` -- WEAK (proves the install call
     ran, not that dispatch happens).
  2. On-page badge with a LIVE dispatch counter (cumulative dispatches + distinct routines /
     37), updated every frame -- the primary proof; "watch the counter climb".
  3. `?breakrandom=1` -- substitutes a deliberately-wrong RANDOM (0x2678) to prove the hook is
     load-bearing. Verified HEADLESSLY (/tmp, not committed): on attract-only, normal-hooks
     reproduce the un-hooked frame hashes byte-identically for all 3085 frames, while the
     broken-RANDOM port first DIVERGES at frame 950 (once the attract demo consumes entropy).
     So breaking a JS port breaks ONLY the hooked build -> hooks are unquestionably live.
`?hooks=0` runs the bare emulator for A/B comparison. Step-by-step play instructions (launch,
ROM wiring, controls, what-to-look-for checklist, the break test) live in machine/PLAY.md.
The shell change is surgical (hook install + counter overlay + a query-param toggle); the
default-on behavior is safe because hooked==un-hooked is proven byte-identical.

## 2026-06-22 -- Play-harness coin/start timing (input plumbing confirmed correct)

Spot-play reported coin/start/fire dead in the shell (identical with ?hooks=0 -> not the
ports). Root cause is the timing already documented in entropy-berzerk.md sec4, now confirmed
end-to-end: the CPU first samples the input ports at POST completion (~frame 573); inputs
applied earlier are released before any read, so no script (or early keypress) ever credits a
coin -- coin-start-first-maze is byte-identical to no-input for all 942 frames. Applied AFTER
frame ~574 the coin credits (CMOS 0x08A4/0x08A5: credits 0->1), start consumes it, and port
0x48 (P1 joystick) begins polling (=player active; the real in-game signal -- ram-map's 0x436e
"game_active_flag" does NOT flip, label is misleading). The key->bit map + active-low polarity
are correct (COIN1/START1 SYSTEM 0x49, BUTTON1 P1 0x48 bit4). HARNESS-ONLY fix (no port /
PORT_META change): shell latches coin/start as fixed-length pulses (a tap suffices) and shows
READY / CREDITS / IN-GAME readouts so the coin register is visible; PLAY.md documents the
wait-for-READY-then-coin flow. This also recontextualizes the earlier "credited play adds no
new records" de-risk finding: credited play never STARTED in those runs (coin too early), so
its zero-new-records result was partly an artifact of the un-credited machine, not only the
leaf-first exclusion -- though the Tier classification (non-leaf composites reachable via
attract) stands independently and is unaffected.

## 2026-06-22 -- Segmented-trace schema change APPROVED (long/interrupted-routine validation)

DECISION (Sudnya sign-off, 2026-06-22): adopt the "interrupts as recorded yield boundaries"
approach to make long / interrupted routines per-segment benchable and portable as coroutines,
and authorize the supporting heavy-trace schema extension. Full plan:
cdoc/long-routine-validation-plan.md. Governance constraints honored: the committed exclusive
test plans and existing goldens stay FROZEN; the boundary snapshots are added as a SEPARATE
segmented-trace file (mirroring the composites-inclusive.jsonl precedent), not by mutating the
frozen exclusive plans. Per-boundary record carries: approx cycle offset, boundary PC, a full
register snapshot INCLUDING the hidden WZ register, and the live-memory snapshot needed to
re-enter; ISR entry/return is marked.

EVIDENCE (why this is sound, not a leap): an independent interrupt-dependency probe
(machine/tools/isr_dep_probe.mjs; re-emulates attract-only 3085f from the flat oracle ROM,
reuses the heavy_trace_capture frame-tracking technique). Over 25,130 serviced interrupts
(8.15/frame == the 2 IRQ + 8 NMI hardware model, a faithfulness check) and 391,347 mainline
invocations, the STRICT spanning-dependency test -- "does an interrupted routine read, after
the ISR returns, an address that ISR wrote during the split, before the routine overwrote it"
-- fires only 645 times across exactly 5 routines: 0x1e78(525), 0x1c6e(87), 0x287f(15),
0x2436(8) [all already Tier-3 hazards], and 0x188b(10) [ATTRACT_DEMO_LOOP, the top-level
driver loop]. ZERO of the 37 cleanly-ported routines show any strict dep. Every dependent
address is in VRAM 0x40xx-0x43xx (the stack-overlaps-VRAM / coroutine-substrate region). The
cleanly-ported routines DO read ISR-maintained state heavily (global provenance: tens of
thousands of reads) but only as STABLE prior-frame values -- already captured as recorded
inputs, which is why they bench clean. Positive control: the probe sees the ISR maintaining
the RNG-phase counter 0x089f/0x08a0 (2510 writes each), so detection is live; RNG 0x2678 shows
no ISR provenance (true negative -- it reads its own mainline-written seed).

CONSEQUENCE: for long-but-CLEAN routines, segments are independent pure functions; the port
need not reproduce the ISR's timing-seeded CONTENT at a boundary -- run the ISR (or just tick
the timers it maintains) and resume. The genuine ISR-output entanglement is quarantined to the
5 routines above, which stay on the Scope-B coroutine track. Notably, this dynamic data-flow
method -- with no knowledge of the structural hazard classification -- REDISCOVERED essentially
the same hazard set, an independent corroboration that the Scope-A/Scope-B boundary is drawn
correctly. CAVEAT recorded: the SP-depth frame tracker is unreliable inside coroutine
stack-swaps (the preempted-routine histogram had phantom RAM/VRAM entryPCs and was discarded),
but that unreliability is confined to the hazard regions; clean-routine tracking is reliable,
so "strict == 0 for clean routines" holds and any undercount falls within the already-excluded
set. NEXT STEP: pilot the segment chain on one long clean routine -- 0x2a40 PRINT_DIGITS
(~8800 T, today ALWAYS-DECLINE/bench-only) -- behind a flag; green pilot converts "long
routines" from a Scope-B blocker into a mechanical, verifiable porting track.

## 2026-06-22 -- Pilot 0x2a40 segment-chain GREEN (V1+V2)

PILOT RESULT (cdoc/pilot-2a40-segment-chain-workorder.md): segment-chain capture + per-segment validation for 0x2a40 PRINT_DIGITS PASSES byte-exact -- 20 invocations / 19 multi-segment / 73 segments; V1 (lossless segmentation: ordered segments+ISR-interval write_sets + last regs_out == heavy_trace_capture INCLUSIVE whole) 20/20; V2 (per-segment snapshot-sufficiency: each segment replayed on a fresh Z80 core from entry_pc+entry_regs+read_set alone reproduces regs_out+write_set, bench X/Y mask) 73/73. New code only: machine/tools/gen_segmented_trace.js + machine/tests/segment_chain_2a40.test.js + traces/segmented/attract-only.0x2a40.jsonl; no port/PORT_META/print_digits/frozen-schema/golden change; no WZ fabricated (NA for this clean routine). Confirms "interrupts as recorded yield boundaries" at the data level -> long-but-clean routines are per-segment benchable; justifies the coroutine-port follow-on (separate task, not done here).

## 2026-06-22 -- Pilot 0x2a40 coroutine-port V3 GREEN (V3a+V3b)

PILOT RESULT (cdoc/pilot-2a40-coroutine-port-workorder.md): generator/coroutine variant of the 0x2a40 PRINT_DIGITS port PASSES. V3a output-equivalence 20/20 (coroutine drained == shipped whole-routine port, byte-identical writes+regs_out, bench X/Y mask; yielding does not change output) and V3a-anchor 20/20 (shipped port data-writes == recorded own-write reconstruction, stack stripped). V3b cadence 20/20 within +/-1 -- in fact EXACT (serviced interrupts == recorded n_interrupts, 0 error) for all 20 -- because the port's hand-calibrated cycle table reproduces the core's real own-cycle total exactly (diff 0) so the budget reaches every recorded boundary. V3c partition (diagnostic) 85% (45/53 interrupts serviced alone in their interval; the 15% are >=2 interrupts that fell in one atomic seam). FINDING: cadence must be driven from the recorded interrupt schedule, NOT a fixed routine-internal own-cycle gap -- a fixed G=4070 predictor hits exact only 8/20, within +/-1 only 12/20 (max err 3), because un-modeled ISR durations perturb the routine-own-cycle spacing of interrupts; the Scope-B coroutine driver must source the schedule from the interrupt controller (per long-routine-validation-plan.md S5). New code only: machine/ports/print_digits_coro.js + machine/tests/coro_2a40.test.js; shipped print_digits.js / PORT_META / 37 ports / frozen schemas / composites-inclusive / goldens untouched; no ISR ported (cadence from recorded chain); no WZ fabricated; no cycle-exact modeling. Regression: V1/V2 20/20+73/73, whole bench (bench.test.js 6/6, composites-inclusive 0x2a40 1/0) still green. Coroutine-resumability proven for one long clean routine -> de-risks the Scope-B core-free build; generalizing the driver across routines + the Tier-3 hazard substrate remains separate Scope-B work.

## 2026-06-22 -- Renderer visible-window fix (score was cropped off-screen)

FINDING + FIX (user-directed, via credited-gameplay capture traces/scripts/kill_robots.jsonl): the on-screen player score was never visible because video.js renderToRGBA rendered VRAM scanlines [0,224) instead of the true visible window. Per cdoc/hardware-berzerk.md sec5 the displayed rows are the non-vblank scanlines [VBEND,VBSTART) = [0x20,0x100) = [32,256) (224 rows). The old row-0-anchored window painted the top stack/var band (VRAM 0x4000-0x43ff = rows 0-31) as garbage AND cropped the bottom status strip where the score is drawn (scanlines ~245-253). Proven: in a credited game the player scored 500 (10 robot kills x 50; score BCD at 0x433e-0x4340, drawn by 0x2341 ADD_AND_DRAW_SCORE -> PRINT_DIGITS 0x2a40 with HL=0x433e, DE=0xd500 -> magic-window writes to VRAM 0x5ea0-0x5fa6); the "500" digits were present in VRAM at scanlines 245-253 but never rasterized. FIX: renderToRGBA now maps VRAM scanline vy -> screen row vy-VBEND and skips rows outside [VBEND, VBEND+224); same 256x224 output size, no shell/canvas change. NOT a scoring/game-logic bug -- the score, collision, and kill accounting were all correct. Files: src/video.js (added VBEND/VISIBLE_ROWS consts + window remap), tests/video.test.js (updated the MSB/nibble test to the corrected geometry + added a top-band-not-rendered assertion). npm test 102/102. Nothing committed.

## 2026-06-22 -- Credited-gameplay coverage (kill_robots.jsonl): universe 83 -> 95 (+12)

COVERAGE RESULT (cdoc/credited-gameplay-capture-workorder.md; report cdoc/credited-gameplay-coverage.md): traces/scripts/kill_robots.jsonl is the first trace to enter CREDITED play (port 0x48 read 87,778x; never read in attract). RAM-map state-change proofs: coin credited (0x08A3 0->1 @f1018); game started (0x4344 0->1, credit consumed @f1419); KILL scenario CONFIRMED (player score 0x433E-0x4340 BCD 000000->000500 in 10 steps of +50 = 10 robot kills); DEATH scenarios 2/3 CONFIRMED (lives 0x434c 5->4->3->2->1 = 4 deaths); game-over PARTIAL (terminal transition at f4812 -- lives reset 1->5, 0x4344->2 -- consistent with game-over but counter does not cleanly pass through 0); maze-transition + Evil-Otto NOT captured (need a longer/dawdle session, follow-on). Reachable-routine universe 83 (attract) -> 95 (credited), +12 new entryPCs: 0x1851 0x186a 0x18b2 0x18f1 0x18f7 (score/credit display subtree) + 0x2b6b 0x2b97 0x2c51 0x2db3 0x2dce (credited start/game-init) + 0x33a7 0x361c (start/sound/config). The 12 are credit/start/score-accounting routines the attract demo never runs; NOT ported here (separate follow-on). Score lives at 0x433E-0x4340 (player-1 BCD) NOT 0x089C (demo counter). Capture-only; no engine/port/PORT_META/schema changes; nothing committed.
