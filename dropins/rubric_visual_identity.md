# Rubric: Visual Identity
Files: index.html
Objective: Validate that the screen geometry, color palette, sprite style, and UI elements look recognizably like Berzerk — bright neon shapes on a black field, per-element coloring, and a simple score/lives UI at the top of the screen.

## Why this matters
Berzerk's visual signature — black background, bright RGBI palette, humanoid
stick-figure sprites, bright-outlined walls — is what makes a glance at the
screen say "this is Berzerk." A clone that scores well on AI and progression
but renders as gray rectangles on a white page will not feel like Berzerk to
any human viewer. Per `./docs/berzerk_visual_spec.md` and MAME
`src/mame/stern/berzerk.cpp` header.

## Scoring

**1 — Default browser look or generic shapes**
The page uses default body styles or non-Berzerk colors; entities are
undifferentiated rectangles; no UI shows score or lives. Concrete signal:
canvas background is white or transparent, or robots and player are drawn
in a single hardcoded color (e.g., all red `fillStyle = 'red'`).

**2 — Black background and some color, but generic**
Canvas is black and entities are drawn in different colors, but the colors
are arbitrary (e.g., default HTML reds and blues, no relation to Berzerk's
palette), sprites are simple filled rectangles, walls are filled blocks
rather than outlined lines, and the UI either is absent or sits outside
the canvas in plain HTML.

**3 — Recognizable Berzerk styling**
Black background, bright RGBI-style colors used for entities (at least
yellow/gold, red, cyan, green, magenta appear), humanoid or stick-figure
shape for the player (multiple connected line segments or a small
multi-rectangle composition, not a single filled square), walls drawn as
bright colored outlines or thin filled lines (not solid blocks), and a
top-of-canvas score display.

**4 — Pixel-character fidelity**
All of 3, plus: a documented 16-color palette declared as a constant in
code that includes the Berzerk-canonical colors (gold, red, dark blue,
green, purple, yellow, white, light blue, pink, grey, cyan, magenta), a
top-of-canvas display showing BOTH current score AND remaining lives AND a
high score, robots and player drawn as recognizable humanoid sprites (head
+ torso + limbs, not just a stylized shape), and individual entity colors
applied per-instance rather than shared across all robots.

## Required evidence
- A palette declaration (an array, object, or set of named CSS colors) with
  at least 10 named Berzerk colors
- A drawing routine for the player that draws multiple distinct shape
  components (e.g., separate calls for head, body, limbs) — not a single
  `fillRect`
- A wall-drawing routine that uses `strokeRect`, `lineTo`, or thin filled
  rectangles, not large filled blocks
- A score *and* lives display drawn on the canvas (or as positioned
  overlay) at the top of the playfield
