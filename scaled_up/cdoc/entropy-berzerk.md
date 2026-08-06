# Berzerk nondeterministic-read-site catalog (T5.2)

Status: DONE — Sudnya signed off catalog completeness 2026-06-17 (counts independently verified in the Cowork review session).
Supersedes the T5.1 stub (which identified the single load-bearing entropy
source; this is the full sweep). Builds on T5.1 (entropy source = port 0x4E
V256), T4.1 (heavy-trace capture), T4.2 (MAME fidelity), and the FROZEN
heavy-trace schema fidelity rule #1 ("entropy reads are inputs, never
recomputed").

## 0. Definitions used here

- **Entropy site** — a read whose value is NOT reproducible from
  `(cold reset + input script)` *across platforms*. In Berzerk this is exactly
  the **timing-locked beam source** (port 0x4E **bit 0 = V256**) and everything
  derived from it (the interrupt-phase counter 0x089F/0x08A0, hence LCG seed
  0x435C). NOTE: the JS machine is itself fully deterministic (T4.1: two runs
  byte-identical), so these values ARE reproducible *within one platform* — they
  are entropy only in the cross-platform (JS vs MAME) sense, because the two
  cores are not cycle-locked (T3.4 / cosim drift). For porting (Phase 7/8) that
  is the relevant sense: a port must replay the captured value, not recompute it.
- **Input (deterministic)** — joystick/button ports (0x48/0x49/0x4A) and DIP
  banks (0x60-0x65). Value is fixed by the input script + DIP settings.
- **NVRAM** — 0x0800-0x0BFF (memory, not a port). Deterministic given saved
  state; on cold reset with cleared NVRAM it is deterministic.
- **Constant / control** — reads whose value our model fixes (sound status 0x44),
  or reads taken only for a side effect (NMI enable/disable 0x4C/0x4D), or
  POST self-test read-backs (0x66/0x67).

## 1. Method (static + dynamic, then reconcile)

Bytes in the frozen oracle are DECIMAL (T5.1). `in a,(n)` = `DB nn` =
`[219, nn]`; `in r,(c)` = `ED 40/48/.../78` = `[237, 64/72/.../120]`.

STATIC — every port-read opcode in `disassembler/oracle/decode_oracle.jsonl`:

```
filter bytes[0]==219                                  -> 54  in a,(n) sites
filter bytes[0]==237 & bytes[1] in {64,72,80,88,96,104,112,120}
                                                      -> 11  in a,(c) sites  (all ED 78 = in a,(c))
total = 65 IN instructions
```

DYNAMIC — exact reading-PC + value of every IO read, plus memory reads of the
entropy counter 0x089F/0x08A0 and seed 0x435C, captured on the JS machine over
four input scripts (attract-only 3085f, coin-start-first-maze 942f, free-play
1276f with P1 joystick+fire, an aggressive start+hold 2600f). Capture wraps the
live `cpu.callbacks.readPort`/`readByte` (the same mechanism the FROZEN
heavy-trace uses). The reading PC recorded is `static_site + 1` (PC after the
opcode-fetch byte), so every dynamic read maps to its static site by `PC-1`.

Heavy traces reproduced the T4.1 numbers exactly (attract = 416,482
invocations), so the capture path is the validated one.

## 2. Classified table of ALL read-sites

"fired?" = appeared in the dynamic IO capture across the four scripts
(Y = yes; the count shown is the attract-only count).

