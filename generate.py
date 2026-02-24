"""CLI entrypoint: generate an Asteroids game via ScalarLM and serve it in a sandbox."""

import argparse
import logging
import signal
import sys

from config import Config
from orchestrator.pipeline import GamePipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("generate")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and serve an Asteroids game")
    parser.add_argument(
        "--stub",
        action="store_true",
        help="Use the bundled stub game instead of calling the LLM",
    )
    args = parser.parse_args()

    config = Config()
    pipeline = GamePipeline(config)

    if args.stub:
        log.info("Using stub asteroids game (no LLM call)")
        result = pipeline.serve_stub()
    else:
        log.info("Calling ScalarLM at %s ...", config.scalarlm_api_url)
        result = pipeline.generate_and_serve()

    if not result.success:
        log.error("Failed: %s", result.error)
        pipeline.cleanup()
        return 1

    print(f"\nGame ready at http://localhost:{result.port}")
    print(f"Saved to {result.game_path}")
    print("Press Ctrl+C to stop the container and exit.\n")

    # Wait until interrupted
    def handle_signal(signum, frame):
        log.info("Shutting down...")
        pipeline.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Block forever until a signal arrives
    signal.pause()
    return 0


if __name__ == "__main__":
    sys.exit(main())
