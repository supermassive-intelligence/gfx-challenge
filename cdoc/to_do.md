# Berzerk Emulator -- Remaining Work to Complete goals_v0

Reference: `goals_v0` defines the project as a literate C++ Berzerk emulator using noweb, with MAME as the blueprint, memory callbacks for observability, and a cosimulation base class for validating a second C++ implementation of the game.

Phases 0--5 are complete. This document covers everything that remains.

---

## Phase 6: Berzerk Disassembly Documentation

**goals_v0 requirement:** "the berzerk disassembly is here: https://seanriddle.com/berzerk.asm we will be using this to meticulously document the subroutines and algorithms and data structures of the original game to sufficient degree that will enable us to implement the C++ version of the game in a bit accurate manner"

This phase must be completed before cosimulation (Phase 7) because the second C++ implementation depends on understanding every subroutine, data structure, and algorithm in the original game code. Phase 6 also produces the static analysis (subroutine entry points, basic blocks) that Phase 7's invocation tracking depends on.

### 6.1 Fetch, Verify, and Annotate the Disassembly

- Download Sean Riddle's `berzerk.asm`
- **Machine-verify every instruction against the ROM binary.** The human disassembly may contain errors in mnemonics, operands, or comments. For each instruction, decode the raw bytes from our ROM files and confirm that the mnemonic and operands match. Flag and correct any discrepancies. Do not trust labels or comments without verification against the actual binary.
- Cross-reference with our ROM files (RC31A revision) to verify address alignment and detect any revision mismatch
- Create `cdoc/disassembly.md` as the master reference

### 6.2 Static Analysis and Basic Block Identification

Perform static analysis of the ROM binary to identify:
- **Branch targets:** all addresses reachable via JP, JR, CALL, RST, and conditional variants. These define basic block boundaries.
- **Subroutine entry points:** the first basic block address of each subroutine, identified by being a target of CALL/RST instructions or by being a known entry (reset vector, NMI vector 0x0066, IRQ handler).
- **Data vs. code regions:** identify lookup tables and data embedded in ROM that should not be disassembled as instructions.

This static analysis is the basis for Phase 7's subroutine invocation tracking: a "subroutine call" is defined as the program counter reaching a subroutine entry point (first basic block address), regardless of whether it arrived via CALL, JP, or fall-through.

### 6.3 Document Subroutines

For each subroutine in the ROM, document:
- Entry address and name
- Purpose and algorithm description
- Register usage (inputs, outputs, clobbered)
- Memory locations accessed (RAM variables, VRAM regions, I/O ports)
- Call graph (who calls this, what it calls)

Key subroutines to document:
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

- RAM variable map: which Work RAM addresses store what (lives, score, level, player position, robot positions, maze state, etc.)
- Lookup tables in ROM (movement tables, maze templates, scoring tables)
- VRAM layout conventions: where the game draws the maze, player, robots, score, text

### 6.5 Document Algorithms

- Maze generation algorithm
- Robot pathfinding / movement logic
- Collision detection (hardware via Magic RAM intercept + software checks)
- Scoring and difficulty progression
- Speech selection logic (which phrases trigger when)

---

## Phase 7: Cosimulation Infrastructure

**goals_v0 requirement:** "This emulator will [be] one implementation of a common base class which will allow us to validate another implementation written in C++ without implementing the low level component emulation. It will be used to validate a C++ implementation of this game using cosimulation, statistical measurement of events and unit tests."

**Correctness model:** We verify functional correctness, not cycle-level timing. Core assumption: if we capture functional side effects at subroutine boundaries and observable events at frame granularity, the perceived experience will be identical to the end user. Two levels of verification:

1. **Subroutine-level:** The side effects of each subroutine call (register writes, memory writes, interrupt state changes) must match between the two implementations. Comparison happens at subroutine entry and exit boundaries. Within a subroutine invocation, the C++ implementation may produce side effects in a completely different order -- what matters is that the same set of effects is observable when the subroutine returns. However, where ordering of side effects within a subroutine affects the final observable state (e.g. multiple writes to the same VRAM address), the C++ implementation must enforce the same ordering for those dependent writes.

