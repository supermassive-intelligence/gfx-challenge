"""Pipeline configuration. Defaults are pinned by spec sections 5.2 and 12.10."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Config:
    input_path: str = ""
    out_dir: str = "./out"

    # Section 5.2
    horizon: str = "end-of-session"
    emit: set[str] = field(default_factory=lambda: {"sft"})
    redundancy: str = "collapse"  # off | collapse
    failure_compression: str = "conservative"  # off | conservative | aggressive
    action_repr: str = "structured"  # structured | string  (section 6.2)
    dpo_granularity: str = "canonical"  # canonical | all | first | last
    strict_local: bool = False
    answer_weight: float = 1.0
    min_answer_chars: int = 0
    max_llm_calls: int | None = None
    reasoning_writer_model: str = "claude-sonnet-4-6"
    judge: str = "mock"  # "mock" | "<model-id>"
    seed: int = 0

    # Section 12.10
    validity_threshold: float = 0.5
    usefulness_threshold: float = 0.5
    policy_threshold: float = 0.5  # policy_score below this fails policy_gate (§12.2)
    reasoning_granularity: str = "per_action"  # per_action | per_turn
    verify_sample_rate: float = 0.10
    answer_warn_chars: int = 8000
    verifier_patterns: tuple[
        str, ...
    ] = ()  # empty = use signals.DEFAULT_VERIFIER_PATTERNS

    # Confirmed in planning round 4.
    system_prompt: str | None = None

    # Convenience flag set by --no-llm on the CLI; forces mock judge / writer.
    no_llm: bool = False

    # Parallel LLM call fan-out (1 = sequential = legacy behavior).
    # Affects Stage 2 scoring, Stage 5 backfill, and Stage 7 re-judge.
    max_workers: int = 1
