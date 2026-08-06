# Berzerk visual gameplay spec

Source: MAME `src/mame/stern/berzerk.cpp` (master, RC31 ROM set — the version
in this repo's ROMs). Audio is intentionally out of scope. This spec covers
what the player sees and the rules that govern it. For the actual Z80 gameplay
code paths (robot AI internals, room transition logic, specific maze tables),
defer to `./docs/rom*_analysis.md` — this spec describes the *visible
behavior*, not the implementation.

## Display

The native screen is 256 × 224 visible pixels, drawn at 30 Hz on a black
background. The visible area is portrait-ish in absolute terms but typically
displayed on a horizontal monitor with the aspect adjusted; for a web clone,
a 256:224 ratio is faithful but a 640×448 or similar scaled-up canvas is
fine. The dominant visual is bright neon outlines on a near-black field.

The color hardware encodes 16 colors using an RGBI model — three color bits
(red, green, blue) plus one intensity bit. That produces 8 hues, each
available in a "dim" and "bright" variant. In practice you almost always
see the bright variants: bright cyan, bright magenta, bright yellow, bright
green, bright red, white, plus the dim blue/red/green used sparingly. Each
8-pixel screen block has its own foreground color, supplied by an attribute
RAM independent of the bitmap. That is how Berzerk gets per-element coloring
(every robot can be a different color in the same room) without any sprite
chip — it's a 4-bit-per-block tinted bitmap.

A faithful web clone doesn't need RGBI math but does need to draw from the
documented palette and to color elements *individually*, not via a single
shared CSS rule.

## Player

The player is a humanoid stick figure, typically drawn in green or yellow.
Movement is 8-way via the joystick. Fire button shoots in the *last direction
the joystick was pressed* — even if the joystick is released to neutral, the
last-aimed direction is remembered. This is critical: it means you can stand
still and shoot.

The player dies on contact with:
- A robot
- A robot's laser
- A wall (electrified)
- Evil Otto

Default lives are 3; bonus lives accrue at 5,000 and 10,000 points (default
DIP settings). On death the player respawns in the current room (or the game
ends if lives are exhausted). The player exits to an adjacent room by walking
through one of the room's openings — this transitions to a new room.

## Robots

Robots are humanoid stick figures sharing the player's general silhouette
but drawn in the *level's robot color* (see Level Progression below). Each
room typically contains 5–15 robots, positioned around the maze when the
room loads.

Robot AI:
- Move toward the player at a constant per-frame velocity
- Respect walls — bumping into a wall destroys the robot (this is a key
  player tactic: lure robots into walls)
- Bumping into another robot also destroys both
- Fire lasers at the player with a *cooldown* and *max simultaneous lasers*
  determined by the level (see table)
- The first laser of a new room does not fire until an *initial delay*
  has elapsed — also level-dependent

A robot's laser is destroyed by walls. The player can shoot the robot's
laser out of the air. This means walls are not just hazards; they're also
defensive cover.

## Maze and walls

Each "room" is one screen. Walls form a maze of corridors and chambers,
drawn as bright colored outlines (typically magenta or cyan in the
arcade — the exact color is set by colorram and varies by ROM). Wall
geometry is one of a small set of patterns drawn from ROM data; specific
layouts are documented in `./docs/rom*_analysis.md`.

Walls are *electrified*: any entity touching them dies. That applies to
the player, robots, robot lasers, and the player's own laser — everything
except Evil Otto, which is the only entity that ignores walls.

Each room has 1–3 openings at its edges that lead to adjacent rooms.
Walking off the screen through an opening loads the next room with a fresh
set of robots and a fresh Evil Otto timer.

## Evil Otto

Evil Otto is a bouncing yellow smiley face — round, distinctive, and
visually unlike everything else on screen. He is:
- **Indestructible** — cannot be shot, immune to walls
- **Wall-ignoring** — passes through walls as if they weren't there
- **Player-seeking** — moves toward the player in a smooth bouncing sine
  pattern
- **Lethal on contact**

Otto's spawn timer is governed by an exact formula documented in MAME:
`5 × (rooms_entered - 1) + (lasers_on_screen × 40)` frames. That is, Otto
appears sooner in later rooms, and sooner when robots are actively
shooting. He persists until the player leaves the room; on entry to a new
room the timer resets.

The design intent is clear: walls + Otto force the player to keep moving.
Sitting still in a defensive corner stops working as Otto closes in.

## Scoring

- 50 points per robot killed (player laser hit)
- Bonus on clearing a room: 10 × (robots in room). A 6-robot room cleared
  awards a +60 bonus.
- Bonus life thresholds: 5,000 and 10,000 (default; settings-configurable)
- The "score" displayed is the player's running total; a "high score" is
  also shown.

## Level progression (RC31)

The single most important table in MAME's berzerk.cpp header comment. Score
thresholds map to robot color, max simultaneous lasers on screen, and fire
delay in frames. An asterisk indicates *faster* lasers from that level on.

| Score    | Robot color | Max lasers | Fire delay (frames) |
|----------|-------------|------------|---------------------|
| 0        | Gold        | 0          | 80                  |
| 300      | Red         | 1          | 80                  |
| 1,500    | Dark Blue   | 2          | 20                  |
| 3,000    | Green       | 3          | 10                  |
| 4,500    | Purple      | 4          | 10                  |
| 6,000    | Yellow      | 5          | 15                  |
| 7,500    | White       | 1*         | 60                  |
| 9,000    | White       | 1*         | 50                  |
| 10,000   | Dark Blue   | 2*         | 35                  |
| 11,000   | Pink        | 3*         | 25                  |
| 13,000   | Grey        | 4*         | 20                  |
| 15,000   | Gold        | 5*         | 15                  |
| 17,000   | Red         | 5*         | 10                  |
| 19,000+  | Light Blue  | 5*         | 5                   |

A faithful clone implements this table verbatim. Each transition is a
visible event — the robots in the next room appear in the new color and
the player feels the difficulty step.

## UI elements

At minimum:
- Current player score, top of screen
- High score, also top of screen
- Remaining lives counter

In the arcade these are drawn in the same bright RGBI palette as everything
else, in a simple bitmap font.
