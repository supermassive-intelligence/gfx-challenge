"""Tests for orchestrator.pipeline (unit tests with mocked dependencies).

Not tested (coverage gaps):
- serve_stub: happy path -- reads stub HTML, persists copy, serves via sandbox. No test.
- serve_stub: missing stub file -- should return GenerationResult(success=False). No test.
- serve_stub: sandbox.serve_game raises an exception -- no test.
- generate_and_serve: sandbox.serve_game raises after successful LLM + extraction -- no test.
- generate_and_serve: all retries exhausted due to validation failures only (not exceptions) --
  the bad_html_retries test covers partial retry, but not full exhaustion via validation.
- generate_and_serve: extract_html raises ValueError (malformed LLM output) vs validation
  failure (missing tags) -- both are retry-able but through different code paths. Only the
  ValueError path is indirectly tested.
- stop_game / cleanup: no tests for container teardown methods.
- GamePipeline.__init__: real construction with Config (creates ScalarLMClient, GameSandbox,
  games_dir) -- all tests bypass __init__ via patch.
"""

from unittest.mock import MagicMock, patch

from config import Config
from orchestrator.pipeline import GamePipeline, GenerationResult


def make_pipeline(config):
    """Helper: create a GamePipeline with __init__ bypassed for mocking."""
    with patch.object(GamePipeline, "__init__", lambda self, cfg: None):
        pipeline = GamePipeline.__new__(GamePipeline)
    pipeline.config = config
    pipeline.config.games_dir.mkdir(parents=True, exist_ok=True)
    pipeline.llm = MagicMock()
    pipeline.sandbox = MagicMock()
    return pipeline


class TestGamePipeline:
    def test_generate_and_serve_success(self, tmp_path):
        """Test successful generation pipeline with mocked LLM and sandbox."""
        config = Config(games_dir=tmp_path / "games")
        pipeline = make_pipeline(config)

        fake_html = (
            "<!DOCTYPE html>\n"
            "<html><head></head><body>"
            "<canvas id='c'></canvas>"
            "<script>console.log('game')</script>"
            "</body></html>"
        )
        pipeline.llm.generate = MagicMock(return_value=fake_html)
        pipeline.sandbox.serve_game = MagicMock(return_value=9999)

        result = pipeline.generate_and_serve()

        assert result.success is True
        assert result.port == 9999
        assert result.game_id is not None
        assert result.game_path is not None
        from pathlib import Path

        assert Path(result.game_path).exists()

    def test_generate_and_serve_llm_failure(self, tmp_path):
        """Test that LLM errors are retried and eventually reported."""
        config = Config(games_dir=tmp_path / "games", max_retries=2)
        pipeline = make_pipeline(config)

        pipeline.llm.generate = MagicMock(side_effect=RuntimeError("LLM unreachable"))

        result = pipeline.generate_and_serve()

        assert result.success is False
        assert "LLM unreachable" in result.error

    def test_generate_and_serve_bad_html_retries(self, tmp_path):
        """Test that invalid HTML triggers retries."""
        config = Config(games_dir=tmp_path / "games", max_retries=3)
        pipeline = make_pipeline(config)

        bad_html = "<div>no game here</div>"
        good_html = (
            "<!DOCTYPE html>\n"
            "<html><body><canvas></canvas><script>ok</script></body></html>"
        )
        # First call returns bad HTML (no html/canvas/script),
        # extract_html will raise ValueError, caught as exception.
        # Second call returns good HTML.
        pipeline.llm.generate = MagicMock(side_effect=[bad_html, good_html])
        pipeline.sandbox.serve_game = MagicMock(return_value=8888)

        result = pipeline.generate_and_serve()

        assert result.success is True
        assert result.port == 8888
