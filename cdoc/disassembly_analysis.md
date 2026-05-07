# Berzerk Disassembly Analysis

Comprehensive reference extracted from Scott Tunstall's reverse engineering of Berzerk (Stern Electronics, 1980).
Source file: `berzerk_tunstall.asm` (9163 lines). Cross-referenced with Frenzy (sequel) source code labels.

This document serves as a key reference for implementing a bit-accurate and frame-accurate C++ emulator.

---

## 1. RAM Variable Map

### 1.1 CMOS RAM ($0800-$09FF, bits 4-7)

Persistent bookkeeping data surviving power cycles. Values stored as BCD (upper nibble = 1 digit).

| Address | Label | Size | Description |
|---------|-------|------|-------------|
| $0800 | UNKNOWN_0800 | ? | Unknown purpose |
| $085E | NMI_STACK_PTR | 2 | SP saved/restored by NMI handler |
| $0870 | V.PTR | 2 | Pointer to next free VECTOR struct |
| $0872 | LINKED_LIST_PTR | 2 | Pointer to head of job linked list |
| $0874 | STACK_PTR | 2 | SP preserved in interrupt handler ($26AC) |
| $0876 | MAN_PTR | 2 | Pointer to current player's VECTOR struct |
| $0878 | TCR1 | 1 | Sound chip phantom register: Timer Control 1 |
| $0879 | TCR2 | 1 | Sound chip phantom register: Timer Control 2 |
| $087A | TCR3 | 1 | Sound chip phantom register: Timer Control 3 |
| $087B | TMR1 | 2 | Sound chip phantom register: Timer 1 value |
| $087D | TMR2 | 2 | Sound chip phantom register: Timer 2 value |
| $087F | TMR3 | 2 | Sound chip phantom register: Timer 3 value |
| $0881 | NOISE | 1 | Sound chip phantom register: Noise |
| $0882 | VOL1 | 1 | Sound chip phantom register: Volume 1 |
| $0883 | VOL2 | 1 | Sound chip phantom register: Volume 2 |
| $0884 | VOL3 | 1 | Sound chip phantom register: Volume 3 |
| $0885 | PC0 | 4 | Sound program counter / pointer to sound data |
| $0889 | PC1 | 1 | Current sound priority level |
| $089A | IS_CHICKEN | 1 | $00 = not chicken, $FF = player is chicken |
| $089B | TALK_TIMER | 1 | Countdown before robot speaks; at 0 robot says something |
| $08A4 | CMOS_CREDITS | 2 | Total credits inserted (BCD) |
| $08A6 | CMOS_CHUTE1 | 8 | Coin chute 1 totals (BCD) |
| $08AE | CMOS_CHUTE2 | 8 | Coin chute 2 totals (BCD) |
| $08B6 | CMOS_CHUTE3 | 8 | Coin chute 3 totals (BCD) |
| $08BE | CMOS_NUM_PLAYS | 6 | Total number of plays (BCD) |
| $08C4 | CMOS_TOTAL_SCORE | 12 | Cumulative score across all plays (BCD) |
| $08D0 | CMOS_TOTAL_SECS_OF_PLAY | 12 | Total seconds of play (BCD) |
| $08DC | CMOS_HIGH_SCORES | ? | High scores stored in CMOS |
| $0918 | SPEECH_BUFFER | ~40 | Buffer for dynamically generated speech byte sequence |
| $0940 | PLAYER_COLOUR_ADDR | 2 | Pointer to colour attribute RAM at player position |
| $0942 | PLAYER_COLOUR_SAVE | 10 | Saved colour attributes to restore when player moves |

### 1.2 Scratch Pad RAM ($0800-$0BFF bits 0-3, $4000-$43FF)

Game state variables in scratch pad RAM.

