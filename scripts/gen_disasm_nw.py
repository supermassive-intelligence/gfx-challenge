#!/usr/bin/env python3
"""Generate noweb literate disassembly from berzerk_tunstall.asm.

Reads the Tunstall disassembly and produces a noweb (.nw) file that:
  1. Tangles back to the exact same .asm source
  2. Organizes the code into functional sections with documentation
  3. Provides C++ conversion notes for each section

Usage: python3 scripts/gen_disasm_nw.py
"""

import re
import sys
from pathlib import Path

ASM_PATH = Path("cdoc/berzerk_tunstall.asm")
OUT_PATH = Path("noweb/disassembly.nw")

# Section definitions: (start_line, end_line, chunk_name, section_title, description)
# Line numbers are 1-based inclusive. Determined by functional analysis of the asm.
# We use line numbers because the file has comments, blank lines, and data regions
# that don't correspond to simple address ranges.

SECTIONS = [
    # --- File header and documentation ---
    (
        1,
        528,
        "file header",
        "File Header and Conventions",
        """Original header by Scott Tunstall (2022) with conventions,
RAM variable map, data structure definitions (VECTOR, BOLT,
LINKED\\_LIST\\_ITEM), and high score entry format.

This section contains no executable code -- it documents the memory
layout and data structures that the rest of the program uses.""",
    ),
    # --- Boot and reset vector ---
    (
        529,
        575,
        "boot and reset",
        "Boot and Reset Vector (\\$0000--\\$0065)",
        """Z80 reset entry point. Disables interrupts, checks test-mode DIP
switches, then branches to hardware self-test or game start.
Includes RST vectors at \\$0008, \\$0018, \\$0020, \\$0038.

C++ note: The boot sequence is not needed for the native
reimplementation since we initialize state directly.""",
    ),
    # --- NMI handler ---
    (
        576,
        595,
        "nmi vector",
        "NMI Vector (\\$0066--\\$0080)",
        """Z80 non-maskable interrupt handler entry. NMI fires 8 times per
frame at specific scanline positions. Saves registers, then
dispatches to the NMI service routine.

C++ note: NMI timing is handled by the interrupt subsystem;
the handler logic (job scheduler tick, speech output) must be
replicated.""",
    ),
    # --- Early initialization ($0081-$0441) ---
    (
        596,
        1178,
        "early init",
        "Early Initialization (\\$0081--\\$0441)",
        """Hardware setup: LED control, colour RAM initialization, sound chip
reset, CMOS RAM validation, stack setup, and initial game state.
Includes the main game entry point after self-test passes.

C++ note: Most of this is hardware initialization that the native
implementation skips. The CMOS validation and default state setup
at \\$187F are relevant for game init.""",
    ),
    # --- Hardware self-test ($0442-$0590) ---
    (
        1179,
        1372,
        "hardware self test",
        "Hardware Self-Test (\\$0442--\\$0590)",
        """Tests Magic RAM and the 74181 ALU by writing known patterns and
verifying the results. Tests all ALU modes. Failure halts the
machine.

C++ note: Not needed for native implementation. The 74181 ALU
logic in video.nw was verified against this test.""",
    ),
    # --- Diagnostic modes ($0591-$0672) ---
    (
        1373,
        1549,
        "diagnostic modes",
        "Diagnostic Modes (\\$0591--\\$0672)",
        """Input test mode (displays joystick/button state), colour test mode
(fills screen with colour bars). Activated by DIP switches at boot.

C++ note: Not needed for gameplay.""",
    ),
    # --- Bookkeeping display ($0673-$0739) ---
    (
        1550,
        1709,
        "bookkeeping",
        "Bookkeeping and String Display (\\$0673--\\$0739)",
        """UNPACK\\_BYTES\\_TO\\_HL: unpacks CMOS bookkeeping data for display.
PRINT\\_DIGITS\\_068D: prints BCD digits (variant used in bookkeeping).
BK\\_SCROLL\\_UP: scrolls the bookkeeping display.
PRINT\\_STRING\\_06B8: general string printing routine.

C++ note: Bookkeeping is not needed for gameplay. The string print
routine (\\$06B8) is relevant for attract mode text display.""",
    ),
    # --- Crosshair test ($073A-$07FF) ---
    (
        1710,
        1821,
        "crosshair test",
        "Crosshair Test Pattern (\\$073A--\\$07FF)",
        """Test pattern display and button wait routines. WAIT\\_FOR\\_1P\\_FIRE\\_BUTTON
polls the fire button input.

C++ note: Not needed for gameplay.""",
    ),
    # --- Sprite pattern data ($1000-$14F2) ---
    (
        1822,
        2560,
        "sprite data",
        "Sprite and Pattern Data (\\$1000--\\$14F2)",
        """Robot and player sprite patterns stored in ROM. Each pattern has a
header (width, height) followed by pixel data bytes. Patterns are
organized by direction (DURL encoding) and animation frame.

Includes robot standing, walking, and explosion animation frames,
as well as player standing and shooting patterns.

C++ note: The native implementation reads these patterns directly
from the ROM data via m\\_patterns pointer. Pattern format:
[width][height][row0\\_byte0][row0\\_byte1]...""",
    ),
    # --- Bolt handling ($14F3-$165F) ---
    (
        2561,
        2854,
        "bolt handling",
        "Bolt Handling (\\$14F3--\\$165F)",
        """HANDLE\\_PLAYER\\_BOLTS (\\$14F3): processes both player bolt slots each frame.
MOVE\\_AND\\_DRAW\\_BOLT (\\$1553): advances bolt position, draws/erases pixels.
CHECK\\_IF\\_BOLT\\_OFFSCREEN (\\$157E): bounds checking.
HANDLE\\_BOLT\\_COLLISION (\\$15CB): determines what the bolt hit.
COLLISION\\_DETECTION: checks bolt against screen pixels.

Bolts are pixel-plotted (not sprite-based). Each BOLT struct is 8 bytes.
Player has 2 bolt slots; robots share a pool of bolt slots.

C++ note: Critical for gameplay. Bolts use direct VRAM pixel reads
for collision detection -- read the pixel at the bolt head position,
non-zero means collision.""",
    ),
    # --- Sound hardware ($1660-$17B7) ---
    (
        2855,
        3108,
        "sound hardware",
        "Sound Hardware Interface (\\$1660--\\$17B7)",
        """NMI handler speech output, S14001A voice chip interface, Exidy 6840
timer chip register loading (C.LOAD, T.LOAD), and audio hardware
initialization.

C++ note: Sound is stubbed in the current implementation. The
register shadow copies at \\$0878--\\$0884 and the speech buffer
at \\$0918 are the key interfaces.""",
    ),
    # --- Game initialization ($17B8-$18CC) ---
    (
        3109,
        3251,
        "game init",
        "Game Initialization (\\$17B8--\\$18CC)",
        """New game setup: copies DEFAULT\\_PLAYER\\_STATE (\\$187F) to \\$4344,
initializes score, lives, room coordinates from RNG. Sets up the
player VECTOR struct and difficulty parameters.

C++ note: Replicated in GameState::Phase::GAME\\_INIT. The 12-byte
default state table at \\$187F sets CURRENT\\_PLAYER=1, DEATHS=3,
XTRAMEN=0. ROOM\\_X/Y are overwritten with RNG values.""",
    ),
    # --- Credits and attract mode ($18CD-$1A4D) ---
    (
        3252,
        3517,
        "credits attract",
        "Credits Display and Attract Mode (\\$18CD--\\$1A4D)",
        """PRINT\\_CREDITS (\\$18CD): displays credit count in demo mode.
Attract mode loop (\\$19AC): cycles through demo gameplay,
high score display, and speech sequences. Language table for
multi-language string selection.

C++ note: Attract mode is not yet implemented in the native
version. The demo playback uses recorded input sequences
stored at DEMO\\_PTR (\\$436F).""",
    ),
    # --- Clear screen and attract loop ($1A4E-$1E21) ---
    (
        3518,
        4121,
        "clear screen attract loop",
        "Clear Screen and Attract Sequence (\\$1A4E--\\$1E21)",
        """CLEAR\\_SCREEN (\\$1A4E): high-speed VRAM clear using the Z80 stack
push trick (PUSH HL is faster than LD/INC loops).
Also contains the main attract mode state machine, high score
entry routines, and coin handling.

C++ note: Clear screen is trivially m\\_video.vram.fill(0) in
the native implementation. The coin/credit system and high
score entry are deferred.""",
    ),
    # --- Job scheduler ($1E22-$1EA8) ---
    (
        4122,
        4223,
        "job scheduler",
        "Cooperative Job Scheduler (\\$1E22--\\$1EA8)",
        """CREATE\\_JOB (\\$1E22): allocate LINKED\\_LIST\\_ITEM, insert into job list.
ACTIVATE\\_HEAD\\_JOB (\\$1E6D): execute the head job's continuation.
STOP\\_JOB (\\$1E78): remove a job from the list.

The game uses cooperative multitasking. Each ``job'' (player, robot,
Otto) has its own stack frame. The scheduler runs one job per frame
tick, cycling through the linked list.

C++ note: The native implementation uses a Phase state machine
instead of coroutines. Each entity's logic runs directly in the
frame update, not via a job scheduler.""",
    ),
    # --- Player routines ($1EA9-$200D) ---
    (
        4224,
        4488,
        "player routines",
        "Player Routines (\\$1EA9--\\$200D)",
        """MAN (\\$1EA9): main player job routine, called by scheduler.
MOVE\\_PLAYER (\\$1EE1): processes joystick input, applies movement.
TRY\\_FIRE (\\$1F01): checks fire button, calls FIRE if pressed.
FIRE (\\$1F1B): spawns a player bolt (finds free slot, sets direction).
CHANGE\\_PLAYER\\_DIRECTION (\\$1F91): updates facing from joystick.
PLAYER\\_DEAD (\\$1FA7): death sequence (flash, sound, life decrement).
MAN\\_INIT (\\$1FD4): initializes player VECTOR for room entry.

C++ note: Movement logic is in do\\_frame\\_playing(). Fire/bolt
spawning and death sequence need implementation. The direction
lookup uses P.TAB (\\$2053) and SR.TAB (\\$2067).""",
    ),
    # --- Player/robot tables ($200E-$209C) ---
    (
        4489,
        4672,
        "player robot tables",
        "VECTOR Allocation and Lookup Tables (\\$200E--\\$209C)",
        """VECTOR allocation routine (\\$200E): allocates a 14-byte VECTOR struct.
D.TAB (\\$2042): direction-to-velocity lookup (8 entries for DURL).
P.TAB (\\$2053): player pattern table indexed by direction.
SR.TAB (\\$2067): player shoot table (8 entries: pattern, delta XY, DURL).

C++ note: D.TAB maps DURL bits to (vx, vy) pairs.
P.TAB maps DURL to pattern ROM addresses for animation.
SR.TAB provides bolt spawn offsets relative to player position.""",
    ),
    # --- Room setup and robot spawning ($209D-$21E5) ---
    (
        4673,
        4828,
        "room setup",
        "Room Setup and Robot Spawning (\\$209D--\\$21E5)",
        """Room initialization (\\$209D): sets up the room after scrolling.
Robot spawning (\\$2117): allocates VECTOR structs for each robot
at positions from the spawn table (\\$23A2).
Robot count and difficulty parameter application.

C++ note: Partially implemented in spawn\\_robots(). The spawn
positions table has 11 entries. Jitter is applied via RNG.""",
    ),
    # --- Room scrolling ($21E6-$2313) ---
    (
        4829,
        5064,
        "room scrolling",
        "Room Scrolling (\\$21E6--\\$2313)",
        """SCROLL\\_UP (\\$21E6): scroll screen when player exits top.
SCROLL\\_DOWN (\\$2237): scroll when player exits bottom.
SCROLL\\_LEFT (\\$2274): scroll when player exits left.
SCROLL\\_RIGHT (\\$22C3): scroll when player exits right.

Each scroll routine shifts VRAM content by one screen width/height,
then generates the adjacent room's maze in the newly revealed area.

C++ note: Room transitions in the native implementation just
regenerate the entire room. Smooth scrolling is a visual nicety
that could be added later.""",
    ),
    # --- Score system ($2314-$23A1) ---
    (
        5065,
        5185,
        "score system",
        "Score Display and Arithmetic (\\$2314--\\$23A1)",
        """SHOW\\_SCORE (\\$2314): displays current score at screen bottom.
GET\\_PLAYER\\_SCORE\\_PTR (\\$2334): returns pointer to P1 or P2 score.
UPDATE\\_SCORE (\\$2341): BCD addition with bonus life check.

Score format: 3 bytes of BCD at \\$433E (P1) or \\$4341 (P2).
UPDATE\\_SCORE uses DAA for decimal-correct addition.
Bonus life thresholds: 5000 and/or 10000 (DIP configurable).

C++ note: show\\_score() is implemented. UPDATE\\_SCORE (BCD add
with DAA) and bonus life logic need implementation.""",
    ),
    # --- Robot spawn positions ($23A2-$23B7) ---
    (
        5186,
        5213,
        "spawn positions",
        "Robot Spawn Position Table (\\$23A2--\\$23B7)",
        """11 spawn position entries (X, Y pairs) defining where robots
can appear in a room. Positions are base coordinates; actual
spawn position is jittered by RNG.

C++ note: Replicated as SPAWN\\_POSITIONS constant array.""",
    ),
    # --- Robot AI ($23B8-$2539) ---
    (
        5214,
        5519,
        "robot ai",
        "Robot AI and Combat (\\$23B8--\\$2539)",
        """ROBOT (\\$23B8): main robot job routine.
SEEK (\\$23EF): pathfinding -- calculates delta to player, chooses
direction to close distance. Uses D.TAB for velocity lookup.
SETPAT (\\$2436): sets animation pattern based on movement direction.
BLAM (\\$2457): robot explosion -- awards 50 points, plays sound,
decrements RCOUNT, checks for room clear bonus.
Room bonus calculation (\\$2491): awards bonus based on RSAVED.

C++ note: SEEK is the core AI. It computes dx = player\\_x - robot\\_x,
dy = player\\_y - robot\\_y, then picks DURL bits to move toward
the player. No randomness in movement -- robots always chase.""",
    ),
    # --- Maze generation ($2540-$2677) ---
    (
        5520,
        5682,
        "maze generation",
        "Maze Generation (\\$2540--\\$2677)",
        """The maze drawing function at \\$2540 is the entry point called per room.
It seeds the RNG from room coordinates, draws border walls with
doorway gaps, then generates interior walls in two passes (top half
and bottom half).

Sub-routines:
\\$2597: post-maze setup (colour fill, lives display, score).
\\$25CA: vertical border with gap.
\\$25D4: horizontal border with gap.
\\$25E4: coordinate setup for wall drawing.
\\$25EB: interior wall generation loop (random direction selection).
\\$2662: draw horizontal wall segment (12 tiles).
\\$264C: draw vertical wall segment (18 tiles).

The maze configuration is stored in a 15-byte array at \\$435E,
using the wall template from ROM \\$268C.

C++ note: Fully implemented and verified in generate\\_maze().
Produces identical VRAM output to the emulator.""",
    ),
    # --- RNG and wall data ($2678-$26AA) ---
    (
        5683,
        5732,
        "rng and data",
        "Random Number Generator and Wall Data (\\$2678--\\$26AA)",
        """RANDOM (\\$2678): 16-bit PRNG. Formula: seed = seed * 7 + \\$3153.
Returns high byte of new seed in A.

Wall segment sprite data at \\$269B: [width=1][height=4][\\$F0 x4].
Wall template at \\$268C: 15 bytes defining the room cell structure.

C++ note: RNG is implemented and verified. Wall data is replicated
as WALL\\_SPRITE and WALL\\_TEMPLATE constants.""",
    ),
    # --- Interrupt handler ($26AB-$272C) ---
    (
        5733,
        5837,
        "interrupt handler",
        "Interrupt Handler (\\$26AB--\\$272C)",
        """Main interrupt entry (\\$26AB): saves all registers, dispatches to
BOTTOM\\_OF\\_SCREEN\\_INTERRUPT (\\$26D9) for end-of-frame processing.
The frame interrupt decrements job delay counters, handles NMI
enable/disable, and triggers the job scheduler.

C++ note: Frame timing is handled by the interrupt subsystem.
The job delay decrement is equivalent to the Phase timer in
the native implementation.""",
    ),
    # --- Sprite rendering ($272D-$2816) ---
    (
        5838,
        6062,
        "sprite rendering",
        "Sprite Erase and Write (\\$272D--\\$2816)",
        """ERASE\\_PATTERN (\\$272D): erases a sprite from its old screen position.
Uses XOR mode (\\$90) through Magic RAM to remove pixels without
affecting the background.

WRITE\\_PATTERN (\\$274D): draws a sprite at its current position.
Sets up Magic RAM control for XOR mode, calculates screen address,
then calls DRAW\\_SPRITE.

MOVE\\_ANIMATE\\_VECTOR (\\$27A9): the core movement/animation loop.
Decrements TIME; when zero, reloads from TPRIME and applies
velocity (V.X -> P.X, V.Y -> P.Y). Updates animation frame
and sets status bits for erase/write.

C++ note: These three routines are the rendering pipeline for
all moving objects. Implementation requires:
1. calc\\_magic\\_ram\\_addr for old and new positions
2. XOR-mode magic RAM writes for erase
3. Pattern data lookup from ROM
4. Animation frame cycling via pattern pointer advancement""",
    ),
    # --- Draw sprite ($2817-$287E) ---
    (
        6063,
        6181,
        "draw sprite",
        "DRAW\\_SPRITE (\\$2817--\\$287E)",
        """Two drawing modes:
- 2-byte wide (\\$281F): for player and robot sprites. Writes 2 data
  bytes + 1 flush byte per row, stride = \\$001E (30 bytes).
- 1-byte wide (\\$2853): for wall tiles. Writes 1 data byte + 1 flush
  byte per row, stride = \\$001F (31 bytes).

The shift register is flushed after each row with a \\$00 write.
Width is in byte 0 of the pattern data, height in byte 1.

C++ note: Implemented in draw\\_sprite() for 1-byte mode (walls).
2-byte mode needed for player/robot rendering. Key difference is
the stride (\\$1E vs \\$1F) and writing 2 data bytes per row.""",
    ),
    # --- Robot shooting ($287F-$297A) ---
    (
        6182,
        6471,
        "robot shooting",
        "Robot Shooting AI (\\$287F--\\$297A)",
        """SHOOT (\\$287F): robot firing decision logic.
1. Check RBOLTS > 0 (robots allowed to shoot)
2. Check RWAIT holdoff timer
3. Calculate relative position to player
4. Decide direction: horizontal, vertical, or diagonal
5. Look up bolt params from S.TAB (\\$2944)
6. Spawn BOLT struct

S.TAB (\\$2944): 8 direction entries with velocity deltas.

C++ note: Needs implementation. The firing decision is deterministic
given positions and timers. The RWAIT holdoff prevents immediate
shooting when a room starts.""",
    ),
    # --- Text rendering ($297B-$2A8D) ---
    (
        6472,
        6761,
        "text rendering",
        "Text Rendering (\\$297B--\\$2A8D)",
        """PRINT\\_STRING (\\$297B): prints a null-terminated string to screen.
RTOAX (\\$29A1): alias for CALCULATE\\_MAGIC\\_IMAGE\\_RAM\\_ADDRESS.
CALCULATE\\_MAGIC\\_IMAGE\\_RAM\\_ADDRESS (\\$29A3): converts (Y, X) screen
coordinates to a Magic RAM address. Sets the shift register via
OUT (\\$4B). Formula: addr = \\$6400 + ((Y*256)|X) >> 3.

PRINT\\_CHAR (\\$29DB): renders a single character from the font ROM
at \\$2F1E. Each character is 9 bytes (9 pixels tall, 8 wide).
Bit 7 of first byte: offset 3 rows down. Each byte ANDed with
\\$7F before writing. Flush byte after each row.

PRINT\\_DIGITS (\\$2A40): prints a multi-digit BCD number with
leading-space suppression. Extracts nibbles (upper first, lower
second) and converts to ASCII via +\\$30.

C++ note: All three routines are implemented and verified:
calc\\_magic\\_ram\\_addr(), print\\_char(), print\\_digits().""",
    ),
    # --- Evil Otto ($2A8E-$2B6A) ---
    (
        6762,
        6927,
        "evil otto",
        "Evil Otto (\\$2A8E--\\$2B6A)",
        """Otto initialization (\\$2A8E): creates Evil Otto VECTOR struct with
countdown timer. Otto appears after OTTO\\_TIME frames expire.

SET\\_VELOCITY (\\$2B3D): calculates Otto's velocity toward the player.
Otto is invulnerable to player bolts but kills robots on contact.
Otto bounces off walls and moves faster in later rooms.

C++ note: Not yet implemented. Otto uses the standard VECTOR/
MOVE\\_ANIMATE\\_VECTOR pipeline. The key difference is invulnerability
and wall-bounce behavior.""",
    ),
    # --- Speech system ($2B6B-$2D19) ---
    (
        6928,
        7461,
        "speech system",
        "Speech System (\\$2B6B--\\$2D19)",
        """WRITE\\_RANDOM\\_SENTENCE\\_TO\\_BUFFER (\\$2B6B): generates random robot
sentences by combining word fragments.
GENERATE\\_ROBOT\\_SPEECH (\\$2B97): picks random pitch and words.
SAY\\_ routines: specific phrases (``Intruder alert'', ``Got the
humanoid'', ``Chicken, fight like a robot'', etc.).
TALK (\\$2C1C): initiates speech playback from buffer.

Speech vocabulary: 30 words in the S14001A ROM. Sentences are
constructed by chaining word IDs in SPEECH\\_BUFFER (\\$0918).

C++ note: Sound/speech is stubbed. The speech system reads from
the voice ROMs and outputs via the S14001A chip interface.""",
    ),
    # --- Score increment and misc ($2DB3-$2F1D) ---
    (
        7462,
        7518,
        "score increment",
        "BCD Increment and Miscellaneous (\\$2DB3--\\$2F1D)",
        """INCREMENT\\_BY\\_1 (\\$2DB3): BCD increment of a multi-byte counter.
Used for bookkeeping statistics (total plays, total score, etc.).

Miscellaneous code between \\$2D1A and \\$2F1D includes additional
utility routines and data.

C++ note: Not needed for gameplay (bookkeeping only).""",
    ),
    # --- Font data ($2F1E-$3394) ---
    (
        7519,
        8195,
        "font data",
        "Character Font Data (\\$2F1E--\\$3394)",
        """9 bytes per character, covering ASCII ordinals from space (\\$20)
through tilde (\\$7E), plus special characters including the stick-man
life icon at ordinal \\$80.

Font address calculation: char\\_addr = \\$2F1E + (ordinal * 9).

Note: ordinals 0--31 overlap with text strings embedded in ROM
(e.g., ``Move stick to change letter''). Only ordinals \\$20+
are actual displayable characters.

C++ note: Accessed via m\\_charset pointer into the loaded ROM data.
Verified by cosimulation: score digits and life icons render
identically to the emulator.""",
    ),
    # --- Test patterns ($3395-$33BC) ---
    (
        8196,
        8226,
        "test patterns",
        "Test Patterns (\\$3395--\\$33BC)",
        """Alternating \\$55/\\$2A crosshatch pattern data for hardware test mode.

C++ note: Not needed for gameplay.""",
    ),
    # --- Sound effect routines ($33BD-$35AE) ---
    (
        8227,
        8639,
        "sound effects",
        "Sound Effect Routines (\\$33BD--\\$35AE)",
        """SFIRE (\\$33BD): bolt shooting sound (priority 0).
SFRY (\\$3439): player electrocution sound (priority 3).
SBLAM (\\$348A): robot explosion sound.
SRFIRE (\\$34E7): robot shooting sound.

Each sound routine checks the priority system via PC1 (\\$0889).
A sound only plays if its priority >= the current priority level.
Sound data is written to the Exidy 6840 timer shadow registers.

C++ note: Sound is stubbed. These routines write to the timer
shadow registers at \\$0878--\\$0884.""",
    ),
    # --- Colour system ($35AF-$37FF) ---
    (
        8640,
        9163,
        "colour system",
        "Colour Attribute System (\\$35AF--\\$37FF)",
        """SET\\_COLOUR\\_ATTRS (\\$35AF): initial colour setup for the screen.
COLOUR\\_FILL\\_WHITE (\\$35F8): fills entire colour RAM with \\$FF.
COLOUR\\_FILL (\\$3657): rectangular fill with 5-byte inline parameter
block (offset LSB, offset MSB, lines, width, colour).

Post-maze colour setup at \\$369F: fills status bar, applies
difficulty-based wall colours. The wall colouring loop (\\$36FA)
reads VRAM pixel data and writes corresponding colour attributes.

UNCOLOUR\\_MAN (\\$3719): restores saved colour attributes at player pos.
COLOUR\\_MAN (\\$373C): applies PLAYER\\_COLOUR to 2x5 attribute block.

Difficulty tables at \\$3794 (upright) and \\$37BC (cocktail):
each entry sets RBOLTS, bolt speed, RWAIT, and wall colour.

C++ note: colour\\_fill() is implemented. COLOUR\\_MAN/UNCOLOUR\\_MAN
and the wall colour application loop need implementation for
full colour accuracy.""",
    ),
]