| Port | static site(s) | nearest label / role | class | fired? | notes |
|------|----------------|----------------------|-------|--------|-------|
| 0x4E b0 | **0x26B4** | IM2 IRQ dispatcher | **ENTROPY (V256)** | **Y** 5020 | `in a,($4e); rra; jr c` — bit0=V256 selects interrupt path; the load-bearing entropy read |
| 0x4E b7 | 0x157A | MOVE_AND_DRAW_BOLT | collision (draw-det.) | Y 2258 | `rlca` → bit7 = collision flop; deterministic given the magic-RAM draw, NOT beam entropy |
| 0x4E b7 | 0x279D | WRITE_PATTERN | collision (draw-det.) | Y 2454 | `bit 7,a; ret z` → collision flop |
| 0x4E | 0x04A9, 0x050C, 0x0522 | POST display/IRQ self-test | constant/sync | Y | beam-wait + intercept self-test in POST (`xor d; rla; jr c,self`); see §5 label caveat |
| 0x4E | 0x023B, 0x0246, 0x0281 | COLOUR_TEST_MODE | service | N | operator color-test menu (service switch) |
| 0x4E | 0x0608 | BOOKKEEPING | service | N | operator bookkeeping menu; value discarded (`ld sp` follows) |
| 0x089F/0x08A0 | (mem) read @0x26BE/0x26C0 | interrupt-phase counter | **ENTROPY (derived)** | **Y** 2512 | 2-byte counter advanced every non-vblank IRQ; the value RANDOM's seed is mixed from |
| 0x435C | (mem) read @0x267B, 0x169C | LCG seed | **ENTROPY (derived)** | Y 115 | seed of RANDOM; rewritten at game start mixing the counter |
| 0x48 | 0x0580,0x0653,0x0786,0x078C,0x1EEB,0x2DD2 | INPUT_TEST / WAIT_FIRE / MOVE_PLAYER / INCREMENT_BY_1 | INPUT (P1) | **N** | P1 joystick L/R/U/D + Fire (active-low). Not reached: see §4 (scripts never credit the machine) |
| 0x49 | 0x1642, 0x19A7, 0x26C3 | COLLISION_DETECTION / DECREMENT_CREDITS / dispatcher | INPUT (SYSTEM) | Y 23574 | coin/start + mixed into the 0x089F counter (`xor`/`cpl`); the *value* is a deterministic input |
| 0x49 | 0x0585 | INPUT_TEST_MODE | service | N | |
| 0x4A | 0x1A80 | CLEAR_SCREEN | INPUT (P2/cab) | Y 3 | |
| 0x4A | 0x1813, 0x1EE7, 0x2DD5, 0x058A | V.LOOP / MOVE_PLAYER / INCREMENT_BY_1 / INPUT_TEST | INPUT (P2/cab) | N | active-gameplay reads, not reached (§4) |
| 0x4C | 0x027E, 0x052D | NMI-enable read | control (side-effect) | Y 14 | read enables NMI; returned value unused. 0x052D fires in POST self-test |
| 0x4D | 0x0520 | NMI-disable read | control (side-effect) | Y 15 | read disables NMI; value unused |
| 0x60 | 0x000E,0x1606,0x1AF6 | F2 DIP (color-test/bonus) | INPUT (DIP) | Y | |
| 0x60 | 0x0569 | INPUT_TEST_MODE | service | N | |
| 0x61 | 0x0007,0x237A,0x2391 | F3 DIP (input-test/language) | INPUT (DIP) | Y | |
| 0x61 | 0x0284, 0x0564 | COLOUR/INPUT_TEST | service | N | |
| 0x62 | 0x056E | INPUT_TEST_MODE (F4 coinage) | INPUT (DIP) | N | service-menu only |
| 0x63 | 0x0573 | INPUT_TEST_MODE (F5 coinage) | INPUT (DIP) | N | service-menu only |
| 0x64 | 0x0578 | INPUT_TEST_MODE (F6 coinage) | INPUT (DIP) | N | service-menu only |
| 0x65 | 0x172E, 0x1896 | NMI_HANDLER / DEFAULT_PLAYER_STATE | INPUT (SW2 DIP) | Y 35348 | SW2 service/free-game; polled as a debounce/wait loop (value constant) |
| 0x65 | 0x060D, 0x064D, 0x066A | BOOKKEEPING | service | N | |
| 0x44 | 0x174C | NMI_HANDLER | constant (sound status) | Y 7 | S14001A busy/ready. HW: timing-dependent; our model returns constant READY (T2.8). Gates speech pacing only — does NOT reach placement |
| 0x66 | 0x0081 | POST | constant | Y 7 | LED port read-back in POST self-test; deterministic |
| 0x67 | 0x00A9 | POST | constant | Y 8 | LED port read-back in POST self-test; deterministic |
| 0xFF | 0x1273,0x127F,0x128B,0x1297,0x12A1,0x12B0 | (inside a data table) | **NOT CODE** | N | `in a,($ff)` is a linear-sweep false positive: 0xFF is not a real Berzerk port; bytes sit between `ld a,(hl)`/`rst $38` filler and never execute. Confirmed: zero dynamic reads of port 0xFF |
| (c)=var | 0x011D, 0x0203-0x0223 (×9), 0x192B | TODOs / COLOUR_TEST / DECREMENT_CREDITS | service | N | `in a,(c)` with C walking 0x48-0x4A: the operator input-scan in color-test mode; never executes in attract/play |

Distinct ports actually READ by the CPU (dynamic, all four scripts):
`0x44, 0x49, 0x4A, 0x4C, 0x4D, 0x4E, 0x60, 0x61, 0x65, 0x66, 0x67` — plus the
memory entropy reads 0x089F/0x08A0/0x435C. Port **0x48 was never read** in any
script (see §4).

