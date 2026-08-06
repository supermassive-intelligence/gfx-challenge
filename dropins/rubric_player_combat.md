# Rubric: Player Combat
Files: index.html
Objective: Validate that the player feels Berzerk-faithful to control — 8-way movement, aim direction *retained* when the joystick returns to neutral, fire button shoots in the last-aimed direction, lasers respect walls, score increments per kill, and a lives counter decrements on death.

## Why this matters
Berzerk's combat feel comes from two specific quirks that distinguish it
from generic top-down shooters: the joystick is 8-way (not 4-way), and
the aim direction is *retained* when the joystick returns to neutral.
You can stand still and shoot in any of 8 directions — including the
diagonals — and you can release all keys, then press fire, and still
shoot in your last-aimed direction. Without aim retention the player
*must* move to aim, which destroys the positional play that makes
Berzerk strategic. Per `./docs/berzerk_visual_spec.md`.

## Scoring

**1 — Basic firing only**
Player moves 4-way (no diagonals), or fires in a single fixed direction
(e.g., always right), or fires in the current movement direction with no
retention. Lasers may not be implemented or may not collide with anything.

**2 — Directional firing without retention**
Player moves 8-way (arrow keys plus diagonals), fires with spacebar in
the direction of *current* movement, but if the player releases all keys
before firing, the laser direction is wrong or defaults to a fixed value.
Lasers travel in straight lines and hit robots, but may pass through
walls. Score increments on robot kill.

**3 — Aim retention and laser-wall physics**
All of 2, plus: the player's last-pressed direction is *retained* across
key release — releasing all directional keys and then pressing fire
produces a laser in the last-aimed direction. Player lasers despawn on
wall hit (don't pass through). Player has a lives counter that decrements
on any death event (robot contact, robot laser hit, wall contact, Otto
contact) and the player respawns at a safe location with lives > 0, or
the game ends at lives == 0.

**4 — Faithful combat feel**
All of 3, plus: 8-way aim retention via a dedicated aim variable that
persists indefinitely until the next directional input (not a "last frame
where keys were pressed" hack); a fire cooldown so the player can't spam
lasers faster than ~5 per second; score increments by 50 points per
robot killed (matching the arcade); a room-clear bonus of 10 × (robots
in the cleared room) awarded when the last robot dies; and the player
sprite visually animates while moving (at least two animation frames
alternated).

## Required evidence
- A `keys` map populated by `keydown`/`keyup` handlers covering
  ArrowUp/Down/Left/Right + Space (or equivalent)
- A dedicated aim variable on the player object (e.g., `player.aimDx,
  player.aimDy`) that is *only* updated when a directional key is pressed
  — and is read by the fire handler, not the current movement velocity
- A fire handler that constructs a new laser using the aim variable
- A player-laser-update routine that checks walls and despawns on hit
- A `lives` counter that decrements on death events
- A `respawn()` function (or inline equivalent) that picks a position
  not currently on a wall or near a robot
- For Score 4: a fire cooldown timer; a `+= 50` on robot kill; a
  room-clear bonus calculation
