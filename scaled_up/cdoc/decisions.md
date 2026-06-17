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
