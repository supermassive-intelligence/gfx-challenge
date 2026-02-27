# Berzerk Emulator -- What Has Been Implemented

Summary of all work completed across Phases 0--5.

## Literate Program Structure

All source code lives in 6 noweb files under `noweb/`. The `notangle` tool extracts C++ into `src/` and `include/`. The `noweave` tool produces LaTeX documentation. No C++ is written or edited directly -- the `.nw` files are the single source of truth.

| noweb source | Tangled output | Purpose |
|---|---|---|
| `noweb/main.nw` | `src/main.cpp` | Entry point, emulation loop, ROM loading, self-test |
| `noweb/memory.nw` | `include/memory.h`, `src/memory.cpp`, `src/berzerk_map.cpp` | AddressSpace class, ROM loader, Berzerk memory map, Z80 CPU |
| `noweb/video.nw` | `include/video.h`, `src/video.cpp` | VRAM, Color RAM, Magic RAM / 74181 ALU, rendering |
| `noweb/sound.nw` | `include/sound.h`, `src/sound.cpp` | S14001A and 6840 stubs |
| `noweb/interrupts.nw` | `include/interrupts.h`, `src/interrupts.cpp` | Per-frame interrupt timing |
| `noweb/platform.nw` | `include/platform.h`, `src/platform.cpp` | SDL2 window, input, texture |

The Z80 CPU implementation (`include/z80.h`, `src/z80.cpp`, `src/z80_test.cpp`) is also tangled from `noweb/memory.nw`.

## Phase 0: Infrastructure

- Docker build environment: Ubuntu 24.04 with g++, noweb, SDL2, texlive, gdb
- `Dockerfile` for the build image
- `Makefile` with targets: `tangle`, `weave`, `build`, `clean`, `all`, `docker-build`, `docker-run`, `docker-shell`, `docker-all`, `test-z80`, `docker-test-z80`, `docker-play`
- Directory structure: `noweb/`, `src/`, `include/`, `doc/`, `cdoc/`, `rom/`
- `.gitignore` for generated artifacts (`src/`, `include/`, `build/`, `doc/`)

## Phase 1: MAME Analysis

- Fetched and analyzed MAME `berzerk.cpp` driver
- Fetched and analyzed MAME Z80 CPU core (`z80.h`, `z80.cpp`)
- Fetched and analyzed MAME 74181 ALU implementation
- Documented full hardware architecture in `cdoc/architecture.md`:
  - Clock tree: 10 MHz master, 2.5 MHz CPU, 5 MHz pixel
  - Memory map: ROM (12 KB), Work RAM (1 KB mirrored), VRAM (8 KB), Magic RAM, Color RAM (2 KB mirrored)
  - I/O port map: 0x40--0x47 sound, 0x48--0x4A inputs, 0x4B--0x4F video/interrupt control, 0x60--0x7F DIP switches
  - Video system: 256x224 visible, 16 RGBI colors, bitmap framebuffer
  - Magic RAM / 74181 ALU: shift register, mirror, collision detection, ALU combine, active-low inversion
  - Interrupt timing: 2 IRQ + 8 NMI per frame at fixed scanline positions
  - Sound system: S14001A speech chip + Exidy 6840 timer
  - Input system: active-low joystick, system buttons, DIP switches
  - Cosimulation architecture sketch

## Phase 2: Memory Subsystem

### AddressSpace Class (`memory.h`, `memory.cpp`)
- Read/write handler callbacks (`std::function<uint8_t(uint16_t)>`, `std::function<void(uint16_t, uint8_t)>`)
- Program space (16-bit address, mask 0xFFFF) and I/O space (8-bit, mask 0xFF)
- Unmapped access returns 0xFF (matches Z80 floating bus behavior)
- Instrumentation: read/write counters per address space
- Diagnostic prints on unmapped access

### ROM Loader (`memory.cpp`)
- Loads ROM files from disk by descriptor table (filename, load address, size, expected CRC32)
- CRC32 verification using standard reflected polynomial 0xEDB88320
- Fails fast with diagnostic on size mismatch or CRC error

### Berzerk Memory Map (`berzerk_map.cpp`)
- ROM0 at 0x0000--0x07FF, ROM1--ROM5 at 0x1000--0x37FF
- ROM6 at 0x3800--0x3FFF (unpopulated, reads 0xFF)
- Work RAM at 0x0800--0x0FFF (1 KB, mirrored at 0x0C00)
- VRAM at 0x4000--0x5FFF (8 KB direct read/write)
- Magic RAM at 0x6000--0x7FFF (reads from VRAM, writes through 74181 ALU)
- Color RAM at 0x8000--0xBFFF (2 KB, mirrored)
- Unmapped high memory at 0xC000--0xFFFF
- I/O ports wired to sound, input, video control, and DIP switch handlers

### Memory Self-Test (`main.nw`)
- Validates ROM read, Work RAM write/read, mirror, VRAM, Magic RAM read-through, empty ROM6, unmapped high memory
- Fails the program if any test fails

## Phase 3: Z80 CPU

