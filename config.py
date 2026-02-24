"""Configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    scalarlm_api_url: str = field(
        default_factory=lambda: os.getenv(
            "SCALARLM_API_URL", "https://qwen3-4b.sudnya.org"
        )
    )
    scalarlm_model: str = field(default_factory=lambda: os.getenv("SCALARLM_MODEL", ""))
    sandbox_image: str = field(
        default_factory=lambda: os.getenv(
            "SANDBOX_IMAGE", "gfx-challenge-sandbox:latest"
        )
    )
    max_retries: int = field(default_factory=lambda: int(os.getenv("MAX_RETRIES", "3")))
    games_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("GAMES_DIR", str(Path(__file__).parent / "games"))
        )
    )
    max_output_tokens: int = field(
        default_factory=lambda: int(os.getenv("MAX_OUTPUT_TOKENS", "512"))
    )
    llm_timeout: int = field(
        default_factory=lambda: int(os.getenv("LLM_TIMEOUT", "120"))
    )
    sandbox_memory_limit: str = field(
        default_factory=lambda: os.getenv("SANDBOX_MEMORY_LIMIT", "128m")
    )