2. **Frame-level:** The player must see the same pixels within each presented frame. All events that occur within a frame of the emulated game must also occur within the corresponding frame of the C++ implementation, but not necessarily in the same intra-frame order. We do not verify cycle-accurate timing -- we verify that each frame produces the same observable output (VRAM content, collision flags).

**Sound:** Sound validation is deferred to a later iteration. The first iteration focuses on visual correctness and game logic.

Magic RAM and sound are memory-mapped I/O in the emulator; the second implementation will use higher-level functional abstractions. Cosimulation compares observable effects (VRAM content after a subroutine returns, collision flags) rather than raw I/O port traffic or cycle-level ordering.

### 7.1 Define the Abstract Base Class

Create `noweb/cosim.nw` defining an abstract interface that both implementations must satisfy:

```
class BerzerkMachine {
public:
    virtual ~BerzerkMachine() = default;

    virtual void init(const std::string& rom_dir) = 0;
    virtual void reset() = 0;

    virtual void step_frame() = 0;
    virtual void step_instruction() {}  // default no-op; emulator only

    virtual MachineSnapshot snapshot() const = 0;
    virtual void restore(const MachineSnapshot& snap) = 0;

    virtual const uint32_t* framebuffer() const = 0;

    virtual const std::vector<EventRecord>& events() const = 0;
};
```

Note: audio_buffer() and audio_sample_count() deferred to later iteration when sound validation is added.

### 7.2 Define MachineSnapshot

Serializable struct capturing full machine state:
- CPU registers (AF, BC, DE, HL, IX, IY, SP, PC, I, R, IFF1, IFF2, IM, shadow regs)
- Work RAM (1 KB), VRAM (8 KB), Color RAM (2 KB)
- Magic RAM control state, interrupt enable flags
- Sound chip register state, frame counter
- Must support binary comparison (operator==) and serialization

### 7.3 Define EventRecord

Tagged struct for observable events, scoped to a subroutine invocation:
- Memory writes (address, old_data, new_data, region) -- each write records the value before and after. Collected as an unordered set per subroutine call, not as an ordered sequence.
- Register writes (register_id, old_value, new_value) -- each register modification records previous and new contents. Full register state also captured at subroutine entry and exit.
- Interrupt fired (type, vector) -- recorded as occurring within the subroutine
- Collision detected (intercept flag change)

The old_data/old_value fields enable bidirectional trace debugging: replay forward by applying new values, or replay backward by restoring old values. These fields are not used for cosimulation comparison (which only checks that the same set of writes occurred) and are excluded from equality checks (the two implementations may reach the same subroutine via different intermediate states).

Comparison semantics: two EventRecord sets for the same subroutine invocation are equal if they contain the same (address, new_data) or (register_id, new_value) pairs regardless of order. The timing of individual events within a subroutine is not compared -- only that they occurred within that invocation.

### 7.4 Event Logging

Instrument the emulator to record events scoped to subroutine invocations and frames, not to individual cycles.

**Subroutine invocation detection:** A subroutine entry point is defined by Phase 6's static analysis: it is the first basic block address of a subroutine. A "subroutine invocation" is observed whenever the program counter equals a known subroutine entry point. This definition covers all entry mechanisms: CALL, RST, JP (tail call), computed dispatch, and fall-through. It does not depend on detecting CALL/RET opcode pairs.

**Subroutine invocation identity:** Each invocation is uniquely identified by three values:
- **Program counter address** (the subroutine entry point)
- **Stack depth** (call nesting level at entry)
- **Invocation count** (a running counter per subroutine address, incremented each time PC reaches that entry point)

Additionally, each invocation is tagged with its **trigger type**:
- **Conventional:** PC reached the entry point via normal control flow (CALL, JP, RST, fall-through)
- **Interrupt-driven:** PC reached the entry point because an NMI or IRQ fired (the ISR entry at 0x0066 for NMI, or the IRQ handler)

The invocation count ensures we match the correct invocation when comparing implementations -- not just "some call to 0x1234" but "the 47th call to 0x1234 at stack depth 3."

**Invocation sequence verification:** The ordered sequence of (subroutine_address, invocation_count, trigger_type) across an entire frame is compared between the two implementations. This validates that:
- The same subroutines are called in the same order
- Interrupt-driven invocations occur at the same logical points in the frame
- No subroutine is called extra times or skipped by either implementation