### Z80 Class (`z80.h`, `z80.cpp`)
- PAIR16 register unions for AF, BC, DE, HL, IX, IY, SP, PC, WZ
- Shadow register set (AF', BC', DE', HL')
- Decomposed flags (S, Z, Y, H, X, PV, N, C as separate variables), recomposed on F read
- Full instruction set:
  - All 256 unprefixed opcodes
  - CB prefix: 256 opcodes (rotates, shifts, BIT, RES, SET)
  - ED prefix: block ops (LDI/LDD/LDIR/LDDR, CPI/CPD/CPIR/CPDR, INI/IND/INIR/INDR, OUTI/OUTD/OTIR/OTDR), 16-bit arithmetic (ADC HL, SBC HL), I/O, interrupt mode selection, register transfers (LD I,A / LD R,A / LD A,I / LD A,R), RLD/RRD
  - DD/FD prefix: IX/IY variants of all applicable opcodes, undocumented IXH/IXL/IYH/IYL access
  - DDCB/FDCB prefix: indexed bit operations with undocumented register copy behavior
- Interrupt handling: NMI (jump to 0x0066, clears IFF1), IRQ modes 0/1/2, EI delay (one instruction), HALT state
- WZ (MEMPTR) internal register tracked per MAME behavior
- Cycle counting: per-instruction T-state costs, execute(max_cycles) returns actual cycles
- Integration with AddressSpace callbacks for all memory and I/O access

### Validation
- 1,604,000 / 1,604,000 SingleStepTests/z80 JSON tests passing
- Test runner in `src/z80_test.cpp`, uses `third_party/nlohmann/json.hpp`
- `make test-z80` / `make docker-test-z80`

## Phase 4: Video + Sound + Interrupts

### Video System (`video.h`, `video.cpp`)

**Data structures:**
- `VideoState`: vram[8KB], color_ram[2KB], MagicRAMControl, v256 flag, framebuffer[256x256 RGBA]
- `MagicRAMControl`: control byte (port 0x4B), last_shift_data latch, intercept flag (collision one-way latch)

**VRAM-to-framebuffer rendering:**
- Iterates all 8192 VRAM bytes
- For each byte: fetches color from Color RAM using address formula `((offset >> 2) & 0x07E0) | (offset & 0x001F)`
- Produces 8 pixels: left 4 use high nibble color, right 4 use low nibble color
- Set VRAM bit = color from palette, clear bit = black
- Matches MAME's `screen_update_berzerk` exactly

**16-color RGBI palette:**
- Color 0 = black
- Colors 1--7: base intensity (0xAA per active channel)
- Colors 8--15: full intensity (0xFF per active channel)
- R = bit 0, G = bit 1, B = bit 2, I = bit 3

**Magic RAM / 74181 ALU pipeline:**
1. Shift register: combines previous write's low 7 bits with current byte, shifted right by control bits 2--0
2. Optional bit reversal: mirror flag (control bit 3) reverses all 8 bits
3. Collision detection: if any bit is set in both shifted data and existing VRAM, intercept flag clears to 0 (one-way latch)
4. 74181 ALU in logic mode (M=1): select lines from control bits 7--4, computes `F = 1 XOR ((!P) & G)` per bit using gate-level P/G equations from the 74181 datasheet. Two 4-bit ALU calls (low nibble + high nibble)
5. Active-low inversion: result XORed with 0xFF before VRAM store
6. Latch: low 7 bits of written data saved for next write's shift register

**Bug found and fixed:** The 74181 per-bit output equation was initially coded as `fi = (!p) & g`, missing the XOR with the carry input term. The correct equation is `fi = 1 ^ ((!p) & g)`. In logic mode (M=1), the carry propagation term `!(Cn & mp)` evaluates to 1 (since mp=0 when M=1), so each bit's output must be XORed with 1. This caused the game to hang at PC=0x0458 during the Magic RAM self-test.

**Read intercept (port 0x4E):**
- Bit 7: collision status (intercept flag inverted -- 0x80 means collision detected)
- Bit 0: V256 flag (whether beam is in vblank region)

### Sound Stubs (`sound.h`, `sound.cpp`)

The sound hardware accepts all I/O writes and returns plausible read values so the game does not hang on polling loops. No audio samples are generated.

**S14001A speech chip (port 0x44):**
- Write mode 0: stores 6-bit word address, clears busy immediately (no actual playback)
- Write mode 1: stores volume (3 bits) and clock divisor (3 bits)
- Read: returns 0x40 (ready) when not busy, 0x00 when busy

**Exidy 6840 timer (ports 0x40--0x43, 0x45, 0x47):**
- 8-byte register file, stores written values, returns them on read

**SFX control latch (port 0x46):**
- Stores written value for observability

**Voice ROM:**
- 4 KB loaded from two 2 KB ROM files (berzerk_r_vo_1c.1c, berzerk_r_vo_2c.2c)
- Pointer stored in SoundState for future use
- Loading is non-fatal -- game runs without speech if ROMs are missing

### Interrupt Timing (`interrupts.h`, `interrupts.cpp`)