| Address | Label | Size | Description |
|---------|-------|------|-------------|
| $4066 | ??? | ? | Unknown |
| $4300 | (unnamed) | 2 | Unknown purpose |
| $4302 | HI_SCORES | 60 | High score table: 10 entries x 6 bytes each |
| $433E | P1_SCORE | 3 | Player 1 score (BCD: $433E=100K/10K, $433F=1K/100, $4340=10/1) |
| $4341 | P2_SCORE | 3 | Player 2 score (same BCD format) |
| $4344 | CURRENT_PLAYER | 1 | 1 = player 1, 2 = player 2 |
| $4345 | ROOM_X | 1 | X coordinate of current room in maze |
| $4346 | ROOM_Y | 1 | Y coordinate of current room in maze |
| $4347 | MAN_X | 1 | Player X position on screen |
| $4348 | MAN_Y | 1 | Player Y position on screen |
| $4349 | DEATHS | 1 | Lives remaining |
| $434B | RBOLTS | 1 | Max robot bolts on screen at once; 0 = robots never shoot |
| $434C | ROBOT_SPEED | 1 | Robot speed: 1 = fastest, 255 = slowest |
| $434D | RWAIT | 1 | Initial robot firing holdoff timer |
| $434E | OTTO_TIME | 1 | Countdown before Evil Otto appears |
| $434F | XTRAMEN | 1 | Flag: 1 = bonus life already awarded, prevents more |
| $435C | RNG_SEED | 2 | 16-bit seed for PRNG at $2678 |
| $435E | (maze data) | 15 | Maze wall configuration for current room |
| $436D | UPDATE | 1 | $FF = score display needs refresh |
| $436E | IS_DEMO_MODE | 1 | Non-zero = demo/attract mode active |
| $436F | DEMO_PTR | 2 | Pointer into demo playback data |
| $4371 | RCOUNT | 1 | Robots still alive in current room |
| $4372 | RSAVED | 1 | Robots at room start (for bonus calculation) |
| $4376 | NUMBER_OF_PLAYERS | 1 | 1 = single player, 2 = two player |
| $4378 | PLAYER_COLOUR | 1 | Player sprite colour attribute value |
| $4379 | FLIP | 1 | 0 = upright cabinet, 8 = cocktail cabinet |
| $437B | PLAYER_BOLTS | 16 | Two BOLT structs for player (8 bytes each) |
| $438F | ROBOT_BOLTS | varies | BOLT structs for robot projectiles |

---

## 2. Data Structure Documentation

### 2.1 VECTOR (14 bytes) -- Animated Sprite State

Used for player, robots, and Evil Otto. Bolts use BOLT struct instead.
Layout verified against actual (ix+$NN) and (iy+$NN) accesses across 12+ routines.
Full evidence table in `cdoc/phase6_structs_rendering.md`.

VECTORs are linked via 2 bytes at negative offsets (BASE-2, BASE-1) forming
a singly-linked list headed by V.PTR ($0870).

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| +$00 | Status | BYTE | Rendering control bits (see status bits below) |
| +$01 | Magic | BYTE | Last magic RAM control value used for this object |
| +$02 | O.A.L | BYTE | Old screen address, low byte |
| +$03 | O.A.H | BYTE | Old screen address, high byte |
| +$04 | O.P.L | BYTE | Old pattern (sprite data) address, low byte |
| +$05 | O.P.H | BYTE | Old pattern address, high byte |
| +$06 | V.X | BYTE | X velocity (signed delta added to P.X) |
| +$07 | P.X | BYTE | Current X position on screen |
| +$08 | V.Y | BYTE | Y velocity (signed delta added to P.Y) |
| +$09 | P.Y | BYTE | Current Y position on screen |
| +$0A | D.P.L | BYTE | Pattern table pointer, low byte |
| +$0B | D.P.H | BYTE | Pattern table pointer, high byte |
| +$0C | TIME | BYTE | Movement speed counter; lower = faster |
| +$0D | TPRIME | BYTE | Reload value for TIME when it counts to 0 |

**Status Bits** (verified against actual BIT/SET/RES instructions):

| Bit | Label | Meaning |
|-----|-------|---------|
| 0 | STATUS_BIT_ERASE | Erase previous image |
| 1 | STATUS_BIT_WRITE | Write/draw current image |
| 2 | STATUS_BIT_MOVE | Object is moving |
| 3 | STATUS_BIT_BLANK | Object is blank/invisible |
| 4 | STATUS_BIT_COLOR | Apply colour attributes |
| 5 | STATUS_BIT_DYING | Death-flash animation (set by PLAYER_DEAD) |
| 7 | STATUS_BIT_HIT | Collision detected |

### 2.2 BOLT (8 bytes) -- Laser Projectile State

Bolts are pixel-plotted, not sprite-based. PLAYER_BOLT_1 at $437B, PLAYER_BOLT_2
at $4383 (8 bytes apart). ROBOT_BOLTS at $438F. The tail half (offsets 4-7)
mirrors the head layout so the same movement routine can process both head and
tail by advancing IY by 4. Layout verified against actual opcodes in
`cdoc/phase6_structs_rendering.md`.

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | Direction | BYTE | DURL bits (non-zero = bolt exists) |
| 1 | Length | BYTE | Current bolt length in pixels |
| 2 | X | BYTE | X coordinate of bolt head |
| 3 | Y | BYTE | Y coordinate of bolt head |
| 4 | LastDirection | BYTE | Previous direction (also "in use" flag) |
| 5 | MaxLength | BYTE | Maximum bolt length ($08 for player) |
| 6 | TailX | BYTE | X coordinate of bolt tail |
| 7 | TailY | BYTE | Y coordinate of bolt tail |