### Reconciliation (every static site explained, every dynamic read mapped)

- **Every dynamic IO read maps to a static site**: each reading PC equals a
  static IN address + 1 (verified for all 23 distinct fired sites). No dynamic
  read lacks a static origin.
- **Static sites that did NOT fire** fall into exactly three buckets, none of
  them entropy:
  1. **Operator service menus** — COLOUR_TEST_MODE (0x02xx), INPUT_TEST_MODE
     (0x0564-0x058A, incl. ports 0x62/0x63/0x64 and the `in a,(c)` scan),
     BOOKKEEPING (0x060D-0x066A). Entered only via the service switch / specific
     DIP; not on the attract or play path.
  2. **Active-gameplay routines not reached** — port 0x48 (all sites), and the
     0x4A reads in V.LOOP/MOVE_PLAYER/INCREMENT_BY_1. None of the four scripts
     drives the JS machine into credited active play (§4). These are
     deterministic INPUT reads by static disassembly + verified input plumbing
     (§4), classified INPUT regardless of firing.
  3. **Data-region false positives** — the six `in a,($ff)` sites at 0x1273+ are
     mis-disassembled data (port 0xFF does not exist; zero dynamic reads).

## 3. Entropy flow (the spine, confirmed + refined from T5.1)

Verified from the oracle disassembly:

```
IM2 IRQ dispatcher @0x26B0
  0x26B4  in a,($4e)        ; A = (collision<<7) | V256        <-- ENTROPY READ
  0x26B6  rra               ; carry = bit0 = V256
  0x26B7  jr c,$26d9        ; V256=1 -> BOTTOM_OF_SCREEN path (0x26D9)
  ; fall-through = mid-screen (non-vblank) IRQ:
  0x26BB  ld hl,$089f
  0x26BE  ld a,(hl) / inc hl / ld b,(hl)   ; load 2-byte counter 0x089F/0x08A0
  0x26C1  xor b
  0x26C3  in a,($49)        ; mix in SYSTEM port (coin/start lines)
  0x26C5  cpl / ld (hl),a / ld (hl),b      ; advance + store counter (bit loop 0x26C9-0x26D3)
```

```
RANDOM (LCG) @0x2678
  hl = (0x435C);  hl = 7*hl + 0x3153;  (0x435C) = hl;  return A = high(hl)
```

```
COLLISION_DETECTION game-start @0x1642
  0x1642  in a,($49) / cpl / ld hl,$089f / ld (hl),a / ld (hl),a
          ; counter 0x089F/0x08A0 initialized to NOT(port 0x49)  [CORRECTION to T5.1 stub:
          ;  it is set to NOT(0x49), not "zeroed". In attract with no coin/start,
          ;  0x49 = 0xFF so NOT = 0x00 -- which is why it *looked* like zeroing.]
  0x169A  ld hl,($435c) ... 0x16B9 ld ($435c),hl ... 0x16BC call RANDOM
          ; seed rewritten (mixing the interrupt-phase-perturbed state) then RANDOM runs
```

Chain: **port 0x4E bit0 (V256, timing-locked)** → selects the interrupt path each
IRQ → the non-vblank path **advances the 2-byte counter 0x089F/0x08A0** (mixing
port 0x49) → at game start the **LCG seed 0x435C** is initialized/rewritten from
that counter state → **RANDOM @0x2678** (deterministic in its seed) → **13
consumers** place/move objects and pick speech. The *count and phase* of
non-vblank-vs-vblank IRQs depends on cycle-timing, so the counter — and hence the
seed — diverges between JS and MAME even though every individual arithmetic step
is deterministic. This is the same root cause measured three independent ways
(0x26D9 cosim, full-VRAM frame-242, visible-only frame-259; see decisions.md).

**No other entropy-consuming path exists.** The only timing-locked read is V256
(port 0x4E bit0), and the only consumer that uses bit0 is the dispatcher 0x26B4.
Every other port 0x4E read consumes **bit 7 (the collision flop)**, which is
deterministic given the magic-RAM draw sequence (set by control writes, reset by
overlapping pixels — T2.5), not beam timing. No `ld a,r` (R register) anywhere
(T5.1). No uninitialized-RAM seeding (the seed is driven by the 0x089F counter,
itself initialized from port 0x49).

## 4. Why port 0x48 / active-gameplay reads never fired (evidence)

