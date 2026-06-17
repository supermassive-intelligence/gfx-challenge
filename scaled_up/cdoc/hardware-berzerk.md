# Berzerk Hardware Contract

Derived from MAME `src/mame/stern/berzerk.cpp`. This document serves as the authoritative specification for the JS machine implementation.

## 1. CPU & Clocks
- **Type**: Z80
- **Clock**: 2.5 MHz (`MASTER_CLOCK / 4` where `MASTER_CLOCK` is 10 MHz). [L162-163, L1172]
- **Populated ROM Regions**: 12 KB total.
    - ROM0: 0x0000 - 0x07FF (2KB) [berzerk_map]
    - ROM1-5: 0x1000 - 0x37FF (10KB) [L670]
    - *Note: 0x0800 - 0x0BFF is NVRAM (1KB, 0x400 bytes), mirrored.* [L669]
    - *Note: 0x3800 - 0x3FFF is the empty ROM6 socket -- a mapped ROM region with
      no ROM loaded, so reads return MAME's unloaded-ROM fill 0xFF (distinct from
      the truly-unmapped 0xC000+ which reads 0x00).* [L670]

> Erratum (2026-06-12): an earlier revision of this section listed 14 KB
> populated ROM, ROM1-5 as 0x1000-0x3FFF (12 KB), and NVRAM as 2 KB. Corrected
> per Sudnya's review of the driver `berzerk_map` and the RC31A ROM-loading
> table (only 6 program ROMs, 0x0000-0x37FF). See cdoc/decisions.md.

## 2. Memory Map (Program Address Space)
Mirror notation is the MAME mirror mask. Ranges below are canonical (the base
copy); a `mirror` makes the region also respond at the mirrored addresses.

| Range | Size | Type | Access | MAME Line | Note |
|-------|------|------|---------|-----------|------|
| 0x0000-0x07FF | 2KB | ROM | R | berzerk_map | ROM0 |
| 0x0800-0x0BFF | 1KB | RAM | R/W | L669 | NVRAM; mirror 0x0400 (also at 0x0C00-0x0FFF) |
| 0x1000-0x37FF | 10KB | ROM | R | L670 | ROM1-5 |
| 0x3800-0x3FFF | 2KB | ROM | R (fill) | L670 | ROM6 socket empty; unloaded ROM reads 0xFF, writes ignored |
| 0x4000-0x5FFF | 8KB | RAM | R/W | berzerk_map | VRAM (direct bitmap) |
| 0x6000-0x7FFF | 8KB | device | R/W | berzerk_map | Magic RAM window; writes trigger 74181 ALU, reads alias VRAM at (addr-0x2000) |
| 0x8000-0x87FF | 2KB | RAM | R/W | L673 | Color RAM; mirror 0x3800 (responds through 0xBFFF) |
| 0xC000-0xFFFF | 16KB | unmapped | None | L674 | noprw(); reads 0x00, writes ignored |

Two distinct "nothing there" fill values, MAME debugger-verified 2026-06-12
(berzerk loaded): an unloaded ROM byte reads 0xFF (`print b@3800`, the empty
ROM6 socket -> ROM_UNLOADED_FILL), while a truly-unmapped noprw() address reads
0x00 (`print b@c000` -> UNMAPPED_FILL). Both constants live in
machine/src/memory.js. Collapsing them would diverge from the oracle on any
stray read at/above 0xC000.

## 3. I/O Port Map
Global mask: `0xFF`. [L711]