### 2.3 LINKED_LIST_ITEM (6 bytes on stack) -- Job Scheduler Entry

The job scheduler is a cooperative coroutine system. Each job has its own stack
frame; the "function to execute" is the return address saved on the stack.
Layout verified against actual opcodes in `cdoc/phase6_jobs_otto_rooms.md`.

```
Stack memory layout (low to high):
  [next_lo] [next_hi] [flags] [delay] [sp_lo] [sp_hi] [24 bytes scratch]
                       ^
                       |--- list pointer points here (offset +0)
```

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| -2 | Next.L | BYTE | Low byte of pointer to next job |
| -1 | Next.H | BYTE | High byte of pointer to next job |
| +0 | Flags | BYTE | Bit 0=runnable, bit 1=active, bit 7=initialized |
| +1 | Delay | BYTE | Frame-delay counter (decremented by interrupt handler) |
| +2 | SP.L | BYTE | Saved stack pointer low (continuation point) |
| +3 | SP.H | BYTE | Saved stack pointer high |

### 2.4 High Score Entry (6 bytes)

10 entries at $4302-$4337, sorted highest to lowest.

| Offset | Size | Description |
|--------|------|-------------|
| 0-2 | 3 | Score as BCD (e.g. 123,456 stored as $12 $34 $56) |
| 3-5 | 3 | Player initials (mostly ASCII) |

---

## 3. Subroutine Labels and Purposes

### 3.1 Boot and Initialization

| Address | Label | Description |
|---------|-------|-------------|
| $0000 | (reset) | NOP, DI, check test mode DIP switches |
| $0066 | (NMI vector) | Z80 NMI entry point |
| $0442 | (magic RAM test) | Hardware self-test of Magic RAM and 74181 ALU |
| $17B8 | (player game start) | Initialize new game: copy defaults, set CMOS stats |
| $187F | DEFAULT_PLAYER_STATE | 12-byte table of default values for $4344-$434F |

### 3.2 Display and Rendering

| Address | Label | Description |
|---------|-------|-------------|
| $1A4E | (clear screen) | Clears VRAM using stack push trick for speed |
| $2314 | SHOW_SCORE | Display current player's score on screen |
| $2334 | GET_PLAYER_SCORE_PTR | Returns pointer to P1_SCORE or P2_SCORE based on CURRENT_PLAYER |
| $272D | ERASE_PATTERN | Erase a sprite pattern from screen |
| $274D | WRITE_PATTERN | Write a sprite pattern to screen |
| $27A9 | MOVE_ANIMATE_VECTOR | Move and animate a VECTOR using TIME/TPRIME speed control |
| $2817 | DRAW_SPRITE | Draw 1-byte or 2-byte wide sprite to magic image RAM |
| $29A1 | RTOAX | Alias for CALCULATE_MAGIC_IMAGE_RAM_ADDRESS |
| $29A3 | CALCULATE_MAGIC_IMAGE_RAM_ADDRESS | Convert screen X,Y to magic image RAM address; handles cabinet flip |
| $29DB | PRINT_CHAR | Plot single character to screen via magic RAM (9 bytes per char) |
| $2A40 | PRINT_DIGITS | Print multi-digit BCD number |
| $06B8 | (string print) | Print a string to screen |

### 3.3 Colour System

| Address | Label | Description |
|---------|-------|-------------|
| $35AF | SET_COLOUR_ATTRS_35AF | Set up initial colour attributes for the screen |
| $35F8 | COLOUR_FILL_WHITE | Fill entire screen colour RAM with white ($FF) |
| $3657 | COLOUR_FILL | Rectangular colour fill; reads 5-byte parameter block inline after CALL |
| $3719 | UNCOLOUR_MAN | Restore original colour attributes at player position |
| $373C | COLOUR_MAN | Apply PLAYER_COLOUR to colour RAM at player sprite position |

### 3.4 Player Routines

| Address | Label | Description |
|---------|-------|-------------|
| $1EA9 | MAN | Main player job routine (called from job scheduler) |
| $1EE1 | MOVE_PLAYER | Process player joystick input and movement |
| $1F01 | TRY_FIRE | Check fire button and attempt to fire |
| $1F1B | FIRE | Spawn a player bolt (find free BOLT slot, set direction/position) |
| $1F91 | CHANGE_PLAYER_DIRECTION | Update player facing direction from joystick |
| $1FA7 | PLAYER_DEAD | Handle player death sequence |
| $1FD4 | MAN_INIT | Initialize player VECTOR struct for room entry |
| $2053 | P.TAB | Player pattern lookup table (indexed by DURL direction) |
| $2067 | SR.TAB | Player shoot table: 8 entries with pattern pointer, X/Y deltas, DURL bits |

