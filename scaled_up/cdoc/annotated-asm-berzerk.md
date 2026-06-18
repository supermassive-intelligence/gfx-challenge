# Berzerk trace-driven annotation (T6.1)

Status: awaiting-human (machine-checkable work complete; Sudnya spot-reviews a
sample of annotations against the traces before this flips to done).

## What this is

Behaviour-derived annotations for every routine the **attract** heavy-trace
reaches, plus a RAM variable map ([ram-map-berzerk.md](ram-map-berzerk.md)).
Method requirement (load-bearing for T6.2): each routine is named and contracted
**only from observed behaviour** -- its read/write addresses (cross-referenced to
`cdoc/hardware-berzerk.md` and `cdoc/entropy-berzerk.md`), argument registers,
call-graph position, and effects. The published Berzerk/Frenzy source, the
seanriddle disassembly, and the existing `disassembler/oracle/labels.json` were
NOT consulted -- those are the T6.2 scoring rubric. (The decode-oracle's
instruction bytes were used for disassembly; its `label` field was ignored.)

## Evidence basis (reproducible)

- Heavy trace: `node machine/tools/heavy_trace_capture.js traces/scripts/attract-only.jsonl <out> ` -> **416,482 invocations over 3085 frames** (matches T4.1 / entropy-berzerk.md).
- Per-routine aggregation (read/write sets, ports, register deltas, parent/child
  call graph) was recomputed by instrumenting the same `Machine` + `ScriptPlayer`
  capture path used by the FROZEN heavy trace.
- Disassembly is from a Z80 disassembler validated against
  `disassembler/oracle/decode_oracle.jsonl`: **5286/5288 instructions identical**
  (the 2 differences are the oracle printing `cp -2`/`cp -4` in signed decimal vs
  the canonical `cp $fe`/`cp $fc`).
- Every contract field below (ports, RAM regions, entropy, callers/callees) is
  emitted directly from the trace aggregate, not hand-transcribed.

## Routine count and reconciliation (83 vs "81")

The attract trace reaches **83 distinct entry PCs** (CALL/RST targets + 3 ISR
entry vectors: 0x0066 NMI, 0x26AB IM2 IRQ, 0x0509 POST IRQ). The task's "81" is
approximate: **8 of the 83 are secondary entry points into a shared code tail of
another routine** (a normal Z80 idiom), confirmed by disasm-span containment:

`0x1505`<-0x14F3, `0x1E78`<-0x1E6D, `0x1F94`<-0x1F91, `0x22F1`<-0x22EB,
`0x29A3`<-0x29A1, `0x2A4A`<-0x2A40, `0x2B3D`<-0x2B39, `0x2BE4`<-0x2BDE.

Counting each shared body once lands at ~75 logical routines; counting all
observed entry points lands at 83. None were invented; routines never seen in the
attract trace are out of scope (gameplay isn't captured yet -- see
entropy-berzerk.md sec4 on why credited play never starts).

## Confidence flags

`conf H` = behaviour unambiguous (ports/effects pin it). `conf M` = behaviour
clear, exact game-semantic label has some interpretation. `conf L` = **flagged
uncertain** -- the mechanism is described from evidence but the higher-level
game meaning is a best guess; do not treat the name as authoritative.
`conf L` routines: 0x200E, 0x1908, 0x188B, 0x18CD, 0x35E7, 0x3601, 0x364E,
0x297B, 0x19AC, 0x1A98, 0x264C, 0x2662, 0x25CA, 0x25D4, 0x25E4, 0x2314, 0x2341,
0x2436, 0x1C6E, 0x287F, 0x1F91, 0x1F94, 0x2A4A, 0x2B54.

## Call-graph caveat (ISR entries as "callees")