| Port | Direction | Function | MAME Line | Note |
|------|-----------|----------|------------|------|
| 0x40-0x47 | R/W | Audio | L714 | Offset 4: S14001A; Offset 6: SFX Ctrl; Else: 6840 |
| 0x48 | R | P1 Input | L715 | `PORT_8WAY` joystick |
| 0x49 | R | SYSTEM Input | L716 | |
| 0x4a | R | P2 Input | L717 | `PORT_8WAY` joystick |
| 0x4b | W | Magic RAM Ctrl | L718 | Control write for ALU operations |
| 0x4c | R/W | NMI Enable | L719 | `nmi_enable_r/w` |
| 0x4d | R/W | NMI Disable | L720 | `nmi_disable_r/w` |
| 0x4e | R | Intercept/V256 | L721 | Reading clears pending frame interrupts (HW note; not in `intercept_v256_r`) |
| 0x4f | W | IRQ Enable | L722 | `irq_enable_w` |
| 0x60 | R | DIP Bank F3 | L725 | Mirror 0x18 |
| 0x61 | R | DIP Bank F2 | L726 | Mirror 0x18 |
| 0x62 | R | DIP Bank F6 | L727 | Mirror 0x18 |
| 0x63 | R | DIP Bank F5 | L728 | Mirror 0x18 |
| 0x64 | R | DIP Bank F4 | L729 | Mirror 0x18 |
| 0x65 | R | DIP Bank SW2 | L730 | Mirror 0x18 |
| 0x66 | R/W | LED Off | L731 | Reads trigger LED state |
| 0x67 | R/W | LED On | L732 | Reads trigger LED state |

## 4. Video

Pinned from `berzerk.cpp` (master, same file as the §2 map). Cross-checked
against the original project's MAME analysis (`cdoc/phase6_maze_robots_difficulty.md`
§4) and the 74181 datasheet; the original emulator booted Berzerk and passed
its power-on Magic RAM self-test with this behavior. Empirical gate: Berzerk's
ROM self-test exercises this exact hardware at boot, so a magicram error will
FAIL the game's own self-test at T2.9 boot, before any golden frames.

- **Geometry**: 256x224. `HTOTAL=0x140`, `VTOTAL=0x106`. [L166, L169]

### 4.1 VRAM (0x4000-0x5FFF) — direct bitmap
8 KB, one bit per pixel, 32 bytes per scanline. The Magic RAM window
(0x6000-0x7FFF) SHARES this same backing store: a read of 0x6000+x returns
videoram[x] (= read of 0x4000+x). [magicram_w L449-483]

### 4.2 Magic RAM control register — port 0x4B [magicram_control_w L486-493]
```
bits 7-4 : S3-S0  74181 ALU function select  (select = control >> 4, all 4 bits)
bit  3   : flip   1 = bit-reverse the shifted data
bits 2-0 : shift  right-shift count, 0-7
```
A write to 0x4B also: clears `last_shift_data` to 0, and SETS the intercept
flop to 1 (see 4.4). Reset state: `magicram_control = 0`. [machine_reset L423-432]

### 4.3 Magic RAM write pipeline — writes to 0x6000-0x7FFF [magicram_w L449-483]
Both 74181s are put in LOGIC mode (M=1) once at startup [video_start L442-446];
in logic mode the carry chain is disabled, so every bit is independent (no
ripple between the two nibble ALUs). For a write of `data` at window offset
`offset` (current VRAM byte `B = videoram[offset]`):
1. **Barrel shift**: `shifted = (((last_shift_data << 8) | data) >> (control & 7)) & 0xFF`.
   The high bits vacated by the shift are filled from the previous write's
   `last_shift_data` (this is the across-byte-boundary horizontal shift).
2. **Flip**: if `control & 0x08`, bit-reverse `shifted` (bitswap 0..7).
3. **Collision**: if `(shifted & B) != 0`, RESET the intercept flop to 0
   (J/K flop with J tied low: collisions only ever reset it; see 4.4).
4. **74181 ALU** (A = `shifted`, B = current VRAM, S = `control >> 4`, M=1),
   per bit, F output per the logic-mode table below.
5. **Invert + store**: `videoram[offset] = aluF ^ 0xFF`  (74181 outputs are
   active-low; the store is inverted — a classic future bug if dropped).
6. **Latch**: `last_shift_data = data & 0x7F`  (only 7 bits kept).

74181 logic-mode (M=1) F by select, and the stored value after `^ 0xFF`.
Cross-checked phase6 §4.3 against the datasheet positive-logic table — all 16
agree (A = shifted, B = current VRAM):

| S3-S0 | F (active-high) | stored = F^0xFF |
|-------|-----------------|------------------|
| 0x0 | ~A | A |
| 0x1 | ~(A\|B) | A\|B |
| 0x2 | ~A & B | A \| ~B |
| 0x3 | 0 | 0xFF |
| 0x4 | ~(A&B) | A & B |
| 0x5 | ~B | B |
| 0x6 | A^B | ~(A^B) |
| 0x7 | A & ~B | ~A \| B |
| 0x8 | ~A \| B | A & ~B |
| 0x9 | ~(A^B) | A^B |
| 0xA | B | ~B |
| 0xB | A & B | ~(A&B) |
| 0xC | 1 | 0x00 |
| 0xD | A \| ~B | ~A & B |
| 0xE | A\|B | ~(A\|B) |
| 0xF | A | ~A |