Within each invocation, side effects are compared as an unordered set. But the sequence of invocations themselves must match.

Key principles:
- Cycle timestamps may be captured by the emulator for documentation/debugging, but are **not used for verification**. The C++ implementation is not cycle-accurate, so cycle counts are meaningless in comparison.
- The verification-relevant fields are: subroutine address, stack depth, invocation count, trigger type, and the unordered set of side effects produced within that invocation.
- The C++ implementation may produce the same memory writes and VRAM updates in a completely different order within a subroutine. Logging must support set-based comparison. However, where ordering affects final state (multiple writes to the same address), the C++ implementation must preserve the emulator's ordering for those dependent writes.
- Frame-level comparison checks that the accumulated visible output (VRAM content, rendered framebuffer) matches at frame boundaries.

Implementation:
- Subroutine entry detection: maintain the set of known entry points from Phase 6 static analysis; on each instruction, check if PC matches an entry point; if so, open a new invocation scope
- Per-subroutine invocation counter: map from subroutine address to running call count; both implementations must maintain this counter
- Interrupt tagging: when NMI/IRQ fires, the next subroutine invocation (the ISR entry) is tagged as interrupt-driven; subroutines called from within the ISR are tagged as conventional
- AddressSpace: optional event recording (flag-gated for performance); events tagged with current subroutine scope identity
- I/O side effects: Magic RAM control, NMI/IRQ enable/disable, collision flag changes -- recorded within subroutine scope
- Frame boundary: at end of frame, collect VRAM content as the frame-level observable output
- Emulator may additionally record cycle timestamps per event for its own diagnostic/documentation use; these fields are ignored during cosimulation comparison

### 7.5 Make the Emulator a Concrete Implementation

Refactor EmulatorContext + BerzerkMemory + Z80 into `BerzerkEmulator : public BerzerkMachine`. Structural refactor only -- no behavior changes. main.cpp becomes a thin wrapper.

### 7.6 Cosimulation Test Harness

- Side-by-side runner: two BerzerkMachine instances, identical input, compare at two levels:
  - Subroutine level: for each matched subroutine call, compare the unordered set of side effects
  - Frame level: compare VRAM content and framebuffer pixels at each frame boundary
- Invocation sequence comparison: verify the ordered sequence of (address, invocation_count, trigger_type) matches between implementations
- Input recording and playback: serialize per-frame InputState for deterministic replay
- Trace capture format: each event includes before and after values for every register write and memory write, making traces self-contained for bidirectional debugging:
  - Forward replay: apply new_data/new_value fields in sequence
  - Backward replay: restore old_data/old_value fields in reverse
  - A trace file from either implementation can be inspected independently without re-running
- Statistical measurement: per-frame event counts, per-subroutine execution frequency, VRAM write patterns, collision frequency, divergence detection (first subroutine or frame where outputs differ)
- Component unit tests: 74181 ALU truth table, Magic RAM pipeline, Color RAM address mapping, interrupt timing, memory map boundaries

---

## Other Remaining Work (not blocking Phase 6 or 7)

### Sound Implementation

Sound is currently stubbed and sound validation is deferred to a later cosimulation iteration. Full sound requires:
- S14001A speech: decode variable-length encoded samples from voice ROM, clock at configured rate, model busy duration
- Exidy 6840 timer: implement three programmable timer/counters, square wave generation, noise/tone circuit
- SDL audio: open audio device with callback, mix speech (gain 0.5) and custom (gain 0.33) to mono

### Woven Documentation

- All 8 PDFs now generate successfully via `make docker-all`
- LaTeX warnings present (undefined references on first pass, resolved on second) but output is readable
- Consider adding a combined document that includes all modules

---

## Summary: Priority Order

| Priority | Phase | Task | Rationale |
|---|---|---|---|
| 1 | 6 | Disassembly documentation + static analysis | Must understand every subroutine and produce entry point table before Phase 7 |
| 2 | 7 | Cosimulation infrastructure | Depends on Phase 6 for subroutine entry points; defines the interface the second implementation targets |
| 3 | -- | Sound implementation + validation | Deferred to later cosimulation iteration |
| 4 | -- | Woven documentation | Done (PDFs generate). Minor cleanup only |