### 3.5 Robot Routines

| Address | Label | Description |
|---------|-------|-------------|
| $200E | (VECTOR alloc) | Allocate VECTOR struct for new robot |
| $2042 | D.TAB | Direction lookup table for robot movement |
| $209D | (room setup) | Set up room: spawn robots in positions |
| $23B8 | ROBOT | Main robot job routine |
| $23EF | SEEK | Robot AI: track player using delta X/Y calculation |
| $2436 | SETPAT | Set robot animation pattern based on direction |
| $2457 | BLAM | Robot explosion: award 50 pts, play sound, check room clear |
| $2491 | (room bonus) | Calculate bonus for clearing room (based on RSAVED) |
| $287F | SHOOT | Robot shooting AI: decide horizontal/vertical/diagonal fire |
| $2944 | S.TAB | Robot shoot table: direction/velocity entries |

### 3.6 Evil Otto

| Address | Label | Description |
|---------|-------|-------------|
| $2A8E | (Otto init) | Initialize Evil Otto VECTOR and countdown |
| $2B3D | SET_VELOCITY | Set Otto's velocity toward player |

### 3.7 Bolt Handling

| Address | Label | Description |
|---------|-------|-------------|
| $14F3 | HANDLE_PLAYER_BOLTS | Process both player bolt slots each frame |
| $1553 | MOVE_AND_DRAW_BOLT | Advance bolt position, draw/erase pixels |
| $157E | (offscreen check) | Check if bolt has left screen bounds |
| $15CB | (collision detect) | Check bolt collision with screen pixels |

### 3.8 Room and Maze

| Address | Label | Description |
|---------|-------|-------------|
| $2540 | (maze wall draw) | Draw maze walls for current room |
| $21E6 | SCROLL_UP | Scroll screen when player exits top |
| $2237 | SCROLL_DOWN | Scroll screen when player exits bottom |
| $2274 | SCROLL_LEFT | Scroll screen when player exits left |
| $22C3 | SCROLL_RIGHT | Scroll screen when player exits right |

### 3.9 Score and Bookkeeping

| Address | Label | Description |
|---------|-------|-------------|
| $2341 | UPDATE_SCORE | Add value to current player score using BCD arithmetic |
| $2DB3 | INCREMENT_BY_1 | BCD increment of multi-byte counter (used for bookkeeping) |
| $0605 | (bookkeeping display) | Show bookkeeping statistics screen |
| $0673 | (CMOS unpack) | Unpack CMOS bookkeeping data for display |
| $18CD | PRINT_CREDITS | Display credit count in demo mode |

### 3.10 Sound Routines

| Address | Label | Description |
|---------|-------|-------------|
| $1776 | C.LOAD | Output all audio register values from RAM shadow to hardware |
| $1792 | T.LOAD | Load timer values to audio hardware |
| $33BD | SFIRE | Play bolt shooting sound (priority 0) |
| $3439 | SFRY | Play player electrocution sound (priority 3) |
| $348A | SBLAM | Play robot explosion sound |
| $34E7 | SRFIRE# | Play robot shooting sound |

All sound routines use the priority system via PC1 ($0889). A sound only plays if its priority >= current priority.

### 3.11 Speech

| Address | Label | Description |
|---------|-------|-------------|
| $1721 | (NMI speech) | NMI handler portion that outputs speech data to voice chip |
| $1748 | (voice output) | Instruct S14001A hardware to emit speech |
| $2B6B | WRITE_RANDOM_SENTENCE_TO_BUFFER | Generate random robot sentence in SPEECH_BUFFER |
| $2B97 | GENERATE_ROBOT_SPEECH | Pick random pitch and word, build speech sequence |

### 3.12 Job Scheduler

| Address | Label | Description |
|---------|-------|-------------|
| $1E22 | CREATE_JOB | Allocate and insert a new job into the linked list |
| $1E6D | ACTIVATE_HEAD_JOB | Execute the job at the head of the linked list |
| $1E78 | STOP_JOB | Remove/deactivate a job from the linked list |

### 3.13 Interrupts

| Address | Label | Description |
|---------|-------|-------------|
| $26AB | (interrupt entry) | Main interrupt handler (DI, save state, dispatch) |
| $26D9 | BOTTOM_OF_SCREEN_INTERRUPT | End-of-frame interrupt processing |

### 3.14 Attract Mode and Demo

