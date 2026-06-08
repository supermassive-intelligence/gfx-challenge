"""LLM judge protocol + deterministic mock for Phase 1 (--no-llm).

Real (Anthropic-backed) implementation lives behind ``RealLLMJudge`` and is
deferred to Phase 2. Mock constants are pinned by spec section 12.11 so the
golden snapshot is reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from traj_pipeline.load import Step


class LLMJudge(Protocol):
    """Per spec section 5.1. Implementations must be deterministic at fixed
    inputs (real impl: temperature 0 + prompt-hash cache; mock: constants).
    """

    def is_new_task(self, prev_goal: str | None, user_text: str) -> bool: ...

    def subgoal_score(
        self,
        task_goal: str,
        step: Step,
        outcome: Step | None,
        lookahead: list[Step],
    ) -> float: ...

    def policy_score(self, step: Step, governing_user_text: str) -> float: ...

    def same_variant(self, goal_a: str, goal_b: str) -> bool: ...

    def resolves(
        self,
        buggy_step: Step,
        candidate_fix: Step,
        intervening_steps: list[Step],
    ) -> bool: ...

    def rejudge_example(
        self,
        input_messages: list[dict],
        output_message: dict,
    ) -> bool: ...

    """Independent quality re-check for an emitted SFT example (spec
    sections 5/7/12.8). Returns True if the proposed output is a reasonable
    training example for the given context; False to flag a disagreement."""


@dataclass
class MockLLMJudge:
    """Phase-1 deterministic mock pinned by spec section 12.11.

    Returns constants chosen so that:
    - the deterministic syntactic / constraint signals do the real labeling work,
    - the LLM-graded axes do not interfere with the gate (``subgoal_score=0.55``
      sits just above ``usefulness_threshold=0.5``; ``policy_score=0.95`` does
      not falsely trigger violations the regex missed),
    - reasoning / reflection prose is a fixed template keyed by ``source_part_id``,
      so byte-stable for the golden test.
    """

    def is_new_task(self, prev_goal: str | None, user_text: str) -> bool:
        return prev_goal is None or prev_goal == ""

    def subgoal_score(
        self,
        task_goal: str,
        step: Step,
        outcome: Step | None,
        lookahead: list[Step],
    ) -> float:
        return 0.55

    def policy_score(self, step: Step, governing_user_text: str) -> float:
        return 0.95

    def same_variant(self, goal_a: str, goal_b: str) -> bool:
        return True

    def resolves(
        self,
        buggy_step: Step,
        candidate_fix: Step,
        intervening_steps: list[Step],
    ) -> bool:
        return True

    def rejudge_example(
        self,
        input_messages: list[dict],
        output_message: dict,
    ) -> bool:
        # Phase-1 mock: always agrees. Real-LLM re-judge surfaces actual
        # disagreements.
        return True