Common Berzerk control bytes (shift 0, no flip): 0x00 direct write (vram=shifted),
0x10 OR-draw (vram=shifted|vram), 0x90 XOR-draw (vram=shifted^vram), 0xC0 clear.

### 4.4 Intercept / collision flop — port 0x4E read [intercept_v256_r L496-504]
A one-bit flip-flop. It is SET to 1 by any control write to 0x4B (4.2), and
only ever RESET to 0 by a colliding magicram write (4.3 step 3). Reading port
0x4E returns it INVERTED in bit 7, OR'd with the V256 video counter in the low
bits: `value = ((intercept ^ 1) << 7) | v256`. So read bit 7 == 1 means "a
collision occurred since the last control write." Reading 0x4E does NOT change
the intercept flop. NOTE: the schematic / address-map comment [L707] suggests a
0x4E read also clears the pending frame IRQ, but MAME's `intercept_v256_r`
[L496-504] implements NO clear (neither for the intercept flop nor the IRQ); we
match the oracle and do not implement it (see §5.4).

### 4.5 Color RAM (0x8000-0x87FF) — 4x4 attribute blocks [screen_update L541-576]
2 KB. For VRAM offset `offs`, the color byte is
`colorram[((offs >> 2) & 0x07E0) | (offs & 0x001F)]` — i.e. one color byte per
(4 pixels wide x 4 scanlines tall) block. Within a VRAM byte: the color byte's
HIGH nibble colors the left 4 pixels (VRAM bits 7..4), the LOW nibble the right
4 pixels (bits 3..0). A set VRAM bit draws `pens[nibble]`, a clear bit draws
black. Pen nibble is RGBI: bit0=R, bit1=G, bit2=B, bit3=intensity [L527-536].
Render order is MSB-first (bit 7 = leftmost pixel) [original video.nw, visually
confirmed]. NOTE: the exact RGBI intensity levels (resistor-network values) are
not pinned here; renderToRGBA uses a documented approximation, display-only,
to be confirmed visually at T2.9. The Phase-3 frame hash is over VRAM+color RAM
bytes, not rendered pixels, so it does not depend on the pen levels.

## 5. Interrupts & Frame Timing

Pinned from berzerk.cpp (clocks/geometry L166-179, trigger tables L181-185,
vsync conversion L230-265, IRQ L283-302, NMI L332-379, machine_reset L423-432).

### 5.1 Clocks & frame budget [L166-179]
```
MASTER_CLOCK = 10 MHz
CPU   = MASTER/4 = 2.5 MHz       PIXEL = MASTER/2 = 5 MHz
HTOTAL = 0x140 (320)   VTOTAL = 0x106 (262)
VBEND  = 0x20  (32)    VBSTART = 0x100 (256)
```
CPU T-states per scanline = HTOTAL / (PIXEL/CPU) = 320 / 2 = **160**.
CYCLES_PER_FRAME = 160 x 262 = **41920** (frame rate 2.5e6/41920 ~= 59.64 Hz).
The scheduler is cycle-counted off these constants only — never wall-clock —
so Phase 3/4 reproducibility holds.

### 5.2 Vertical counter <-> scanline (vsync chain) [L230-265]
The interrupt positions are given as `(V-counter, V256)` pairs, and the counter
is NOT the scanline in the vblank region. Verbatim conversion:
```
vpos_to_vsync_chain_counter(vpos):
  v256 = (vpos < VBEND) || (vpos >= VBSTART)          # "in vblank"
  counter = v256 ? (vpos - VBSTART + 0xda  (+VTOTAL if <0)) : vpos
vsync_chain_counter_to_vpos(counter, v256):
  vpos = v256 ? (counter - 0xda + VBSTART  (-VTOTAL if >=VTOTAL)) : counter
```
V256 readable in the port-0x4E read is the single `v256` BIT (0/1), NOT the
counter — pass only that bit to §4.4 readIntercept.

