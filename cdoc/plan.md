# Berzerk Emulator -- Implementation Plan

8-phase plan for building the literate C++ Berzerk emulator.

## Phase 0: Infrastructure

- Docker build environment (Ubuntu 24.04, g++, cmake, noweb, texlive, SDL2, gdb)
- Makefile with targets: tangle, weave, build, clean, docker-build, docker-run, docker-shell
- Directory structure: noweb/, src/, include/, doc/, cdoc/, rom/
- .gitignore for generated artifacts
- Skeleton noweb/main.nw to validate the tangle -> compile -> link -> run pipeline

Status: DONE

## Phase 1: MAME Analysis

- Fetch and analyze MAME berzerk.cpp driver
- Fetch and analyze MAME Z80 CPU core
- Document hardware architecture in cdoc/architecture.md:
  clock tree, memory map, I/O ports, video system, Magic RAM / 74181 ALU,
  interrupt timing (2 IRQ + 8 NMI per frame), sound system (S14001A + Exidy 6840),
  input system, DIP switches

Status: DONE

## Phase 2: Memory Subsystem

- AddressSpace class with read/write handler callbacks
- ROM loader with CRC32 verification
- Berzerk memory map: ROM, mirrored Work RAM, VRAM, Magic RAM (ALU stub),
  Color RAM, I/O port stubs
- Memory self-test

Status: DONE

## Phase 3: Z80 CPU

- Z80 class with PAIR16 register unions, decomposed/composed flags
- Full instruction set:
  - All 256 unprefixed opcodes
  - CB prefix (rotates, shifts, BIT/RES/SET)
  - ED prefix (block ops, 16-bit arithmetic, I/O, interrupt modes)
  - DD/FD prefix (IX/IY variants, undocumented IXH/IXL/IYH/IYL)
  - DDCB/FDCB prefix (indexed bit ops with undocumented register copy)
- Interrupt handling: NMI, IRQ modes 0/1/2, EI delay, HALT
- WZ (MEMPTR) internal register
- Cycle counting (per-instruction T-state costs)
- Integration with AddressSpace callbacks
- Validation with SingleStepTests/z80 JSON test suite

Status: DONE -- 1,604,000/1,604,000 SingleStepTests passing

## Phase 4: Video + Sound + Interrupts

- Video system:
  - VideoState: vram[8KB], color_ram[2KB], MagicRAMControl, v256, framebuffer[256x256]
  - VRAM to framebuffer rendering (256x224, 16 colors, RGBI palette)
  - Color RAM lookup (per-cell color attributes, split nibble)
  - Magic RAM / 74181 ALU (shift register, optional mirror, collision detect, ALU combine, active-low inversion)
  - Bug found and fixed: 74181 per-bit equation was missing XOR with carry term (1 ^ ((!p) & g))
- Sound system (stubs):
  - S14001A speech: busy flag clears immediately, register writes stored
  - Exidy 6840 timer: register file stored, no audio generation
  - Real audio deferred to later phase
- Interrupt timing:
  - 10 events per frame: 2 IRQ + 8 NMI at fixed cycle offsets
  - run_frame() executes CPU in chunks between events
  - Constants: 41920 T-states/frame, 160 T-states/scanline, 262 scanlines

Status: DONE

## Phase 5: SDL Platform Layer + noVNC Browser Display

- Platform layer (noweb/platform.nw):
  - InputState: three port bytes (0x48, 0x49, 0x4A), active-low
  - SDL window (256x224 * 3x scale), vsync renderer, RGBA8888 streaming texture
  - Keyboard mapping: arrows, ctrl/space, 1/2/5, escape
  - poll_input(), update_texture(), present_frame()
- Memory wiring: InputState in BerzerkMemory, I/O ports read from input state
- Main loop: EmulatorContext + frame_callback, while loop with SDL_Delay(1)
- noVNC Docker display:
  - Dockerfile.novnc: Xvfb + x11vnc + noVNC + websockify
  - scripts/start-novnc.sh: starts display stack then emulator
  - `make docker-play` -> browser at localhost:6080/vnc.html
- Verified: game boots, passes hardware self-test, reaches attract mode with active VRAM drawing

Status: DONE

## Phase 6: Berzerk Disassembly Documentation

