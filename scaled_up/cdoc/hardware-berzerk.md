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
- **Geometry**: 256x224. `HTOTAL=0x140`, `VTOTAL=0x106`. [L166, L169]
- **VRAM (0x4000-0x5FFF)**: Direct bitmap.
- **Magic RAM (0x6000-0x7FFF)**: 
    - Accesses map to the same physical memory as VRAM [L668].
    - Writes trigger the `magicram_w` ALU logic [L668].
    - Uses two 74181 ALUs (`ls181_10c`, `ls181_12c`) and a barrel shifter.
- **Color RAM (0x8000-0x87FF)**: Block granularity for color mapping.
- **Intercept**: Reading port `0x4e` clears pending frame interrupts (HW note; not in `intercept_v256_r`). [L721]

## 5. Interrupts
- **IRQ**: 
    - Vector: `0xFC`. [L289]
    - Frequency: 2 per frame. [L292]
    - Triggered by `irq_timer` at counts `{0x80, 0xda}`. [L293]
    - Enabled via port `0x4f` (`irq_enable_w`). [L273]
- **NMI**: 
    - Vector: Z80 default.
    - Frequency: 8 per frame.
    - Triggered roughly every 32 scanlines at `{0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0, 0xf0}`. [L356]
    - Controlled via ports `0x4c` (Enable) and `0x4d` (Disable). [L348, L719-720]

## 6. DIP Switches & Input Ports
- **P1/P2**: 8-way joystick (`IPT_JOYSTICK_LEFT`, `RIGHT`, `UP`, `DOWN`). [L746-750]
- **DIP Banks**:
    - F3 (0x60), F2 (0x61), F6 (0x62), F5 (0x63), F4 (0x64), SW2 (0x65).
    - Each bank is 8 bits wide.
- **Coinage**: Defined via `BERZERK_COINAGE` macro [L721-743].

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