| Address | Label | Description |
|---------|-------|-------------|
| $19AC | (attract mode) | Attract mode loop: cycle demo, high scores, speech |
| $1AED | (language table) | Lookup table for 4-language string selection |

### 3.15 Utility

| Address | Label | Description |
|---------|-------|-------------|
| $2678 | RANDOM | 16-bit PRNG: seed = seed * 7 + $3153; returns A = high byte |
| $073A | (crosshair test) | Draw crosshair test pattern |

---

## 4. Game Constants and Tables

### 4.1 Direction Constants (DURL)

| Value | Label | Meaning |
|-------|-------|---------|
| $01 | LEFT | Move/face left |
| $02 | RIGHT | Move/face right |
| $04 | UP | Move/face up |
| $08 | DOWN | Move/face down |

Diagonal directions combine bits: e.g. UP+LEFT = $05, DOWN+RIGHT = $0A.

### 4.2 Speech Vocabulary (30 words, S14001A chip)

| ID | Word | ID | Word | ID | Word |
|----|------|----|------|----|------|
| $01 | KILL | $0B | IN | $15 | DESTROY |
| $02 | ATTACK | $0C | IT | $16 | MUST |
| $03 | CHARGE | $0D | THERE | $17 | NOT |
| $04 | GOT | $0E | WHERE | $18 | CHICKEN |
| $05 | SHOOT | $0F | HUMANOID | $19 | FIGHT |
| $06 | GET | $10 | COINS | $1A | LIKE |
| $07 | IS | $11 | POCKET | $1B | A |
| $08 | ALERT | $12 | INTRUDER | $1C | ROBOT |
| $09 | DETECTED | $13 | NO | $1D | ??? |
| $0A | THE | $14 | ESCAPE | | |

### 4.3 Speech Sentence Tables

| Address | Label | Content |
|---------|-------|---------|
| $1AD6 | COINS_DETECTED_IN_POCKET | "Coins detected in pocket" |
| $2C25 | ROBOT_TARGET | Target words for "the humanoid/intruder" |
| $2C2C | ROBOT_FIRST_WORD | First words: KILL, ATTACK, CHARGE, GOT, SHOOT, GET, DESTROY |
| $2C32 | MUST_NOT_ESCAPE | "Must not escape" phrase data |

### 4.4 Pattern/Sprite Tables (ROM at $1000+)

| Address | Content |
|---------|---------|
| $1000+ | Robot standing patterns (by direction) |
| (varies) | Robot moving/walking animation frames |
| (varies) | Robot explosion animation frames |
| (varies) | Player standing patterns (8 directions) |
| (varies) | Player shooting patterns (8 directions) |
| $2053 | P.TAB: Player pattern table indexed by DURL |
| $2067 | SR.TAB: Player shoot table (8 entries: pattern ptr, X/Y delta, DURL) |
| $2042 | D.TAB: Direction lookup for robot movement |
| $2944 | S.TAB: Robot shoot table (direction/velocity for bolt spawning) |

### 4.5 Character Set

| Address | Details |
|---------|---------|
| $2F1E-$3395 | 9 bytes per character, full ASCII set from space ($20) through tilde ($7E) |
| $80 | Special ordinal: "life" icon (stick figure for lives display) |

Character rendering: `char_addr = $2F1E + (ordinal * 9)`. Each character is 9 pixels tall, drawn 1 byte (8 pixels) wide through magic RAM.

### 4.6 Scoring Constants

| Event | Points |
|-------|--------|
| Robot destroyed | 50 |
| Room clearance bonus | Based on RSAVED (robot count at room start) |
| Bonus life threshold | 5000 and/or 10000 (DIP switch configurable) |

Bonus life DIP switch (F2 bits 6-7):
- $C0: bonus at 5000 and 10000
- $40: bonus at 5000 only
- $80: bonus at 10000 only
- $00: no bonus life

### 4.7 Difficulty/Progression Tables

| Address | Description |
|---------|-------------|
| $3794 | Difficulty table for upright cabinet (indexed by room count / score) |
| $37BC | Difficulty table for cocktail cabinet |

Each entry sets: RBOLTS (max robot bolts), robot bolt speed, RWAIT (firing holdoff), and maze wall colour. The game looks up the current difficulty level based on accumulated score/room data and applies these parameters per room.

### 4.8 Default Player State ($187F)

12 bytes copied to $4344-$434F at game start:

| Offset | Target | Typical Value | Field |
|--------|--------|---------------|-------|
| 0 | $4344 | 1 | CURRENT_PLAYER |
| 1 | $4345 | (random) | ROOM_X |
| 2 | $4346 | (random) | ROOM_Y |
| 3 | $4347 | - | MAN_X |
| 4 | $4348 | - | MAN_Y |
| 5 | $4349 | 3 | DEATHS (lives) |
| 6 | $434A | - | unknown |
| 7 | $434B | - | RBOLTS |
| 8 | $434C | - | ROBOT_SPEED |
| 9 | $434D | - | RWAIT |
| 10 | $434E | - | OTTO_TIME |
| 11 | $434F | 0 | XTRAMEN |

Note: ROOM_X and ROOM_Y are overwritten with RNG_SEED value immediately after the LDIR copy.

### 4.9 Maze Wall Segment Data

| Address | Description |
|---------|-------------|
| $269B | Wall segment sprite data (4-byte pattern for vertical/horizontal walls) |
| $268C | 15-byte room wall configuration template |

Maze walls are drawn as 12x12 pixel blocks (vertical segments) and 18x4 pixel blocks (horizontal segments) using DRAW_SPRITE through magic RAM.

### 4.10 Crosshatch Test Pattern

| Address | Description |
|---------|-------------|
| $3395 | Alternating $55/$2A pattern for hardware test mode display |

---

## 5. Major Algorithms

### 5.1 Random Number Generator ($2678)

Linear congruential generator operating on a 16-bit seed.

Instruction trace from disassembly:

```
RANDOM:
  PUSH HL
  LD HL,(RNG_SEED)      ; HL = seed
  LD D,H / LD E,L      ; DE = seed (copy)
  ADD HL,HL             ; HL = 2 * seed
  ADD HL,DE             ; HL = 3 * seed
  ADD HL,HL             ; HL = 6 * seed
  ADD HL,DE             ; HL = 7 * seed
  LD DE,$3153
  ADD HL,DE             ; HL = 7 * seed + $3153
  LD (RNG_SEED),HL      ; store new seed
  LD A,H                ; return high byte
  POP HL
  RET
```

**Formula: `new_seed = old_seed * 7 + $3153` (mod 65536)**

Returns A = high byte of new seed. Note: some secondary sources cite the multiplier as 5, but the actual instruction sequence (opcodes $29 $19 $29 $19 at addresses $267E-$2681) yields a multiplier of 7.

### 5.2 Robot AI: SEEK ($23EF)

The SEEK routine makes robots track the player:

1. Calculate delta X = player_X - robot_X
2. Calculate delta Y = player_Y - robot_Y
3. Choose direction bits (DURL) to move toward player
4. Apply direction to robot's velocity via D.TAB lookup
5. Set animation pattern via SETPAT ($2436)

Robots move in cardinal or diagonal directions. The AI is deterministic given positions -- no randomness in movement choice.

### 5.3 Robot Shooting AI: SHOOT ($287F)

Decision logic for robot bolt firing:

1. Check if RBOLTS > 0 (robots allowed to shoot)
2. Check RWAIT holdoff timer
3. Calculate relative position to player
4. Decide fire direction:
   - If nearly aligned horizontally: fire horizontal
   - If nearly aligned vertically: fire vertical
   - Otherwise: fire diagonal toward player
5. Look up bolt parameters from S.TAB ($2944)
6. Spawn BOLT struct with appropriate direction and velocity

### 5.4 Clear Screen ($1A4E)

Uses the Z80 stack push trick for high-speed memory clearing:

1. Save SP
2. Set SP to end of VRAM
3. Load HL with 0
4. Execute repeated PUSH HL to fill VRAM with zeros (2 bytes per push, much faster than LD/INC loops)
5. Restore SP

### 5.5 Magic RAM Sprite Drawing ($2817 DRAW_SPRITE)

Magic RAM provides hardware-accelerated sprite operations through the 74181 ALU:

1. Calculate magic image RAM address from X,Y coordinates via CALCULATE_MAGIC_IMAGE_RAM_ADDRESS ($29A3)
2. Set magic RAM control byte via OUT ($4B):
   - Bits 0-2: pixel shift amount (X % 8)
   - Bit 3: horizontal flip (set for cocktail cabinet)
   - Bit 4 + Bit 7: XOR mode (for collision detection)
3. Write sprite data bytes to magic image RAM
4. The 74181 ALU hardware automatically performs shift/combine/XOR operations
5. For collision detection: write in XOR mode and check intercept register at port $4E

### 5.6 Cooperative Multitasking (Job System)

The game uses a linked list job scheduler:

1. CREATE_JOB ($1E22): Allocate a LINKED_LIST_ITEM, set flags and delay, insert into list
2. ACTIVATE_HEAD_JOB ($1E6D): Pop head job, execute its associated routine
3. STOP_JOB ($1E78): Remove a job from the list

