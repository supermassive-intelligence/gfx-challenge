# Berzerk ROM Disassembly -- Master Reference

Phase 6 master reference for the Berzerk ROM disassembly. All struct layouts and
algorithms verified against actual Z80 opcodes in the ROM binary.

ROM revision: RC31A (6 populated ROMs, 12KB total code)

## Source Materials

- `cdoc/berzerk_tunstall.asm` -- Scott Tunstall's annotated Z80 disassembly (9163 lines)
- `cdoc/disassembly_analysis.md` -- RAM variables, subroutine catalog, I/O ports, memory map
- `cdoc/phase6_structs_rendering.md` -- VECTOR/BOLT structs and rendering pipeline (opcode-verified)
- `cdoc/phase6_maze_robots_difficulty.md` -- maze generation, robot spawning, difficulty tables (opcode-verified)
- `cdoc/phase6_jobs_otto_rooms.md` -- job scheduler, Evil Otto, room transitions, demo mode (opcode-verified)
- `cdoc/subroutine_entry_points.txt` -- 119 verified subroutine entry points for cosimulation
- `scripts/z80_disasm.py` -- Z80 disassembler/verifier
- `rom/berzerk/` -- 6 ROM files (RC31A revision) + 2 voice ROMs

## Verification Results (Section 6.1)

Machine verification by `scripts/z80_disasm.py`.

| Metric | Result |
|--------|--------|
| Byte-level matches (ROM vs disassembly hex) | 5432 / 5432 (100%) |
| Instruction decode matches | 5286 / 5293 (99.87%) |
| Decode mismatches (formatting only) | 6 |
| Decode failures (data directives) | 1 |
| Byte mismatches in code regions | 0 |

Tunstall's disassembly is verified correct against the RC31A ROM binary.

## Static Analysis Results (Section 6.2)

| Metric | Count |
|--------|-------|
| Subroutine entry points (verified) | 119 |
| False positives removed | 6 |
| Branch targets / basic block boundaries | 877 |
| Data regions identified | 139 |

6 false positive entry points were removed: $087B (RAM variable), $0C08 (RAM gap),
$3C2B/$4262/$7FFF/$9503/$9F02/$F41D (data bytes misidentified as CALL targets in
difficulty tables, font data, sound data, and jump tables).

### ROM Layout

| Address Range | Size | Content |
|---------------|------|---------|
| $0000-$07FF | 2K | ROM0 (1C) -- boot, self-test, utility |
| $0800-$0FFF | 2K | RAM (not ROM) |
| $1000-$17FF | 2K | ROM1 (1D) -- sprite data, bolt logic, credits |
| $1800-$1FFF | 2K | ROM2 (3D) -- attract mode, maze, jobs, player |
| $2000-$27FF | 2K | ROM3 (4D) -- player, score, robot AI, RNG, speech |
| $2800-$2FFF | 2K | ROM4 (6D) -- robot shoot, sprite draw, character set |
| $3000-$37FF | 2K | ROM5 (5C) -- colour system, difficulty tables |
| $3800-$3FFF | 2K | Unpopulated (ROM socket empty) |

---

## Data Structures (Section 6.4) -- Opcode-Verified

Full evidence tables with specific instruction addresses in `cdoc/phase6_structs_rendering.md`.

### VECTOR (14 bytes) -- animated sprite

Allocated on the Z80 stack (7 x `push hl` of $0000). VECTORs are linked via a
2-byte next-pointer at offsets (BASE-2, BASE-1), forming a singly-linked list
headed by V.PTR ($0870).

