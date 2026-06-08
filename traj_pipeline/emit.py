"""Stage 7 (part 1): write ``sft.jsonl``, ``dpo.jsonl``, ``trajectories.json``.

Section 3.1 SFT shape: one example per ``loss_mask==1`` span, with
``input`` = all preceding spans rendered as OpenAI messages and
``output`` = the trained span as one assistant message.

Section 3.2 / 12.6 DPO shape: per canonical fix step, emit a triple
``{prompt, chosen, rejected}`` where ``prompt`` is the OpenAI message list
up to (and including) the reasoning span that precedes the buggy action;
``chosen`` and ``rejected`` are full assistant messages produced by the
same ``span_to_message`` call.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from traj_pipeline.assemble import AssembleResult, Span
from traj_pipeline.backfill import BackfillResult
from traj_pipeline.scoring import ScoredStep
from traj_pipeline.segment import Trajectory
from traj_pipeline.serialize import span_to_message


@dataclass
class EmitResult:
    sft_count: int = 0
    dpo_count: int = 0
    dpo_answer_rejected_skipped: int = 0


def _prefix_messages(
    spans: list[Span], end: int, system_prompt: str | None
) -> list[dict]:
    msgs: list[dict] = []
    if system_prompt:
        msgs.append({"role": "system", "content": system_prompt})
    for prev in spans[:end]:
        msgs.append(span_to_message(prev))
    return msgs


def emit_sft(
    spans: list[Span],
    *,
    system_prompt: str | None = None,
) -> list[dict]:
    """Build the SFT example list (one per ``loss_mask==1`` span)."""
    out: list[dict] = []
    for i, span in enumerate(spans):
        if span.loss_mask != 1:
            continue
        out.append(
            {
                "input": _prefix_messages(spans, i, system_prompt),
                "output": span_to_message(span),
            }
        )
    return out


def emit_dpo(
    spans: list[Span],
    scored_steps: list[ScoredStep],
    *,
    granularity: str = "canonical",
    system_prompt: str | None = None,
) -> tuple[list[dict], int]:
    """Build DPO pairs per spec section 12.6. Returns ``(pairs, skipped)``.

    ``skipped`` counts pairs that would have had an ``answer`` span as the
    rejected (section 12.5 Phase-1 exclusion).
    """
    pairs: list[dict] = []
    skipped = 0

    # Span index by provenance.step_id (only spans backed by a real step).
    pos: dict[int, int] = {}
    for i, sp in enumerate(spans):
        sid = sp.provenance.get("step_id")
        if isinstance(sid, int):
            # Prefer the first occurrence for a step_id; actions and tool_results
            # share step_id-distinct provenance so this is safe in practice.
            pos.setdefault(sid, i)

    # Walk scored fixes (steps that store ``resolves_step_id``); each emits at
    # most one pair under the canonical default.
    for ss in scored_steps:
        if ss.resolves_step_id is None:
            continue
        fix_span_idx = pos.get(ss.step.step_id)
        buggy_span_idx = pos.get(ss.resolves_step_id)
        if fix_span_idx is None or buggy_span_idx is None:
            continue
        rejected = spans[buggy_span_idx]
        if rejected.kind == "answer":
            skipped += 1
            continue
        if rejected.kind != "action":
            # Sanity: a buggy that became something other than an action is
            # an unexpected case under section 12.6. Skip rather than emit a
            # mis-shaped pair.
            skipped += 1
            continue

        chosen = spans[fix_span_idx]
        if chosen.kind != "action":
            continue

        # Section 12.6: prompt includes the reasoning that precedes the buggy
        # action; exclude the buggy itself. ``buggy_span_idx`` excludes the
        # buggy by construction.
        prompt = _prefix_messages(spans, buggy_span_idx, system_prompt)
        pairs.append(
            {
                "prompt": prompt,
                "chosen": span_to_message(chosen),
                "rejected": span_to_message(rejected),
            }
        )

    return pairs, skipped


def _span_to_dict(span: Span) -> dict[str, Any]:
    return {
        "kind": span.kind,
        "text": span.text,
        "tool": span.tool,
        "args": span.args,
        "loss_mask": span.loss_mask,
        "weight": span.weight,
        "provenance": span.provenance,
    }


def _scored_step_to_dict(ss: ScoredStep) -> dict[str, Any]:
    s = ss.step
    return {
        "step_id": s.step_id,
        "source_message_id": s.source_message_id,
        "source_part_id": s.source_part_id,
        "role": s.role,
        "kind": s.kind,
        "tool": s.tool,
        "args": s.args,
        "text": s.text,
        "status": s.status,
        "ts": s.ts,
        "metadata": s.metadata,
        "syntactic": ss.syntactic_value,
        "policy_local": ss.policy_local,
        "policy_score": ss.policy_score_value,
        "subgoal_score": ss.subgoal_score_value,
        "axes": {
            "syntactic": ss.axes_syntactic,
            "subgoal": ss.axes_subgoal,
            "policy": ss.axes_policy,
        },
        "local_validity": ss.local_validity,
        "retrospective_usefulness": ss.retrospective_usefulness,
        "label": ss.label,
        "resolves_step_id": ss.resolves_step_id,
        "constraint_violations": ss.constraint_violations,
        "governing_user_text": ss.governing_user_text,
        "compressed_out": ss.compressed_out,
    }


def trajectories_payload(
    trajectories: list[Trajectory],
    scored_by_traj: list[list[ScoredStep]],
    backfill_by_traj: list[BackfillResult],
    assemble_by_traj: list[AssembleResult],
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Build the ``trajectories.json`` payload (debug artifact, section 3.3)."""
    return {
        "meta": meta,
        "trajectories": [
            {
                "task_goal": traj.task_goal,
                "scored_steps": [_scored_step_to_dict(ss) for ss in scored],
                "reasonings": bf.reasonings,
                "reflections": bf.reflections,
                "spans": [_span_to_dict(sp) for sp in asm.spans],
                "long_answer_spans": asm.long_answer_spans,
            }
            for traj, scored, bf, asm in zip(
                trajectories, scored_by_traj, backfill_by_traj, assemble_by_traj
            )
        ],
    }


def write_outputs(
    out_dir: str | Path,
    *,
    sft_examples: list[dict],
    dpo_pairs: list[dict],
    trajectories_doc: dict,
    write_dpo: bool,
) -> None:
    """Write JSONL / JSON files to ``out_dir``."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    with (out / "sft.jsonl").open("w", encoding="utf-8") as f:
        for ex in sft_examples:
            f.write(json.dumps(ex, ensure_ascii=False, sort_keys=True))
            f.write("\n")

    if write_dpo:
        with (out / "dpo.jsonl").open("w", encoding="utf-8") as f:
            for pair in dpo_pairs:
                f.write(json.dumps(pair, ensure_ascii=False, sort_keys=True))
                f.write("\n")

    with (out / "trajectories.json").open("w", encoding="utf-8") as f:
        json.dump(trajectories_doc, f, ensure_ascii=False, sort_keys=True, indent=2)
