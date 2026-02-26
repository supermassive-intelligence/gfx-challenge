# gfx-challenge

Generate HTML5 canvas games via ScalarLM and serve them in Docker sandboxes.

## Prerequisites

- Python 3.11+
- Docker (running)
- Access to a ScalarLM endpoint (for generation mode)

## Setup

```bash
pip install -r requirements.txt
make build   # builds the sandbox Docker image
```

## Usage

### Stub mode (no LLM needed)

Serves a bundled Asteroids game:

```bash
python generate.py --stub
# or
make stub
```

### Generate mode

Calls ScalarLM to generate a game from scratch:

```bash
python generate.py
# or
make run
```

Both modes print the game URL (e.g. `http://localhost:49901`) and block until Ctrl+C.

## Configuration

All settings are via environment variables with defaults:

| Variable | Default | Description |
|---|---|---|
| `SCALARLM_API_URL` | `https://qwen3-4b.sudnya.org/v1` | ScalarLM endpoint |
| `SCALARLM_MODEL` | (empty) | Model name to pass to ScalarLM |
| `MAX_OUTPUT_TOKENS` | `512` | Max tokens for LLM generation |
| `MAX_RETRIES` | `3` | Retry attempts for LLM generation |
| `SANDBOX_IMAGE` | `gfx-challenge-sandbox:latest` | Docker image for game containers |
| `SANDBOX_MEMORY_LIMIT` | `128m` | Memory limit per container |
| `GAMES_DIR` | `./games` | Directory to persist generated HTML files |

## Running Tests

```bash
# Run all tests
python -m pytest tests/ -v

# Run only code cleaner tests
python -m pytest tests/test_code_cleaner.py -v

# Run only pipeline tests
python -m pytest tests/test_pipeline.py -v

# Run with make
make test
```

Tests use mocked LLM and Docker dependencies -- no running ScalarLM endpoint or Docker daemon is required.

## Formatting

Code is formatted with [black](https://github.com/psf/black). A git pre-commit hook runs `black --check` on staged Python files automatically.

```bash
# Format all files manually
black *.py **/*.py

# Check without modifying
black --check *.py **/*.py
```

## Cleanup

Stop all running game containers:

```bash
make clean
```
