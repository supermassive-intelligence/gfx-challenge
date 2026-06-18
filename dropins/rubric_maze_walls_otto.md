# Rubric: Maze, Walls & Evil Otto
Files: index.html
Objective: Validate that the environment itself threatens the player — walls drawn as bright outlines, walls electrified (kill on contact for everyone except Otto), rooms have non-trivial layouts with exits to adjacent rooms, and Evil Otto exists as a separate indestructible wall-ignoring entity that appears after a timer.

## Why this matters
Berzerk's environment is as dangerous as its robots. Electrified walls
turn the maze itself into a threat; Evil Otto turns *staying still*
into a death sentence. The two belong in one rubric because they answer
the same design question — "how does the environment threaten the
player?" — and they share scope: walls block everyone *except* Otto. Per
`./docs/berzerk_visual_spec.md`.

## Scoring

**1 — No maze hazards, no Otto**
Either no walls at all, or walls don't kill on contact, or walls are
placed via `Math.random()` with no recognizable layout. Otto is absent
entirely. Concrete signal: no `wallKills`, no Otto class or object, no
electrified-wall check in the player update.

**2 — Walls block but don't kill**
A non-random wall layout exists and is drawn, the player respects walls
(movement is blocked when hitting one), but walls are NOT electrified —
touching them is harmless. Otto is still absent.

**3 — Electrified walls and room exits**
All of 2, plus: walls kill the player on contact (explicit life decrement
+ respawn or death state — not just a movement block), walls also kill
robots on contact (so luring robots into walls is a real tactic), and
each room has at least one exit/opening at its edge through which the
player can leave. Otto may still be absent.

**4 — Otto, room transitions, non-trivial geometry**
All of 3, plus: Evil Otto implemented as a separate entity class —
appears after a timer (any timer; doesn't have to match the exact MAME
formula, but must depend on something other than a constant delay),
ignores walls entirely (passes through them), is indestructible to the
player's laser, kills the player on contact. Room geometry is non-trivial
(not just a border rectangle — has interior corridors or chambers).
Exiting through a room's opening loads a new room with a fresh set of
robots and the Otto timer reset.

## Required evidence
- A wall data structure consulted by ALL entity movement code (player,
  robots, lasers, NOT Otto)
- A player wall-collision branch that triggers death/respawn, not just a
  movement block
- A robot wall-collision that removes the robot from play
- An Otto entity class or object distinct from the robots array, with
  its own update function
- An Otto update function that does NOT call the wall-collision check
  (Otto passes through walls)
- An Otto spawn-timer that resets on room entry
- A `loadRoom()` or `nextRoom()` function that places new walls/robots/
  player position and resets the Otto timer when called