Jobs include: MAN (player), ROBOT (each robot), Evil Otto, attract mode tasks. The main loop iterates the job list each frame.

### 5.7 BCD Score Arithmetic ($2341 UPDATE_SCORE)

Scores are stored as 3-byte BCD (6 digits). UPDATE_SCORE:

1. Add point value to score bytes using DAA (Decimal Adjust Accumulator) for BCD correctness
2. Check for bonus life thresholds (5000 / 10000) based on DIP switch setting
3. Set UPDATE flag ($436D) = $FF to trigger display refresh
4. INCREMENT_BY_1 ($2DB3): BCD increment used for bookkeeping counters (6-byte precision)

### 5.8 Bolt Movement and Collision ($1553, $15CB)

1. MOVE_AND_DRAW_BOLT: advance bolt head by direction, erase tail pixel if at max length
2. Collision detection: read pixel at bolt head position from screen RAM; if non-zero, collision occurred
3. Offscreen check ($157E): compare bolt coordinates against screen boundaries (0-255 X, 0-223 Y)
4. On collision: determine if target is player, robot, or wall; dispatch appropriate handler

### 5.9 MOVE_ANIMATE_VECTOR ($27A9)

Frame-rate independent movement using TIME/TPRIME:

1. Decrement VECTOR.TIME
2. If TIME reaches 0: reload from TPRIME, execute actual movement (add V.X to P.X, V.Y to P.Y)
3. Update pattern pointer for animation cycling
4. Set STATUS_BIT_ERASE and STATUS_BIT_WRITE for rendering

Lower TPRIME = faster movement. This is how ROBOT_SPEED controls difficulty.

### 5.10 Colour Attribute System

Colour RAM at $8000-$87FF maps 4x4 pixel blocks to one of 16 colours (RGBI format, two nibbles per byte = foreground/background).

- COLOUR_FILL ($3657): reads a 5-byte parameter block inline after the CALL instruction:
  - Byte 0: Y start (in attribute coordinates)
  - Byte 1: X start
  - Byte 2: height (attribute rows)
  - Byte 3: width (attribute columns)
  - Byte 4: colour value
- COLOUR_MAN ($373C): saves 2x5 attribute block at player position, overwrites with PLAYER_COLOUR
- UNCOLOUR_MAN ($3719): restores the saved 2x5 attribute block

---

## 6. Memory Map Summary

### 6.1 Address Space

| Range | Size | Description |
|-------|------|-------------|
| $0000-$07FF | 2K | Program PROM (1C) |
| $0800-$09FF | 512 | CMOS RAM (bits 4-7: persistent bookkeeping) |
| $0800-$0BFF | 1K | Scratch pad RAM (bits 0-3) |
| $0A00-$0BFF | 512 | Optional CMOS RAM (bits 4-7) |
| $1000-$17FF | 2K | Program PROM (1D) |
| $1800-$1FFF | 2K | Program PROM (3D) |
| $2000-$27FF | 2K | Program PROM (4D) |
| $2800-$2FFF | 2K | Program PROM (6D) |
| $3000-$37FF | 2K | Program PROM (4C) |
| $3800-$3FFF | 2K | Program PROM (3C) |
| $4000-$43FF | 1K | Scratch pad RAM (game state variables) |
| $4400-$5FFF | 7K | Screen Image RAM (VRAM): 256x223, 1 bit/pixel, 32 bytes/scanline |
| $6000-$63FF | 1K | Magic Scratchpad RAM |
| $6400-$7FFF | 7K | Magic Image RAM (write-only via 74181 ALU) |
| $8000-$87FF | 2K | Colour lookup RAM (RGBI,RGBI per nibble) |

### 6.2 Colour RAM Layout

- $8000-$83FF: top half of screen (first 128 scanlines)
- $8400-$87FF: bottom half of screen
- Each byte covers a 4x4 pixel block
- Upper nibble: one colour, lower nibble: other colour
- 16 colours (4-bit RGBI)
- 32 columns x 56 rows = 1792 bytes per half

### 6.3 VRAM Layout

- 32 bytes per scanline (256 pixels / 8 bits per byte)
- 223 visible scanlines (not 224; the hardware produces 224 but line 0 is not displayed in standard configuration)
- Pixel address = $4400 + (Y * 32) + (X / 8)
- Bit position within byte = X % 8

---

## 7. I/O Port Usage

### 7.1 Port Map (active-low unless noted)