def escape_noweb(line: str) -> str:
    """Escape noweb special sequences in assembly lines.

    In noweb, << starts a chunk reference and @ at the start of a line
    ends a chunk. We need to escape these in the assembly text.
    Also expand tabs to spaces since noweb's notangle expands tabs
    and we want the output to match exactly.
    """
    # Expand tabs to 8-space stops (matching notangle's default)
    line = line.expandtabs(8)
    # Escape @ at start of line (noweb: @@ produces literal @)
    if line.startswith("@"):
        line = "@" + line
    return line


def main():
    asm_path = ASM_PATH
    out_path = OUT_PATH

    if not asm_path.exists():
        print(f"Error: {asm_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(asm_path, "r") as f:
        lines = f.readlines()

    total_lines = len(lines)
    print(f"Read {total_lines} lines from {asm_path}")

    # Validate section coverage
    covered = set()
    for start, end, _, _, _ in SECTIONS:
        for i in range(start, end + 1):
            if i in covered:
                print(
                    f"WARNING: line {i} covered by multiple sections", file=sys.stderr
                )
            covered.add(i)

    uncovered = set(range(1, total_lines + 1)) - covered
    if uncovered:
        ranges = []
        sorted_uc = sorted(uncovered)
        rstart = sorted_uc[0]
        rprev = rstart
        for u in sorted_uc[1:]:
            if u == rprev + 1:
                rprev = u
            else:
                ranges.append((rstart, rprev))
                rstart = u
                rprev = u
        ranges.append((rstart, rprev))
        print(
            f"WARNING: {len(uncovered)} lines not covered by any section:",
            file=sys.stderr,
        )
        for rs, re in ranges[:10]:
            print(f"  lines {rs}-{re}", file=sys.stderr)

    # Generate the noweb file
    with open(out_path, "w") as out:
        # LaTeX preamble
        out.write(r"""\documentclass{article}
\usepackage{noweb}
\usepackage[margin=1in]{geometry}
\usepackage{longtable}

\title{Berzerk: Annotated Disassembly}
\author{Scott Tunstall (reverse engineering) \\ Literate Organization by Machine Analysis}
\date{}

\begin{document}
\maketitle
\tableofcontents

\section{Overview}

This literate program contains the complete Berzerk (Stern Electronics, 1980)
disassembly by Scott Tunstall, organized into functional sections with
documentation sufficient for C++ reimplementation.

When tangled, this file produces \texttt{berzerk.asm} -- the full disassembly
identical to the original \texttt{cdoc/berzerk\_tunstall.asm}.

Each section includes:
\begin{itemize}
\item The original annotated Z80 assembly
\item A description of the section's purpose and algorithms
\item C++ conversion notes for the native reimplementation
\end{itemize}

The disassembly covers ROM addresses \$0000--\$37FF (six 2KB PROMs totaling
12KB). Addresses \$0800--\$0FFF are RAM (not ROM), so the disassembly skips
from \$07FF to \$1000.

""")
        # Top-level chunk
        out.write("\\section{Top-Level Assembly Output}\n\n")
        out.write("<<berzerk.asm>>=\n")
        for _, _, chunk_name, _, _ in SECTIONS:
            out.write(f"<<{chunk_name}>>\n")
        out.write("@\n\n")

        # Each section
        for start, end, chunk_name, title, description in SECTIONS:
            out.write(f"\\section{{{title}}}\n\n")
            out.write(f"{description}\n\n")
            out.write(f"<<{chunk_name}>>=\n")

            for i in range(start - 1, end):  # 0-based index
                line = lines[i]
                # Remove trailing newline for consistent output
                line = line.rstrip("\n")
                escaped = escape_noweb(line)
                out.write(escaped + "\n")

            out.write("@\n\n")

        out.write("\\end{document}\n")

    print(f"Generated {out_path}")
    print(f"Sections: {len(SECTIONS)}")
    print(f"Total lines covered: {len(covered)}/{total_lines}")


if __name__ == "__main__":
    main()