### 5.3 Trigger tables (counts and v256 are PAIRED columns) [L181-185]
```
IRQ (2/frame): counts {0x80, 0xda}   v256 {0, 1}
NMI (8/frame): counts {0x30,0x50,0x70,0x90,0xb0,0xd0,0xf0,0xf0}
               v256   {0,   0,   0,   0,   0,   0,   0,   1}
```
Resolved firing scanlines (via 5.2) and cycle offsets (vpos x 160):
```
NMI vpos: 16,48,80,112,144,176,208,240  (every 32 lines)
  cycles: 2560,7680,12800,17920,23040,28160,33280,38400
IRQ vpos: 128 (0x80,0) and 256 (0xda,1)   cycles: 20480, 40960
```
The two `0xf0` NMI entries are NOT a duplicate: (0xf0,v256=0)->line 240,
(0xf0,v256=1)->0xf0-0xda+0x100=0x116>=VTOTAL->line 16.

### 5.4 IRQ — HELD, vector 0xFC [L283-302]
`set_input_line_and_vector(0, HOLD_LINE, 0xFC)`: the line is LEVEL-HELD until
the CPU acknowledges, and byte 0xFC is on the data bus during ack. Berzerk runs
IM 2 (loads I at boot), so the jump goes through table entry `(I<<8)|0xFC`.
Enabled via port 0x4F (`irq_enable_w`). The enable only gates whether a NEW
trigger asserts the line; it does NOT retract an already-held IRQ (HOLD_LINE
survives `irq_enable_w(0)`). A held IRQ is cleared by the CPU's interrupt
acknowledge. NOTE (match-the-oracle): the schematic / address-map comment [L707]
says reading port 0x4E clears the pending frame IRQ, but MAME's
`intercept_v256_r` [L496-504] implements NO such clear (see also the §3 table:
"not in intercept_v256_r"). We follow MAME, not the schematic — do not wire a
0x4E-read IRQ clear. (Hold vs pulse backwards = missed/doubled IRQs that only
surface as gameplay weirdness.)

### 5.5 NMI — PULSE, vector 0x0066 [L332-379]
`pulse_input_line` — edge-triggered, serviced once; jumps to 0x0066 (Z80
default NMI), clears IFF1 (IFF2 preserved). Enable AND disable happen on BOTH
the read and the write of ports 0x4C (enable) / 0x4D (disable).

### 5.6 Reset [L423-432]
`machine_reset`: irq_enabled=0, nmi_enabled=0, both frame timers started.

## 6. Input Ports & DIP Switches

Pinned from berzerk.cpp `INPUT_PORTS_START(berzerk)` [L751-843] and the
`BERZERK_COINAGE` macro [L730-747]. Defaults are for the BASE `berzerk` set
(English). Clones (berzerkf/berzerkg/...) override only the F3 Language default
(and use different speech ROMs); our ROM set is base RC31 berzerk, so English /
0x00 is correct. See cdoc/decisions.md.

Field names below are canonical: the input-script schema (T3.1) resolves them on
both platforms, so they MUST match these exactly -- input.js setField() throws on
any other name (the typo guard is load-bearing for T3.1/T3.2 cross-platform replay,
not decoration).

### 6.1 Read-port address map [L711-719]
| Addr | Port | Kind |
|------|------|------|
| 0x48 | P1     | input |
| 0x49 | SYSTEM | input |
| 0x4a | P2     | input + Cabinet DIP (bit 7) |
| 0x60 | F3  | DIP |
| 0x61 | F2  | DIP |
| 0x62 | F6  | DIP (coinage, chute 3) |
| 0x63 | F5  | DIP (coinage, chute 2) |
| 0x64 | F4  | DIP (coinage, chute 1) |
| 0x65 | SW2 | service inputs (mixed polarity) |
Ports 0x60-0x67 are mirrored by mask 0x18 -- each also responds at +0x08, +0x10,
+0x18 (e.g. F3 at 0x60/0x68/0x70/0x78). 0x66/0x67 are LED off/on (not inputs).
`MONITOR_TYPE` is a FAKE MAME config port (Wells-Gardner 0x00 / Electrohome 0x01),
NOT CPU-readable -- it only weights the renderer pens (T2.5). It is deliberately
ABSENT from this map and from input.js; model it as video config or the machine
desyncs against MAME (which never lets the CPU read it).