| Offset | Field | Size | Purpose |
|--------|-------|------|---------|
| +$00 | Status | 1 | Rendering control bits (see status bits below) |
| +$01 | Magic | 1 | Last magic RAM control byte used for this object |
| +$02 | O.A.L | 1 | Old screen address, low byte |
| +$03 | O.A.H | 1 | Old screen address, high byte |
| +$04 | O.P.L | 1 | Old pattern data address, low byte |
| +$05 | O.P.H | 1 | Old pattern data address, high byte |
| +$06 | V.X | 1 | X velocity (signed delta) |
| +$07 | P.X | 1 | Current X position on screen |
| +$08 | V.Y | 1 | Y velocity (signed delta) |
| +$09 | P.Y | 1 | Current Y position on screen |
| +$0A | D.P.L | 1 | Pattern table pointer, low byte |
| +$0B | D.P.H | 1 | Pattern table pointer, high byte |
| +$0C | TIME | 1 | Movement countdown (lower = faster) |
| +$0D | TPRIME | 1 | Reload value for TIME |

**Status Bits** (verified against actual BIT/SET/RES instructions):

| Bit | Value | Name | Key Evidence |
|-----|-------|------|-------------|
| 0 | $01 | ERASE | $2733: `bit 0,(hl)` in ERASE_PATTERN |
| 1 | $02 | WRITE | $274D: `bit 1,(hl)` in WRITE_PATTERN |
| 2 | $04 | MOVE | $27AC: `bit 2,(hl)` in MOVE_ANIMATE_VECTOR |
| 3 | $08 | BLANK | $3719: `bit 3,(hl)` in UNCOLOUR_MAN |
| 4 | $10 | COLOR | $373C: `bit 4,(hl)` in COLOUR_MAN |
| 5 | $20 | DYING | $1FAF: `set 5,(ix+$00)` in PLAYER_DEAD |
| 7 | $80 | HIT | $15F8: `set 7,(ix+$00)` on collision |

### BOLT (8 bytes) -- laser projectile

Bolts are pixel-plotted, not sprite-based. PLAYER_BOLT_1 at $437B, PLAYER_BOLT_2
at $4383 (8 bytes apart). ROBOT_BOLTS at $438F. The tail half of the struct
(offsets 4-7) mirrors the head layout so the same movement routine can process
both head and tail by advancing IY by 4.

| Offset | Field | Size | Purpose |
|--------|-------|------|---------|
| +$00 | Direction | 1 | DURL bits (active = bolt exists) |
| +$01 | Length | 1 | Current bolt length in pixels |
| +$02 | X | 1 | X coordinate of bolt head |
| +$03 | Y | 1 | Y coordinate of bolt head |
| +$04 | LastDirection | 1 | Previous direction (also "in use" flag) |
| +$05 | MaxLength | 1 | Maximum bolt length ($08 for player) |
| +$06 | TailX | 1 | X coordinate of bolt tail |
| +$07 | TailY | 1 | Y coordinate of bolt tail |

### LINKED_LIST_ITEM (6 bytes on stack) -- job scheduler entry

The job scheduler is a cooperative coroutine system. See `cdoc/phase6_jobs_otto_rooms.md`.

```
Stack memory layout (low to high):
  [next_lo] [next_hi] [flags] [delay] [sp_lo] [sp_hi] [24 bytes scratch]
                       ^
                       |--- list pointer points here (offset +0)
```

| Offset | Field | Size | Purpose |
|--------|-------|------|---------|
| -2 | Next.L | 1 | Low byte of pointer to next job |
| -1 | Next.H | 1 | High byte of pointer to next job |
| +0 | Flags | 1 | Bit 0=runnable, bit 1=active, bit 7=initialized |
| +1 | Delay | 1 | Frame-delay counter (decremented by interrupt handler) |
| +2 | SP.L | 1 | Saved stack pointer low (continuation point) |
| +3 | SP.H | 1 | Saved stack pointer high |

### Sprite/Pattern Data Format

Pattern data uses double indirection. See `cdoc/phase6_structs_rendering.md` Task 3.

```
VECTOR.D.P -> pattern table (array of 16-bit frame pointers)
                |
                v
              frame_ptr -> [width] [height] [width*height pixel bytes]
              frame_ptr -> ...
              $0000      -> sentinel (end of animation)
              loop_addr  -> restart address
```

