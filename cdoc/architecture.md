# Berzerk Arcade Machine Architecture

Reference document for the literate C++ emulator. All information derived from
MAME source code (src/mame/stern/berzerk.cpp and associated device files).

## Hardware Overview

Berzerk is a Stern Electronics arcade game (1980) built around a Z80 CPU with
custom video, sound, and I/O hardware. The machine uses a single-board design
with the CPU, video, and sound integrated onto one PCB.

Manufacturer: Stern Electronics
Year: 1980
Orientation: Horizontal (ROT0)
Primary ROM revision: RC31A

## Clock Tree

```
Master Crystal: 10.000 MHz
    |
    +-- / 4 --> CPU Clock:   2.500 MHz (Z80)
    |
    +-- / 2 --> Pixel Clock: 5.000 MHz
    |
    +-- / 4 --> S14001A Base Clock: 2.500 MHz
                    |
                    +-- / divisor / 8 --> Speech sample rate
                        (divisor = 16 - (control & 0x07), default 16)
                        Default rate: 2,500,000 / 16 / 8 = 19,531 Hz
```

## CPU: Zilog Z80

Clock: 2.5 MHz
Address space: 16-bit (64KB)
I/O space: 8-bit (256 ports, active mask 0xFF)

### Z80 Register Set

Main registers: A, F, B, C, D, E, H, L (8-bit), accessible as pairs AF, BC, DE, HL (16-bit)
Shadow registers: AF', BC', DE', HL' (swapped via EX AF,AF' and EXX)
Index registers: IX, IY (16-bit)
Stack pointer: SP (16-bit)
Program counter: PC (16-bit)
Interrupt vector: I (8-bit, used in IM 2)
Refresh counter: R (8-bit, 7-bit counter + bit 7 preserved)
Internal: WZ (16-bit, undocumented MEMPTR register)

### Z80 Flags (F register)

```
Bit 7: S  (Sign)
Bit 6: Z  (Zero)
Bit 5: Y  (undocumented, copy of bit 5 of result)
Bit 4: H  (Half-carry)
Bit 3: X  (undocumented, copy of bit 3 of result)
Bit 2: PV (Parity/Overflow)
Bit 1: N  (Subtract)
Bit 0: C  (Carry)
```

MAME decomposes flags into separate variables for efficient access during
instruction execution, then recomposes them when F is read directly. Our
implementation should follow the same pattern.

### Z80 Interrupt Modes

The Z80 supports three interrupt modes. Berzerk uses IM 0 with vector 0xFC
placed on the data bus during interrupt acknowledge.

- IM 0: Read instruction from data bus during INTA. Berzerk places RST 38h-like
  vectors. The driver uses vector 0xFC (which is a RST 30h variant, jumping
  to address 0x0038... actually 0xFC maps to CALL-like behavior per MAME).
  MAME handles: if vector byte matches RST pattern ((vec & 0xC7) == 0xC7),
  push PC and jump to (vec & 0x0038). For 0xFC: push PC, jump to 0x0038.
  Wait -- 0xFC & 0xC7 = 0xC4, not 0xC7. Let me re-examine.
  Actually: the driver sets vector 0xFC via set_input_line_and_vector(0, HOLD_LINE, 0xFC).
  In MAME IM 0 handling, 0xFC does not match RST pattern. It likely falls through
  to the CALL 0xnn pattern or is treated as a direct vector. This needs careful
  verification against MAME's take_interrupt logic. The key point: IRQ vector is 0xFC.

- IM 1: Jump to 0x0038. Not used by Berzerk but must be implemented.

- IM 2: Read low byte from bus, combine with I register for vector table lookup.
  Jump to address stored at (I << 8 | vector). Not used by Berzerk but must
  be implemented for completeness.

- NMI: Non-maskable, always jumps to 0x0066. Clears IFF1 only (IFF2 preserved).

## Memory Map

### Berzerk (berzerk_map)

```
Address Range    Size    Description
----------------------------------------------------------------------
0x0000 - 0x07FF  2 KB   ROM (boot/ROM0)
0x0800 - 0x0BFF  1 KB   RAM + NVRAM (mirrored, actual 0x0400 bytes)
0x0C00 - 0x0FFF          Mirror of 0x0800-0x0BFF
0x1000 - 0x17FF  2 KB   ROM1
0x1800 - 0x1FFF  2 KB   ROM2
0x2000 - 0x27FF  2 KB   ROM3
0x2800 - 0x2FFF  2 KB   ROM4
0x3000 - 0x37FF  2 KB   ROM5
0x3800 - 0x3FFF  2 KB   ROM6 (unpopulated, reads 0xFF)
0x4000 - 0x5FFF  8 KB   Video RAM (direct read/write)
0x6000 - 0x7FFF  8 KB   Magic RAM (writes go through 74181 ALU to VRAM)
                         Reads come from underlying VRAM at (addr - 0x2000)
0x8000 - 0x87FF  2 KB   Color RAM (mirrored with 0x3800 stride to 0xBFFF)
0xC000 - 0xFFFF         Unmapped
```

Note: Magic RAM at 0x6000-0x7FFF is not separate memory. Writes go through the
74181 ALU hardware and the result is written to Video RAM at offset (addr - 0x2000).
Reads from 0x6000-0x7FFF return the Video RAM content at the corresponding address.

### ROM Loading (RC31A revision)

```
Address    File                          Size   CRC32
--------------------------------------------------------------
0x0000     berzerk_rc31_1c.rom0.1c      2 KB   0xca566dbc
0x1000     berzerk_rc31_1d.rom1.1d      2 KB   0x7ba69fde
0x1800     berzerk_rc31_3d.rom2.3d      2 KB   0xa1d5248b
0x2000     berzerk_rc31_5d.rom3.5d      2 KB   0xfcaefa95
0x2800     berzerk_rc31_6d.rom4.6d      2 KB   0x1e35b9a0
0x3000     berzerk_rc31a_5c.rom5.5c     2 KB   0xe0fab8f5
0x3800     (unpopulated, filled 0xFF)   2 KB   --
```

### Speech ROM

```
Address    File                          Size   CRC32
--------------------------------------------------------------
0x0000     berzerk_r_vo_1c.1c           2 KB   0x2cfe825d
0x0800     berzerk_r_vo_2c.2c           2 KB   0xd2b6324e
```

## I/O Port Map

Global address mask: 0xFF (only low 8 bits of address bus used for I/O)

```
Port     Read                    Write
----------------------------------------------------------------------
0x40     6840 timer (offset 0)   6840 timer (offset 0)
0x41     6840 timer (offset 1)   6840 timer (offset 1)
0x42     6840 timer (offset 2)   6840 timer (offset 2)
0x43     6840 timer (offset 3)   6840 timer (offset 3)
0x44     S14001A busy status     S14001A data/control
0x45     6840 timer (offset 5)   6840 timer (offset 5)
0x46     (error/unused)          SFX control latch
0x47     6840 timer (offset 7)   6840 timer (offset 7)
0x48     Player 1 joystick       (no-op)
0x49     System inputs           (no-op)
0x4A     Player 2 joystick       (no-op)
0x4B     (no read)               Magic RAM control
0x4C     NMI enable (side-eff)   NMI enable
0x4D     NMI disable (side-eff)  NMI disable
0x4E     Intercept + V256        (no write)
0x4F     (no read)               IRQ enable
0x60*    DIP switch F3           (no-op)
0x61*    DIP switch F2           (no-op)
0x62*    DIP switch F6           (no-op)
0x63*    DIP switch F5           (no-op)
0x64*    DIP switch F4           (no-op)
0x65*    DIP switch SW2          (no-op)
0x66*    LED off (side-effect)   LED off
0x67*    LED on (side-effect)    LED on

* Ports 0x60-0x67 are mirrored at +0x08, +0x10, +0x18
  (i.e., 0x60=0x68=0x70=0x78, etc.)
```

## Video System

### Display Parameters

```
Resolution (visible):  256 x 224 pixels
Total H pixels:        320 (0x140)
Total V lines:         262 (0x106)
H blank end:           0x000
H blank start:         0x100 (pixel 256)
V blank end:           0x020 (line 32)
V blank start:         0x100 (line 256)
Pixel clock:           5.000 MHz
Frame rate:            ~59.64 Hz (5,000,000 / 320 / 262)
```

### Video RAM Layout

Video RAM occupies 8 KB at 0x4000-0x5FFF. Each byte represents 8 horizontal
pixels (MSB = leftmost pixel). The mapping is:

```
byte offset = (y * 32) + (x / 8)
bit within byte = 7 - (x % 8)

For a given offset:
    y = offset >> 5        (offset / 32)
    x = (offset & 0x1F) * 8   (low 5 bits * 8)
```

Display is 256 pixels wide = 32 bytes per row.
Display is 256 lines tall (0x00-0xFF) but only 224 visible (lines 0x20-0xFF map
to screen, lines 0x00-0x1F are vblank).

### Color RAM Layout

Color RAM occupies 2 KB at 0x8000-0x87FF. Each color byte covers 8 pixels
(same horizontal span as one video RAM byte), but the color is split:

```
High nibble (bits 7-4): color for left 4 pixels of the group
Low nibble (bits 3-0):  color for right 4 pixels of the group
```

The color RAM address for a given video RAM offset is:
```
color_addr = ((offset >> 2) & 0x07E0) | (offset & 0x001F)
```

This means each color byte covers 4 video RAM bytes horizontally (32 pixels),
with two independent 4-pixel color zones within that span.

### Color Generation

16 colors derived from 4 bits:

```
Bit 0: Red
Bit 1: Green
Bit 2: Blue
Bit 3: Intensity
```

Actual RGB values depend on monitor type (selected via DIP switch):
- Wells-Gardner: 750 ohm resistor network
- Electrohome: 750 ohm || 360 ohm (~243 ohm) resistor network

Color 0 always maps to black (background). When a video RAM bit is 0, the pixel
is black regardless of the color RAM value.

### Screen Update Algorithm (from MAME)

```
for each byte offset in videoram (0 to videoram_size):
    data = videoram[offset]
    color = colorram[((offset >> 2) & 0x07E0) | (offset & 0x001F)]

    y = offset >> 5
    x = (offset & 0x1F) << 3

    for i = 0 to 3:
        pixel = (data & 0x80) ? palette[color >> 4] : BLACK
        plot(x, y, pixel)
        x++; data <<= 1

    for i = 4 to 7:
        pixel = (data & 0x80) ? palette[color & 0x0F] : BLACK
        plot(x, y, pixel)
        x++; data <<= 1
```

## Magic RAM (Graphics ALU)

The Berzerk hardware includes two 74181 4-bit ALU chips (at board positions 10C
and 12C) that perform hardware-accelerated bit operations on video RAM writes.
This is used for fast sprite drawing, collision detection, and screen clearing.

### Control Register (port 0x4B)

Writing to I/O port 0x4B sets the magic RAM control byte which configures:
- The ALU operation (via 74181 select/mode inputs)
- The shift amount for incoming data

### Magic RAM Write Operation

When the CPU writes to address range 0x6000-0x7FFF:

1. The write data is captured as the new shift input
2. A shift operation combines the previous write data and current write data:
   - The 74181 ALUs at 10C and 12C receive the control signals
   - Data is shifted and combined according to the programmed operation
3. The result is written to Video RAM at (address - 0x2000)
4. If the result AND the existing VRAM content are both non-zero at any bit
   position, the intercept flag (m_intercept) is set (collision detected)

### Collision Detection (port 0x4E read)

Reading port 0x4E returns:
```
Bit 7: V256 (vertical counter bit 8, indicates vblank region)
Bit 0-6: (other bits come from the read, but intercept is the key one)
```

Actually, the intercept flag is returned in the read value and the V256 status
is combined. The exact bit mapping needs verification from MAME source, but
the intercept flag is set whenever a magic RAM write would cause overlapping
non-zero pixels (hardware collision detection).

## Interrupt System

### IRQ (Maskable Interrupt)

2 IRQs per frame, triggered at specific vertical counter positions:

```
IRQ 0: V-counter = 0x80, V256 = 0 (mid-screen, approximately line 128)
IRQ 1: V-counter = 0xDA, V256 = 1 (during vblank)
```

Vector: 0xFC (placed on data bus during INTA cycle)
Enable/disable: Write to port 0x4F, bit 0 (1=enabled, 0=disabled)

When IRQ fires and is enabled:
- CPU acknowledges interrupt
- Vector 0xFC is read from bus
- In IM 0, this is executed as an instruction

### NMI (Non-Maskable Interrupt)

8 NMIs per frame, triggered at these vertical counter positions:

```
NMI 0: V-counter = 0x30, V256 = 0
NMI 1: V-counter = 0x50, V256 = 0
NMI 2: V-counter = 0x70, V256 = 0
NMI 3: V-counter = 0x90, V256 = 0
NMI 4: V-counter = 0xB0, V256 = 0
NMI 5: V-counter = 0xD0, V256 = 0
NMI 6: V-counter = 0xF0, V256 = 0
NMI 7: V-counter = 0xF0, V256 = 1
```

Enable/disable:
- Port 0x4C write: NMI enabled
- Port 0x4D write: NMI disabled
- Port 0x4C read: NMI enabled (side effect), returns 0
- Port 0x4D read: NMI disabled (side effect), returns 0

When NMI fires and is enabled:
- CPU pushes PC to stack
- CPU jumps to 0x0066
- IFF1 cleared, IFF2 preserved

### Vertical Counter Conversion

The V-sync chain counter does not map 1:1 to screen line position. MAME
converts between the two using:

```
vpos_to_vsync_chain_counter(vpos):
    if vpos < VBEND (0x20) or vpos >= VBSTART (0x100):
        v256 = 1
    else:
        v256 = 0

vsync_chain_counter_to_vpos(counter, v256):
    (inverse mapping, used to schedule timer callbacks)
```

Timers are scheduled using screen.time_until_pos() to fire at the exact
scanline where each interrupt should occur.

## Sound System

### S14001A Speech Synthesis (Votrax)

The S14001A is a speech synthesis chip that plays back digitized speech from ROM.
It is controlled through I/O port 0x44:

Write port 0x44:
```
Bits 7-6: Mode select
    00: Load word address (bits 5-0) and trigger playback
    01: Set volume (bits 5-3) and clock divisor (bits 2-0)
        Volume = (data >> 3) & 7, applied as gain = volume / 7.0
        Divisor = 16 - (data & 0x07)
        Clock = 2,500,000 / divisor / 8
    10: Unused
    11: Unused
```

Read port 0x44:
```
Bit 6: Busy status (0 = busy, 0x40 = ready)
```

Speech ROM: 4 KB total (two 2 KB chips)

### Exidy Custom Sound (6840 Timer)

The main sound effects use a Motorola 6840 PTM (Programmable Timer Module)
driving a custom noise/tone generator circuit. This is the same sound system
used in other Exidy games.

Controlled through I/O ports 0x40-0x43, 0x45, 0x47 (6840 timer registers)
and port 0x46 (SFX control latch, bits 7-6 select function).

Audio output: mono speaker
Gain: S14001A at 0.5 through volume filter, Exidy custom at 0.33

## Input System

### Player 1 (port 0x48)

```
Bit 0: Left
Bit 1: Right
Bit 2: Up
Bit 3: Down
Bit 4: Fire
Bits 5-7: Unused
```

### Player 2 (port 0x4A)

```
Bit 0: Left (active in cocktail mode)
Bit 1: Right
Bit 2: Up
Bit 3: Down
Bit 4: Fire
Bits 5-6: Unused
Bit 7: Cabinet type (0x80 = Upright, 0x00 = Cocktail)
```

### System Inputs (port 0x49)

```
Bit 0: Start 1 (active low)
Bit 1: Start 2 (active low)
Bits 2-4: Unused
Bit 5: Coin 3 (active low)
Bit 6: Coin 2 (active low)
Bit 7: Coin 1 (active low)
```

### DIP Switches

**F2 (port 0x61):**
```
Bits 0-1: Color Test (0x00=Off, 0x03=On)
Bits 6-7: Bonus Life (0xC0=5000+10000, 0x40=5000, 0x80=10000, 0x00=None)
```

**F3 (port 0x60):**
```
Bit 0: Input Test Mode (0=Off, 1=On)
Bit 1: Crosshair Pattern (0=Off, 1=On)
Bits 6-7: Language (0x00=English, 0x40=German, 0x80=French, 0xC0=Spanish)
```

**F4 (port 0x64) -- Coin Chute 1 Coinage:**
```
Bits 0-3: Coinage value (16 settings)
    0x00=1C/1C  0x01=1C/2C  0x02=1C/3C  0x03=1C/4C
    0x04=1C/5C  0x05=1C/6C  0x06=1C/7C  0x07=1C/10C
    0x08=1C/14C 0x09=2C/1C  0x0A=2C/3C  0x0B=2C/5C
    0x0C=2C/7C  0x0D=4C/3C  0x0E=4C/5C  0x0F=4C/7C
```

**F5 (port 0x63) -- Coin Chute 2 Coinage:** Same encoding as F4

**F6 (port 0x62) -- Coin Chute 3 Coinage:** Same encoding as F4

**SW2 (port 0x65):**
```
Bit 0: Free Game trigger (not logged in bookkeeping)
Bit 7: Bookkeeping mode
```

## MAME Component Dependencies

These are the MAME device/library components used by the Berzerk driver.
Each represents a hardware component we need to emulate:

```
Component               MAME Source                  Purpose
------------------------------------------------------------------------
Z80 CPU                 cpu/z80/z80.h                Main processor
74181 ALU (x2)          machine/74181.h              Magic RAM shifting
NVRAM                   machine/nvram.h              Battery-backed RAM
S14001A speech          sound/s14001a.h              Voice synthesis
Filter Volume           sound/flt_vol.h              Audio gain control
Exidy Sound             exidysound.h                 6840 timer sound
Screen                  screen.h                     Video timing/display
Speaker                 speaker.h                    Audio output
Resistor Network        video/resnet.h               Color calculation
```

## Design Decisions to Follow from MAME

1. All memory access through callbacks (data_read/data_write, not direct array
   access). This provides observability and enables instrumentation.

2. Flags decomposed into separate variables during execution, composed only
   when F register is read directly. Avoids per-instruction bit manipulation.

3. Interrupt timing driven by screen position timers, not cycle counting.
   Use the host display timing to schedule IRQ/NMI at correct scanlines.

4. Video rendering is scanline-independent in MAME (full frame update). The
   screen_update function iterates all of VRAM each frame. This is acceptable
   because Berzerk does not use mid-frame rendering tricks.

5. Magic RAM ALU operations are performed inline during the write callback.
   The intercept flag is set atomically during the write.

6. Sound chips run on their own timing. The S14001A has its own clock and
   the 6840 timer generates its own frequencies. Audio is mixed to mono.

## Cosimulation Architecture

This emulator will implement a base class interface that enables:

1. A second implementation (pure C++ game logic, no hardware emulation) to
   satisfy the same interface
2. Cosimulation comparing outputs between the two implementations
3. Statistical measurement of events
4. Unit testing of individual components

The base class should define:
- Machine state initialization and reset
- Per-frame or per-step execution
- State snapshot/restore for comparison
- Event logging (memory access, I/O, interrupts)
- Video frame output comparison
- Audio sample output comparison