The interrupt vectors **0x0066 (NMI), 0x26AB (IM2 IRQ), 0x0509 (POST IRQ)** appear
in many routines' **callees** list. These are NOT real calls: an interrupt
delivered while a routine was executing opens a child frame (heavy-trace.md frozen
rule #3), so the ISR shows up as a "child" of whatever it interrupted. Read those
three entries as "an interrupt fired during this routine," not as a subroutine
call. Likewise a routine appearing in its own callees (e.g. 0x1E78 under 0x1E78)
is the coroutine scheduler re-entering shared code, not literal recursion.

The **Side-effects / entropy** line lists only the entropy vars (0x089F/0x08A0
counter, 0x435C seed) that THIS routine touches, tagged `(r)`/`(w)`/`(rw)` from
its own trace read/write set. Caveat: these tags are *trace-observed*, so a write
that executes after a coroutine stack-swap can be attributed to a sibling frame
(heavy-trace.md known limitation). Example: **0x1685 START_GAME** shows
`0x435C(r)` but its disasm also writes 0x435C at 0x16B9 (after the `call 0x209D`
spawn) -- the reseed write is real; cross-check the disasm for stack-swapping
routines rather than trusting the r/w tag alone.

## Memory-region legend (used in contracts)

- **NVRAM** 0x0800-0x0BFF -- battery work RAM (variables; see RAM map).
- **VAR/STK(VRAM)** 0x4000-0x43FF -- VRAM low band reused as coroutine **stacks**
  and **game variables** (NOT visible bitmap). The visible bitmap proper starts
  higher; the magic-window blitter targets 0x6400+.
- **VRAM-bitmap** 0x4400-0x5FFF -- direct bitmap.
- **MAGIC** 0x6000-0x7FFF -- 74181 ALU write window (port 0x4B control).
- **COLOR** 0x8100-0x87FF -- 4x4 color-attribute RAM.

## Subsystem map (bottom-up, the order Phase 9 ports)

1. **Leaf arithmetic/IO:** RANDOM (0x2678), magic-addr (0x29A1/0x29A3),
   sound-out (0x1776), digit/BCD (0x18E0), coord->cell (0x1CE7).
2. **Sound:** sequencer (0x1D12/0x1D22), priority SFX triggers
   (0x33BD/0x3439/0x348A/0x34E7), NMI speech service (0x1721 under 0x0066).
3. **Bolt engine:** 0x14F3 -> 0x1505 -> 0x151A -> {move/draw 0x1553, bounds
   0x157E, hit-scan 0x15A0/0x15CB}.
4. **Actor blitter + objects:** blit 0x2817, draw-object 0x272D, motion 0x27A9,
   timers 0x27F5, player draw 0x3719.
5. **Coroutine scheduler:** 0x1E22/0x1FD4/0x1E59/0x1E6D/0x1E78/0x24F7.
6. **Maze/level + robots:** 0x1685 start -> 0x209D setup -> 0x2540 gen ->
   {place 0x25EB, render 0x369F, walls 0x3657}.
7. **Frame interrupt:** 0x26AB ties draw+objects+entropy together each frame.

---

# Per-routine annotations (bottom-up by call-graph depth)

### 0x0509  POST_IRQ_SELFTEST   _(conf H)_
- **Purpose:** Power-on self-test IRQ handler: validates the interrupt/V256 phasing (in 0x4E; rl b; xor 0x55 / xor 0x20) and enables IRQ (port 0x4F); spins (jr $) on mismatch. Runs only at boot.
- **Inputs (read):** regs in; mem regions: (none non-ROM)
- **Outputs (written):** regs out [sp]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 7x (ISR); callers (root/ISR); callees (leaf)

  <details><summary>disasm (21 insn)</summary>

  ```
  0509  ld sp,$43ff
  050c  in a,($4e)
  050e  rra
  050f  rl b
  0511  ld a,b
  0512  xor $55
  0514  jr z,$0519
  0516  ei
  0517  jr $0517
  0519  out ($4f),a
  051b  ld b,$ff
  051d  ld sp,$43ff
  0520  in a,($4d)
  0522  in a,($4e)
  0524  rra
  0525  rl b
  0527  ld a,b
  0528  xor $20
  052a  jp z,$0079
  052d  in a,($4c)
  052f  jr $052f
  ```
  </details>

### 0x1666  COLD_START   _(conf M)_
- **Purpose:** Boot entry after RST chain: disable interrupts, stash the return address at 0x4400, set the boot stack to 0x4300, and spawn the first coroutine (0x1E22).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x4
- **Outputs (written):** regs out [h,l,sp]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 2x; callers (root/ISR); callees (leaf)

  <details><summary>disasm (14 insn)</summary>

  ```
  1666  di
  1667  pop hl
  1668  ld ($4400),hl
  166b  ld ($4402),a
  166e  ld sp,$4300
  1671  call $1e22
  1674  ld iy,($0872)
  1676  ld (hl),d
  1677  ex af,af'
  1678  call $22f1
  167b  call $26ab
  167e  ld hl,($4400)
  1681  ld a,($4402)
  1684  jp (hl)
  ```
  </details>

### 0x1776  WRITE_SOUND_REGISTERS   _(conf H)_
- **Purpose:** Push the current SFX register image (NVRAM 0x0878-0x0884) out to the 6840 timer + SFX-control ports 0x40-0x47. Pure output stage of the sound chain.
- **Inputs (read):** regs in; mem regions: NVRAM x15
- **Outputs (written):** regs out [a,f,sp,c,l,d]; mem regions: (none); ports 40<=[00]  41<=[00]  42<=[00]  43<=[00]  45<=[00]  46<=[00,40,80,c0]  47<=[00]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 20092x; callers 0x0066 0x1721 0x26ab; callees (leaf)

  <details><summary>disasm (46 insn)</summary>

  ```
  1776  ld hl,$0878
  1779  ld b,(hl)
  177a  inc hl
  177b  ld d,(hl)
  177c  inc hl
  177d  ld e,(hl)
  177e  inc hl
  177f  ld c,$41
  1781  res 0,b
  1783  set 0,d
  1785  out (c),d
  1787  dec c
  1788  out (c),b
  178a  inc c
  178b  res 0,d
  178d  out (c),d
  178f  dec c
  1790  out (c),e
  1792  inc c
  1793  inc c
  1794  ld b,$03
  1796  ld a,c
  1797  inc c
  1798  ld d,c
  1799  ld e,(hl)
  179a  inc hl
  179b  ld c,a
  179c  ld a,(hl)
  179d  inc hl
  179e  out (c),a
  17a0  ld a,c
  17a1  ld c,d
  17a2  out (c),e
  17a4  inc d
  17a5  inc d
  17a6  djnz $1799
  17a8  dec c
  17a9  ld a,$00
  17ab  ld b,$04
  17ad  or (hl)
  17ae  inc hl
  17af  out (c),a
  17b1  and $c0
  17b3  add a,$40
  17b5  djnz $17ad
  17b7  ret
  ```
  </details>

### 0x1aed  DISPATCH_BY_LANGUAGE   _(conf H)_
- **Purpose:** Language-indexed jump table: read the F3 language DIP (port 0x60 bits6-7), index a table 8 bytes past the inline base, and jp (hl) to the localized handler.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x2
- **Outputs (written):** regs out [h,l,sp]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 3x; callers 0x1a98; callees (leaf)
- **Notes:** pop+jp dispatcher; alternate language strings.

  <details><summary>disasm (19 insn)</summary>

  ```
  1aed  pop hl
  1aee  ld d,h
  1aef  ld e,l
  1af0  ld bc,$0008
  1af3  add hl,bc
  1af4  push hl
  1af5  ex de,hl
  1af6  in a,($60)
  1af8  and $c0
  1afa  rlca
  1afb  rlca
  1afc  rlca
  1afd  ld c,a
  1afe  add hl,bc
  1aff  ld a,(hl)
  1b00  inc hl
  1b01  ld h,(hl)
  1b02  ld l,a
  1b03  jp (hl)
  ```
  </details>

### 0x1d22  SOUND_SEQ_DISPATCH   _(conf M)_
- **Purpose:** SFX-sequencer opcode dispatcher: fetch a byte from the (BC) script stream and jump through the 2-byte jump table at 0x1D31.
- **Inputs (read):** regs in; mem regions: NVRAM x2
- **Outputs (written):** regs out [a,f,d,e,sp,h]; mem regions: NVRAM x4
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 2965x; callers 0x1d12; callees (leaf)

  <details><summary>disasm (12 insn)</summary>

  ```
  1d22  ld a,(bc)
  1d23  inc bc
  1d24  ld h,$00
  1d26  add a,a
  1d27  ld l,a
  1d28  ld de,$1d31
  1d2b  add hl,de
  1d2c  ld a,(hl)
  1d2d  inc hl
  1d2e  ld h,(hl)
  1d2f  ld l,a
  1d30  jp (hl)
  ```
  </details>

### 0x1e22  SPAWN_ACTOR_COROUTINE   _(conf M)_
- **Purpose:** Create a coroutine/actor: pop the body address, build a fresh actor stack frame, and link it into the actor list (0x0872/0x0873 head, 0x0870 tail).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x22
- **Outputs (written):** regs out [l,sp,h]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 20x; callers 0x1e59; callees (leaf)
- **Notes:** Stack-discipline-defeating (pop+jp); traces best-effort per heavy-trace.md.

  <details><summary>disasm (31 insn)</summary>

  ```
  1e22  pop hl
  1e23  exx
  1e24  ld hl,$0001
  1e27  push hl
  1e28  push hl
  1e29  ld hl,$0000
  1e2c  add hl,sp
  1e2d  ld a,($0873)
  1e30  or a
  1e31  jr nz,$1e39
  1e33  push hl
  1e34  ld ($0872),hl
  1e37  jr $1e57
  1e39  push iy
  1e3b  pop bc
  1e3c  ld iy,($0872)
  1e3e  ld (hl),d
  1e3f  ex af,af'
  1e40  ex de,hl
  1e41  ld h,(iy-$01)
  1e44  ld l,(iy-$02)
  1e47  push hl
  1e48  di
  1e49  ld (iy-$01),d
  1e4c  ld (iy-$02),e
  1e4f  ei
  1e50  ld ($0872),de
  1e54  push bc
  1e55  pop iy
  1e57  exx
  1e58  jp (hl)
  ```
  </details>

### 0x1fd4  INIT_COROUTINE_STACK   _(conf M)_
- **Purpose:** Initialize a fresh coroutine stack: pop IY (frame base) and push 7 zero words as the initial saved-register frame.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x4
- **Outputs (written):** regs out [iy,sp]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 2x; callers 0x1e59; callees (leaf)
- **Notes:** Stack-swap routine; trace nesting is best-effort.

  <details><summary>disasm (27 insn)</summary>

  ```
  1fd4  pop iy
  1fd6  ld hl,$0000
  1fd9  ld b,$07
  1fdb  push hl
  1fdc  djnz $1fdb
  1fde  ld ix,$0000
  1fe0  nop
  1fe1  nop
  1fe2  add ix,sp
  1fe4  push hl
  1fe5  ld ($0876),ix
  1fe7  halt
  1fe8  ex af,af'
  1fe9  ld a,($4344)
  1fec  cp $01
  1fee  ld a,$aa
  1ff0  jr z,$1ff4
  1ff2  ld a,$dd
  1ff4  ld ($4378),a
  1ff7  ld hl,($4347)
  1ffa  ld (ix+$07),l
  1ffd  ld (ix+$09),h
  2000  xor a
  2001  call $1f91
  2004  ld (ix+$0d),$02
  2008  ld (ix+$0c),$01
  200c  jp (iy)
  ```
  </details>

### 0x2334  SELECT_SCORE_PTR   _(conf M)_
- **Purpose:** Select the active score base pointer: return HL=0x4341 when current-player word 0x4344==2 (player 2), else HL=0x433E (player 1).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x19
- **Outputs (written):** regs out [f,l,sp,a,h]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 37x; callers 0x1e78 0x2341 0x369f; callees (leaf)

  <details><summary>disasm (6 insn)</summary>

  ```
  2334  ld a,($4344)
  2337  cp $02
  2339  ld hl,$4341
  233c  ret z
  233d  ld hl,$433e
  2340  ret
  ```
  </details>

### 0x297b  DRAW_TEXT_RUN   _(conf L)_
- **Purpose:** Draw a labelled text/graphic run: pop an inline descriptor (count + source ptr), compute the magic address (0x29A3) and emit characters (0x29DB) along a row.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x6
- **Outputs (written):** regs out [l,sp,h]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 6x; callers 0x1a98 0x1e78; callees (leaf)
- **Notes:** Uncertain exact content.

  <details><summary>disasm (27 insn)</summary>

  ```
  297b  pop hl
  297c  ld b,(hl)
  297d  inc hl
  297e  ld e,(hl)
  297f  inc hl
  2980  ld d,(hl)
  2981  inc hl
  2982  ex de,hl
  2983  call $29a3
  2986  ex de,hl
  2987  ld c,(hl)
  2988  res 7,c
  298a  call $29db
  298d  ld b,a
  298e  ld a,($4379)
  2991  or a
  2992  jr nz,$2997
  2994  inc de
  2995  jr $2998
  2997  dec de
  2998  inc hl
  2999  ld a,(hl)
  299a  or a
  299b  ld a,b
  299c  jp nz,$2987
  299f  inc hl
  29a0  jp (hl)
  ```
  </details>

### 0x2bde  QUEUE_SPEECH_A   _(conf L)_
- **Purpose:** Queue a fixed speech sequence: load HL=0x2C4A and store it as the active speech pointer 0x0898.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x4
- **Outputs (written):** regs out [h,l,sp]; mem regions: NVRAM x2
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 2x; callers 0x1e6d 0x1e78; callees (leaf)

  <details><summary>disasm (4 insn)</summary>

  ```
  2bde  ld hl,$2c4a
  2be1  jp $2c1b
  2c1b  ld ($0898),hl
  2c1e  ret
  ```
  </details>

### 0x2be4  GENERATE_INTRO_SPEECH   _(conf M)_
- **Purpose:** Build the intro/taunt speech: gated by 0x4371 -- when clear, pick a random word (RANDOM->0x0918 buffer), assemble a sentence into the speech buffer (0x2B6B), and set the speech pointer 0x0898/flag 0x089A.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x3
- **Outputs (written):** regs out [a,h,l,sp]; mem regions: NVRAM x3
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 1x; callers 0x22eb; callees (leaf)
- **Notes:** Contains RANDOM call site 0x2BED; in the attract trace the 0x4371 gate was NOT taken, so RANDOM was not reached here (latent path).

  <details><summary>disasm (28 insn)</summary>

  ```
  2be4  ld a,($4371)
  2be7  or a
  2be8  jr nz,$2c13
  2bea  ld hl,$0918
  2bed  call $2678
  2bf0  and $07
  2bf2  or $70
  2bf4  ld (hl),a
  2bf5  inc hl
  2bf6  ex de,hl
  2bf7  ld hl,$2c28
  2bfa  ld b,$02
  2bfc  call $2b6b
  2bff  ld hl,$2c32
  2c02  ld b,$01
  2c04  call $2b6b
  2c07  ex de,hl
  2c08  ld (hl),$44
  2c0a  inc hl
  2c0b  ld (hl),$ff
  2c0d  ld hl,$0918
  2c10  xor a
  2c11  jr $2c18
  2c13  ld hl,$2c35
  2c16  ld a,$ff
  2c18  ld ($089a),a
  2c1b  ld ($0898),hl
  2c1e  ret
  ```
  </details>

### 0x2c1f  QUEUE_SPEECH_B   _(conf L)_
- **Purpose:** Queue a fixed speech sequence (HL=0x2C40) into the speech pointer 0x0898, clearing the speech flag 0x089A.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x2
- **Outputs (written):** regs out [a,f,h,l,sp]; mem regions: NVRAM x3
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 1x; callers 0x1e78; callees (leaf)

  <details><summary>disasm (3 insn)</summary>

  ```
  2c1f  ld hl,$2c40
  2c22  xor a
  2c23  jr $2c18
  ```
  </details>

### 0x33bd  START_SFX_PRIO0   _(conf M)_
- **Purpose:** Priority-gated sound-effect trigger: if the requested priority (0x00) outranks the current 0x0889, preempt -- disable NMI (port 0x4D), set priority 0x0889, point the SFX sequencer 0x0885 at script 0x33D3 -- then restore NMI (port 0x4C). One specific sound.
- **Inputs (read):** regs in; mem regions: NVRAM x1, VAR/STK(VRAM) x8
- **Outputs (written):** regs out [h,l,sp]; mem regions: NVRAM x3, VAR/STK(VRAM) x4; ports 4c<=[02,04,08,09]  4d<=[00]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 13x; callers 0x1e78; callees (leaf)

  <details><summary>disasm (12 insn)</summary>

  ```
  33bd  ld hl,$0889
  33c0  push af
  33c1  ld a,$00
  33c3  cp (hl)
  33c4  jr c,$33cf
  33c6  out ($4d),a
  33c8  ld (hl),a
  33c9  ld hl,$33d3
  33cc  ld ($0885),hl
  33cf  pop af
  33d0  out ($4c),a
  33d2  ret
  ```
  </details>

### 0x3439  START_SFX_PRIO3   _(conf M)_
- **Purpose:** Priority-gated SFX trigger (priority 0x03, script 0x344F); same preempt/restore protocol around the NMI ports as 0x33BD.
- **Inputs (read):** regs in; mem regions: NVRAM x1, VAR/STK(VRAM) x4
- **Outputs (written):** regs out [h,l,sp]; mem regions: NVRAM x3, VAR/STK(VRAM) x2; ports 4c<=[1f]  4d<=[03]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 1x; callers 0x1e78; callees (leaf)

  <details><summary>disasm (12 insn)</summary>

  ```
  3439  ld hl,$0889
  343c  push af
  343d  ld a,$03
  343f  cp (hl)
  3440  jr c,$344b
  3442  out ($4d),a
  3444  ld (hl),a
  3445  ld hl,$344f
  3448  ld ($0885),hl
  344b  pop af
  344c  out ($4c),a
  344e  ret
  ```
  </details>

### 0x348a  START_SFX_PRIO1_A   _(conf M)_
- **Purpose:** Priority-gated SFX trigger (priority 0x01, script 0x34A0); preempts the sound sequencer if it outranks 0x0889.
- **Inputs (read):** regs in; mem regions: NVRAM x1, VAR/STK(VRAM) x28
- **Outputs (written):** regs out [h,l,sp]; mem regions: NVRAM x3, VAR/STK(VRAM) x14; ports 4c<=[00,01,04,0c,35,37,39,3a,bc]  4d<=[01]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 11x; callers 0x1e78; callees (leaf)

  <details><summary>disasm (12 insn)</summary>

  ```
  348a  ld hl,$0889
  348d  push af
  348e  ld a,$01
  3490  cp (hl)
  3491  jr c,$349c
  3493  out ($4d),a
  3495  ld (hl),a
  3496  ld hl,$34a0
  3499  ld ($0885),hl
  349c  pop af
  349d  out ($4c),a
  349f  ret
  ```
  </details>

### 0x34e7  START_SFX_PRIO1_B   _(conf M)_
- **Purpose:** Priority-gated SFX trigger (priority 0x01, script 0x34FD); a distinct sound from 0x348A using the same protocol.
- **Inputs (read):** regs in; mem regions: NVRAM x1, VAR/STK(VRAM) x20
- **Outputs (written):** regs out [h,l,sp]; mem regions: NVRAM x3, VAR/STK(VRAM) x10; ports 4c<=[01,04,05,08,f6,fd]  4d<=[01]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 11x; callers 0x287f; callees (leaf)

  <details><summary>disasm (12 insn)</summary>

  ```
  34e7  ld hl,$0889
  34ea  push af
  34eb  ld a,$01
  34ed  cp (hl)
  34ee  jr c,$34f9
  34f0  out ($4d),a
  34f2  ld (hl),a
  34f3  ld hl,$34fd
  34f6  ld ($0885),hl
  34f9  pop af
  34fa  out ($4c),a
  34fc  ret
  ```
  </details>

### 0x3657  DRAW_WALL_SEGMENT   _(conf M)_
- **Purpose:** Draw one wall segment into color RAM: pop the inline descriptor pointer, read length/value, and fill a horizontal or vertical run of color cells from base 0x8100/0x87FF, direction per flip 0x4379.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x8
- **Outputs (written):** regs out [h,l,sp]; mem regions: (none)
- **Side-effects / entropy:** none observed
- **Call graph:** depth 0, invoked 24x; callers 0x35af 0x35e7 0x3601 0x364e 0x369f; callees (leaf)

  <details><summary>disasm (54 insn)</summary>

  ```
  3657  pop hl
  3658  ld e,(hl)
  3659  inc hl
  365a  ld d,(hl)
  365b  inc hl
  365c  push hl
  365d  ld a,($4379)
  3660  or a
  3661  jr nz,$3669
  3663  ld hl,$8100
  3666  add hl,de
  3667  jr $366e
  3669  ld hl,$87ff
  366c  sbc hl,de
  366e  ex de,hl
  366f  pop hl
  3670  ld c,(hl)
  3671  inc hl
  3672  ex af,af'
  3673  ld a,(hl)
  3674  inc hl
  3675  ex af,af'
  3676  or a
  3677  ld a,(hl)
  3678  inc hl
  3679  push hl
  367a  ex de,hl
  367b  jr nz,$368e
  367d  ld de,$0020
  3680  ex af,af'
  3681  ld b,a
  3682  ex af,af'
  3683  push hl
  3684  ld (hl),a
  3685  inc hl
  3686  djnz $3684
  3688  pop hl
  3689  add hl,de
  368a  dec c
  368b  jr nz,$3680
  368d  ret
  368e  ld de,$ffe0
  3691  ex af,af'
  3692  ld b,a
  3693  ex af,af'
  3694  push hl
  3695  ld (hl),a
  3696  dec hl
  3697  djnz $3695
  3699  pop hl
  369a  add hl,de
  369b  dec c
  369c  jr nz,$3691
  369e  ret
  ```
  </details>

### 0x1d12  SOUND_ENGINE_TICK   _(conf M)_
- **Purpose:** Advance the active SFX sequencer one step: read sequencer state 0x0852/0x0853, run the bytecode dispatcher (0x1d22), and store updated pointers (0x0850/0x0851, 0x0885/0x0886).
- **Inputs (read):** regs in; mem regions: NVRAM x4
- **Outputs (written):** regs out [a,f,d,e,ix,sp]; mem regions: NVRAM x4
- **Side-effects / entropy:** none observed
- **Call graph:** depth 1, invoked 2965x; callers 0x0066 0x1721 0x26ab; callees 0x1d22

  <details><summary>disasm (8 insn)</summary>

  ```
  1d12  ld ix,$1d22
  1d14  ld ($ed1d),hl
  1d17  ld c,e
  1d18  add a,l
  1d19  ex af,af'
  1d1a  call $1d22
  1d1d  ld ($0885),bc
  1d21  ret
  ```
  </details>

### 0x0066  NMI_HANDLER   _(conf H)_
- **Purpose:** Z80 NMI entry: disable NMI, abort to POST-fail (0x051d) if boot flag 0x4000!=0, else tail-jump to the NMI service body 0x1721.
- **Inputs (read):** regs in; mem regions: NVRAM x50, VAR/STK(VRAM) x196, VRAM-bitmap x120; ports 44 65
- **Outputs (written):** regs out [sp,a,f]; mem regions: NVRAM x50, VAR/STK(VRAM) x158, VRAM-bitmap x60; ports 44<=[09,0b,10,11,45,65]  4c<=[00,01,02,03,04,05,06,07,08,09,0a,0b,0c,0d,0e,0f,10,11,12,13,14,15,16,17,18,19,1a,1b,1c,1d,1e,1f,20,21,22,23,24,25,26,27,28,29,2a,2b,2c,2d,2e,2f,30,31,32,33,34,35,36,37,38,39,3a,3b,3c,3d,3e,3f,40,41,42,43,44,45,46,47,48,49,4a,4b,4c,4d,4e,4f,50,51,52,53,54,55,56,57,58,59,5a,5b,5c,5d,5e,5f,60,61,62,63,64,65,66,67,68,69,6a,6b,6c,6d,6e,6f,70,71,72,73,74,75,76,77,78,79,7a,7b,7c,7d,7e,7f,80,81,82,83,84,85,86,87,88,89,8a,8b,8c,8d,8e,8f,90,91,92,93,94,95,96,97,98,99,9a,9b,9c,9d,9e,9f,a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,aa,ab,ac,ad,ae,af,b0,b1,b2,b3,b4,b5,b6,b7,b8,b9,ba,bb,bc,bd,be,bf,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,ca,cb,cc,cd,ce,cf,d0,d1,d2,d3,d4,d5,d6,d7,d8,d9,da,db,dc,dd,de,df,e0,e1,e2,e3,e4,e5,e6,e7,e8,e9,ea,eb,ec,ed,ee,ef,f0,f1,f2,f3,f5,f6,f7,f8,f9,fa,fb,fd,fe,ff]  4d<=[00,01,02,03,04,05,06,07,08,09,0a,0b,0c,0d,0e,0f,10,11,12,13,14,15,16,17,18,19,1a,1b,1c,1d,1e,1f,20,21,22,23,24,25,26,27,28,29,2a,2b,2c,2d,2e,2f,30,31,32,33,34,35,36,37,38,39,3a,3b,3c,3d,3e,3f,40,41,42,43,44,45,46,47,48,49,4a,4b,4c,4d,4e,4f,50,51,52,53,54,55,56,57,58,59,5a,5b,5c,5d,5e,5f,60,61,62,63,64,65,66,67,68,69,6a,6b,6c,6d,6e,6f,70,71,72,73,74,75,76,77,78,79,7a,7b,7c,7d,7e,7f,80,81,82,83,84,85,86,87,88,89,8a,8b,8c,8d,8e,8f,90,91,92,93,94,95,96,97,98,99,9a,9b,9c,9d,9e,9f,a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,aa,ab,ac,ad,ae,af,b0,b1,b2,b3,b4,b5,b6,b7,b8,b9,ba,bb,bc,bd,be,bf,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,ca,cb,cc,cd,ce,cf,d0,d1,d2,d3,d4,d5,d6,d7,d8,d9,da,db,dc,dd,de,df,e0,e1,e2,e3,e4,e5,e6,e7,e8,e9,ea,eb,ec,ed,ee,ef,f0,f1,f2,f3,f5,f6,f7,f8,f9,fa,fb,fc,fd,fe,ff]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 2, invoked 20105x (ISR); callers 0x14f3 0x1505 0x151a 0x1553 0x157e 0x1597 0x15a0 0x15cb 0x188b 0x18e0 0x1908 0x197b 0x1997 0x1a45 0x1a4e 0x1add 0x1c6e 0x1ce7 0x1e59 0x1e6d 0x1e78 0x1f91 0x200e 0x22f1 0x2314 0x2341 0x2436 0x24f7 0x2540 0x25ca 0x25d4 0x25e4 0x25eb 0x264c 0x2662 0x2678 0x26ab 0x272d 0x27a9 0x27f5 0x2817 0x287f 0x29a1 0x29a3 0x29db 0x2a40 0x2b39 0x2b3d 0x2b54 0x35af 0x35e7 0x3601 0x364e 0x369f 0x3719; callees 0x1776 0x1d12

  <details><summary>disasm (7 insn)</summary>

  ```
  0066  out ($4d),a
  0068  push af
  0069  ld a,($4000)
  006c  or a
  006d  jp nz,$051d
  0070  pop af
  0071  jp $1721
  ```
  </details>

### 0x1721  NMI_SOUND_SERVICE   _(conf H)_
- **Purpose:** Per-NMI service on a private stack at 0x085E: poll SW2 bit7 (bookkeeping), tick the SFX engine (0x1d12) and push the 6840 register image (0x1776), then drain the speech queue 0x0898 to the S14001A (port 0x44).
- **Inputs (read):** regs in; mem regions: NVRAM x14, VAR/STK(VRAM) x3; ports 65
- **Outputs (written):** regs out [sp]; mem regions: NVRAM x16; ports 4c<=[00]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 2, invoked 1x; callers (root/ISR); callees 0x1776 0x1d12

  <details><summary>disasm (43 insn)</summary>

  ```
  1721  ld ($085e),sp
  1725  ld sp,$085e
  1728  push af
  1729  push bc
  172a  push de
  172b  push hl
  172c  push ix
  172e  in a,($65)
  1730  bit 7,a
  1732  jp nz,$0605
  1735  ld a,($436e)
  1738  or a
  1739  call z,$1d12
  173c  call $1776
  173f  ld a,($436e)
  1742  or a
  1743  jr nz,$1762
  1745  ld hl,($0898)
  1748  ld a,h
  1749  or l
  174a  jr z,$1765
  174c  in a,($44)
  174e  and $c0
  1750  cp $40
  1752  jr nz,$1765
  1754  ld a,(hl)
  1755  bit 7,a
  1757  jr nz,$1762
  1759  inc hl
  175a  out ($44),a
  175c  bit 6,a
  175e  jr z,$1765
  1760  jr $1748
  1762  ld hl,$0000
  1765  ld ($0898),hl
  1768  pop ix
  176a  pop hl
  176b  pop de
  176c  pop bc
  176d  pop af
  176e  ld sp,($085e)
  1772  out ($4c),a
  1774  retn
  ```
  </details>

### 0x1597  BOLT_LIMIT_COMPARE   _(conf M)_
- **Purpose:** Limit/zero comparator helper: returns B=0 (flag "at boundary") when the coordinate equals 0 or the supplied limit low-byte; used by bolt expiry.
- **Inputs (read):** regs in; mem regions: NVRAM x4
- **Outputs (written):** regs out [f,sp]; mem regions: NVRAM x6
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 4489x; callers 0x157e 0x26ab; callees 0x0066

  <details><summary>disasm (6 insn)</summary>

  ```
  1597  cp $00
  1599  jr z,$159d
  159b  cp e
  159c  ret nz
  159d  ld b,$00
  159f  ret
  ```
  </details>

### 0x15cb  BOLT_VS_ACTOR_COLLISION   _(conf M)_
- **Purpose:** Bounding-box overlap test between a bolt and an actor (player at iy, actor at ix): gated by actor bit2; on overlap sets actor hit flags (bit7, and bit0 of ix-6).
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x59
- **Outputs (written):** regs out [sp,f,l,a,h,e]; mem regions: NVRAM x4, VAR/STK(VRAM) x14
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 117x; callers 0x15a0 0x26ab; callees 0x0066

  <details><summary>disasm (31 insn)</summary>

  ```
  15cb  bit 2,(ix+$00)
  15cf  ret z
  15d0  ld h,(ix+$0b)
  15d3  ld l,(ix+$0a)
  15d6  ld d,(hl)
  15d7  inc hl
  15d8  ld e,(hl)
  15d9  ex de,hl
  15da  ld d,(hl)
  15db  inc hl
  15dc  ld e,(hl)
  15dd  inc e
  15de  ld a,(iy+$03)
  15e1  sub (ix+$09)
  15e4  inc a
  15e5  ret m
  15e6  cp e
  15e7  ret nc
  15e8  ld a,(iy+$02)
  15eb  sub (ix+$07)
  15ee  ret m
  15ef  sla d
  15f1  sla d
  15f3  sla d
  15f5  inc d
  15f6  cp d
  15f7  ret nc
  15f8  set 7,(ix+$00)
  15fc  set 0,(ix-$06)
  1600  pop hl
  1601  ret
  ```
  </details>

### 0x1add  CLEAR_BOTTOM_STRIP   _(conf M)_
- **Purpose:** Zero the VRAM region 0x5BC0-0x5D7F (0x2C0 bytes), clearing the bottom screen strip.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x2
- **Outputs (written):** regs out [f,h,l,sp]; mem regions: VAR/STK(VRAM) x2, VRAM-bitmap x448
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 1x; callers 0x1a98; callees 0x0066

  <details><summary>disasm (9 insn)</summary>

  ```
  1add  ld hl,$5bc0
  1ae0  ld bc,$02c0
  1ae3  xor a
  1ae4  ld (hl),a
  1ae5  inc hl
  1ae6  dec c
  1ae7  jp nz,$1ae4
  1aea  djnz $1ae4
  1aec  ret
  ```
  </details>

### 0x200e  LINK_COROUTINE_ALT   _(conf L)_
- **Purpose:** Variant coroutine creator/linker using list vars 0x0870/0x0871 (parallels 0x1E22).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x18
- **Outputs (written):** regs out [h,l,sp]; mem regions: VAR/STK(VRAM) x2
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 16x; callers 0x1e59; callees 0x0066
- **Notes:** Uncertain: coroutine plumbing, stack-swap; trace unreliable.

  <details><summary>disasm (29 insn)</summary>

  ```
  200e  pop hl
  200f  exx
  2010  ld b,$07
  2012  ld de,$0000
  2015  push de
  2016  djnz $2015
  2018  ld hl,$0000
  201b  add hl,sp
  201c  ex de,hl
  201d  ld a,($0871)
  2020  or a
  2021  jr nz,$202a
  2023  push de
  2024  ld ($0870),de
  2028  jr $203d
  202a  ld ix,($0870)
  202c  ld (hl),b
  202d  ex af,af'
  202e  ld h,(ix-$01)
  2031  ld l,(ix-$02)
  2034  push hl
  2035  di
  2036  ld (ix-$01),d
  2039  ld (ix-$02),e
  203c  ei
  203d  push de
  203e  pop ix
  2040  exx
  2041  jp (hl)
  ```
  </details>

### 0x22f1  INIT_ACTOR_TABLE   _(conf M)_
- **Purpose:** Zero the actor/bolt table 0x437B-0x43B2 (0x38 bytes) and clear the actor-list heads 0x0870/0x0876.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x5
- **Outputs (written):** regs out [h,l,sp,a,f,b]; mem regions: NVRAM x4, VAR/STK(VRAM) x60
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 2x; callers (root/ISR); callees 0x0066
- **Notes:** Shared tail of 0x22EB (alternate entry).

  <details><summary>disasm (18 insn)</summary>

  ```
  22f1  push iy
  22f3  pop hl
  22f4  ld (iy-$01),h
  22f7  ld (iy-$02),l
  22fa  ld hl,$0000
  22fd  di
  22fe  ld ($0870),hl
  2301  ld ($0876),hl
  2304  xor a
  2305  ld hl,$437b
  2308  ld b,$38
  230a  ld (hl),a
  230b  inc hl
  230c  djnz $230a
  230e  ld a,($4379)
  2311  or a
  2312  ei
  2313  ret
  ```
  </details>

### 0x27a9  UPDATE_OBJECT_MOTION   _(conf M)_
- **Purpose:** Per-object motion/timer update: gated by bit2, decrement the object timer (slot+0x0C), accumulate position deltas into the slot, advance the list pointer 0x0870, and toggle the animation bit 0x4378.
- **Inputs (read):** regs in; mem regions: NVRAM x6, VAR/STK(VRAM) x91
- **Outputs (written):** regs out [sp,iy,f,l,e,a]; mem regions: NVRAM x10, VAR/STK(VRAM) x61
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 4872x; callers 0x26ab; callees 0x0066

  <details><summary>disasm (53 insn)</summary>

  ```
  27a9  ld ($0870),hl
  27ac  bit 2,(hl)
  27ae  ret z
  27af  push hl
  27b0  pop iy
  27b2  ld de,$000c
  27b5  add hl,de
  27b6  dec (hl)
  27b7  ret nz
  27b8  inc hl
  27b9  ld a,(hl)
  27ba  dec hl
  27bb  ld (hl),a
  27bc  ld de,$fffa
  27bf  add hl,de
  27c0  ld a,(hl)
  27c1  inc hl
  27c2  add a,(hl)
  27c3  ld (hl),a
  27c4  inc hl
  27c5  ld a,(hl)
  27c6  inc hl
  27c7  add a,(hl)
  27c8  ld (hl),a
  27c9  inc hl
  27ca  ld e,(hl)
  27cb  inc hl
  27cc  ld d,(hl)
  27cd  inc de
  27ce  inc de
  27cf  ex de,hl
  27d0  ld a,(hl)
  27d1  or a
  27d2  jp nz,$27da
  27d5  inc hl
  27d6  ld a,(hl)
  27d7  inc hl
  27d8  ld h,(hl)
  27d9  ld l,a
  27da  ex de,hl
  27db  ld (hl),d
  27dc  dec hl
  27dd  ld (hl),e
  27de  ld a,$1b
  27e0  or (iy+$00)
  27e3  ld (iy+$00),a
  27e6  bit 5,(iy+$00)
  27ea  ret z
  27eb  ld a,($4378)
  27ee  rlca
  27ef  xor $11
  27f1  ld ($4378),a
  27f4  ret
  ```
  </details>

### 0x27f5  TICK_OBJECT_TIMERS   _(conf M)_
- **Purpose:** Walk the object list (head 0x0872) decrementing each object's bit1 countdown timer; on expiry flip its bit1/bit0 state.
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x44
- **Outputs (written):** regs out [f,l,sp,a,e,h]; mem regions: NVRAM x4, VAR/STK(VRAM) x22
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 2505x; callers 0x26ab; callees 0x0066

  <details><summary>disasm (25 insn)</summary>

  ```
  27f5  ld hl,($0872)
  27f8  ld a,h
  27f9  or l
  27fa  ret z
  27fb  ld d,h
  27fc  ld e,l
  27fd  bit 1,(hl)
  27ff  jr z,$280a
  2801  inc hl
  2802  dec (hl)
  2803  dec hl
  2804  jr nz,$280a
  2806  res 1,(hl)
  2808  set 0,(hl)
  280a  dec hl
  280b  ld a,(hl)
  280c  dec hl
  280d  ld l,(hl)
  280e  ld h,a
  280f  cp d
  2810  jr nz,$27fd
  2812  ld a,l
  2813  cp e
  2814  jr nz,$27fd
  2816  ret
  ```
  </details>

### 0x2817  BLIT_SPRITE_TO_MAGICRAM   _(conf H)_
- **Purpose:** The sprite blitter: copy sprite rows into the magic-RAM window 0x6400-0x7E00 (row stride +0x1E/+0x1F/+0x20), walking forward or backward per the cocktail flip 0x4379. The 74181 ALU + shift in port 0x4B do the actual pixel merge.
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x11
- **Outputs (written):** regs out [sp,f,c,d,h,e]; mem regions: NVRAM x2, VAR/STK(VRAM) x10, MAGIC x3842
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 5461x; callers 0x25ca 0x25d4 0x264c 0x2662 0x26ab 0x272d; callees 0x0066 0x26ab
- **Notes:** Magic-window writes record the CPU byte, not the post-ALU VRAM (heavy-trace.md note #3).

  <details><summary>disasm (75 insn)</summary>

  ```
  2817  ld b,$00
  2819  ld a,(hl)
  281a  inc hl
  281b  dec a
  281c  jp z,$2853
  281f  ld a,($4379)
  2822  or a
  2823  ld a,(hl)
  2824  inc hl
  2825  jp nz,$283d
  2828  ld bc,$001e
  282b  ex de,hl
  282c  ex af,af'
  282d  ld a,(de)
  282e  inc de
  282f  ld (hl),a
  2830  inc hl
  2831  ld a,(de)
  2832  inc de
  2833  ld (hl),a
  2834  inc hl
  2835  ld (hl),b
  2836  ex af,af'
  2837  add hl,bc
  2838  dec a
  2839  jp nz,$282c
  283c  ret
  283d  ld bc,$ffe2
  2840  ex de,hl
  2841  ex af,af'
  2842  ld a,(de)
  2843  inc de
  2844  ld (hl),a
  2845  dec hl
  2846  ld a,(de)
  2847  inc de
  2848  ld (hl),a
  2849  dec hl
  284a  ld (hl),$00
  284c  ex af,af'
  284d  add hl,bc
  284e  dec a
  284f  jp nz,$2841
  2852  ret
  2853  ld a,($4379)
  2856  or a
  2857  ld a,(hl)
  2858  inc hl
  2859  jp nz,$286d
  285c  ld bc,$001f
  285f  ex de,hl
  2860  ex af,af'
  2861  ld a,(de)
  2862  inc de
  2863  ld (hl),a
  2864  inc hl
  2865  ld (hl),b
  2866  ex af,af'
  2867  add hl,bc
  2868  dec a
  2869  jp nz,$2860
  286c  ret
  286d  ld bc,$ffe1
  2870  ex de,hl
  2871  ex af,af'
  2872  ld a,(de)
  2873  inc de
  2874  ld (hl),a
  2875  dec hl
  2876  ld (hl),$00
  2878  ex af,af'
  2879  add hl,bc
  287a  dec a
  287b  jp nz,$2871
  287e  ret
  ```
  </details>

### 0x29a1  PIXEL_TO_MAGICRAM_PRESET   _(conf H)_
- **Purpose:** Set up a magic-RAM write for a single pixel/byte: program port 0x4B (ALU function 0x9x + shift = x&7), handle the cocktail flip (0x4379), and return HL = the 0x6400-based magic-window address. Enters with B=0x90.
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x1
- **Outputs (written):** regs out [b,sp,l,h,a,f]; mem regions: NVRAM x4; ports 4b<=[90,91,92,93,94,95,96,97]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 2225x; callers 0x1553 0x26ab; callees 0x0066

  <details><summary>disasm (33 insn)</summary>

  ```
  29a1  ld b,$90
  29a3  ld a,($4379)
  29a6  or a
  29a7  ld a,$07
  29a9  jr nz,$29c0
  29ab  and l
  29ac  or b
  29ad  out ($4b),a
  29af  srl h
  29b1  rr l
  29b3  srl h
  29b5  rr l
  29b7  srl h
  29b9  rr l
  29bb  ld bc,$6400
  29be  add hl,bc
  29bf  ret
  29c0  and l
  29c1  or b
  29c2  set 3,a
  29c4  out ($4b),a
  29c6  srl h
  29c8  rr l
  29ca  srl h
  29cc  rr l
  29ce  srl h
  29d0  rr l
  29d2  ld b,h
  29d3  ld c,l
  29d4  ld hl,$7fff
  29d7  or a
  29d8  sbc hl,bc
  29da  ret
  ```
  </details>

### 0x29a3  PIXEL_TO_MAGICRAM_ADDR   _(conf H)_
- **Purpose:** As 0x29A1 but with the ALU/control high-nibble passed in B; computes the magic-RAM window address for a glyph/sprite byte at pixel coords HL, flipping for cocktail mode.
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x25
- **Outputs (written):** regs out [sp,l,h,b,a,f]; mem regions: NVRAM x2, VAR/STK(VRAM) x12; ports 4b<=[00,10,14,90,91,92,93,94,95,96,97]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 3053x; callers 0x1a98 0x1e78 0x2540 0x25ca 0x25d4 0x25e4 0x264c 0x2662 0x26ab 0x272d 0x2a40; callees 0x0066 0x26ab
- **Notes:** Alternate entry point sharing the body of 0x29A1.

  <details><summary>disasm (32 insn)</summary>

  ```
  29a3  ld a,($4379)
  29a6  or a
  29a7  ld a,$07
  29a9  jr nz,$29c0
  29ab  and l
  29ac  or b
  29ad  out ($4b),a
  29af  srl h
  29b1  rr l
  29b3  srl h
  29b5  rr l
  29b7  srl h
  29b9  rr l
  29bb  ld bc,$6400
  29be  add hl,bc
  29bf  ret
  29c0  and l
  29c1  or b
  29c2  set 3,a
  29c4  out ($4b),a
  29c6  srl h
  29c8  rr l
  29ca  srl h
  29cc  rr l
  29ce  srl h
  29d0  rr l
  29d2  ld b,h
  29d3  ld c,l
  29d4  ld hl,$7fff
  29d7  or a
  29d8  sbc hl,bc
  29da  ret
  ```
  </details>

### 0x35e7  DRAW_WALL_GROUP_A   _(conf L)_
- **Purpose:** Draw a fixed group of wall/door segments via 0x3657 from an inline descriptor list (writes color rows 0x8780-0x87FF region).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x9
- **Outputs (written):** regs out [a,l,sp]; mem regions: VAR/STK(VRAM) x8, COLOR x80
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 2x; callers 0x369f; callees 0x0066 0x3657
- **Notes:** Uncertain which maze feature; descriptor-table driven.

  <details><summary>disasm (36 insn)</summary>

  ```
  35e7  call $3657
  35ea  add a,b
  35eb  ld b,$04
  35ed  ld a,(bc)
  35ee  xor d
  35ef  call $3657
  35f2  sub (hl)
  35f3  ld b,$04
  35f5  ld a,(bc)
  35f6  db $dd ; ix-prefixed $c9
  35f8  call $3657
  35fb  nop
  35fc  nop
  35fd  jr c,$361f
  35ff  rst $38
  3600  ret
  361f  nop
  3620  nop
  3621  ex af,af'
  3622  jr nz,$35df
  3624  call $3657
  3627  nop
  3628  ld bc,$2010
  362b  ld h,(hl)
  362c  call $3657
  362f  nop
  3630  inc bc
  3631  inc b
  3632  jr nz,$3633
  3633  rst $38
  3634  call $3657
  3637  add a,b
  3638  inc bc
  3639  inc e
  363a  jr nz,$35e6
  363c  ret
  ```
  </details>

### 0x3601  DRAW_WALL_GROUP_B   _(conf L)_
- **Purpose:** Draw a fixed wall-segment group via 0x3657 (color rows 0x86E0-0x875F).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x7
- **Outputs (written):** regs out [a,f,d,e,h,l]; mem regions: VAR/STK(VRAM) x6, COLOR x128
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 1x; callers 0x1a98; callees 0x0066 0x3657
- **Notes:** Uncertain which maze feature.

  <details><summary>disasm (7 insn)</summary>

  ```
  3601  call $3657
  3604  ret po
  3605  dec b
  3606  inc b
  3607  jr nz,$363c
  3609  ret
  363c  ret
  ```
  </details>

### 0x3719  DRAW_PLAYER_SPRITE   _(conf M)_
- **Purpose:** Update/redraw the player sprite into color RAM (0x8100 base) and the 0x0940 shadow buffer: bit3 erases the old image, bit4 computes the new color-RAM address from player coords (flip via 0x4379) and copies the 5x2 sprite cells.
- **Inputs (read):** regs in; mem regions: NVRAM x16, VAR/STK(VRAM) x8, COLOR x415
- **Outputs (written):** regs out [sp,f,a,e,d,b]; mem regions: NVRAM x16, VAR/STK(VRAM) x2, COLOR x415
- **Side-effects / entropy:** none observed
- **Call graph:** depth 3, invoked 2508x; callers 0x26ab; callees 0x0066

  <details><summary>disasm (73 insn)</summary>

  ```
  3719  bit 3,(hl)
  371b  jp z,$373c
  371e  res 3,(hl)
  3720  push hl
  3721  ld hl,($0940)
  3724  ld de,$0942
  3727  ld a,$05
  3729  ex af,af'
  372a  ld b,$02
  372c  ld a,(de)
  372d  inc de
  372e  ld (hl),a
  372f  inc hl
  3730  djnz $372c
  3732  ld bc,$001e
  3735  add hl,bc
  3736  ex af,af'
  3737  dec a
  3738  jp nz,$3729
  373b  pop hl
  373c  bit 4,(hl)
  373e  ret z
  373f  set 3,(hl)
  3741  push hl
  3742  ld de,$0007
  3745  add hl,de
  3746  ld e,(hl)
  3747  inc hl
  3748  inc hl
  3749  ld a,($4379)
  374c  or a
  374d  ld a,(hl)
  374e  jr z,$375a
  3750  neg
  3752  add a,$d0
  3754  ex af,af'
  3755  ld a,$f7
  3757  sub e
  3758  ld e,a
  3759  ex af,af'
  375a  srl a
  375c  srl a
  375e  ld h,a
  375f  ld l,e
  3760  srl h
  3762  rr l
  3764  srl h
  3766  rr l
  3768  srl h
  376a  rr l
  376c  ld bc,$8100
  376f  add hl,bc
  3770  ld ($0940),hl
  3773  ld a,($4378)
  3776  ld de,$001e
  3779  ld iy,$0942
  377b  ld b,d
  377c  add hl,bc
  377d  ld c,$05
  377f  ld b,$02
  3781  ex af,af'
  3782  ld a,(hl)
  3783  ld (iy+$00),a
  3786  inc iy
  3788  ex af,af'
  3789  ld (hl),a
  378a  inc hl
  378b  djnz $3781
  378d  add hl,de
  378e  dec c
  378f  jp nz,$377f
  3792  pop hl
  3793  ret
  ```
  </details>

### 0x1553  MOVE_AND_DRAW_BOLT   _(conf H)_
- **Purpose:** Move a bolt one step from its 4-bit direction nibble (dec/inc the slot X/Y at iy+2/iy+3), compute the magic-RAM byte address (0x29A1), draw the pixel (write 0x80), and sample the draw-collision flop (port 0x4E bit7).
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x12; ports 4e
- **Outputs (written):** regs out [sp,a,f,b,c,l]; mem regions: NVRAM x8, VAR/STK(VRAM) x10, MAGIC x557
- **Side-effects / entropy:** **reads port 0x4E**
- **Call graph:** depth 4, invoked 2250x; callers 0x151a 0x26ab; callees 0x0066 0x29a1
- **Notes:** Reads port 0x4E bit7 = collision flop (deterministic given the draw, NOT beam entropy; entropy-berzerk.md classifies 0x157A here as collision).

  <details><summary>disasm (19 insn)</summary>

  ```
  1553  rrca
  1554  jp nc,$155a
  1557  dec (iy+$02)
  155a  rrca
  155b  jp nc,$1561
  155e  inc (iy+$02)
  1561  rrca
  1562  jp nc,$1568
  1565  dec (iy+$03)
  1568  rrca
  1569  jp nc,$156f
  156c  inc (iy+$03)
  156f  ld h,(iy+$03)
  1572  ld l,(iy+$02)
  1575  call $29a1
  1578  ld (hl),$80
  157a  in a,($4e)
  157c  rlca
  157d  ret
  ```
  </details>

### 0x157e  CHECK_BOLT_BOUNDS   _(conf M)_
- **Purpose:** Test whether a bolt has reached the play-field limits: compare slot X against 0x03FF and Y against 0x0CD0 via the limit-compare helper 0x1597.
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x18
- **Outputs (written):** regs out [a,sp,b,f,d,e]; mem regions: NVRAM x8, VAR/STK(VRAM) x6
- **Side-effects / entropy:** none observed
- **Call graph:** depth 4, invoked 2251x; callers 0x151a 0x26ab; callees 0x0066 0x1597

  <details><summary>disasm (9 insn)</summary>

  ```
  157e  ld a,(iy+$02)
  1581  ld b,(iy+$00)
  1584  ld de,$03ff
  1587  call $1597
  158a  ld a,(iy+$03)
  158d  ld de,$0cd0
  1590  call $1597
  1593  ld (iy+$00),b
  1596  ret
  ```
  </details>

### 0x15a0  BOLT_HIT_SCAN   _(conf M)_
- **Purpose:** Scan the actor list (head 0x0876, link 0x0870) calling the bolt-vs-actor overlap test 0x15CB for each, to find a bolt/actor collision.
- **Inputs (read):** regs in; mem regions: NVRAM x10, VAR/STK(VRAM) x18
- **Outputs (written):** regs out [f,sp,a,b,c,d]; mem regions: NVRAM x6, VAR/STK(VRAM) x3
- **Side-effects / entropy:** none observed
- **Call graph:** depth 4, invoked 24x; callers 0x151a 0x26ab; callees 0x0066 0x15cb

  <details><summary>disasm (23 insn)</summary>

  ```
  15a0  ld (iy+$00),$00
  15a4  ld ix,($0876)
  15a6  halt
  15a7  ex af,af'
  15a8  call $15cb
  15ab  ld bc,($0870)
  15af  ld a,b
  15b0  or c
  15b1  jr z,$15ca
  15b3  push bc
  15b4  pop ix
  15b6  call $15cb
  15b9  ld h,(ix-$01)
  15bc  ld l,(ix-$02)
  15bf  push hl
  15c0  pop ix
  15c2  ld a,l
  15c3  cp c
  15c4  jr nz,$15b6
  15c6  ld a,h
  15c7  cp b
  15c8  jr nz,$15b6
  15ca  ret
  ```
  </details>

### 0x272d  DRAW_OBJECT   _(conf H)_
- **Purpose:** Render one actor sprite: if its draw-flag bit0 set, program the magic-RAM control and blit (0x2817); compute mirrored screen coords for cocktail (0x4379) via 0x29A3, blit, then read the collision flop (port 0x4E bit7) and set the actor hit flag on overlap.
- **Inputs (read):** regs in; mem regions: NVRAM x6, VAR/STK(VRAM) x105; ports 4e
- **Outputs (written):** regs out [sp,f,iy,a,e,d]; mem regions: NVRAM x6, VAR/STK(VRAM) x64; ports 4b<=[90,91,92,93,94,95,96,97]
- **Side-effects / entropy:** **reads port 0x4E**
- **Call graph:** depth 4, invoked 5016x; callers 0x26ab; callees 0x0066 0x2817 0x29a3
- **Notes:** Reads port 0x4E bit7 (collision, deterministic).

  <details><summary>disasm (73 insn)</summary>

  ```
  272d  ld ($0870),hl
  2730  push hl
  2731  pop iy
  2733  bit 0,(hl)
  2735  jp z,$274d
  2738  res 0,(hl)
  273a  inc hl
  273b  ld a,(hl)
  273c  out ($4b),a
  273e  inc hl
  273f  ld e,(hl)
  2740  inc hl
  2741  ld d,(hl)
  2742  inc hl
  2743  ld a,(hl)
  2744  inc hl
  2745  ld h,(hl)
  2746  ld l,a
  2747  call $2817
  274a  ld hl,($0870)
  274d  bit 1,(hl)
  274f  ret z
  2750  res 1,(hl)
  2752  ld de,$0007
  2755  add hl,de
  2756  ld e,(hl)
  2757  inc hl
  2758  inc hl
  2759  ld d,(hl)
  275a  inc hl
  275b  ld b,$90
  275d  ex de,hl
  275e  call $29a3
  2761  ld (iy+$01),a
  2764  ex de,hl
  2765  ld a,(hl)
  2766  inc hl
  2767  ld h,(hl)
  2768  ld l,a
  2769  ld a,(hl)
  276a  inc hl
  276b  ld l,(hl)
  276c  ld h,a
  276d  ld a,(hl)
  276e  bit 7,a
  2770  jr z,$278b
  2772  inc hl
  2773  and $7f
  2775  ld b,a
  2776  ld a,(hl)
  2777  inc hl
  2778  ld c,a
  2779  ex de,hl
  277a  ld a,($4379)
  277d  or a
  277e  jp z,$2786
  2781  sbc hl,bc
  2783  jp $278a
  2786  add hl,bc
  2787  jp $278a
  278a  ex de,hl
  278b  ld (iy+$04),l
  278e  ld (iy+$05),h
  2791  ld (iy+$02),e
  2794  ld (iy+$03),d
  2797  call $2817
  279a  ld hl,($0870)
  279d  in a,($4e)
  279f  bit 7,a
  27a1  ret z
  27a2  set 7,(hl)
  27a4  set 0,(iy-$06)
  27a8  ret
  ```
  </details>

### 0x151a  UPDATE_BOLT_SLOT   _(conf M)_
- **Purpose:** Per-slot bolt update: if slot active, advance its anim counter and call move+draw (0x1553), edge test (0x157E), and hit scan (0x15A0); expire on counter underflow.
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x24
- **Outputs (written):** regs out [sp,iy,b,c,f,a]; mem regions: NVRAM x8, VAR/STK(VRAM) x13
- **Side-effects / entropy:** none observed
- **Call graph:** depth 5, invoked 27511x; callers 0x14f3 0x1505 0x26ab; callees 0x0066 0x1553 0x157e 0x15a0

  <details><summary>disasm (24 insn)</summary>

  ```
  151a  ld a,(iy+$00)
  151d  or a
  151e  jr z,$152c
  1520  inc (iy+$01)
  1523  call $1553
  1526  call c,$15a0
  1529  call $157e
  152c  ld bc,$0004
  152f  add iy,bc
  1531  dec (iy+$01)
  1534  ret nz
  1535  inc (iy+$01)
  1538  xor a
  1539  or (iy-$03)
  153c  ret z
  153d  xor a
  153e  or (iy+$00)
  1541  jp z,$154a
  1544  call $1553
  1547  call $157e
  154a  dec (iy-$03)
  154d  ret nz
  154e  ld (iy+$00),$00
  1552  ret
  ```
  </details>

### 0x1505  UPDATE_BOLT_RANGE   _(conf M)_
- **Purpose:** Iterate B projectile-table slots (stride 8 from 0x437B) calling the per-slot updater 0x151a.
- **Inputs (read):** regs in; mem regions: NVRAM x6
- **Outputs (written):** regs out [sp,f,b,a,iy,e]; mem regions: NVRAM x10
- **Side-effects / entropy:** none observed
- **Call graph:** depth 6, invoked 5007x; callers 0x14f3 0x26ab; callees 0x0066 0x151a
- **Notes:** Shared tail of 0x14F3 (alternate entry point).

  <details><summary>disasm (12 insn)</summary>

  ```
  1505  ld iy,$437b
  1507  ld a,e
  1508  ld b,e
  1509  push bc
  150a  push iy
  150c  call $151a
  150f  pop iy
  1511  pop bc
  1512  ld de,$0008
  1515  add iy,de
  1517  djnz $1509
  1519  ret
  ```
  </details>

### 0x14f3  UPDATE_ALL_BOLTS   _(conf M)_
- **Purpose:** Top of the bolt/laser engine: tick the 2 player-bolt slots, then 7 robot-bolt slots (base 0x437A) of the projectile table 0x437B-0x43B2 via 0x1505/0x151a.
- **Inputs (read):** regs in; mem regions: NVRAM x6, VAR/STK(VRAM) x1
- **Outputs (written):** regs out [iy,sp,f,e,a,d]; mem regions: NVRAM x8
- **Side-effects / entropy:** none observed
- **Call graph:** depth 7, invoked 2507x; callers 0x26ab; callees 0x0066 0x1505 0x151a

  <details><summary>disasm (20 insn)</summary>

  ```
  14f3  ld b,$02
  14f5  call $1505
  14f8  ld a,($437a)
  14fb  add a,$02
  14fd  and $07
  14ff  ld b,a
  1500  call $1505
  1503  ld b,$07
  1505  ld iy,$437b
  1507  ld a,e
  1508  ld b,e
  1509  push bc
  150a  push iy
  150c  call $151a
  150f  pop iy
  1511  pop bc
  1512  ld de,$0008
  1515  add iy,de
  1517  djnz $1509
  1519  ret
  ```
  </details>

### 0x26ab  FRAME_IRQ_DISPATCHER   _(conf H)_
- **Purpose:** IM2 frame interrupt. Reads port 0x4E bit0 (V256): mid-frame IRQs advance the 2-byte interrupt-phase entropy counter 0x089F/0x08A0 (mixing port 0x49); the vblank IRQ runs a full game frame -- draw robots (0x272d), draw player (0x3719), move/draw bolts (0x14f3), tick object lists (0x27a9/0x27f5) -- then rearms IM2 (I=0x37) and re-enables IRQ (port 0x4F).
- **Inputs (read):** regs in; mem regions: NVRAM x69, VAR/STK(VRAM) x306, COLOR x415; ports 49 4e 65
- **Outputs (written):** regs out [sp,i,f,b,d,e]; mem regions: NVRAM x64, VAR/STK(VRAM) x143, MAGIC x660, COLOR x415; ports 4b<=[90,91,92,93,94,95,96,97]  4c<=[00,01,02,03,04,05,06,07,08,09,0a,0c,0e,10,11,12,13,14,15,16,17,18,1c,1e,1f,20,21,22,24,26,27,28,29,2a,2b,2d,2e,30,32,33,35,36,37,38,3a,3b,3c,3d,40,41,42,43,44,47,48,4c,4d,4e,4f,50,51,52,53,54,55,56,57,58,59,5a,5b,5d,5e,5f,60,61,62,63,64,65,66,67,68,69,6a,6c,6d,6e,6f,70,72,74,75,76,78,79,7a,7b,7c,7e,80,81,82,84,86,87,88,89,8a,8c,8d,8e,8f,90,91,92,93,94,95,96,97,99,9b,9c,9d,9f,a1,a2,a3,a5,a7,a8,a9,ab,ad,ae,af,b0,b1,b3,b4,b6,bc,d1,ee,ef,fc,fe]  4f<=[01]
- **Side-effects / entropy:** **reads port 0x4E; touches entropy var 0x089F(rw), 0x08A0(rw)**
- **Call graph:** depth 8, invoked 5020x (ISR); callers 0x188b 0x18e0 0x1908 0x197b 0x1997 0x1a45 0x1a4e 0x1c6e 0x1ce7 0x1e59 0x1e6d 0x1e78 0x2341 0x2436 0x24f7 0x25ca 0x25e4 0x25eb 0x264c 0x2662 0x2678 0x26ab 0x2817 0x287f 0x29a3 0x29db 0x2a40 0x2b39 0x2b3d 0x2b54 0x35af 0x364e 0x369f; callees 0x0066 0x14f3 0x1505 0x151a 0x1553 0x157e 0x1597 0x15a0 0x15cb 0x1776 0x1d12 0x272d 0x27a9 0x27f5 0x2817 0x29a1 0x29a3 0x3719
- **Notes:** THE load-bearing entropy read (port 0x4E @0x26B4); see entropy-berzerk.md sec3.

  <details><summary>disasm (77 insn)</summary>

  ```
  26ab  di
  26ac  ld ($0874),sp
  26b0  ld sp,$0840
  26b3  push af
  26b4  in a,($4e)
  26b6  rra
  26b7  jr c,$26d9
  26b9  push hl
  26ba  push bc
  26bb  ld hl,$089f
  26be  ld a,(hl)
  26bf  inc hl
  26c0  ld b,(hl)
  26c1  xor b
  26c2  ld c,a
  26c3  in a,($49)
  26c5  cpl
  26c6  ld (hl),a
  26c7  dec hl
  26c8  ld (hl),b
  26c9  and c
  26ca  and $e0
  26cc  dec hl
  26cd  add a,a
  26ce  jr nc,$26d3
  26d0  inc (hl)
  26d1  jr $26cc
  26d3  jr nz,$26cc
  26d5  pop bc
  26d6  pop hl
  26d7  jr $271c
  26d9  push iy
  26db  push ix
  26dd  push hl
  26de  push de
  26df  push bc
  26e0  ex af,af'
  26e1  push af
  26e2  ld hl,($0870)
  26e5  push hl
  26e6  ld hl,($0876)
  26e9  call $272d
  26ec  call $3719
  26ef  pop hl
  26f0  push hl
  26f1  call $272d
  26f4  call $14f3
  26f7  ld hl,($0876)
  26fa  call $27a9
  26fd  pop hl
  26fe  call $27a9
  2701  ld hl,($0870)
  2704  ld a,h
  2705  or l
  2706  jr z,$2710
  2708  dec hl
  2709  ld d,(hl)
  270a  dec hl
  270b  ld e,(hl)
  270c  ld ($0870),de
  2710  call $27f5
  2713  pop af
  2714  ex af,af'
  2715  pop bc
  2716  pop de
  2717  pop hl
  2718  pop ix
  271a  pop iy
  271c  ld a,$01
  271e  out ($4f),a
  2720  ld a,$37
  2722  ld i,a
  2724  im 2
  2726  pop af
  2727  ld sp,($0874)
  272b  ei
  272c  ret
  ```
  </details>

### 0x18e0  READ_BCD_PAIR   _(conf M)_
- **Purpose:** Read a packed BCD digit pair from the score/counter words 0x08A4/0x08A5 and merge the selected nibbles into A.
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x14
- **Outputs (written):** regs out [sp,f,c,a,b,d]; mem regions: VAR/STK(VRAM) x12
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 70314x; callers 0x188b 0x18cd 0x197b 0x1997 0x1a98; callees 0x0066 0x26ab

  <details><summary>disasm (11 insn)</summary>

  ```
  18e0  ld a,($08a5)
  18e3  rrca
  18e4  rrca
  18e5  rrca
  18e6  rrca
  18e7  and $0f
  18e9  ld c,a
  18ea  ld a,($08a4)
  18ed  and $f0
  18ef  or c
  18f0  ret
  ```
  </details>

### 0x1908  STEP_SCORE_DIGIT   _(conf L)_
- **Purpose:** Advance/draw one score or demo counter digit: decrement a count, index a digit table (0x195B), BCD-add with daa and saturate at 0x99, then draw via 0x18F7.
- **Inputs (read):** regs in; mem regions: NVRAM x3, VAR/STK(VRAM) x4
- **Outputs (written):** regs out [sp,f]; mem regions: VAR/STK(VRAM) x8
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 70345x; callers 0x188b 0x197b; callees 0x0066 0x26ab
- **Notes:** Uncertain: also performs an in a,(c) read (variable port) in the demo path; exact role of 0x089C-0x089E vs 0x08A4 not fully pinned.

  <details><summary>disasm (56 insn)</summary>

  ```
  1908  ld a,(hl)
  1909  or a
  190a  ret z
  190b  push bc
  190c  push hl
  190d  dec (hl)
  190e  ld a,b
  190f  dec a
  1910  add a,a
  1911  add a,a
  1912  add a,a
  1913  ld e,a
  1914  ld d,$00
  1916  ld hl,$08a6
  1919  add hl,de
  191a  ld b,$08
  191c  call $2db3
  191f  pop hl
  1920  push hl
  1921  ld de,$0005
  1924  add hl,de
  1925  ld a,(hl)
  1926  ld d,a
  1927  inc a
  1928  and $03
  192a  ld (hl),a
  192b  in a,(c)
  192d  and $0f
  192f  rr d
  1931  rla
  1932  ld c,a
  1933  ld b,$00
  1935  ld hl,$195b
  1938  add hl,bc
  1939  ld a,(hl)
  193a  bit 0,d
  193c  jr z,$1942
  193e  rlca
  193f  rlca
  1940  rlca
  1941  rlca
  1942  and $0f
  1944  add a,$00
  1946  daa
  1947  ld d,a
  1948  call $18e0
  194b  cp $99
  194d  jr z,$1958
  194f  add a,d
  1950  daa
  1951  jr nc,$1955
  1953  ld a,$99
  1955  call $18f7
  1958  pop hl
  1959  pop bc
  195a  ret
  ```
  </details>

### 0x1a45  FILL_ROW_FF   _(conf M)_
- **Purpose:** Fill 0x40 consecutive bytes from HL with 0xFF (draw a solid wall/border row in VRAM).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x2
- **Outputs (written):** regs out [l,sp,a,b]; mem regions: VAR/STK(VRAM) x2, VRAM-bitmap x128
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 4x; callers (root/ISR); callees 0x0066 0x26ab
- **Notes:** Shared tail of 0x19AC.

  <details><summary>disasm (6 insn)</summary>

  ```
  1a45  ld a,$ff
  1a47  ld b,$40
  1a49  ld (hl),a
  1a4a  inc hl
  1a4b  djnz $1a49
  1a4d  ret
  ```
  </details>

### 0x1a4e  CLEAR_SCREEN_SET_FLIP   _(conf H)_
- **Purpose:** Clear color RAM 0x8100-0x87FF and blank VRAM (push 0x000 words through the magic window from SP=0x6000), then read the cabinet DIP (port 0x4A bit7) and player state (0x4344) to set the cocktail screen-flip flag 0x4379 (0 or 8).
- **Inputs (read):** regs in; mem regions: (none non-ROM)
- **Outputs (written):** regs out [f,h,l,sp,a]; mem regions: VAR/STK(VRAM) x6, COLOR x1792
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 3x; callers 0x19ac 0x209d; callees 0x0066 0x26ab

  <details><summary>disasm (44 insn)</summary>

  ```
  1a4e  ld hl,$8100
  1a51  ld bc,$0700
  1a54  xor a
  1a55  ld (hl),a
  1a56  inc hl
  1a57  dec c
  1a58  jr nz,$1a55
  1a5a  djnz $1a55
  1a5c  di
  1a5d  ld ($4300),sp
  1a61  ld sp,$6000
  1a64  ld b,$e0
  1a66  ld de,$0000
  1a69  push de
  1a6a  push de
  1a6b  push de
  1a6c  push de
  1a6d  push de
  1a6e  push de
  1a6f  push de
  1a70  push de
  1a71  push de
  1a72  push de
  1a73  push de
  1a74  push de
  1a75  push de
  1a76  push de
  1a77  push de
  1a78  push de
  1a79  djnz $1a69
  1a7b  ld sp,($4300)
  1a7f  ei
  1a80  in a,($4a)
  1a82  bit 7,a
  1a84  jr nz,$1a93
  1a86  ld a,($4344)
  1a89  cp $02
  1a8b  jr nz,$1a93
  1a8d  ld a,$08
  1a8f  ld ($4379),a
  1a92  ret
  1a93  xor a
  1a94  ld ($4379),a
  1a97  ret
  ```
  </details>

### 0x1ce7  COORD_TO_MAZECELL   _(conf M)_
- **Purpose:** Map a pixel coordinate (H,L) to a maze-cell attribute byte: quantize X/Y into cell indices and read the cell table based at 0x435E.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x46
- **Outputs (written):** regs out [sp,a,f,e,c,b]; mem regions: VAR/STK(VRAM) x42
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 54050x; callers 0x1c6e 0x2436; callees 0x0066 0x26ab

  <details><summary>disasm (28 insn)</summary>

  ```
  1ce7  ld a,l
  1ce8  ld e,$00
  1cea  cp $46
  1cec  jr c,$1cf6
  1cee  ld e,$05
  1cf0  cp $8a
  1cf2  jr c,$1cf6
  1cf4  ld e,$0a
  1cf6  ld a,h
  1cf7  ld b,$05
  1cf9  ld c,$3a
  1cfb  ld d,$30
  1cfd  cp c
  1cfe  jr c,$1d08
  1d00  inc e
  1d01  ex af,af'
  1d02  ld a,c
  1d03  add a,d
  1d04  ld c,a
  1d05  ex af,af'
  1d06  djnz $1cfd
  1d08  ex de,hl
  1d09  ld bc,$435e
  1d0c  ld h,$00
  1d0e  add hl,bc
  1d0f  ld a,(hl)
  1d10  ex de,hl
  1d11  ret
  ```
  </details>

### 0x2341  ADD_AND_DRAW_SCORE   _(conf L)_
- **Purpose:** BCD-add a points value into a score field and redraw it, with a language/credit read (port 0x61) and bonus-life handling; tails into the maze status redraw.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x19; ports 61
- **Outputs (written):** regs out [f,b,c,sp,a,l]; mem regions: VAR/STK(VRAM) x19
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 17x; callers 0x1e78; callees 0x0066 0x2334 0x26ab
- **Notes:** Uncertain; my CFG walk over-runs into 0x259A (status redraw) -- the routine proper ends near 0x23A0.

  <details><summary>disasm (83 insn)</summary>

  ```
  2341  ld a,$ff
  2343  ld ($436d),a
  2346  ld e,$04
  2348  call $2334
  234b  inc hl
  234c  inc hl
  234d  inc hl
  234e  srl b
  2350  ex af,af'
  2351  inc b
  2352  dec hl
  2353  dec e
  2354  djnz $2352
  2356  ex af,af'
  2357  jr nc,$2361
  2359  sla c
  235b  sla c
  235d  sla c
  235f  sla c
  2361  ld a,c
  2362  add a,(hl)
  2363  daa
  2364  ld (hl),a
  2365  jr nc,$236f
  2367  dec hl
  2368  dec e
  2369  jr z,$236f
  236b  ld c,$01
  236d  jr $2361
  236f  call $2334
  2372  ld b,h
  2373  ld c,l
  2374  ld hl,$434f
  2377  ld de,$4349
  237a  in a,($61)
  237c  bit 7,a
  237e  jr z,$2391
  2380  ld a,(bc)
  2381  or a
  2382  jr z,$2391
  2384  bit 1,(hl)
  2386  ret nz
  2387  set 1,(hl)
  2389  ex de,hl
  238a  inc (hl)
  238b  call $3538
  238e  jp $259a
  2391  in a,($61)
  2393  bit 6,a
  2395  ret z
  2396  inc bc
  2397  ld a,(bc)
  2398  cp $50
  239a  ret c
  239b  bit 0,(hl)
  239d  ret nz
  239e  set 0,(hl)
  23a0  jr $2389
  259a  ld a,($4344)
  259d  cp $02
  259f  ld hl,$d538
  25a2  jr nz,$25a6
  25a4  ld l,$e8
  25a6  ld b,$00
  25a8  call $29a3
  25ab  ex de,hl
  25ac  ex af,af'
  25ad  ld a,($4349)
  25b0  ld b,a
  25b1  ex af,af'
  25b2  dec b
  25b3  jr z,$25bf
  25b5  push bc
  25b6  ld c,$80
  25b8  call $29db
  25bb  inc de
  25bc  pop bc
  25bd  djnz $25b5
  25bf  ld a,($436e)
  25c2  or a
  25c3  call nz,$18cd
  25c6  call $2314
  25c9  ret
  ```
  </details>

### 0x24f7  REMOVE_ACTOR_FROM_LIST   _(conf M)_
- **Purpose:** Unlink an actor (at IX) from the 0x0872 doubly-linked actor list by finding its predecessor and splicing the back-link, under DI.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x46
- **Outputs (written):** regs out [a,b,c,d,e,h]; mem regions: NVRAM x2, VAR/STK(VRAM) x26
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 12x; callers 0x1e78; callees 0x0066 0x26ab

  <details><summary>disasm (25 insn)</summary>

  ```
  24f7  push ix
  24f9  pop bc
  24fa  ld d,b
  24fb  ld e,c
  24fc  ex de,hl
  24fd  dec hl
  24fe  ld d,(hl)
  24ff  dec hl
  2500  ld e,(hl)
  2501  ld a,b
  2502  cp d
  2503  jr nz,$24fc
  2505  ld a,c
  2506  cp e
  2507  jr nz,$24fc
  2509  di
  250a  ld a,(ix-$02)
  250d  ld (hl),a
  250e  inc hl
  250f  ld a,(ix-$01)
  2512  ld (hl),a
  2513  inc hl
  2514  ld ($0870),hl
  2517  ei
  2518  ret
  ```
  </details>

### 0x25e4  MAGICADDR_PRESET_10   _(conf L)_
- **Purpose:** Thin wrapper: preset magic-RAM control nibble B=0x10 and compute the window address (0x29A3), returning it in DE.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x13
- **Outputs (written):** regs out [b,d,e,h,l,sp]; mem regions: VAR/STK(VRAM) x12; ports 4b<=[10,14]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 569x; callers 0x25ca 0x25d4 0x264c 0x2662; callees 0x0066 0x26ab 0x29a3

  <details><summary>disasm (4 insn)</summary>

  ```
  25e4  ld b,$10
  25e6  call $29a3
  25e9  ex de,hl
  25ea  ret
  ```
  </details>

### 0x2678  RANDOM   _(conf H)_
- **Purpose:** LCG pseudo-random generator: seed = 0x435C; seed = 7*seed + 0x3153; store back; return A = high byte. Deterministic in its seed (which is entropy-derived at game start).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x48
- **Outputs (written):** regs out [a,sp,f,d,e]; mem regions: VAR/STK(VRAM) x34
- **Side-effects / entropy:** **touches entropy var 0x435C(rw); is RANDOM itself**
- **Call graph:** depth 9, invoked 115x; callers 0x1e59 0x25eb; callees 0x0066 0x26ab
- **Notes:** ENTROPY: reads/writes seed 0x435C; the 13-consumer RNG (entropy-berzerk.md sec7).

  <details><summary>disasm (14 insn)</summary>

  ```
  2678  push hl
  2679  ld hl,($435c)
  267c  ld d,h
  267d  ld e,l
  267e  add hl,hl
  267f  add hl,de
  2680  add hl,hl
  2681  add hl,de
  2682  ld de,$3153
  2685  add hl,de
  2686  ld ($435c),hl
  2689  ld a,h
  268a  pop hl
  268b  ret
  ```
  </details>

### 0x287f  SPAWN_ROBOT_SHOT   _(conf L)_
- **Purpose:** When a robot fires: bounds-check the target delta, choose a firing direction, allocate a shot actor (0x34E7 + coroutine 0x1E6D), and seed its sprite/move data from the 0x434B/0x434D robot params.
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x64
- **Outputs (written):** regs out [l,sp,a,h,f,d]; mem regions: VAR/STK(VRAM) x89
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 10822x; callers 0x1e6d 0x1e78; callees 0x0066 0x1e6d 0x26ab 0x34e7
- **Notes:** Uncertain; coroutine-spawning.

  <details><summary>disasm (128 insn)</summary>

  ```
  287f  ld hl,($0872)
  2882  inc hl
  2883  ld a,(hl)
  2884  or a
  2885  ret nz
  2886  push bc
  2887  push de
  2888  ld de,$0008
  288b  ld hl,$438f
  288e  ld a,($434b)
  2891  or a
  2892  jr z,$289c
  2894  ld b,a
  2895  ld a,(hl)
  2896  or a
  2897  jr z,$289f
  2899  add hl,de
  289a  djnz $2895
  289c  pop de
  289d  pop bc
  289e  ret
  289f  pop de
  28a0  pop bc
  28a1  dec hl
  28a2  dec hl
  28a3  dec hl
  28a4  dec hl
  28a5  ld a,d
  28a6  cp $fe
  28a8  jp nc,$28d8
  28ab  cp $06
  28ad  jr c,$28d8
  28af  ld a,e
  28b0  cp $fc
  28b2  jr nc,$28d2
  28b4  cp $07
  28b6  jr c,$28d2
  28b8  ld a,d
  28b9  bit 0,c
  28bb  jr z,$28c0
  28bd  neg
  28bf  ld d,a
  28c0  ld a,e
  28c1  bit 2,c
  28c3  jr z,$28c8
  28c5  neg
  28c7  ld e,a
  28c8  sub d
  28c9  cp $f6
  28cb  jr nc,$28de
  28cd  cp $06
  28cf  ret nc
  28d0  jr $28de
  28d2  ld a,c
  28d3  and $03
  28d5  ld c,a
  28d6  jr $28de
  28d8  ld a,c
  28d9  and $0c
  28db  ld c,a
  28dc  jr $28de
  28de  ld b,$00
  28e0  push hl
  28e1  call $34e7
  28e4  ld hl,$2042
  28e7  add hl,bc
  28e8  ld c,(hl)
  28e9  ld hl,$2944
  28ec  add hl,bc
  28ed  add hl,bc
  28ee  add hl,bc
  28ef  ld (ix+$06),b
  28f2  ld (ix+$08),b
  28f5  ld a,(hl)
  28f6  inc hl
  28f7  di
  28f8  ld (ix+$0a),a
  28fb  ld a,(hl)
  28fc  ld (ix+$0b),a
  28ff  ei
  2900  inc hl
  2901  ld (ix+$0c),$01
  2905  ld b,(hl)
  2906  inc hl
  2907  ld c,(hl)
  2908  inc hl
  2909  ld d,(hl)
  290a  ld a,(ix+$07)
  290d  add a,b
  290e  ld b,a
  290f  ld a,(ix+$09)
  2912  add a,c
  2913  ld c,a
  2914  pop hl
  2915  di
  2916  ld (hl),d
  2917  inc hl
  2918  ld (hl),$00
  291a  inc hl
  291b  ld (hl),b
  291c  inc hl
  291d  ld (hl),c
  291e  inc hl
  291f  ld (hl),d
  2920  inc hl
  2921  ld (hl),$05
  2923  inc hl
  2924  ld (hl),b
  2925  inc hl
  2926  ld (hl),c
  2927  ei
  2928  push ix
  292a  ld a,$0a
  292c  call $1e6d
  292f  pop ix
  2931  ld hl,($0872)
  2934  inc hl
  2935  ld a,($434d)
  2938  ld (hl),a
  2939  dec hl
  293a  set 1,(hl)
  293c  pop hl
  293d  inc hl
  293e  inc hl
  293f  pop af
  2940  pop bc
  2941  ld c,$10
  2943  jp (hl)
  ```
  </details>

### 0x29db  DRAW_CHARS_MAGICRAM   _(conf M)_
- **Purpose:** Render a run of glyph/character bytes into the magic-RAM window: per-character set port 0x4B control (0x90/0x94) and emit the masked byte, stepping by 0x1F rows, direction from 0x4379.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x41
- **Outputs (written):** regs out [sp,c,b,f]; mem regions: VAR/STK(VRAM) x38, MAGIC x543; ports 4b<=[00,90,94]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 203x; callers 0x1a98 0x1e78 0x2a40 0x2a4a; callees 0x0066 0x26ab

  <details><summary>disasm (69 insn)</summary>

  ```
  29db  push hl
  29dc  ld hl,$0000
  29df  ld b,$00
  29e1  add hl,bc
  29e2  add hl,hl
  29e3  add hl,hl
  29e4  add hl,hl
  29e5  add hl,bc
  29e6  ld bc,$2f1e
  29e9  add hl,bc
  29ea  push de
  29eb  push af
  29ec  ex de,hl
  29ed  ld a,($4379)
  29f0  or a
  29f1  ld a,(de)
  29f2  jr nz,$2a1a
  29f4  or a
  29f5  jp p,$29fc
  29f8  ld bc,$0060
  29fb  add hl,bc
  29fc  ld a,$09
  29fe  ld bc,$001f
  2a01  ex af,af'
  2a02  pop af
  2a03  push af
  2a04  di
  2a05  out ($4b),a
  2a07  ld a,(de)
  2a08  and $7f
  2a0a  inc de
  2a0b  ld (hl),a
  2a0c  inc hl
  2a0d  ld (hl),$00
  2a0f  ei
  2a10  add hl,bc
  2a11  ex af,af'
  2a12  dec a
  2a13  jp nz,$2a01
  2a16  pop af
  2a17  pop de
  2a18  pop hl
  2a19  ret
  2a1a  or a
  2a1b  jp p,$2a22
  2a1e  ld bc,$ffa0
  2a21  add hl,bc
  2a22  ld a,$09
  2a24  ld bc,$ffe1
  2a27  ex af,af'
  2a28  pop af
  2a29  push af
  2a2a  di
  2a2b  out ($4b),a
  2a2d  ld a,(de)
  2a2e  and $7f
  2a30  inc de
  2a31  ld (hl),a
  2a32  dec hl
  2a33  ld (hl),$00
  2a35  ei
  2a36  add hl,bc
  2a37  ex af,af'
  2a38  dec a
  2a39  jp nz,$2a27
  2a3c  pop af
  2a3d  pop de
  2a3e  pop hl
  2a3f  ret
  ```
  </details>

### 0x2b39  SET_ANIM_FRAME_MASKED   _(conf M)_
- **Purpose:** Set an actor's animation frame: mask the frame index, and if it changed, look up the frame's sprite-data pointer (tables 0x2042/0x2519) into the actor (ix+6/ix+8).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x4
- **Outputs (written):** regs out [f,sp,c,e,h,l]; mem regions: VAR/STK(VRAM) x6
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 134x; callers 0x1e6d 0x1e78; callees 0x0066 0x26ab

  <details><summary>disasm (17 insn)</summary>

  ```
  2b39  and $0f
  2b3b  cp c
  2b3c  ret z
  2b3d  ld c,a
  2b3e  ld b,$00
  2b40  ld d,b
  2b41  ld hl,$2042
  2b44  add hl,bc
  2b45  ld e,(hl)
  2b46  ld hl,$2519
  2b49  add hl,de
  2b4a  ld a,(hl)
  2b4b  inc hl
  2b4c  ld (ix+$06),a
  2b4f  ld a,(hl)
  2b50  ld (ix+$08),a
  2b53  ret
  ```
  </details>

### 0x2b3d  SET_ANIM_FRAME   _(conf M)_
- **Purpose:** Look up a frame index in the sprite tables 0x2042->0x2519 and store the sprite-data pointer into the actor (ix+6/ix+8).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x36
- **Outputs (written):** regs out [f,h,l,sp,d,e]; mem regions: VAR/STK(VRAM) x24
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 92x; callers 0x1f91 0x1f94 0x2436; callees 0x0066 0x26ab
- **Notes:** Alternate entry into 0x2B39 (no mask/compare).

  <details><summary>disasm (14 insn)</summary>

  ```
  2b3d  ld c,a
  2b3e  ld b,$00
  2b40  ld d,b
  2b41  ld hl,$2042
  2b44  add hl,bc
  2b45  ld e,(hl)
  2b46  ld hl,$2519
  2b49  add hl,de
  2b4a  ld a,(hl)
  2b4b  inc hl
  2b4c  ld (ix+$06),a
  2b4f  ld a,(hl)
  2b50  ld (ix+$08),a
  2b53  ret
  ```
  </details>

### 0x2b54  SPAWN_TYPED_ACTOR   _(conf L)_
- **Purpose:** Create a type-0x82 actor at the 0x0872 list head, set its parameter byte, run it (0x1E78), and return its bit7 status.
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x8
- **Outputs (written):** regs out [f,h,l,iy,sp,a]; mem regions: NVRAM x4, VAR/STK(VRAM) x14
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 133x; callers 0x1e78; callees 0x0066 0x1e78 0x26ab
- **Notes:** Uncertain.

  <details><summary>disasm (13 insn)</summary>

  ```
  2b54  ld hl,($0872)
  2b57  ld (hl),$82
  2b59  inc hl
  2b5a  ld (hl),a
  2b5b  push ix
  2b5d  push hl
  2b5e  push bc
  2b5f  call $1e78
  2b62  pop bc
  2b63  pop hl
  2b64  pop ix
  2b66  bit 7,(ix+$00)
  2b6a  ret
  ```
  </details>

### 0x35af  DRAW_MAZE_WALLS   _(conf M)_
- **Purpose:** Clear color RAM then draw the maze wall layout by feeding wall-segment descriptor tables (inlined after each call) to the segment drawer 0x3657; sets flip 0x4379=0.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x7
- **Outputs (written):** regs out [a,f,e,l,sp]; mem regions: VAR/STK(VRAM) x7, COLOR x1792
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 2x; callers (root/ISR); callees 0x0066 0x26ab 0x3657

  <details><summary>disasm (125 insn)</summary>

  ```
  35af  xor a
  35b0  ld ($4379),a
  35b3  ld a,$1e
  35b5  nop
  35b6  nop
  35b7  call $3657
  35ba  nop
  35bb  nop
  35bc  dec b
  35bd  jr nz,$3569
  35bf  call $3657
  35c2  and b
  35c3  nop
  35c4  add hl,hl
  35c5  jr nz,$35d8
  35c7  call $3657
  35ca  and b
  35cb  nop
  35cc  add hl,hl
  35cd  add hl,bc
  35ce  sbc a,c
  35cf  call $3657
  35d2  xor c
  35d3  nop
  35d4  add hl,hl
  35d5  ex af,af'
  35d6  cp e
  35d7  call $3657
  35d8  ld d,a
  35d9  ld (hl),$b0
  35da  or b
  35db  nop
  35dc  add hl,hl
  35dd  djnz $3634
  35df  call $3657
  35e2  ret nz
  35e3  dec b
  35e4  ld a,(bc)
  35e5  jr nz,$365e
  35e6  ld (hl),a
  35e7  call $3657
  35ea  add a,b
  35eb  ld b,$04
  35ed  ld a,(bc)
  35ee  xor d
  35ef  call $3657
  35f2  sub (hl)
  35f3  ld b,$04
  35f5  ld a,(bc)
  35f6  db $dd ; ix-prefixed $c9
  35f8  call $3657
  35fb  nop
  35fc  nop
  35fd  jr c,$361f
  35ff  rst $38
  3600  ret
  361f  nop
  3620  nop
  3621  ex af,af'
  3622  jr nz,$35df
  3624  call $3657
  3627  nop
  3628  ld bc,$2010
  362b  ld h,(hl)
  362c  call $3657
  362f  nop
  3630  inc bc
  3631  inc b
  3632  jr nz,$3633
  3633  rst $38
  3634  call $3657
  3637  add a,b
  3638  inc bc
  3639  inc e
  363a  jr nz,$35e6
  363c  ret
  365e  ld a,c
  365f  ld b,e
  3660  or a
  3661  jr nz,$3669
  3663  ld hl,$8100
  3666  add hl,de
  3667  jr $366e
  3669  ld hl,$87ff
  366c  sbc hl,de
  366e  ex de,hl
  366f  pop hl
  3670  ld c,(hl)
  3671  inc hl
  3672  ex af,af'
  3673  ld a,(hl)
  3674  inc hl
  3675  ex af,af'
  3676  or a
  3677  ld a,(hl)
  3678  inc hl
  3679  push hl
  367a  ex de,hl
  367b  jr nz,$368e
  367d  ld de,$0020
  3680  ex af,af'
  3681  ld b,a
  3682  ex af,af'
  3683  push hl
  3684  ld (hl),a
  3685  inc hl
  3686  djnz $3684
  3688  pop hl
  3689  add hl,de
  368a  dec c
  368b  jr nz,$3680
  368d  ret
  368e  ld de,$ffe0
  3691  ex af,af'
  3692  ld b,a
  3693  ex af,af'
  3694  push hl
  3695  ld (hl),a
  3696  dec hl
  3697  djnz $3695
  3699  pop hl
  369a  add hl,de
  369b  dec c
  369c  jr nz,$3691
  369e  ret
  ```
  </details>

### 0x364e  CLEAR_MAZE_COLOR   _(conf L)_
- **Purpose:** Fill the maze color area 0x8100-0x877F via the 0x3657 segment filler (clears prior maze coloring).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x7
- **Outputs (written):** regs out [a,f,b,c,d,e]; mem regions: VAR/STK(VRAM) x6, COLOR x1664
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 1x; callers 0x22eb; callees 0x0066 0x26ab 0x3657
- **Notes:** Uncertain exact extent semantics.

  <details><summary>disasm (18 insn)</summary>

  ```
  364e  call $3657
  3651  nop
  3652  nop
  3653  inc (hl)
  3654  jr nz,$369a
  3656  ret
  3691  ex af,af'
  3692  ld b,a
  3693  ex af,af'
  3694  push hl
  3695  ld (hl),a
  3696  dec hl
  3697  djnz $3695
  3699  pop hl
  369a  add hl,de
  369b  dec c
  369c  jr nz,$3691
  369e  ret
  ```
  </details>

### 0x369f  RENDER_MAZE_LEVEL   _(conf M)_
- **Purpose:** Build and color the maze for the level: pick robot count/speed/type from a difficulty table (writes 0x434B/0x437A/0x434D), expand the maze bitmap from buffer 0x4400/0x4600 into color RAM (0x8100/0x8180), and draw walls via 0x35E7/0x3657.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x12, VRAM-bitmap x1664
- **Outputs (written):** regs out [a,f,c,d,e,h]; mem regions: VAR/STK(VRAM) x11, COLOR x1792
- **Side-effects / entropy:** none observed
- **Call graph:** depth 9, invoked 2x; callers 0x2540; callees 0x0066 0x2334 0x26ab 0x35e7 0x3657

  <details><summary>disasm (149 insn)</summary>

  ```
  369f  call $3657
  36a2  add a,b
  36a3  ld b,$04
  36a5  jr nz,$371e
  36a7  call $35e7
  36aa  call $2334
  36ad  ex de,hl
  36ae  ld bc,$0005
  36b1  inc de
  36b2  ld a,(de)
  36b3  ex af,af'
  36b4  dec de
  36b5  ld a,(de)
  36b6  or a
  36b7  ld hl,$3794
  36ba  jr z,$36cb
  36bc  and $0f
  36be  ld h,a
  36bf  ex af,af'
  36c0  and $f0
  36c2  or h
  36c3  rlca
  36c4  rlca
  36c5  rlca
  36c6  rlca
  36c7  ld hl,$37bc
  36ca  ex af,af'
  36cb  ex af,af'
  36cc  cp (hl)
  36cd  jr c,$36d5
  36cf  ex af,af'
  36d0  add hl,bc
  36d1  ld a,(hl)
  36d2  or a
  36d3  jr nz,$36cb
  36d5  inc hl
  36d6  ld a,(hl)
  36d7  inc hl
  36d8  ld ($434b),a
  36db  ld a,(hl)
  36dc  inc hl
  36dd  ld ($437a),a
  36e0  ld a,(hl)
  36e1  inc hl
  36e2  ld ($434d),a
  36e5  ld c,(hl)
  36e6  ld a,($4379)
  36e9  or a
  36ea  ld ix,$8100
  36ec  nop
  36ed  add a,c
  36ee  ld hl,$4400
  36f1  jr z,$36fa
  36f3  ld ix,$8180
  36f5  add a,b
  36f6  add a,c
  36f7  ld hl,$4600
  36fa  ld a,$34
  36fc  ex af,af'
  36fd  ld b,$20
  36ff  ld a,(hl)
  3700  inc hl
  3701  ld e,a
  3702  and $44
  3704  ld d,a
  3705  ld a,e
  3706  cpl
  3707  and c
  3708  or d
  3709  ld (ix+$00),a
  370c  inc ix
  370e  djnz $36ff
  3710  ld de,$0060
  3713  add hl,de
  3714  ex af,af'
  3715  dec a
  3716  jr nz,$36fc
  3718  ret
  371e  res 3,(hl)
  3720  push hl
  3721  ld hl,($0940)
  3724  ld de,$0942
  3727  ld a,$05
  3729  ex af,af'
  372a  ld b,$02
  372c  ld a,(de)
  372d  inc de
  372e  ld (hl),a
  372f  inc hl
  3730  djnz $372c
  3732  ld bc,$001e
  3735  add hl,bc
  3736  ex af,af'
  3737  dec a
  3738  jp nz,$3729
  373b  pop hl
  373c  bit 4,(hl)
  373e  ret z
  373f  set 3,(hl)
  3741  push hl
  3742  ld de,$0007
  3745  add hl,de
  3746  ld e,(hl)
  3747  inc hl
  3748  inc hl
  3749  ld a,($4379)
  374c  or a
  374d  ld a,(hl)
  374e  jr z,$375a
  3750  neg
  3752  add a,$d0
  3754  ex af,af'
  3755  ld a,$f7
  3757  sub e
  3758  ld e,a
  3759  ex af,af'
  375a  srl a
  375c  srl a
  375e  ld h,a
  375f  ld l,e
  3760  srl h
  3762  rr l
  3764  srl h
  3766  rr l
  3768  srl h
  376a  rr l
  376c  ld bc,$8100
  376f  add hl,bc
  3770  ld ($0940),hl
  3773  ld a,($4378)
  3776  ld de,$001e
  3779  ld iy,$0942
  377b  ld b,d
  377c  add hl,bc
  377d  ld c,$05
  377f  ld b,$02
  3781  ex af,af'
  3782  ld a,(hl)
  3783  ld (iy+$00),a
  3786  inc iy
  3788  ex af,af'
  3789  ld (hl),a
  378a  inc hl
  378b  djnz $3781
  378d  add hl,de
  378e  dec c
  378f  jp nz,$377f
  3792  pop hl
  3793  ret
  ```
  </details>

### 0x197b  DRAW_SCORE   _(conf M)_
- **Purpose:** Draw the 3-byte score/counter at 0x089C by stepping 3 digit groups (0x1908) and the high pair (0x18E0).
- **Inputs (read):** regs in; mem regions: NVRAM x5, VAR/STK(VRAM) x12
- **Outputs (written):** regs out [a,f,h,l,sp]; mem regions: VAR/STK(VRAM) x14
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 23416x; callers 0x188b; callees 0x0066 0x18e0 0x1908 0x26ab

  <details><summary>disasm (15 insn)</summary>

  ```
  197b  push bc
  197c  ld hl,$089c
  197f  call $18e0
  1982  push af
  1983  ld bc,$0362
  1986  call $1908
  1989  inc hl
  198a  inc c
  198b  djnz $1986
  198d  call $18e0
  1990  pop bc
  1991  cp b
  1992  call nz,$18cd
  1995  pop bc
  1996  ret
  ```
  </details>

### 0x1997  READ_SYSTEM_INPUT_MASK   _(conf M)_
- **Purpose:** Read SYSTEM port 0x49 (active-low, inverted) masked to a movement/credit subset chosen by a packed-digit lookup; used by the attract/demo control path.
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x8; ports 49
- **Outputs (written):** regs out [f,l,sp,c,b,d]; mem regions: VAR/STK(VRAM) x10
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 23427x; callers 0x188b; callees 0x0066 0x18e0 0x26ab

  <details><summary>disasm (12 insn)</summary>

  ```
  1997  call $18e0
  199a  ld l,$00
  199c  or a
  199d  jr z,$19a7
  199f  cp $01
  19a1  ld l,$01
  19a3  jr z,$19a7
  19a5  ld l,$03
  19a7  in a,($49)
  19a9  cpl
  19aa  and l
  19ab  ret
  ```
  </details>

### 0x19ac  DRAW_ATTRACT_SCREEN   _(conf L)_
- **Purpose:** Compose an attract/title screen: clear (0x1A4E), draw maze walls (0x35AF), draw text runs (0x297B), and fill a BCD-indexed grid of cells (0x2A40/0x29DB) plus border rows (0x1A45).
- **Inputs (read):** regs in; mem regions: (none non-ROM)
- **Outputs (written):** regs out [f,h,l,sp]; mem regions: VAR/STK(VRAM) x2
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 2x; callers (root/ISR); callees 0x1a4e
- **Notes:** Uncertain high-level layout; large inline descriptor data.

  <details><summary>disasm (101 insn)</summary>

  ```
  19ac  call $1a4e
  19af  call $35af
  19b2  call $297b
  19b5  sub b
  19b6  inc c
  19b7  cp (hl)
  19b8  rra
  19b9  ld sp,$3839
  19bc  jr nc,$19de
  19be  ld d,e
  19bf  ld d,h
  19c0  ld b,l
  19c1  ld d,d
  19c2  ld c,(hl)
  19c3  jr nz,$1a0a
  19c5  ld l,h
  19c6  ld h,l
  19c7  ld h,e
  19c8  ld (hl),h
  19c9  ld (hl),d
  19ca  ld l,a
  19cb  ld l,(hl)
  19cc  ld l,c
  19cd  ld h,e
  19ce  ld (hl),e
  19cf  inc l
  19d0  jr nz,$1a1b
  19d2  ld l,(hl)
  19d3  ld h,e
  19d4  ld l,$00
  19d6  call $18cd
  19d9  call $2314
  19dc  call $1aed
  19de  ld a,(de)
  19df  inc b
  19e0  dec de
  19e1  dec l
  19e2  dec de
  19e3  rla
  19e4  dec de
  19e5  ld b,l
  19e6  dec de
  19e7  ld hl,$4302
  19ea  ld a,$01
  19ec  ld ($4300),a
  19ef  ld de,$1838
  19f2  push de
  19f3  push hl
  19f4  ld a,(hl)
  19f5  inc hl
  19f6  or (hl)
  19f7  inc hl
  19f8  or (hl)
  19f9  pop hl
  19fa  push hl
  19fb  jr nz,$1a01
  19fd  pop hl
  19fe  pop de
  19ff  jr $1a36
  1a01  ld hl,$4300
  1a04  ld b,$02
  1a06  call $2a40
  1a09  inc de
  1a0a  pop hl
  1a0b  ld b,$06
  1a0d  call $2a4a
  1a10  inc de
  1a11  xor a
  1a12  ld c,(hl)
  1a13  call $29db
  1a16  inc de
  1a17  inc hl
  1a18  ld c,(hl)
  1a19  call $29db
  1a1b  add hl,hl
  1a1c  inc de
  1a1d  inc hl
  1a1e  ld c,(hl)
  1a1f  call $29db
  1a22  inc hl
  1a23  pop de
  1a24  ld a,d
  1a25  add a,$10
  1a27  ld d,a
  1a28  ld a,($4300)
  1a2b  add a,$01
  1a2d  daa
  1a2e  ld ($4300),a
  1a31  cp $11
  1a33  jp nz,$19f2
  1a36  ld hl,$4600
  1a39  call $1a45
  1a3c  ld hl,$5b00
  1a3f  call $1a45
  1a42  ld hl,$5d80
  1a45  ld a,$ff
  1a47  ld b,$40
  1a49  ld (hl),a
  1a4a  inc hl
  1a4b  djnz $1a49
  1a4d  ret
  ```
  </details>

### 0x1a98  ATTRACT_SCENE_DISPATCH   _(conf L)_
- **Purpose:** Step the attract sequence: clear bottom strip, branch on the demo-phase counter (0x18E0) to draw one of several scenes (0x3601/0x3613/0x360A) and queue the matching speech pointer into 0x0898.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x5; ports 60
- **Outputs (written):** regs out [a,f,b,c,d,e]; mem regions: NVRAM x2, VAR/STK(VRAM) x4
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 1x; callers (root/ISR); callees 0x18e0 0x1add 0x1aed 0x297b 0x29a3 0x29db 0x3601
- **Notes:** Uncertain; reads language DIP (port 0x60) via 0x1AED.

  <details><summary>disasm (36 insn)</summary>

  ```
  1a98  call $1add
  1a9b  call $18e0
  1a9e  jr z,$1ac1
  1aa0  dec a
  1aa1  jr z,$1ab2
  1aa3  call $3613
  1aa6  call $1aed
  1aa9  sub h
  1aaa  dec de
  1aab  sbc a,$1b
  1aad  cp e
  1aae  dec de
  1aaf  ei
  1ab0  dec de
  1ab1  ret
  1ab2  call $360a
  1ab5  call $1aed
  1ab8  ld d,h
  1ab9  dec de
  1aba  sbc a,$1b
  1abc  halt
  1abd  dec de
  1abe  ei
  1abf  dec de
  1ac0  ret
  1ac1  call $3601
  1ac4  call $1aed
  1ac7  rrca
  1ac8  inc e
  1ac9  ccf
  1aca  inc e
  1acb  ld ($561c),hl
  1ace  inc e
  1acf  ld hl,$1ad6
  1ad2  ld ($0898),hl
  1ad5  ret
  ```
  </details>

### 0x1c6e  CHECK_ROBOT_PROXIMITY   _(conf L)_
- **Purpose:** Compute a robot-vs-player relationship mask: transform both actors' coords to maze cells (0x1CE7) at several offsets and combine bit tests into a direction/contact mask (used for chase + collision).
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x110
- **Outputs (written):** regs out [h,l,sp,e,d,a]; mem regions: VAR/STK(VRAM) x92
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 10818x; callers 0x1e6d 0x1e78 0x2436; callees 0x0066 0x1ce7 0x26ab
- **Notes:** Uncertain whether line-of-fire vs adjacency.

  <details><summary>disasm (86 insn)</summary>

  ```
  1c6e  push bc
  1c6f  push af
  1c70  ld iy,($0876)
  1c72  halt
  1c73  ex af,af'
  1c74  ld h,(iy+$07)
  1c77  ld l,(iy+$09)
  1c7a  call $1ce7
  1c7d  push de
  1c7e  ld h,(ix+$07)
  1c81  ld l,(ix+$09)
  1c84  dec l
  1c85  dec l
  1c86  dec l
  1c87  dec l
  1c88  dec h
  1c89  dec h
  1c8a  dec h
  1c8b  dec h
  1c8c  call $1ce7
  1c8f  exx
  1c90  ld b,a
  1c91  exx
  1c92  pop bc
  1c93  ld a,c
  1c94  cp e
  1c95  jr nz,$1c9a
  1c97  pop af
  1c98  pop bc
  1c99  ret
  1c9a  ld a,h
  1c9b  push hl
  1c9c  add a,$10
  1c9e  ld h,a
  1c9f  call $1ce7
  1ca2  exx
  1ca3  ld c,a
  1ca4  exx
  1ca5  ld a,l
  1ca6  add a,$13
  1ca8  ld l,a
  1ca9  call $1ce7
  1cac  exx
  1cad  ld d,a
  1cae  exx
  1caf  ld a,l
  1cb0  pop hl
  1cb1  ld l,a
  1cb2  call $1ce7
  1cb5  exx
  1cb6  ld e,a
  1cb7  pop af
  1cb8  ld h,a
  1cb9  ld l,$00
  1cbb  bit 3,h
  1cbd  jr z,$1cc5
  1cbf  ld a,b
  1cc0  or c
  1cc1  and $08
  1cc3  or l
  1cc4  ld l,a
  1cc5  bit 2,h
  1cc7  jr z,$1ccf
  1cc9  ld a,d
  1cca  or e
  1ccb  and $04
  1ccd  or l
  1cce  ld l,a
  1ccf  bit 1,h
  1cd1  jr z,$1cd9
  1cd3  ld a,b
  1cd4  or e
  1cd5  and $02
  1cd7  or l
  1cd8  ld l,a
  1cd9  bit 0,h
  1cdb  jr z,$1ce3
  1cdd  ld a,c
  1cde  or d
  1cdf  and $01
  1ce1  or l
  1ce2  ld l,a
  1ce3  cpl
  1ce4  and h
  1ce5  pop bc
  1ce6  ret
  ```
  </details>

### 0x1f91  SET_ROBOT_SPRITE_PTR   _(conf L)_
- **Purpose:** Resolve a robot sprite-data pointer from the animation table 0x2053 (via 0x2B3D) and store it into the actor (ix+0x0A/0x0B) under DI.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x8
- **Outputs (written):** regs out [a,f,e,h,l,sp]; mem regions: VAR/STK(VRAM) x12
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 21x; callers 0x1e59 0x1e6d 0x1e78; callees 0x0066 0x2b3d

  <details><summary>disasm (13 insn)</summary>

  ```
  1f91  ld c,a
  1f92  and $0f
  1f94  call $2b3d
  1f97  ld hl,$2053
  1f9a  add hl,de
  1f9b  ld a,(hl)
  1f9c  inc hl
  1f9d  ld h,(hl)
  1f9e  di
  1f9f  ld (ix+$0a),a
  1fa2  ld (ix+$0b),h
  1fa5  ei
  1fa6  ret
  ```
  </details>

### 0x1f94  SET_ROBOT_SPRITE_PTR_ALT   _(conf L)_
- **Purpose:** Alternate entry into 0x1F91 that skips the initial nibble mask.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x2
- **Outputs (written):** regs out [a,f,c,e,h,l]; mem regions: VAR/STK(VRAM) x4
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 1x; callers 0x1e78; callees 0x2b3d
- **Notes:** Shared tail.

  <details><summary>disasm (11 insn)</summary>

  ```
  1f94  call $2b3d
  1f97  ld hl,$2053
  1f9a  add hl,de
  1f9b  ld a,(hl)
  1f9c  inc hl
  1f9d  ld h,(hl)
  1f9e  di
  1f9f  ld (ix+$0a),a
  1fa2  ld (ix+$0b),h
  1fa5  ei
  1fa6  ret
  ```
  </details>

### 0x209d  SETUP_LEVEL   _(conf M)_
- **Purpose:** Build a playable level: clear screen (0x1A4E), generate the maze+robots (0x2540), spawn robot actors via the coroutine system (0x1E6D), and update difficulty/bonus counters (0x434A/0x434C/0x434D).
- **Inputs (read):** regs in; mem regions: (none non-ROM)
- **Outputs (written):** regs out [a,f,h,l,sp]; mem regions: VAR/STK(VRAM) x2
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 1x; callers 0x1685; callees 0x1a4e

  <details><summary>disasm (246 insn)</summary>

  ```
  209d  call $1a4e
  20a0  call $2540
  20a3  ld a,($436e)
  20a6  or a
  20a7  jr nz,$20d7
  20a9  call $1fd4
  20ac  ld bc,$1812
  20af  ld a,($4376)
  20b2  cp $02
  20b4  jr z,$20b8
  20b6  ld b,$08
  20b8  ld (ix+$00),c
  20bb  push bc
  20bc  push ix
  20be  ld a,$0a
  20c0  call $1e6d
  20c3  pop ix
  20c5  pop bc
  20c6  ld a,$1b
  20c8  xor c
  20c9  ld c,a
  20ca  djnz $20b8
  20cc  ld hl,$0000
  20cf  ld ($0876),hl
  20d2  ld b,$08
  20d4  pop de
  20d5  djnz $20d4
  20d7  ei
  20d8  ld a,($434a)
  20db  add a,$60
  20dd  daa
  20de  ld ($434a),a
  20e1  ld a,($434c)
  20e4  cp $01
  20e6  jr z,$20ec
  20e8  dec a
  20e9  ld ($434c),a
  20ec  xor a
  20ed  ld ($4371),a
  20f0  ld iy,($0872)
  20f2  ld (hl),d
  20f3  ex af,af'
  20f4  ld (iy+$01),a
  20f7  ld a,($434d)
  20fa  cp $14
  20fc  jr c,$2103
  20fe  sub $0a
  2100  ld ($434d),a
  2103  ld iy,$2117
  2105  rla
  2106  ld hl,$f021
  2109  rst $38
  210a  add hl,sp
  210b  ld sp,hl
  210c  call $1e59
  210f  ld hl,$0010
  2112  add hl,sp
  2113  ld sp,hl
  2114  jp $2157
  2157  ld ix,($0876)
  2159  halt
  215a  ex af,af'
  215b  bit 2,(ix+$00)
  215f  ret z
  2160  ld a,(ix+$09)
  2163  ld ($4348),a
  2166  ld b,a
  2167  ld a,(ix+$07)
  216a  ld ($4347),a
  216d  bit 7,(ix+$00)
  2171  jp nz,$218d
  2174  or a
  2175  jp p,$2182
  2178  cp $fc
  217a  jp nc,$22ac
  217d  cp $f6
  217f  jp nc,$225d
  2182  ld a,b
  2183  cp $02
  2185  jp c,$2220
  2188  cp $be
  218a  jp nc,$21cf
  218d  ld a,($436d)
  2190  or a
  2191  jr z,$2196
  2193  call $2314
  2196  ld a,($436e)
  2199  or a
  219a  jr z,$21a3
  219c  call $197b
  219f  call $1997
  21a2  ret nz
  21a3  ld iy,($0872)
  21a5  ld (hl),d
  21a6  ex af,af'
  21a7  set 1,(iy+$00)
  21ab  ld a,(iy+$01)
  21ae  or a
  21af  jr nz,$21c9
  21b1  ld (iy+$01),$3b
  21b5  ld b,$0c
  21b7  ld hl,$08d0
  21ba  ld a,($436e)
  21bd  or a
  21be  jr nz,$21c6
  21c0  call $2db3
  21c3  call $2b97
  21c6  call $2678
  21c9  call $1e78
  21cc  jp $2157
  21cf  ld a,$06
  21d1  ld ($4348),a
  21d4  ld hl,$4346
  21d7  inc (hl)
  21d8  call $22eb
  21db  jr z,$21e6
  21dd  ld hl,$5fad
  21e0  ld de,$5fdf
  21e3  jp $223d
  21e6  ld hl,$442d
  21e9  ld de,$4400
  21ec  push hl
  21ed  ld a,$1b
  21ef  ld hl,$0100
  21f2  add hl,de
  21f3  ld bc,$1900
  21f6  push de
  21f7  ldir
  21f9  pop de
  21fa  ld bc,$0100
  21fd  dec hl
  21fe  ld (hl),$00
  2200  dec c
  2201  jp nz,$21fd
  2204  djnz $21fd
  2206  dec a
  2207  jr nz,$21ef
  2209  call $2540
  220c  pop hl
  220d  ld de,$001a
  2210  ld c,$02
  2212  ld b,$06
  2214  ld (hl),$ff
  2216  inc hl
  2217  djnz $2214
  2219  add hl,de
  221a  dec c
  221b  jr nz,$2212
  221d  jp $20d7
  2220  ld a,$b9
  2222  ld ($4348),a
  2225  ld hl,$4346
  2228  dec (hl)
  2229  call $22eb
  222c  jr z,$2237
  222e  ld hl,$462d
  2231  ld de,$4600
  2234  jp $21ec
  2237  ld hl,$5dad
  223a  ld de,$5dff
  223d  push hl
  223e  ld a,$1a
  2240  ld bc,$1900
  2243  ld hl,$ff00
  2246  add hl,de
  2247  push de
  2248  lddr
  224a  pop de
  224b  ld bc,$0100
  224e  inc hl
  224f  ld (hl),$00
  2251  dec c
  2252  jp nz,$224e
  2255  djnz $224e
  2257  dec a
  2258  jr nz,$2240
  225a  jp $2209
  225d  ld a,$08
  225f  ld ($4347),a
  2262  ld hl,$4345
  2265  inc (hl)
  2266  call $22eb
  2269  jr z,$2274
  226b  ld hl,$4f1f
  226e  ld de,$5fe0
  2271  jp $22c9
  2274  ld hl,$4d00
  2277  ld de,$4400
  227a  push hl
  227b  ld a,$20
  227d  ld bc,$19ff
  2280  ld hl,$0001
  2283  add hl,de
  2284  push de
  2285  ldir
  2287  ld b,$d0
  2289  ld de,$ffe1
  228c  ld (hl),$00
  228e  dec hl
  228f  ld (hl),$00
  2291  add hl,de
  2292  djnz $228c
  2294  pop de
  2295  dec a
  2296  jr nz,$227d
  2298  ld a,$06
  229a  push af
  229b  call $2540
  229e  pop af
  229f  pop hl
  22a0  ld de,$0020
  22a3  ld b,$40
  22a5  ld (hl),a
  22a6  add hl,de
  22a7  djnz $22a5
  22a9  jp $20d7
  22ac  ld a,$e6
  22ae  ld ($4347),a
  22b1  ld hl,$4345
  22b4  dec (hl)
  22b5  call $22eb
  22b8  jr z,$22c3
  22ba  ld hl,$4f00
  22bd  ld de,$4600
  22c0  jp $227a
  22c3  ld hl,$4d1f
  22c6  ld de,$5e00
  22c9  push hl
  22ca  ld a,$20
  22cc  ld bc,$1a00
  22cf  ld hl,$ffff
  22d2  add hl,de
  22d3  push de
  22d4  lddr
  22d6  ld de,$001f
  22d9  ld (hl),$00
  22db  inc hl
  22dc  ld (hl),$00
  22de  add hl,de
  22df  djnz $22d9
  22e1  pop de
  22e2  dec a
  22e3  jr nz,$22cc
  22e5  ld a,$60
  22e7  push af
  22e8  jp $229b
  ```
  </details>

### 0x22eb  INIT_GAMEPLAY_STATE   _(conf M)_
- **Purpose:** Reset gameplay state for a new round: queue the intro speech path (0x2BE4), clear the maze color buffer (0x364E), then zero the actor table.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x5
- **Outputs (written):** regs out [a,f,b,c,d,e]; mem regions: NVRAM x4, VAR/STK(VRAM) x60
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 1x; callers (root/ISR); callees 0x2be4 0x364e

  <details><summary>disasm (20 insn)</summary>

  ```
  22eb  call $2be4
  22ee  call $364e
  22f1  push iy
  22f3  pop hl
  22f4  ld (iy-$01),h
  22f7  ld (iy-$02),l
  22fa  ld hl,$0000
  22fd  di
  22fe  ld ($0870),hl
  2301  ld ($0876),hl
  2304  xor a
  2305  ld hl,$437b
  2308  ld b,$38
  230a  ld (hl),a
  230b  inc hl
  230c  djnz $230a
  230e  ld a,($4379)
  2311  or a
  2312  ei
  2313  ret
  ```
  </details>

### 0x264c  DRAW_MAZE_ROW   _(conf L)_
- **Purpose:** Draw a row of 0x0C maze wall cells: preset magic address (0x25E4) and blit each cell (0x2817), stepping X by 4.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x15
- **Outputs (written):** regs out [a,l,sp,f,d,e]; mem regions: VAR/STK(VRAM) x14, MAGIC x16
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 20x; callers 0x25d4 0x25eb; callees 0x0066 0x25e4 0x26ab 0x2817 0x29a3
- **Notes:** Uncertain row-vs-column orientation.

  <details><summary>disasm (13 insn)</summary>

  ```
  264c  ld b,$0c
  264e  push bc
  264f  push hl
  2650  call $25e4
  2653  ld hl,$269b
  2656  call $2817
  2659  pop hl
  265a  pop bc
  265b  ld a,$04
  265d  add a,l
  265e  ld l,a
  265f  djnz $264e
  2661  ret
  ```
  </details>

### 0x2662  DRAW_MAZE_COL   _(conf L)_
- **Purpose:** Draw a column of 0x12 maze wall cells (preset 0x25E4, blit 0x2817), stepping Y by 4.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x13
- **Outputs (written):** regs out [a,f,h,sp,b,d]; mem regions: VAR/STK(VRAM) x12, MAGIC x8
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 12x; callers 0x25ca 0x25eb; callees 0x0066 0x25e4 0x26ab 0x2817 0x29a3
- **Notes:** Uncertain orientation.

  <details><summary>disasm (13 insn)</summary>

  ```
  2662  ld b,$12
  2664  push bc
  2665  push hl
  2666  call $25e4
  2669  ld hl,$269b
  266c  call $2817
  266f  pop hl
  2670  pop bc
  2671  ld a,$04
  2673  add a,h
  2674  ld h,a
  2675  djnz $2664
  2677  ret
  ```
  </details>

### 0x2a40  FORMAT_AND_DRAW_DIGITS   _(conf M)_
- **Purpose:** Convert a packed value to ASCII/hex digit codes (nibble extract, +0x30 with A-F adjust, leading-space blanking) and draw each via 0x29DB.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x20
- **Outputs (written):** regs out [b,d,e,l,sp,c]; mem regions: VAR/STK(VRAM) x16; ports 4b<=[00]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 20x; callers 0x18cd 0x2314; callees 0x0066 0x26ab 0x29a3 0x29db

  <details><summary>disasm (48 insn)</summary>

  ```
  2a40  push bc
  2a41  ld b,$00
  2a43  ex de,hl
  2a44  call $29a3
  2a47  ex de,hl
  2a48  ex af,af'
  2a49  pop bc
  2a4a  res 0,c
  2a4c  ld a,b
  2a4d  dec a
  2a4e  jr nz,$2a52
  2a50  set 0,c
  2a52  ld a,(hl)
  2a53  bit 0,b
  2a55  jr nz,$2a60
  2a57  srl a
  2a59  srl a
  2a5b  srl a
  2a5d  srl a
  2a5f  dec hl
  2a60  inc hl
  2a61  and $0f
  2a63  jr nz,$2a6d
  2a65  bit 0,c
  2a67  jr nz,$2a6f
  2a69  ld a,$20
  2a6b  jr $2a77
  2a6d  set 0,c
  2a6f  add a,$30
  2a71  cp $3a
  2a73  jr c,$2a77
  2a75  add a,$07
  2a77  push hl
  2a78  push bc
  2a79  ld c,a
  2a7a  ex af,af'
  2a7b  call $29db
  2a7e  ex af,af'
  2a7f  pop bc
  2a80  pop hl
  2a81  ld a,($4379)
  2a84  or a
  2a85  jr nz,$2a8a
  2a87  inc de
  2a88  jr $2a8b
  2a8a  dec de
  2a8b  djnz $2a4c
  2a8d  ret
  ```
  </details>

### 0x2a4a  FORMAT_AND_DRAW_DIGITS_ALT   _(conf L)_
- **Purpose:** Alternate entry into the digit formatter 0x2A40 (skips the leading 0x29A3 address preset).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x9
- **Outputs (written):** regs out [a,f,b,e,l,sp]; mem regions: VAR/STK(VRAM) x6
- **Side-effects / entropy:** none observed
- **Call graph:** depth 10, invoked 1x; callers 0x1e78; callees 0x29db
- **Notes:** Shared tail; uncertain exact caller contract.

  <details><summary>disasm (41 insn)</summary>

  ```
  2a4a  res 0,c
  2a4c  ld a,b
  2a4d  dec a
  2a4e  jr nz,$2a52
  2a50  set 0,c
  2a52  ld a,(hl)
  2a53  bit 0,b
  2a55  jr nz,$2a60
  2a57  srl a
  2a59  srl a
  2a5b  srl a
  2a5d  srl a
  2a5f  dec hl
  2a60  inc hl
  2a61  and $0f
  2a63  jr nz,$2a6d
  2a65  bit 0,c
  2a67  jr nz,$2a6f
  2a69  ld a,$20
  2a6b  jr $2a77
  2a6d  set 0,c
  2a6f  add a,$30
  2a71  cp $3a
  2a73  jr c,$2a77
  2a75  add a,$07
  2a77  push hl
  2a78  push bc
  2a79  ld c,a
  2a7a  ex af,af'
  2a7b  call $29db
  2a7e  ex af,af'
  2a7f  pop bc
  2a80  pop hl
  2a81  ld a,($4379)
  2a84  or a
  2a85  jr nz,$2a8a
  2a87  inc de
  2a88  jr $2a8b
  2a8a  dec de
  2a8b  djnz $2a4c
  2a8d  ret
  ```
  </details>

### 0x1685  START_GAME   _(conf H)_
- **Purpose:** Start a game/level: save the live score pointer (0x433E->0x4373), reseed the LCG (push 0x435C, run 0x209D, then rewrite 0x435C and call RANDOM), copy the 12-byte game-config block from ROM 0x16CD to 0x4344-0x434F, and set the game-active flag 0x436E=0xFF.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x5
- **Outputs (written):** regs out [f,d,e,h,l,sp]; mem regions: VAR/STK(VRAM) x25
- **Side-effects / entropy:** **touches entropy var 0x435C(r)**
- **Call graph:** depth 11, invoked 1x; callers (root/ISR); callees 0x209d
- **Notes:** ENTROPY: reseeds LCG seed 0x435C (entropy-berzerk.md sec3 game-start mix).

  <details><summary>disasm (28 insn)</summary>

  ```
  1685  ld hl,($433e)
  1688  ld ($4373),hl
  168b  ld a,($4340)
  168e  ld ($4375),a
  1691  ld hl,$0000
  1694  ld ($433e),hl
  1697  ld ($433f),hl
  169a  ld hl,($435c)
  169d  push hl
  169e  ld hl,$16d9
  16a1  ld ($436f),hl
  16a4  ld a,$ff
  16a6  ld ($436e),a
  16a9  ld bc,$000c
  16ac  ld de,$4344
  16af  ld hl,$16cd
  16b2  ldir
  16b4  call $209d
  16b7  pop hl
  16b8  push af
  16b9  ld ($435c),hl
  16bc  call $2678
  16bf  ld hl,($4373)
  16c2  ld ($433e),hl
  16c5  ld hl,($4374)
  16c8  ld ($433f),hl
  16cb  pop af
  16cc  ret
  ```
  </details>

### 0x188b  ATTRACT_DEMO_LOOP   _(conf L)_
- **Purpose:** Attract-mode driver: set the demo actor, poll SW2 (port 0x65) free-game bit, run score draw (0x197B) and input read (0x1997), and on a credit/start branch set the game-mode selector 0x4376.
- **Inputs (read):** regs in; mem regions: NVRAM x3, VAR/STK(VRAM) x11; ports 49 65
- **Outputs (written):** regs out [a,f,c,h,l,sp]; mem regions: VAR/STK(VRAM) x12
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 3x; callers (root/ISR); callees 0x0066 0x18e0 0x1908 0x197b 0x1997 0x26ab
- **Notes:** Uncertain higher-level orchestration; coroutine-bodied.

  <details><summary>disasm (31 insn)</summary>

  ```
  188b  ld b,$03
  188d  ld hl,($0872)
  1890  inc hl
  1891  ld (hl),$3c
  1893  dec hl
  1894  set 1,(hl)
  1896  in a,($65)
  1898  bit 0,a
  189a  jr z,$18a0
  189c  ld a,$01
  189e  jr $18c1
  18a0  call $197b
  18a3  call $1997
  18a6  jr nz,$18b2
  18a8  ld hl,($0872)
  18ab  bit 1,(hl)
  18ad  jr nz,$1896
  18af  djnz $188d
  18b1  ret
  18b2  ld l,a
  18b3  call $18f1
  18b6  bit 1,l
  18b8  ld a,$01
  18ba  jr z,$18c1
  18bc  call $18f1
  18bf  ld a,$02
  18c1  ld ($4376),a
  18c4  ld hl,($0872)
  18c7  ld (hl),$01
  18c9  pop hl
  18ca  jp $17b8
  ```
  </details>

### 0x18cd  DRAW_SMALL_FIELD   _(conf L)_
- **Purpose:** Draw a small 2-digit on-screen field: fetch a value (0x18E0) and format/draw it (0x2A40) from ROM digit data at 0xD578.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x10
- **Outputs (written):** regs out [a,c,e,l,sp,b]; mem regions: VAR/STK(VRAM) x10
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 4x; callers 0x2540; callees 0x18e0 0x2a40
- **Notes:** Uncertain exact field meaning.

  <details><summary>disasm (10 insn)</summary>

  ```
  18cd  push hl
  18ce  ld hl,$0000
  18d1  add hl,sp
  18d2  call $18e0
  18d5  ld (hl),a
  18d6  ld b,$02
  18d8  ld de,$d578
  18db  call $2a40
  18de  pop hl
  18df  ret
  ```
  </details>

### 0x2314  DRAW_STATUS_LINE   _(conf L)_
- **Purpose:** Draw the score/status line: format and blit two 6-digit fields from ROM digit data (0xD500/0xD5B0) via 0x2A40, keyed by the 2-player selector 0x4376.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x9
- **Outputs (written):** regs out [f,e,h,l,sp,a]; mem regions: VAR/STK(VRAM) x9
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 16x; callers 0x2540; callees 0x0066 0x2a40
- **Notes:** Uncertain exact fields.

  <details><summary>disasm (13 insn)</summary>

  ```
  2314  xor a
  2315  ld ($436d),a
  2318  ld de,$d500
  231b  ld hl,$433e
  231e  ld b,$06
  2320  call $2a40
  2323  ld a,($4376)
  2326  cp $02
  2328  ret nz
  2329  ld de,$d5b0
  232c  ld hl,$4341
  232f  ld b,$06
  2331  jp $2a40
  ```
  </details>

### 0x2436  UPDATE_ROBOT_MOVE   _(conf L)_
- **Purpose:** Update a robot's movement/animation: mask the desired direction nibble, run the proximity/line check (0x1C6E), look up the animation frame (0x2B3D), and store the new sprite-data pointer into the actor (ix+0x0A/0x0B).
- **Inputs (read):** regs in; mem regions: NVRAM x2, VAR/STK(VRAM) x112
- **Outputs (written):** regs out [f,h,l,sp,e,d]; mem regions: VAR/STK(VRAM) x132
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 10830x; callers 0x1e59 0x1e6d 0x1e78; callees 0x0066 0x1c6e 0x1ce7 0x26ab 0x2b3d
- **Notes:** Uncertain; my CFG span over-runs (entered as alt-entry context).

  <details><summary>disasm (18 insn)</summary>

  ```
  2436  and $0f
  2438  call nz,$1c6e
  243b  cp c
  243c  ret z
  243d  ld c,a
  243e  call $2b3d
  2441  ld hl,$252d
  2444  add hl,de
  2445  ld a,(hl)
  2446  inc hl
  2447  ld h,(hl)
  2448  di
  2449  ld (ix+$0a),a
  244c  ld (ix+$0b),h
  244f  ei
  2450  ld a,($434c)
  2453  ld (ix+$0d),a
  2456  ret
  ```
  </details>

### 0x25ca  DRAW_MAZE_BLOCK_A   _(conf L)_
- **Purpose:** Draw a maze wall block by two column passes (0x2662) offset by 0x40.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x11
- **Outputs (written):** regs out [h,sp,a,f]; mem regions: VAR/STK(VRAM) x10, MAGIC x8
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 4x; callers 0x2540; callees 0x0066 0x25e4 0x2662 0x26ab 0x2817 0x29a3
- **Notes:** Uncertain.

  <details><summary>disasm (5 insn)</summary>

  ```
  25ca  call $2662
  25cd  ld a,$40
  25cf  add a,h
  25d0  ld h,a
  25d1  jp $2662
  ```
  </details>

### 0x25d4  DRAW_MAZE_BLOCK_B   _(conf L)_
- **Purpose:** Draw a maze wall block via four row passes (0x264C) offset by 0x30.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x8
- **Outputs (written):** regs out [l,sp,a,f,d,e]; mem regions: VAR/STK(VRAM) x8
- **Side-effects / entropy:** none observed
- **Call graph:** depth 11, invoked 4x; callers 0x2540; callees 0x0066 0x25e4 0x264c 0x2817 0x29a3
- **Notes:** Uncertain.

  <details><summary>disasm (7 insn)</summary>

  ```
  25d4  call $264c
  25d7  call $264c
  25da  ld a,$30
  25dc  add a,l
  25dd  ld l,a
  25de  call $264c
  25e1  jp $264c
  ```
  </details>

### 0x25eb  PLACE_ROBOT_RANDOM   _(conf M)_
- **Purpose:** Place one robot at a random position: call RANDOM twice, and on (result & 3) select one of four edge/quadrant placement routines, setting the robot cell flags.
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x24
- **Outputs (written):** regs out [l,ix,sp,a,f,c]; mem regions: VAR/STK(VRAM) x24
- **Side-effects / entropy:** **touches entropy var 0x435C(rw); calls RANDOM(0x2678)**
- **Call graph:** depth 11, invoked 4x; callers 0x2540; callees 0x0066 0x264c 0x2662 0x2678 0x26ab
- **Notes:** ENTROPY: RANDOM (0x2678) consumer (entropy-berzerk.md sec7).

  <details><summary>disasm (34 insn)</summary>

  ```
  25eb  call $2678
  25ee  push hl
  25ef  call $2678
  25f2  ld bc,$2606
  25f5  push bc
  25f6  and $03
  25f8  jp z,$2630
  25fb  dec a
  25fc  jp z,$2640
  25ff  dec a
  2600  jp z,$2614
  2603  jp $2620
  2614  call $264c
  2617  set 3,(ix+$01)
  261b  set 2,(ix+$06)
  261f  ret
  2620  ld a,l
  2621  sub $30
  2623  ld l,a
  2624  call $264c
  2627  set 3,(ix+$00)
  262b  set 2,(ix+$05)
  262f  ret
  2630  ld a,h
  2631  sub $44
  2633  ld h,a
  2634  call $2662
  2637  set 1,(ix+$00)
  263b  set 0,(ix+$01)
  263f  ret
  2640  call $2662
  2643  set 1,(ix+$05)
  2647  set 0,(ix+$06)
  264b  ret
  ```
  </details>

### 0x1e59  COROUTINE_ENTER   _(conf M)_
- **Purpose:** Allocate an actor stack frame (reserve 0x18 bytes below SP, record the frame pointer in the 0x0872 list) and enter the body via jp (iy).
- **Inputs (read):** regs in; mem regions: NVRAM x4, VAR/STK(VRAM) x97
- **Outputs (written):** regs out [d,e,l,iy,sp,f]; mem regions: NVRAM x6, VAR/STK(VRAM) x270
- **Side-effects / entropy:** **calls RANDOM(0x2678)**
- **Call graph:** depth 12, invoked 20x; callers 0x1e59; callees 0x0066 0x1e22 0x1f91 0x1fd4 0x200e 0x2436 0x2678 0x26ab

  <details><summary>disasm (13 insn)</summary>

  ```
  1e59  ld hl,$0000
  1e5c  add hl,sp
  1e5d  ex de,hl
  1e5e  ld hl,$ffe8
  1e61  add hl,sp
  1e62  ld sp,hl
  1e63  ld hl,($0872)
  1e66  inc hl
  1e67  inc hl
  1e68  ld (hl),e
  1e69  inc hl
  1e6a  ld (hl),d
  1e6b  jp (iy)
  ```
  </details>

### 0x1e78  ACTOR_YIELD   _(conf M)_
- **Purpose:** Coroutine yield/scheduler: save the current actor SP into its 0x0872 frame, walk the list to the next ready actor (bit0), and switch SP to it.
- **Inputs (read):** regs in; mem regions: NVRAM x7, VAR/STK(VRAM) x207; ports 61
- **Outputs (written):** regs out [l,sp,f,h,iy,ix]; mem regions: NVRAM x9, VAR/STK(VRAM) x218; ports 4c<=[02]  4d<=[01]
- **Side-effects / entropy:** none observed
- **Call graph:** depth 12, invoked 19807x; callers 0x1e6d 0x1e78 0x2b54; callees 0x0066 0x1c6e 0x1e6d 0x1f91 0x1f94 0x2334 0x2341 0x2436 0x24f7 0x26ab 0x287f 0x297b 0x29a3 0x29db 0x2a4a 0x2b39 0x2b54 0x2bde 0x2c1f 0x33bd 0x3439 0x348a
- **Notes:** Alternate (no-type-set) entry into 0x1E6D body; the actor scheduler.

  <details><summary>disasm (22 insn)</summary>

  ```
  1e78  ld iy,($0872)
  1e7a  ld (hl),d
  1e7b  ex af,af'
  1e7c  ld hl,$0000
  1e7f  add hl,sp
  1e80  ld sp,$0870
  1e83  ld (iy+$02),l
  1e86  ld (iy+$03),h
  1e89  jr $1e8f
  1e8f  ld h,(iy-$01)
  1e92  ld l,(iy-$02)
  1e95  push hl
  1e96  pop iy
  1e98  bit 0,(hl)
  1e9a  jp z,$1e8f
  1e9d  ld l,(iy+$02)
  1ea0  ld h,(iy+$03)
  1ea3  ld ($0872),iy
  1ea5  ld (hl),d
  1ea6  ex af,af'
  1ea7  ld sp,hl
  1ea8  ret
  ```
  </details>

### 0x2540  GENERATE_MAZE_AND_ROBOTS   _(conf M)_
- **Purpose:** Maze + robot placement: seed RANDOM from 0x4345, clear the maze build buffer (0x5E6A/0x444A), copy the placement seed table ROM 0x268C->0x435E, place robots at random quadrant positions (0x25CA/0x25D4/0x25EB), and render the maze (0x369F).
- **Inputs (read):** regs in; mem regions: VAR/STK(VRAM) x10
- **Outputs (written):** regs out [f,c,d,e,h,l]; mem regions: VAR/STK(VRAM) x21, VRAM-bitmap x144
- **Side-effects / entropy:** **touches entropy var 0x435C(w)**
- **Call graph:** depth 12, invoked 2x; callers (root/ISR); callees 0x0066 0x18cd 0x2314 0x25ca 0x25d4 0x25eb 0x29a3 0x369f
- **Notes:** ENTROPY: writes LCG seed 0x435C and the 0x435E placement buffer.

  <details><summary>disasm (63 insn)</summary>

  ```
  2540  ld hl,($4345)
  2543  ld ($435c),hl
  2546  ld a,($4379)
  2549  or a
  254a  jr nz,$2551
  254c  ld hl,$5e6a
  254f  jr $2554
  2551  ld hl,$444a
  2554  ld de,$0014
  2557  xor a
  2558  ld c,$0c
  255a  ld b,$0c
  255c  ld (hl),a
  255d  inc hl
  255e  djnz $255c
  2560  add hl,de
  2561  dec c
  2562  jr nz,$255a
  2564  ld bc,$000f
  2567  ld de,$435e
  256a  ld hl,$268c
  256d  ldir
  256f  ld hl,$0008
  2572  call $25d4
  2575  ld hl,$cc08
  2578  call $25d4
  257b  ld hl,$0004
  257e  call $25ca
  2581  ld hl,$00f8
  2584  call $25ca
  2587  ld ix,$435e
  2589  ld e,(hl)
  258a  ld b,e
  258b  ld hl,$4438
  258e  call $25eb
  2591  ld hl,$8838
  2594  call $25eb
  2597  call $369f
  259a  ld a,($4344)
  259d  cp $02
  259f  ld hl,$d538
  25a2  jr nz,$25a6
  25a4  ld l,$e8
  25a6  ld b,$00
  25a8  call $29a3
  25ab  ex de,hl
  25ac  ex af,af'
  25ad  ld a,($4349)
  25b0  ld b,a
  25b1  ex af,af'
  25b2  dec b
  25b3  jr z,$25bf
  25b5  push bc
  25b6  ld c,$80
  25b8  call $29db
  25bb  inc de
  25bc  pop bc
  25bd  djnz $25b5
  25bf  ld a,($436e)
  25c2  or a
  25c3  call nz,$18cd
  25c6  call $2314
  25c9  ret
  ```
  </details>

### 0x1e6d  ACTOR_YIELD_TYPED   _(conf M)_
- **Purpose:** Mark the current actor type (0x82) and yield: walk the 0x0872 actor list to the next ready coroutine (bit0 set) and switch to its stack.
- **Inputs (read):** regs in; mem regions: NVRAM x6, VAR/STK(VRAM) x132
- **Outputs (written):** regs out [iy,sp,f,l,h,a]; mem regions: NVRAM x6, VAR/STK(VRAM) x108
- **Side-effects / entropy:** none observed
- **Call graph:** depth 13, invoked 121x; callers 0x1e6d 0x1e78 0x287f; callees 0x0066 0x1c6e 0x1e78 0x1f91 0x2436 0x26ab 0x287f 0x2b39 0x2bde
- **Notes:** Falls through into 0x1E78; coroutine scheduler core, trace best-effort.

  <details><summary>disasm (27 insn)</summary>

  ```
  1e6d  ld iy,($0872)
  1e6f  ld (hl),d
  1e70  ex af,af'
  1e71  ld (iy+$01),a
  1e74  ld (iy+$00),$82
  1e78  ld iy,($0872)
  1e7a  ld (hl),d
  1e7b  ex af,af'
  1e7c  ld hl,$0000
  1e7f  add hl,sp
  1e80  ld sp,$0870
  1e83  ld (iy+$02),l
  1e86  ld (iy+$03),h
  1e89  jr $1e8f
  1e8f  ld h,(iy-$01)
  1e92  ld l,(iy-$02)
  1e95  push hl
  1e96  pop iy
  1e98  bit 0,(hl)
  1e9a  jp z,$1e8f
  1e9d  ld l,(iy+$02)
  1ea0  ld h,(iy+$03)
  1ea3  ld ($0872),iy
  1ea5  ld (hl),d
  1ea6  ex af,af'
  1ea7  ld sp,hl
  1ea8  ret
  ```
  </details>