Detailed documentation of the original game's subroutines, algorithms, and data
structures from the Sean Riddle disassembly (https://seanriddle.com/berzerk.asm),
cross-referenced with our ROM hex dumps. This documentation must be thorough
enough to enable a second C++ implementation that is bit-accurate and
frame-accurate.

### 6.1 Fetch, Verify, and Annotate the Disassembly

- Download Sean Riddle's berzerk.asm
- **Machine-verify every instruction against the ROM binary.** The human
  disassembly may contain errors in mnemonics, operands, or comments.
  For each instruction, decode the raw bytes from our ROM files and
  confirm that the mnemonic and operands match. Flag and correct any
  discrepancies. Do not trust labels or comments without verification
  against the actual binary.
- Cross-reference with our ROM files (RC31A revision) to verify address
  alignment and detect any revision mismatch
- Create cdoc/disassembly.md as the master reference

### 6.2 Static Analysis and Basic Block Identification

Perform static analysis of the ROM binary to identify:
- **Branch targets:** all addresses reachable via JP, JR, CALL, RST,
  and conditional variants. These define basic block boundaries.
- **Subroutine entry points:** the first basic block address of each
  subroutine, identified by being a target of CALL/RST instructions
  or by being a known entry (reset vector, NMI vector 0x0066, IRQ
  handler).
- **Data vs. code regions:** identify lookup tables and data embedded
  in ROM that should not be disassembled as instructions.

This static analysis is the basis for Phase 7's subroutine invocation
tracking: a "subroutine call" is defined as the program counter reaching
a subroutine entry point (first basic block address), regardless of
whether it arrived via CALL, JP, or fall-through.

### 6.3 Document Subroutines

For each subroutine in the ROM, document:
- Entry address and name
- Purpose and algorithm description
- Register usage (inputs, outputs, clobbered)
- Memory locations accessed (RAM variables, VRAM regions, I/O ports)
- Call graph (callers and callees)

Key subroutines:
- Boot sequence and hardware self-test (0x0000--0x00FF)
- Main game loop
- Player movement and collision
- Robot AI and movement
- Maze generation and drawing
- Score display and management
- Attract mode sequence
- Sound/speech trigger routines
- Interrupt service routines (IRQ at vector 0xFC, NMI at 0x0066)

### 6.4 Document Data Structures

- RAM variable map: which Work RAM addresses store what (lives, score, level,
  player position, robot positions, maze state, etc.)
- Lookup tables in ROM (movement tables, maze templates, scoring tables)
- VRAM layout conventions: where the game draws the maze, player, robots,
  score, text

### 6.5 Document Algorithms

- Maze generation algorithm
- Robot pathfinding / movement logic
- Collision detection (hardware via Magic RAM intercept + software checks)
- Scoring and difficulty progression
- Speech selection logic (which phrases trigger when)

Status: DONE

Deliverables:
- scripts/z80_disasm.py: machine-verified 5432/5432 bytes, 5286/5293 instruction decodes
- cdoc/disassembly_analysis.md: 718-line reference (RAM vars, data structures, 60+ subroutines, 10 algorithms, I/O map)
- cdoc/subroutine_entry_points.txt: 125 entry points (static analysis: 877 branch targets, 139 data regions)
- cdoc/disassembly.md: master reference document
- noweb/disassembly.nw: literate noweb program (9797 lines, 36 sections) that tangles to berzerk.asm
- scripts/gen_disasm_nw.py: generator script that splits Tunstall's disassembly into functional sections with C++ conversion notes

## Phase 7: Cosimulation Infrastructure

### Correctness Model

We are verifying **functional correctness**, not cycle-level timing. The
core assumption: if we capture functional side effects at subroutine
boundaries and observable events at frame granularity, the perceived
experience will be identical to the end user. Two levels of verification:

**Subroutine-level correctness:** The side effects of each subroutine call
(register writes, memory writes, interrupt state changes) must match between
the emulator and the second C++ implementation. Comparison happens at
subroutine entry and exit boundaries. Within a subroutine invocation, the
C++ implementation may produce side effects in a different order than the
emulated machine -- what matters is that the same set of effects is
observable when the subroutine returns. However, where ordering of side
effects within a subroutine affects the final observable state (e.g.
multiple writes to the same VRAM address), the C++ implementation must
enforce the same ordering for those dependent writes as the original
machine code produces.

**Frame-level correctness:** The player must see the same pixels and hear
the same sounds within each presented frame. All events that occur within
a frame of the emulated game must also occur within the corresponding frame
of the C++ implementation, but not necessarily in the same intra-frame
order. We do not verify cycle-accurate timing -- we verify that each frame
produces the same observable output (VRAM content, collision flags).

**Sound:** Sound validation is deferred to a later iteration. The first
iteration of cosimulation focuses on visual correctness (VRAM/framebuffer)
and game logic (memory state, collision flags, subroutine invocations).

Note: Magic RAM and sound are memory-mapped I/O in the emulator. In the
second implementation, these will be replaced by higher-level functional
abstractions. The cosimulation framework compares observable effects (VRAM
content after a subroutine returns, collision flags) rather than raw I/O
port traffic or cycle-level ordering.

### 7.1 Define the Abstract Base Class

Create noweb/cosim.nw defining BerzerkMachine -- the interface both
implementations must satisfy:
- Lifecycle: init(rom_dir), reset()
- Execution: step_frame() (pure virtual), step_instruction() (virtual
  with default no-op; only meaningful for the emulator)
- State snapshot: snapshot() -> MachineSnapshot, restore(snap)
- Output extraction: framebuffer()
- Event log: events() -> vector<EventRecord>

Note: audio_buffer() and audio_sample_count() are deferred to a later
iteration when sound validation is added.

### 7.2 Define MachineSnapshot

Serializable struct capturing full machine state:
- CPU registers (AF, BC, DE, HL, IX, IY, SP, PC, I, R, IFF1, IFF2, IM,
  shadow regs)
- Work RAM (1 KB), VRAM (8 KB), Color RAM (2 KB)
- Magic RAM control state, interrupt enable flags
- Sound chip register state, frame counter
- Binary comparison (operator==) and serialization

### 7.3 Define EventRecord

Tagged struct for observable events, scoped to a subroutine invocation:
- Memory writes (address, old_data, new_data, region) -- each write
  records the value at the address before the write and the value after.
  Collected as an unordered set per subroutine call, not as an ordered
  sequence.
- Register writes (register_id, old_value, new_value) -- each register
  modification records the previous and new contents. At subroutine
  boundaries, the full register state at CALL entry and RET exit is also
  captured.
- Interrupt fired (type, vector) -- recorded as occurring within the
  subroutine, not at a specific cycle
- Collision detected (intercept flag change)

The old_data/old_value fields are not used for cosimulation comparison
(which only checks that the same set of writes occurred). They exist to
enable bidirectional trace debugging: given a trace, you can replay
forward by applying new values, or replay backward by restoring old
values.

Comparison semantics: two EventRecord sets for the same subroutine
invocation are equal if they contain the same events regardless of order.
The timing of individual events within a subroutine is not compared --
only that they occurred within that invocation. The old_data/old_value
fields are excluded from comparison (they may differ between
implementations that reach the same subroutine via different intermediate
states).

### 7.4 Event Logging

Instrument the emulator to record events scoped to subroutine invocations
and frames, not to individual cycles.

#### Subroutine Invocation Detection

A subroutine entry point is defined by Phase 6's static analysis: it is
the first basic block address of a subroutine. A "subroutine invocation"
is observed whenever the program counter equals a known subroutine entry
point. This definition covers all entry mechanisms: CALL, RST, JP (tail
call), computed dispatch, and fall-through. It does not depend on
detecting CALL/RET opcode pairs, which avoids the problem of Z80 code
using non-standard control flow (stack manipulation, JP into subroutine
bodies, conditional RET, etc.).

The C++ implementation produces the equivalent observation by recording
each C++ function call that corresponds to a subroutine entry point.

#### Subroutine Invocation Identity

Each subroutine invocation is uniquely identified by three values:
- **Program counter address** (the subroutine entry point)
- **Stack depth** (call nesting level at entry)
- **Invocation count** (a running counter per subroutine address,
  incremented each time PC reaches that entry point)

Additionally, each invocation is tagged with its **trigger type**:
- **Conventional:** PC reached the entry point via normal control flow
  (CALL, JP, RST, fall-through)
- **Interrupt-driven:** PC reached the entry point because an NMI or IRQ
  fired (the ISR entry at 0x0066 for NMI, or the IRQ handler)

The invocation count ensures that when comparing the emulator and the
C++ implementation, we are matching the correct invocation of each
subroutine -- not just "some call to address 0x1234" but specifically
"the 47th call to address 0x1234 at stack depth 3." This is the primary
mechanism for verifying that both implementations execute the same
subroutine call sequence.

#### Invocation Sequence Verification

The ordered sequence of (subroutine_address, invocation_count,
trigger_type) across an entire frame is compared between the two
implementations. This validates that:
- The same subroutines are called in the same order
- Interrupt-driven invocations occur at the same logical points in the
  frame (same position in the invocation sequence, not necessarily at
  the same cycle)
- No subroutine is called extra times or skipped by either implementation

Within each invocation, side effects are compared as an unordered set
(the C++ implementation may reorder writes). But the sequence of
invocations themselves must match.

#### Key Principles

- Cycle timestamps may be captured by the emulator for documentation and
  debugging purposes, but they are **not used for verification** against
  the C++ implementation. The C++ implementation is not cycle-accurate,
  so cycle counts have no meaning in the comparison.
- The verification-relevant fields are: subroutine address, stack depth,
  invocation count, trigger type, and the unordered set of side effects
  produced within that invocation.
- The C++ implementation may produce the same memory writes and VRAM
  updates in a completely different order within a subroutine. The
  logging must support set-based comparison, not sequence comparison.
  However, where ordering affects final state (multiple writes to the
  same address), the C++ implementation must preserve the emulator's
  ordering for those dependent writes.
- Frame-level comparison checks that the accumulated visible output (VRAM
  content, rendered framebuffer) matches at frame boundaries. Intra-frame
  ordering differences are acceptable.

#### Implementation

- Subroutine entry detection: maintain the set of known subroutine entry
  points from Phase 6 static analysis; on each instruction, check if PC
  matches an entry point; if so, open a new invocation scope with
  (pc_address, stack_depth, invocation_count, trigger_type)
- Per-subroutine invocation counter: a map from subroutine address to
  running call count, incremented each time PC reaches that entry point;
  both implementations must maintain this counter so invocations can be
  matched
- Interrupt tagging: when an NMI or IRQ fires, the next subroutine
  invocation (the ISR entry) is tagged as interrupt-driven; subroutines
  called from within the ISR are tagged as conventional (they were called
  by code, not by an interrupt)
- AddressSpace: optional event recording (flag-gated for performance);
  events tagged with current subroutine scope identity
- I/O side effects: Magic RAM control, NMI/IRQ enable/disable, collision
  flag changes -- recorded within subroutine scope
- Frame boundary: at end of frame, collect VRAM content as the
  frame-level observable output
- Emulator may additionally record cycle timestamps per event for its own
  diagnostic/documentation use; these fields are ignored during
  cosimulation comparison

### 7.5 Make the Emulator a Concrete Implementation

Refactor EmulatorContext + BerzerkMemory + Z80 into
BerzerkEmulator : public BerzerkMachine. Structural refactor only -- no
behavior changes. main.cpp becomes a thin wrapper.

### 7.6 Cosimulation Test Harness

- Side-by-side runner: instantiates two BerzerkMachine implementations,
  feeds identical input sequences, compares at two levels:
  - Subroutine level: for each matched subroutine call, compare the
    unordered set of side effects between the two implementations
  - Frame level: compare VRAM content, framebuffer pixels, and sound
    register state at each frame boundary
- Input recording and playback: serialize per-frame InputState for
  deterministic replay
- Trace capture format: each event in the trace includes before and
  after values for every register write and memory write. This makes
  the trace self-contained for bidirectional debugging:
  - Forward replay: apply new_data/new_value fields in sequence
  - Backward replay: restore old_data/old_value fields in reverse
  - A trace file from either implementation can be inspected
    independently to step through state changes in both directions
    without re-running the emulator or the C++ implementation
- Statistical measurement: per-frame event counts, per-subroutine
  execution frequency, VRAM write patterns, collision frequency,
  divergence detection (first subroutine or frame where outputs differ)
- Component unit tests: 74181 ALU truth table, Magic RAM pipeline,
  Color RAM address mapping, interrupt timing, memory map boundaries

Status: DONE

Deliverables:
- noweb/cosim.nw: BerzerkMachine interface, MachineSnapshot, EventRecord, SubroutineEntryPoints, InvocationRecord, FrameLog
- noweb/emulator.nw: BerzerkEmulator (concrete BerzerkMachine), EventLogger with per-instruction PC checking
- noweb/cosim_harness.nw: CosimRunner, ComparisonResult, InputRecording with binary save/load
- noweb/main.nw: refactored to use BerzerkEmulator (structural refactor, no behavior change)
- Makefile: fixed tangle target for macOS/Linux cross-platform grep
