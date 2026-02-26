"""Prompt templates for game generation using Qwen chat template format."""

USER_START = "<|im_start|>user\n"
ASSISTANT_START = "<|im_end|>\n<|im_start|>assistant\n"


def make_asteroids_prompt() -> str:
    """Build the full Asteroids game generation prompt."""

    prompt = USER_START

    prompt += """\
You are a game developer. You output ONLY a single, complete, self-contained HTML file.

Rules:
- The entire game must be in ONE HTML file with inline CSS and inline JavaScript.
- Use HTML5 Canvas for rendering.
- Use only vanilla JavaScript -- no external libraries, no CDN imports, no frameworks.
- The HTML file must be fully playable when opened directly in a browser.
- Do not include any explanation, commentary, or markdown. Output ONLY the HTML file.
- Start your response with <!DOCTYPE html> and end with </html>.

Create a classic Asteroids arcade game with these specifications:

Canvas: 800x600 pixels, black background.

Ship:
- Triangular wireframe ship in the center of the screen.
- Rotate left/right with arrow keys (or A/D).
- Thrust forward with up arrow (or W) with inertia-based movement.
- Screen wrapping on all edges (ship exits one side, appears on the opposite).
- Hyperspace jump with shift key (teleport to random position).

Shooting:
- Fire bullets with spacebar.
- Bullets travel in the direction the ship is facing.
- Bullets wrap around the screen.
- Bullets disappear after traveling a set distance.
- Limit of 4 bullets on screen at once.

Asteroids:
- Start with 4 large asteroids per wave.
- Large asteroids split into 2 medium asteroids when hit.
- Medium asteroids split into 2 small asteroids when hit.
- Small asteroids are destroyed when hit.
- All asteroids move in random directions at varying speeds.
- Asteroids wrap around the screen.
- Wireframe irregular polygon style (not perfect circles).

Scoring:
- Large asteroid: 20 points.
- Medium asteroid: 50 points.
- Small asteroid: 100 points.
- Display score in the top-left corner.
- Display remaining lives in the top-right corner (start with 3 lives).
- Extra life every 10,000 points.

Game mechanics:
- Collision detection between ship and asteroids (ship is destroyed on contact).
- Brief invulnerability period after respawning.
- New wave starts when all asteroids are destroyed (wave number increases asteroid count).
- Game over screen with final score and "Press Enter to restart".

Visual style:
- White wireframe vector graphics on black background (classic arcade look).
- Ship thrust flame effect when accelerating.
- Explosion particle effect when asteroids or ship are destroyed.

Technical:
- Use requestAnimationFrame for the game loop.
- Delta-time based movement for consistent speed regardless of frame rate.
"""

    prompt += ASSISTANT_START

    return prompt