### 6.2 Input bit fields
Polarity is PER-BIT, not per-port. Active-low: unpressed bit = 1, pressed = 0.
Active-high: unpressed = 0, pressed = 1. Unused active-low bits read 1, unused
active-high read 0.
```
P1     [L751-757] active-low:  0x01 LEFT 0x02 RIGHT 0x04 UP 0x08 DOWN 0x10 BUTTON1 ; 0xe0 unused
P2     [L759-768] active-low, cocktail: 0x01 LEFT 0x02 RIGHT 0x04 UP 0x08 DOWN 0x10 BUTTON1 ; 0x60 unused ; 0x80 Cabinet DIP
SYSTEM [L772-778] active-low:  0x01 START1 0x02 START2 ; 0x1c unused ; 0x20 COIN3 0x40 COIN2 0x80 COIN1
SW2    [L787-801] MIXED:       0x01 SERVICE1 "Free Game" ACTIVE_HIGH ; 0x7e unused active-low ; 0x80 SERVICE2 "Bookkeeping" ACTIVE_HIGH
```
Default reads (no input pressed, DIPs default): P1=0xFF, SYSTEM=0xFF, P2=0xFF,
SW2=0x7E, F2=0xFC, F3=0x3C, F4=F5=F6=0xF0.

### 6.3 DIP switches & factory defaults
```
Cabinet  (P2 0x80)  default 0x80 : 0x80 Upright, 0x00 Cocktail
F2 [L808-817]: Color Test (0x03) default 0x00 {Off 0x00, On 0x03}
               Bonus Life (0xc0) default 0xc0 {0xc0 "5000 and 10000", 0x40 "5000",
                                               0x80 "10000", 0x00 None}   ; 0x3c unused
F3 [L819-831]: Input Test Mode (0x01) default 0x00 {Off 0x00, On 0x01}
               Crosshair Pattern (0x02) default 0x00 {Off 0x00, On 0x02}
               Language (0xc0) default 0x00 {English 0x00, German 0x40,
                                             French 0x80, Spanish 0xc0} ; 0x3c unused
F4/F5/F6 [L833-843]: Coinage (0x0f) chutes 1/2/3, default 0x00 ; 0xf0 unused
```

### 6.4 BERZERK_COINAGE (mask 0x0f, default 0x00 = 1C/1C) [L730-747]
All 16 nibble values are defined (no gaps): 0x00 1C/1C, 0x01 1C/2C, 0x02 1C/3C,
0x03 1C/4C, 0x04 1C/5C, 0x05 1C/6C, 0x06 1C/7C, 0x07 1C/10C, 0x08 "1 Coin/14
Credits", 0x09 2C/1C, 0x0a 2C/3C, 0x0b 2C/5C, 0x0c 2C/7C, 0x0d 4C/3C, 0x0e 4C/5C,
0x0f 4C/7C.

## 7. Sound/Speech (CPU Interface)
- **S14001A Speech**:
    - Command Port: `0x44` (Audio offset 4). [L585, L588]
    - Data Write (`data >> 6 == 0`): Writes 6 bits of data to the chip, then pulses the start line (L591-594).
    - Control Write (`data >> 6 == 1`): 
        - Volume: `(data >> 3 & 7) / 7.0` (0 = inaudible). [L600]
        - Clock Divisor: `16 - (data & 0x07)`. Final clock is `S14001_CLOCK / divisor / 8` (range 19.5kHz to 34.7kHz). [L602-603]
- **6840 SFX**:
    - All other audio ports (`0x40-0x43`, `0x45-0x47`) write to the 6840-based sound board. [L610]
- **SFX Ctrl**:
    - Port `0x46` (Audio offset 6) writes to `sfxctrl_w`. [L607]

## 8. Nondeterminism Candidates
- **NVRAM**: 0x0800. Initial state depends on battery-backed memory.
- **Speech Clock**: Software-controllable clock divisor affects timing of utterances.
- **S14001A Volume**: Volume gain can be changed mid-game.
- **DIP Switches**: Configuration of game options (e.g. difficulty) can change behavior.
- **Input**: Joystick movement is asynchronous.
