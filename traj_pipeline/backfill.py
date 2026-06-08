"""Stage 5: reasoning + reflection backfill (D7).

For each *kept* action, insert a ``reasoning`` span immediately before it.
For each error_recovery_fix (a step with ``resolves_step_id`` set), insert a
``reflection`` span immediately after the corresponding buggy's tool_result
and before the corrective action.

Pre-buggy-action reasoning (D16): under section 3.1 / D8 the output format
is loss-on-output-only with full context, so reasoning preceding a buggy
action is always ``loss_mask=0`` -- it appears in input context only. The
generator still runs for kept buggy actions so the trajectory context reads
naturally; the Stage 6 mask logic enforces the mask=0 rule.

Spec also requires "no hindsight" (D7): the call to ``writer.reason`` must
receive only the prior context (steps before the action), never the future
result or downstream steps. We pass the slice ``scored_steps[:idx]`` to make
that boundary structural rather than convention.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from traj_pipeline.load import Step
from traj_pipeline.reasoning import ReasoningWriter
from traj_pipeline.scoring import ScoredStep

# Labels whose actions are "kept" and therefore get a preceding reasoning.
# ``redundant`` and ``dead_end`` actions are not kept; compressed_out actions
# are explicitly excluded too.
_KEPT_ACTION_LABELS: frozenset[str] = frozenset(
    {"clean_success", "stale_info", "error_recovery_buggy", "error_recovery_fix"}
)


@dataclass
class BackfillResult:
    """Synthetic prose keyed by the step it attaches to.

    ``reasonings[action_step_id]`` = prose to emit immediately before that
    action. ``reflections[fix_step_id]`` = prose to emit immediately before
    the corrective action (and after the buggy's tool_result).
    """

    reasonings: dict[int, str] = field(default_factory=dict)
    reflections: dict[int, str] = field(default_factory=dict)


def _find_buggy_tool_result(
    scored_steps: list[ScoredStep], buggy_idx: int
) -> Step | None:
    """Return the buggy step's own tool_result (the next step sharing source_part_id)."""
    if buggy_idx + 1 >= len(scored_steps):
        return None
    cand = scored_steps[buggy_idx + 1]
    buggy = scored_steps[buggy_idx]
    if (
        cand.step.kind == "tool_result"
        and cand.step.source_part_id == buggy.step.source_part_id
    ):
        return cand.step
    return None


def _prefetch_writer_calls(
    scored_steps: list[ScoredStep],
    writer: ReasoningWriter,
    max_workers: int,
) -> None:
    """Warm ``writer``'s cache for all reasoning + reflection calls in
    parallel. Same idea as the scoring prefetch."""
    if max_workers <= 1:
        return
    from concurrent.futures import ThreadPoolExecutor

    pos = {ss.step.step_id: i for i, ss in enumerate(scored_steps)}

    reason_tasks: list[tuple[list[Step], Step]] = []
    reflect_tasks: list[tuple[Step, Step | None, Step]] = []
    for idx, ss in enumerate(scored_steps):
        if ss.step.kind != "action" or ss.compressed_out:
            continue
        if ss.label not in _KEPT_ACTION_LABELS:
            continue
        context = [s.step for s in scored_steps[:idx]]
        reason_tasks.append((context, ss.step))
        if ss.resolves_step_id is not None:
            buggy_idx = pos.get(ss.resolves_step_id)
            if buggy_idx is None:
                continue
            buggy_step = scored_steps[buggy_idx].step
            buggy_tr = _find_buggy_tool_result(scored_steps, buggy_idx)
            reflect_tasks.append((buggy_step, buggy_tr, ss.step))

    if not reason_tasks and not reflect_tasks:
        return

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = []
        for ctx, action in reason_tasks:
            futures.append(ex.submit(writer.reason, ctx, action))
        for b, tr, c in reflect_tasks:
            futures.append(ex.submit(writer.reflect, b, tr, c))
        for f in futures:
            f.result()


def backfill(
    scored_steps: list[ScoredStep],
    writer: ReasoningWriter,
    *,
    max_workers: int = 1,
) -> BackfillResult:
    """Generate reasoning and reflection prose for the kept actions.

    Reasoning is generated for every kept action (label in
    ``_KEPT_ACTION_LABELS`` and not ``compressed_out``); reflection is
    generated for every step that ``resolves_step_id`` points *from* (i.e.,
    every fix step). The text is stored keyed by step_id; Stage 6 turns
    these into Spans with the right ``loss_mask`` per spec section 6.

    With ``max_workers > 1`` the LLM calls fan out in parallel via the
    writer's cache before the sequential collection loop runs.
    """
    _prefetch_writer_calls(scored_steps, writer, max_workers)
    result = BackfillResult()
    pos = {ss.step.step_id: i for i, ss in enumerate(scored_steps)}

    for idx, ss in enumerate(scored_steps):
        if ss.step.kind != "action" or ss.compressed_out:
            continue
        if ss.label not in _KEPT_ACTION_LABELS:
            continue

        # No-hindsight: pass only the strict prefix of steps.
        context = [s.step for s in scored_steps[:idx]]
        result.reasonings[ss.step.step_id] = writer.reason(context, ss.step)

        if ss.resolves_step_id is not None:
            buggy_idx = pos.get(ss.resolves_step_id)
            if buggy_idx is None:
                continue
            buggy_step = scored_steps[buggy_idx].step
            buggy_tool_result = _find_buggy_tool_result(scored_steps, buggy_idx)
            result.reflections[ss.step.step_id] = writer.reflect(
                buggy_step, buggy_tool_result, ss.step
            )

    return result
