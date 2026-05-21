"""Stage 2: per-step scoring.

Computes the three quality axes (syntactic / subgoal / policy) and combines
them into ``local_validity`` and ``retrospective_usefulness`` per spec
sections 12.1 and 12.2. Labels and the ``resolves_step_id`` link are
assigned in Stage 3 (``labeling.py``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from traj_pipeline import signals as signals_mod
from traj_pipeline.judge import LLMJudge
from traj_pipeline.load import Step
from traj_pipeline.segment import Trajectory


Label = Literal[
    "unscored",
    "clean_success",
    "stale_info",
    "error_recovery_buggy",
    "error_recovery_fix",
    "dead_end",
    "redundant",
]


@dataclass
class ScoredStep:
    """Scored step per spec section 4.2 plus Stage-3 fields (defaulted)."""

    step: Step
    # Raw axis inputs (kept for debugging and for verification re-judge).
    syntactic_value: float = 1.0
    policy_local: float = 1.0
    policy_score_value: float = 1.0  # LLM-graded; under mock = 0.95
    subgoal_score_value: float = 0.0
    # Composite axes per section 4.2 / section 12.1.
    axes_syntactic: float = 1.0
    axes_subgoal: float = 0.0
    axes_policy: float = 1.0  # = min(policy_local, policy_score_value)
    # Combined scores per section 12.2.
    local_validity: float = 1.0
    retrospective_usefulness: float = 0.0
    # Stage-3 outputs.
    label: Label = "unscored"
    resolves_step_id: int | None = None
    # Diagnostic.
    constraint_violations: list[str] = field(default_factory=list)
    governing_user_text: str = ""
    # Stage-4 compression output: ``True`` means this step is dropped from
    # both the emitted spans and the input-context (it should still appear in
    # ``trajectories.json`` so the debug artifact stays complete).
    compressed_out: bool = False


def score_step(
    step: Step,
    trajectory: Trajectory,
    judge: LLMJudge,
    *,
    policy_threshold: float = 0.5,
    strict_local: bool = False,
) -> ScoredStep:
    """Score a single step within its trajectory context.

    For non-assistant steps returns a placeholder ``ScoredStep`` -- they are
    not labeled and only carry through for IR completeness. Spec section 5
    Stage 2 only scores assistant steps; sections 12.5 / 12.12 extend that
    to ``assistant_text`` / ``answer`` text steps via the same path.
    """
    if step.role != "assistant":
        return ScoredStep(step=step)

    # Lookahead within the trajectory.
    idx = next(
        (i for i, s in enumerate(trajectory.steps) if s.step_id == step.step_id),
        None,
    )
    assert idx is not None, "step must belong to its trajectory"
    following = trajectory.steps[idx + 1 :]

    governing = signals_mod.governing_user_text(
        step, trajectory.steps, trajectory.task_goal
    )
    segment = signals_mod.governed_actions(step, trajectory.steps)

    # Syntactic axis.
    synt = signals_mod.syntactic(step, following)

    # Policy axis. ``policy_local`` is binary; fires only on confirmed
    # violations (section 12.1). ``policy_score`` is the LLM-graded value
    # for semantic / paraphrased violations the deterministic detector
    # cannot reach. ``axes.policy = min(policy_local, policy_score)`` is the
    # composite reported axis; the labeling gate (below) consumes both via
    # ``policy_gate``.
    violations = signals_mod.constraint_violations(step, governing, segment)
    policy_local = 0.0 if violations else 1.0
    policy_llm = judge.policy_score(step, governing)
    axes_policy = min(policy_local, policy_llm)
    policy_gate = 1.0 if policy_llm >= policy_threshold else 0.0

    # Subgoal axis. Pass the action's own tool_result as ``outcome`` so the
    # judge can read it without scanning the lookahead.
    own_outcome = following[0] if following and following[0].kind == "tool_result" else None
    subgoal = judge.subgoal_score(trajectory.task_goal, step, own_outcome, following)

    # Section 12.2: local_validity = min(syntactic, policy_local, policy_gate).
    # Under ``--strict-local`` we drop the gate (deterministic-only ablation).
    if strict_local:
        local_validity = min(synt, policy_local)
    else:
        local_validity = min(synt, policy_local, policy_gate)

    # Section 12.2: retrospective_usefulness = subgoal_score. Stage-3 boosts
    # apply for fixes / stale_info; not done here.
    retrospective_usefulness = subgoal

    return ScoredStep(
        step=step,
        syntactic_value=synt,
        policy_local=policy_local,
        policy_score_value=policy_llm,
        subgoal_score_value=subgoal,
        axes_syntactic=synt,
        axes_subgoal=subgoal,
        axes_policy=axes_policy,
        local_validity=local_validity,
        retrospective_usefulness=retrospective_usefulness,
        constraint_violations=violations,
        governing_user_text=governing,
    )


def _prefetch_judge_calls(trajectory: Trajectory, judge: LLMJudge, max_workers: int) -> None:
    """Warm the judge's cache for every assistant step in parallel.

    Each ``score_step`` makes two LLM calls (``subgoal_score`` and
    ``policy_score``); they have no dependency on each other or on other
    steps, so they can fire concurrently. After this returns, sequential
    ``score_step`` calls hit the cache and complete in microseconds.

    Safe to call even when ``judge`` is the mock -- the mock just returns
    constants and the cache is shared per-process.
    """
    if max_workers <= 1:
        return
    from concurrent.futures import ThreadPoolExecutor

    tasks: list[tuple[Step, Step | None, list[Step], str]] = []
    for i, s in enumerate(trajectory.steps):
        if s.role != "assistant":
            continue
        following = trajectory.steps[i + 1 :]
        own_outcome = (
            following[0]
            if following and following[0].kind == "tool_result"
            else None
        )
        governing = signals_mod.governing_user_text(
            s, trajectory.steps, trajectory.task_goal
        )
        tasks.append((s, own_outcome, following, governing))

    if not tasks:
        return

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = []
        for s, own_outcome, following, governing in tasks:
            futures.append(
                ex.submit(
                    judge.subgoal_score,
                    trajectory.task_goal, s, own_outcome, following,
                )
            )
            futures.append(ex.submit(judge.policy_score, s, governing))
        for f in futures:
            f.result()  # raise any exceptions


def score_trajectory(
    trajectory: Trajectory,
    judge: LLMJudge,
    *,
    policy_threshold: float = 0.5,
    strict_local: bool = False,
    max_workers: int = 1,
) -> list[ScoredStep]:
    """Score every step in a trajectory in source order.

    With ``max_workers > 1`` the LLM calls fan out in parallel via the cache;
    the visible sequence of operations is unchanged because all dispatch
    happens before the first ``score_step`` consumes any judge output.
    """
    _prefetch_judge_calls(trajectory, judge, max_workers)
    return [
        score_step(
            s, trajectory, judge,
            policy_threshold=policy_threshold,
            strict_local=strict_local,
        )
        for s in trajectory.steps
    ]