- Width: 1 or 2 bytes (8 or 16 pixels wide)
- Height: in pixels
- Animation cycling: MOVE_ANIMATE_VECTOR advances D.P by 2 each frame;
  on reading a $00 sentinel, it reads the next 2 bytes as the loop-back address

---

## Algorithms (Section 6.5) -- Opcode-Verified

### Maze Generation ($2540-$2677)

Full trace in `cdoc/phase6_maze_robots_difficulty.md` Task 1.

1. Seed RNG with `(ROOM_Y << 8) | ROOM_X` -- mazes are deterministic per room
2. Copy 15-byte wall template from ROM ($268C) to RAM ($435E)
3. Draw border walls with doorways:
   - Horizontal borders: two 48px segments with 48px gap
   - Vertical borders: two 72px segments with 64px gap
4. Generate interior walls: iterate columns at 48px intervals, call RANDOM,
   dispatch on `result & 3` to one of four wall types (UP/DOWN/LEFT/RIGHT)
5. Wall segments drawn as 4x4 pixel blocks via Magic RAM with OR mode ($10)

### Robot Spawning ($2117-$2154)

Full trace in `cdoc/phase6_maze_robots_difficulty.md` Task 2.

1. 11 spawn slots per room (counter starts at $16, decrements by 2)
2. Spawn probability: `RANDOM() >= $434A` (BCD threshold)
3. $434A increments by $60 BCD per room (wraps: $00, $60, $20, $80, $40, $00...)
4. 11 positions in a 4-3-4 grid layout at $23A2, each jittered by 0-31 pixels
5. Each robot gets a VECTOR, initial sprite pattern, and a job with RWAIT delay
6. ROBOT_SPEED decrements by 1 per room (minimum 1)
7. RWAIT decreases by 10 per room (minimum 20)
8. After all slots processed, jumps to Evil Otto init at $2A8E

### Evil Otto ($2A8E-$2B68)

Full trace in `cdoc/phase6_jobs_otto_rooms.md` Task 2.

1. OTTO_TIME = ROBOT_SPEED + RSAVED + RBOLTS (each unit = 40 frame-tick yields)
2. Killing a robot adds 2 to OTTO_TIME
3. Otto spawns at player position (clamped at screen edges)
4. Velocity: +/-1 per axis toward player, TPRIME=2
5. Otto retargets every ~44 ticks, passes through walls, is invulnerable
6. Otto kills player on sprite overlap (Magic RAM collision detection)

### Room Transitions ($2157-$2313)

Full trace in `cdoc/phase6_jobs_otto_rooms.md` Task 3.

| Edge | Trigger | ROOM update | New player position |
|------|---------|-------------|---------------------|
| Right | X >= $F6 | ROOM_X++ | MAN_X = $08 |
| Left | X >= $FC | ROOM_X-- | MAN_X = $F0 |
| Top | Y < $02 | ROOM_Y-- | MAN_Y = $BC |
| Bottom | Y >= $BE | ROOM_Y++ | MAN_Y = $04 |

On transition: V.PTR=NULL, MAN_PTR=NULL, 56 bytes of bolt data zeroed at $437B.

### Difficulty Tables ($3794-$37FF)

Full trace in `cdoc/phase6_maze_robots_difficulty.md` Task 3.

Score < 10,000 uses upright table at $3794; score >= 10,000 uses cocktail table at $37BC.
Each entry is 5 bytes: `(score_threshold, RBOLTS, bolt_speed, RWAIT, wall_colour)`.

### Interrupt-Driven Rendering Pipeline ($26D9)

Full trace in `cdoc/phase6_structs_rendering.md` Task 4.

The BOTTOM_OF_SCREEN_INTERRUPT executes this exact sequence every frame:

1. Erase player sprite (ERASE_PATTERN via MAN_PTR)
2. Restore player colour attributes (UNCOLOUR_MAN)
3. Erase current robot sprite (ERASE_PATTERN via V.PTR)
4. Handle player bolts (HANDLE_PLAYER_BOLTS: move, draw, collide)
5. Move/animate player (MOVE_ANIMATE_VECTOR via MAN_PTR)
6. Move/animate current robot (MOVE_ANIMATE_VECTOR via V.PTR)
7. Walk V.PTR to next robot in linked list
8. Process job list timers ($27F5: decrement Delay, transition to runnable)
9. Re-enable interrupts, restore registers, return

The top-of-screen interrupt ($26B6 path) handles coin edge detection on port $49 bits 5-7.

### Job Scheduler (Coroutines)

Full trace in `cdoc/phase6_jobs_otto_rooms.md` Task 1.

- CREATE_JOB ($1E22): allocates 4-byte header + 24-byte scratch on stack, inserts at list head
- STOP_JOB ($1E78): saves SP, walks list for next runnable job (Flags bit 0), restores that job's SP, RETs into its continuation
- ACTIVATE_HEAD_JOB ($1E6D): sets Flags=$82 + Delay, then falls through to STOP_JOB
- Jobs are Z80 coroutines: each job has its own stack frame; the "function to execute" is the return address saved on the stack

### Demo Mode ($1685-$16CC)

Full trace in `cdoc/phase6_jobs_otto_rooms.md` Task 4.

- Demo data at ROM $16D9, format: bit 7 clear = DURL+fire direction, bit 7 set = delay count
- IS_DEMO_MODE ($436E) = $FF suppresses scoring, speech, coin sound, play time tracking
- Attract loop: title screen -> wait -> credits prompt -> wait -> demo play -> repeat

### Magic RAM Control Register (Port $4B)

Full truth table in `cdoc/phase6_maze_robots_difficulty.md` (74181 ALU section).

| Bits | Function |
|------|----------|
| 0-2 | Pixel shift amount (X % 8) |
| 3 | Horizontal flip (cocktail mode) |
| 4-7 | 74181 ALU function select (S3-S0) |

Common ALU modes (after mandatory XOR $FF inversion):
- $00: F = ~A (pass-through new data)
- $10: F = ~(A OR B) (OR-combine, used for walls)
- $90: F = A XOR B (XOR mode, used for collision detection)
- $C0: F = $00 (clear)

### Previously Documented Algorithms

See `cdoc/disassembly_analysis.md` Section 5 for:
- RNG: `seed = seed * 7 + $3153` (verified, multiplier is 7 not 5)
- Robot SEEK: deterministic delta-based pathfinding
- Robot SHOOT: RBOLTS check, RWAIT timer, S.TAB lookup
- Clear Screen: stack-push VRAM trick
- BCD Score: DAA arithmetic with bonus life threshold
- Bolt Collision: read pixel at head, non-zero = hit
- Movement Speed: VECTOR.TIME/TPRIME countdown
- Colour Attributes: 4x4 blocks, inline 5-byte parameter blocks after CALL

---

## RAM Variables -- Additions and Corrections

Variables identified through opcode tracing (see phase6_jobs_otto_rooms.md Task 4):

| Address | Label | Purpose |
|---------|-------|---------|
| $434A | DIFFICULTY | BCD difficulty counter; +$60 per room; controls robot spawn probability |
| $4300 | (scratch) | Dual-purpose: system stack base address and reusable scratch temporary |
| $4066 | (unknown) | EQU only, no code references found; purpose undetermined |

---

## Phase 7 Interface

The 119 verified subroutine entry points in `cdoc/subroutine_entry_points.txt` define
the set of addresses used for cosimulation invocation tracking. A "subroutine invocation"
occurs whenever the Z80 program counter reaches one of these addresses, regardless
of whether it arrived via CALL, JP, RST, or fall-through.

The data structures, RAM variable map, and algorithm documentation here define the
observable state and behavior that the C++ reimplementation must reproduce at
subroutine boundaries.
