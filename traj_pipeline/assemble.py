"""Stage 6: assemble Spans + loss masks per spec section 6 table.

Walks ``scored_steps`` plus Stage-5 ``BackfillResult`` and produces a list
of ``Span`` objects in source order with synthetic reasoning / reflection
inserted per section 12.4:

  ... buggy_action, buggy_tool_result, REFLECTION, REASONING, fix_action ...

Loss-mask rules (section 6):
  user                        -> 0   (context only)
  tool_result                 -> 0   (context only)
  reasoning (pre-action)      -> 1
  reasoning (pre-buggy)       -> 0   (D16 unconditional)
  reflection                  -> 1
  answer                      -> 1 iff local_validity >= validity_threshold
                                 (section 12.5); trivial confirmations
                                 below ``min_answer_chars`` are dropped
  action (clean/fix/stale)    -> 1
  action (error_recovery_buggy) -> 0
  action (redundant/dead_end)   -> not emitted (Stage 4 drops)

Compressed-out steps are not emitted; their associated tool_result is also
dropped so the emitted span sequence stays coherent.

The ``Span`` payload keeps both the textual material and (for actions) the
structured ``tool``+``args`` so Stage 7's serializer can render either as
``content`` prose or as an OpenAI structured ``tool_calls`` entry.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from traj_pipeline.backfill import BackfillResult
from traj_pipeline.scoring import ScoredStep


SpanKind = Literal["user", "reasoning", "action", "tool_result", "reflection", "answer"]


DEFAULT_VALIDITY_THRESHOLD = 0.5
DEFAULT_MIN_ANSWER_CHARS = 0
DEFAULT_ANSWER_WEIGHT = 1.0
DEFAULT_ANSWER_WARN_CHARS = 8000


@dataclass
class Span:
    """Spec section 4.3."""

    kind: SpanKind
    text: str | None = None
    tool: str | None = None
    args: dict[str, Any] | None = None
    loss_mask: int = 0
    weight: float = 1.0
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass
class AssembleResult:
    spans: list[Span] = field(default_factory=list)
    # Warn lists for the verification report.
    long_answer_spans: list[int] = field(default_factory=list)  # step_ids


# Action labels that are *emitted* by Stage 6. Other labels (redundant,
# dead_end, unscored) are dropped; their tool_results are dropped too.
_EMITTED_ACTION_LABELS: frozenset[str] = frozenset(
    {"clean_success", "stale_info", "error_recovery_buggy", "error_recovery_fix"}
)


def _kept_iter(scored_steps: list[ScoredStep]):
    """Yield only the scored_steps that survive Stage-4 filtering, dropping
    the tool_result that immediately follows any dropped action.
    """
    drop_next_tool_result_for: str | None = None  # source_part_id we just dropped
    for ss in scored_steps:
        s = ss.step

        if s.kind == "tool_result" and drop_next_tool_result_for is not None:
            if s.source_part_id == drop_next_tool_result_for:
                drop_next_tool_result_for = None
                continue
            # Different part id -- pairing broken, stop suppressing.
            drop_next_tool_result_for = None

        if s.kind == "action":
            if ss.compressed_out or ss.label not in _EMITTED_ACTION_LABELS:
                drop_next_tool_result_for = s.source_part_id
                continue

        yield ss


def assemble_trajectory(
    scored_steps: list[ScoredStep],
    backfill_result: BackfillResult,
    *,
    validity_threshold: float = DEFAULT_VALIDITY_THRESHOLD,
    min_answer_chars: int = DEFAULT_MIN_ANSWER_CHARS,
    answer_weight: float = DEFAULT_ANSWER_WEIGHT,
    answer_warn_chars: int = DEFAULT_ANSWER_WARN_CHARS,
) -> AssembleResult:
    result = AssembleResult()
    kept = list(_kept_iter(scored_steps))

    for ss in kept:
        s = ss.step

        # Inject reasoning + reflection before an action.
        if s.kind == "action":
            if s.step_id in backfill_result.reflections:
                # D16: reflections always have loss_mask=1.
                result.spans.append(
                    Span(
                        kind="reflection",
                        text=backfill_result.reflections[s.step_id],
                        loss_mask=1,
                        weight=ss.retrospective_usefulness,
                        provenance={"synthetic": True, "for_fix_step_id": s.step_id},
                    )
                )

            if s.step_id in backfill_result.reasonings:
                # D16: pre-buggy reasoning is always loss_mask=0.
                pre_buggy = ss.label == "error_recovery_buggy"
                result.spans.append(
                    Span(
                        kind="reasoning",
                        text=backfill_result.reasonings[s.step_id],
                        loss_mask=0 if pre_buggy else 1,
                        weight=ss.retrospective_usefulness,
                        provenance={"synthetic": True, "for_step_id": s.step_id},
                    )
                )

        # Emit the step's own span.
        if s.kind == "user_text":
            result.spans.append(
                Span(
                    kind="user",
                    text=s.text,
                    loss_mask=0,
                    weight=1.0,
                    provenance={"step_id": s.step_id},
                )
            )
        elif s.kind == "assistant_text":
            text = s.text or ""
            if len(text) < min_answer_chars:
                continue  # trivial confirmation; drop entirely per section 12.5
            # Section 12.5: loss_mask=1 only if validity passes.
            mask = 1 if ss.local_validity >= validity_threshold else 0
            if len(text) > answer_warn_chars:
                result.long_answer_spans.append(s.step_id)
            result.spans.append(
                Span(
                    kind="answer",
                    text=text,
                    loss_mask=mask,
                    weight=ss.retrospective_usefulness * answer_weight,
                    provenance={"step_id": s.step_id},
                )
            )
        elif s.kind == "action":
            mask = 0 if ss.label == "error_recovery_buggy" else 1
            call_id = (s.metadata or {}).get("callID") or f"call_{s.step_id}"
            result.spans.append(
                Span(
                    kind="action",
                    tool=s.tool,
                    args=s.args,
                    loss_mask=mask,
                    weight=ss.retrospective_usefulness,
                    provenance={"step_id": s.step_id, "call_id": call_id},
                )
            )
        elif s.kind == "tool_result":
            call_id = (s.metadata or {}).get("callID") or f"call_{s.step_id}"
            result.spans.append(
                Span(
                    kind="tool_result",
                    text=s.text,
                    loss_mask=0,
                    weight=1.0,
                    provenance={"step_id": s.step_id, "call_id": call_id},
                )
            )

    return result