The four scripts coin/start at frames 60-530, but on the JS machine the CPU does
not poll the SYSTEM port until **frame 573** (POST completion — matches the cosim
"first steady IRQ at JS frame 573"). Probe of port 0x49 over the aggressive
script: the only distinct value ever returned is `0b11111111`, first read at
frame 573 — i.e. every injected coin/start was already RELEASED before the CPU
first sampled the port, so no credit registers and the game never leaves attract.
Hence MOVE_PLAYER (0x1EE1) never executes and port 0x48 is never read.

The input PLUMBING is verified correct and deterministic (so these are confirmed
INPUT sites, not dead code):

```
SYSTEM(0x49) default        = 11111111
SYSTEM(0x49) after COIN1=1  = 01111111   (bit7 clear, active-low)
SYSTEM(0x49) after START1=1 = 01111110   (bit0 clear)
P1(0x48)     default        = 11111111
P1(0x48)     after RIGHT=1   = 11111101   (bit1 clear)
```

This is a consequence of the deferred timing-parity work (the stock scripts were
authored against MAME's POST timing): a follow-up should re-time coin/start to
land after frame ~573 so Phase 7/8 can capture the port-0x48 gameplay reads. It
does NOT affect this catalog's classification.

## 5. Label caveat (so a future session doesn't trust a stale label)

The sites 0x04A9 / 0x050C / 0x0520 / 0x0522 / 0x052D carry the nearest label
`COLOUR_TEST_MODE`, but they are actually **POST hardware self-test** code
(NMI-enable/disable 0x4C/0x4D, intercept 0x4E, beam-wait) that runs every boot —
which is why they fire in attract while the genuine color-test sites (0x023B-
0x0284) do not. The `COLOUR_TEST_MODE` label at 0x0200 is simply the closest
preceding label; the labels map is sparse here. Classify by the instruction
context (above), not the label.

## 6. Values Phase 7/8 MUST treat as INPUTS (replay from capture, never recompute)

Per the FROZEN heavy-trace fidelity rule #1, a port/routine bench must replay
these captured values rather than recompute them:

1. **Port 0x4E read at 0x26B4 (V256 bit0)** — the interrupt-path selector. Its
   per-IRQ value is timing-locked; replay the captured sequence.
2. **The interrupt-phase counter 0x089F/0x08A0** — derived from #1 over many
   IRQs. A bench for any routine that reads it (the dispatcher; COLLISION_
   DETECTION at game start) must seed it from the captured value.
3. **LCG seed 0x435C** — derived from #2 at game start. A RANDOM-consumer bench
   must start from the captured seed; RANDOM itself is then bit-exact (T4.2
   confirmed JS==MAME across seed states).

Everything else is reproducible from `(cold reset + input script + DIP settings
+ NVRAM)` and is NOT an input-to-replay:

- Ports **0x48/0x49/0x4A** — deterministic from the input script.
- DIP banks **0x60-0x65** — deterministic from DIP settings.
- **NVRAM 0x0800-0x0BFF** — deterministic given saved state (clear it for a
  hermetic bench).
- Port **0x44** (sound status) — our model returns constant READY; it never
  reaches placement.
- Ports **0x4C/0x4D** (NMI enable/disable) — read for side effect only.
- Port **0x4E bit 7** (collision flop) — deterministic given the draw sequence
  (needs the T2.5 magic-RAM model, NOT a replayed input).

## 7. RANDOM (0x2678) consumer list — 13 call sites

`call $2678` = bytes `[205,120,38]`, exhaustively from the oracle:

```
0x16BC  COLLISION_DETECTION(+237)            0x25EB  ROBOT_ANIMATION_TABLES(+172)
0x17D6  V.LOOP(+41)                          0x25EF  ROBOT_ANIMATION_TABLES(+176)
0x1821  V.LOOP(+116)                         0x2B6C  WRITE_RANDOM_SENTENCE_TO_BUFFER(+1)
0x2121  SR.TAB(+132)                         0x2BA2  GENERATE_ROBOT_SPEECH(+11)
0x2130  SR.TAB(+147)                         0x2BAF  GENERATE_ROBOT_SPEECH(+24)
0x2137  SR.TAB(+154)                         0x2BED  TRY_SPEAK_ON_PLAYER_LEAVING_ROOM(+9)
0x21C6  SR.TAB(+297)
```

(no `jp $2678`.) Roles: robot movement (V.LOOP), robot spawn/animation tables
(SR.TAB, ROBOT_ANIMATION_TABLES), the game-start seed-rewrite (COLLISION_
DETECTION), and speech selection (the three speech routines). Object PLACEMENT
flows through the movement/animation consumers; SPEECH variety flows through the
speech consumers — both off the same seed, so interrupt-phase timing perturbs
both.
