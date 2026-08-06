# Rubric: Robot AI
Files: index.html
Objective: Validate that robots pursue the player intelligently — moving toward the player each frame, respecting walls (and dying on contact with them), firing lasers with a per-robot cooldown, and ideally exhibiting state-based behavior (wander/hunt or similar) that escalates with score.

## Why this matters
The signature Berzerk threat is robots that *think*: they chase the player,
fire at the player, and can be tricked into walls — which is the player's
main survival tactic. A clone where robots are static, random-walking, or
wall-clipping has no real tension. The robots are the antagonist; this
rubric measures their intelligence and threat. Per
`./docs/berzerk_visual_spec.md` and `./docs/rom*_analysis.md`.

## Scoring

**1 — Static or random**
Robots don't move toward the player (static or random walk), don't fire,
have no awareness of walls. Concrete signal: the robot update routine uses
`Math.random()` for direction with no reference to player position, or
robots never appear to move at all.

**2 — Basic pursuit**
Robots move toward the player each frame using a simple `dx = player.x -
robot.x` heuristic. No firing. No wall awareness — robots either pass
through walls or get harmlessly stuck on them. Concrete signal: the robot
update has `r.x += (dx/dist) * speed` with no `isWalkable` check on the
new position, and no robot-firing code path exists.

**3 — Wall-aware and firing**
All of 2, plus: robots check walls before moving and die on wall contact
(the robot is explicitly removed from the robots array on collision —
this is what makes "luring robots into walls" an actual tactic), and
robots fire lasers at the player with a per-robot cooldown timer. Robot
lasers despawn on wall hit (don't pass through). Robot-vs-robot collision
destroys both robots.

**4 — State machine and difficulty-aware**
All of 3, plus: a named state machine on each robot with at least two
states (e.g., `WANDER`, `HUNT`) and a transition condition based on
distance, line-of-sight, or elapsed time; robot firing rate and/or maximum
simultaneous lasers escalate with score (doesn't need to match the full
RC31 table — just "harder as the game progresses"); and the initial-fire
delay on a new room (robots wait some frames before opening fire).

## Required evidence
- A robot update function that branches on robot state OR has clearly
  separated movement-vs-firing logic blocks
- An `isWalkable(robot.nextX, robot.nextY)` (or equivalent) check before
  applying robot movement, with explicit removal of the robot on collision
- A robot-firing code path with a cooldown timer stored per-robot
- A laser-update routine that despawns robot lasers on wall hit
- For Score 4: a named state variable on each robot (e.g., `r.state =
  'WANDER'`) with a transition condition somewhere in the update function
