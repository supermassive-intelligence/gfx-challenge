"""Pipeline: generate game code via LLM, clean it, persist, and serve in a sandbox.

This is the main orchestrator. It ties together the LLM client, HTML extraction/validation,
file persistence, and Docker sandbox serving. There are two entry points:
- serve_stub(): skip the LLM entirely and serve a bundled HTML file
- generate_and_serve(): call the LLM, extract HTML, validate, persist, and serve
"""

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from config import Config
from llm.client import ScalarLMClient
from llm.code_cleaner import extract_html, validate_html_minimal
from llm.prompts import make_asteroids_prompt
from sandbox.manager import GameSandbox

log = logging.getLogger(__name__)

# Location of the bundled stub game, relative to this file's parent directory
STUB_PATH = Path(__file__).parent.parent / "stubs" / "asteroids.html"


@dataclass
class GenerationResult:
    """Return value from pipeline operations. Callers check .success first."""

    success: bool
    game_id: str | None = None
    port: int | None = None
    game_path: str | None = None
    error: str | None = None


class GamePipeline:
    """Orchestrates game generation: LLM call -> extract HTML -> persist -> serve."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.llm = ScalarLMClient(config)
        self.sandbox = GameSandbox(config)
        self.config.games_dir.mkdir(parents=True, exist_ok=True)

    def serve_stub(self) -> GenerationResult:
        """Serve the bundled stub asteroids game (no LLM call).

        Reads the stub HTML from stubs/asteroids.html, saves a copy to the games
        directory for consistency, and launches a Docker container to serve it.
        """
        game_id = "stub-" + uuid.uuid4().hex[:8]

        if not STUB_PATH.exists():
            return GenerationResult(
                success=False,
                game_id=game_id,
                error=f"Stub file not found: {STUB_PATH}",
            )

        html = STUB_PATH.read_text(encoding="utf-8")

        # Persist a copy so every served game has a file on disk
        game_path = self.config.games_dir / f"{game_id}.html"
        game_path.write_text(html, encoding="utf-8")

        port = self.sandbox.serve_game(game_id, html)

        return GenerationResult(
            success=True,
            game_id=game_id,
            port=port,
            game_path=str(game_path),
        )

    def generate_and_serve(self) -> GenerationResult:
        """Full pipeline: prompt LLM, extract HTML, save to disk, launch sandbox.

        Retries up to config.max_retries times. Each retry re-calls the LLM from scratch.
        Failures can come from:
        - LLM call itself (network error, timeout, bad response)
        - HTML extraction (LLM returned text that doesn't contain valid HTML)
        - Validation (HTML is missing required tags like <canvas> or <script>)
        - Sandbox launch (Docker failure)
        """
        game_id = uuid.uuid4().hex[:12]
        last_error = None

        for attempt in range(1, self.config.max_retries + 1):
            try:
                log.info(
                    "Generation attempt %d/%d for game %s",
                    attempt,
                    self.config.max_retries,
                    game_id,
                )

                # Build the prompt with Qwen chat template tokens and call ScalarLM
                prompt = make_asteroids_prompt()
                raw_response = self.llm.generate(prompt)
                log.info("Received LLM response (%d chars)", len(raw_response))

                # Try to pull a clean HTML document out of whatever the LLM returned.
                # If the LLM returned prose or garbage, extract_html raises ValueError.
                try:
                    html = extract_html(raw_response)
                except ValueError as e:
                    last_error = (
                        f"LLM did not return valid HTML: {e}\n"
                        f"Raw response (first 500 chars): {raw_response[:500]}"
                    )
                    log.warning("Attempt %d: %s", attempt, last_error)
                    continue

                # Sanity check: does the HTML have the basic tags a canvas game needs?
                # This catches cases where the LLM returns valid HTML but not a game.
                issues = validate_html_minimal(html)
                if issues:
                    last_error = (
                        f"LLM returned HTML but it is not a valid game: "
                        f"{', '.join(issues)}\n"
                        f"HTML (first 500 chars): {html[:500]}"
                    )
                    log.warning("Attempt %d: %s", attempt, last_error)
                    continue

                # Write the game to disk so we have a record of what was generated
                game_path = self.config.games_dir / f"{game_id}.html"
                game_path.write_text(html, encoding="utf-8")
                log.info("Saved game to %s", game_path)

                # Start an nginx container to serve the game
                port = self.sandbox.serve_game(game_id, html)

                return GenerationResult(
                    success=True,
                    game_id=game_id,
                    port=port,
                    game_path=str(game_path),
                )

            except TimeoutError:
                last_error = (
                    f"ScalarLM did not respond within {self.config.llm_timeout}s"
                )
                log.error("Attempt %d timed out: %s", attempt, last_error)

            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                log.error("Attempt %d failed: %s", attempt, last_error)

        return GenerationResult(
            success=False,
            game_id=game_id,
            error=f"All {self.config.max_retries} attempts failed. Last error: {last_error}",
        )

    def stop_game(self, game_id: str) -> None:
        self.sandbox.stop_game(game_id)

    def cleanup(self) -> None:
        """Stop all running containers."""
        self.sandbox.cleanup_all()