| Port | R/W | Label | Description |
|------|-----|-------|-------------|
| $40 | W | CR1_PORT | Audio control register 1 |
| $41 | W | CR2_PORT | Audio control register 2 |
| $42 | W | - | Audio timer MSB |
| $43 | W | - | Audio timer LSB |
| $44 | R/W | VOICE_PORT | S14001A speech synthesis chip |
| $48 | R | P1 | Player 1 joystick + fire button |
| $49 | R | SYSTEM | Start buttons, coin switches |
| $4A | R | P2 | Player 2 joystick + fire + cabinet DIP |
| $4B | W | magicram_control_w | Magic RAM control register |
| $4C | R/W | nmi_enable | Read or write enables NMI |
| $4D | R/W | nmi_disable | Read or write disables NMI |
| $4E | R | intercept_v256_r | Collision detect + V256 scanline; clears pending frame IRQ |
| $4F | W | irq_enable_w | Enable IRQ |
| $50-$57 | - | - | Second sound board (initialized but unused) |
| $60 | R | F3 | DIP: input test, crosshair, language |
| $61 | R | F2 | DIP: color test, bonus life setting |
| $62 | R | F6 | DIP: coin chute 3 pricing |
| $63 | R | F5 | DIP: coin chute 2 pricing |
| $64 | R | F4 | DIP: coin chute 1 pricing |
| $65 | R | SW2 | Bookkeeping button + free game button |
| $66 | R/W | led_off | LED off control |
| $67 | R/W | led_on | LED on control |

Ports $60-$67 have mirror at $78-$7F (mirror mask $18).

### 7.2 Player 1 Input (Port $48)

Active-low (0 = pressed).

| Bit | Function |
|-----|----------|
| 0 | Joystick Left |
| 1 | Joystick Right |
| 2 | Joystick Up |
| 3 | Joystick Down |
| 4 | Fire Button |
| 5-7 | Unused |

### 7.3 System Input (Port $49)

| Bit | Function |
|-----|----------|
| 0 | Start 1 (active low) |
| 1 | Start 2 (active low) |
| 2-4 | Unused |
| 5 | Coin 3 (active low) |
| 6 | Coin 2 (active low) |
| 7 | Coin 1 (active low) |

### 7.4 Player 2 Input (Port $4A)

Same layout as P1 (bits 0-4). Bit 7: cabinet type DIP (1 = upright, 0 = cocktail).

### 7.5 Magic RAM Control Register (Port $4B)

| Bit(s) | Function |
|--------|----------|
| 0-2 | Pixel shift amount (X position mod 8) |
| 3 | Horizontal flip (set for cocktail cabinet) |
| 4+7 | XOR mode when both set (used for collision detection) |

### 7.6 DIP Switch F2 (Port $61)

| Bits | Setting |
|------|---------|
| 0-1 | Colour test mode (00=off, 11=on) |
| 2-5 | Unused |
| 6-7 | Bonus life: C0=5K+10K, 40=5K only, 80=10K only, 00=none |

### 7.7 DIP Switch F3 (Port $60)

| Bits | Setting |
|------|---------|
| 0 | Input test mode (0=off, 1=on) |
| 1 | Crosshair pattern (0=off, 1=on) |
| 2-5 | Unused |
| 6-7 | Language: 00=English, 40=German, 80=French, C0=Spanish |

### 7.8 DIP Switches F4/F5/F6 (Ports $64/$63/$62)

Bits 0-3: coinage setting for coin chutes 1, 2, 3 respectively. Standard Berzerk coinage table with 16 pricing options from 2C/1Cr to 1C/14Cr.

### 7.9 SW2 (Port $65)

| Bit | Function |
|-----|----------|
| 0 | Free game (active high) -- S2 button on PCB |
| 1-6 | Unused |
| 7 | Bookkeeping display (active high) -- control panel button |

### 7.10 Intercept Register (Port $4E)

Read from this port:
- Returns collision/intercept status from Magic RAM operations
- Clears any pending frame interrupt (per hardware schematic: 74LS74 at 3D pin 13 /CLR)
- V256 bit indicates current scanline position (above/below line 256)

---

## Appendix: Conventions from the Disassembly

- **DURL**: Direction encoding -- Down=8, Up=4, Right=2, Left=1
- **Numbers**: `#$xx` = immediate hex value; `$xxxx` = memory address; unadorned = decimal
- **BCD**: Binary Coded Decimal; upper nibble holds tens digit, lower holds ones
- **Active-low inputs**: 0 = pressed/active, 1 = released/inactive
- **Cocktail support**: FLIP ($4379) = 8 triggers screen coordinate inversion and horizontal flip in magic RAM
- **Frenzy cross-references**: Many labels match Frenzy source code (EQUS.ASM, NMI.ASM, color.asm, showa.asm, demo.asm, bolts.asm)
