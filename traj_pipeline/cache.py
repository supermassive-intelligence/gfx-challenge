"""Disk-backed prompt-hash cache (spec section 12.8).

Cache key = ``sha256(payload + model_id + pipeline_version)`` -- so any
prompt-template or pipeline-version bump auto-invalidates without manual
cache busting. Stored as one JSON file per key under
``.cache/traj_pipeline/`` by default; the path is configurable for tests.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def cache_key(payload: dict[str, Any], model_id: str, pipeline_version: str) -> str:
    blob = json.dumps(
        {"payload": payload, "model": model_id, "version": pipeline_version},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass
class PromptCache:
    """File-backed cache with no eviction (Phase-2 scope; fixture is small)."""

    root: Path

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, key: str) -> Any | None:
        p = self.root / f"{key}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text())["response"]
        except Exception:
            return None

    def put(self, key: str, payload: dict[str, Any], response: Any) -> None:
        p = self.root / f"{key}.json"
        p.write_text(
            json.dumps(
                {"meta": payload, "response": response},
                ensure_ascii=False,
                sort_keys=True,
            )
        )


class LLMCallBudgetExceeded(RuntimeError):
    """Raised when the ``max_llm_calls`` circuit breaker fires (D20)."""