**Constants:**
- 160 T-states per scanline, 262 scanlines per frame, 41,920 T-states per frame
- IRQ vector: 0xFC (placed on data bus during interrupt acknowledge)

**10 events per frame (sorted by cycle offset):**
- 8 NMIs at V-counter positions 0x30, 0x50, 0x70, 0x90, 0xB0, 0xD0, 0xF0 (V256=0), 0xF0 (V256=1)
- 2 IRQs at V-counter positions 0x80 (V256=0, mid-screen) and 0xDA (V256=1, vblank)

**`run_frame()` function:**
- Executes CPU in chunks between interrupt events
- Fires NMI or IRQ at each event boundary (if enabled)
- Updates V256 flag at each event for port 0x4E reads
- Runs remaining cycles after last event to complete the frame
- Resets per-frame diagnostic counters (irq_count, nmi_count)

## Phase 5: SDL Platform Layer + noVNC Browser Display

### Platform Layer (`platform.h`, `platform.cpp`)

**InputState struct:**
- Three bytes: port_48 (P1 joystick + fire), port_49 (system buttons), port_4a (P2 joystick + fire)
- All default to 0xFF (active-low: no buttons pressed)

**SDL initialization:**
- Window: 256x224 visible pixels scaled 3x (768x672 window)
- Renderer: hardware-accelerated with vsync
- Texture: 256x256 streaming RGBA8888

**Keyboard mapping (active-low: clear bit when key pressed):**
- Arrow keys -> P1 directions (port 0x48 bits 0--3)
- Left Ctrl / Space -> P1 fire (port 0x48 bit 4)
- 1 -> 1P start (port 0x49 bit 0)
- 2 -> 2P start (port 0x49 bit 1)
- 5 -> Coin 1 (port 0x49 bit 7)
- Escape -> quit

**Frame presentation:**
- `update_texture()`: uploads 256x256 RGBA framebuffer to SDL texture
- `present_frame()`: renders texture with source rect cropping to visible scanlines (y=32, h=224)

### Memory Wiring
- `InputState` added to `BerzerkMemory` struct
- I/O port 0x48 reads from `mem.input.port_48`
- I/O port 0x49 reads from `mem.input.port_49`
- I/O port 0x4A reads from `mem.input.port_4a | 0x80` (bit 7 = upright cabinet)

### Main Loop (`main.nw`)
- `EmulatorContext` struct bundles CPU, memory, platform handles, palette, running flag, frame counter
- `frame_callback()`: polls input, runs one frame with interrupts, renders VRAM to framebuffer, uploads texture, presents frame
- Diagnostic output: prints PC, SP, registers, IRQ/NMI counts, VRAM usage, magic_ctrl at frames 1--10 and every 60th frame
- Loop: `while (ctx.running) { frame_callback(ctx); SDL_Delay(1); }`

### noVNC Browser Display
- `Dockerfile.novnc`: Ubuntu 24.04 + build tools + SDL2 + Xvfb + x11vnc + noVNC + websockify
- `scripts/start-novnc.sh`: starts Xvfb (virtual framebuffer), x11vnc (VNC server), noVNC/websockify (browser bridge), then runs the emulator
- `make docker-play`: builds image, maps ROM directory, exposes port 6080, user opens `localhost:6080/vnc.html`

### Verification
- Native build compiles clean
- Z80 tests: 1,604,000 / 1,604,000 passing
- Game boots, passes hardware RAM test, reaches attract mode
- Player can insert coin (5), start game (1), move (arrows), fire (Ctrl/Space)
- Interrupt timing verified: 2 IRQ + 8 NMI per frame
- VRAM actively updated (~1300--1400 non-zero bytes during attract mode)

## Design Documents

| File | Contents |
|---|---|
| `cdoc/architecture.md` | Complete hardware reference: clock tree, memory map, I/O ports, video, Magic RAM, interrupts, sound, inputs, DIP switches, MAME component dependencies, cosimulation architecture sketch |
| `cdoc/plan.md` | 6-phase implementation plan with status tracking |

## ROM Files

8 ROM files in `rom/berzerk/`, all CRC32-verified at load time:

| File | Address | Size | Purpose |
|---|---|---|---|
| `berzerk_rc31_1c.rom0.1c` | 0x0000 | 2 KB | Boot/ROM0 |
| `berzerk_rc31_1d.rom1.1d` | 0x1000 | 2 KB | ROM1 |
| `berzerk_rc31_3d.rom2.3d` | 0x1800 | 2 KB | ROM2 |
| `berzerk_rc31_5d.rom3.5d` | 0x2000 | 2 KB | ROM3 |
| `berzerk_rc31_6d.rom4.6d` | 0x2800 | 2 KB | ROM4 |
| `berzerk_rc31a_5c.rom5.5c` | 0x3000 | 2 KB | ROM5 |
| `berzerk_r_vo_1c.1c` | voice 0x0000 | 2 KB | Speech ROM 1 |
| `berzerk_r_vo_2c.2c` | voice 0x0800 | 2 KB | Speech ROM 2 |
