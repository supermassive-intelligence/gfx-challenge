"""Stage 7 (part 2): self-verification (writes ``verification_report.json``).

The report includes the fields required by spec section 8:
- ``kept_spans``, ``dropped_spans``, ``masked_action_count``
- ``success_vs_recovery_ratio``
- ``recoveries_preserved`` (every error_recovery_buggy has a linked fix +
  reflection, and was not dropped)
- ``empty_output_lines`` (must be 0)
- ``policy_axis_approximate`` (True under ``--no-llm``)
- ``dpo_answer_rejected_skipped`` (section 12.5)
- ``long_answer_spans`` (section 11.6)
- ``llm_calls_used`` / ``max_llm_calls``
- provenance (``judge``, ``reasoning_writer_model``, ``pipeline_version``)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from traj_pipeline.assemble import AssembleResult, Span
from traj_pipeline.backfill import BackfillResult
from traj_pipeline.emit import EmitResult
from traj_pipeline.scoring import ScoredStep


@dataclass
class VerificationReport:
    kept_spans: int = 0
    dropped_spans: int = 0
    masked_action_count: int = 0
    success_vs_recovery_ratio: float | None = None
    recoveries_preserved: bool = True
    empty_output_lines: int = 0
    policy_axis_approximate: bool = False
    dpo_answer_rejected_skipped: int = 0
    long_answer_spans: list[int] = field(default_factory=list)
    llm_calls_used: int = 0
    max_llm_calls: int | None = None
    judge: str = ""
    reasoning_writer_model: str = ""
    pipeline_version: str = ""
    failures: list[str] = field(default_factory=list)
    # Re-judge sample (spec section 12.8).
    rejudge_sample_size: int = 0
    rejudge_disagreements: int = 0
    rejudge_disagreement_rate: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "kept_spans": self.kept_spans,
            "dropped_spans": self.dropped_spans,
            "masked_action_count": self.masked_action_count,
            "success_vs_recovery_ratio": self.success_vs_recovery_ratio,
            "recoveries_preserved": self.recoveries_preserved,
            "empty_output_lines": self.empty_output_lines,
            "policy_axis_approximate": self.policy_axis_approximate,
            "dpo_answer_rejected_skipped": self.dpo_answer_rejected_skipped,
            "long_answer_spans": self.long_answer_spans,
            "llm_calls_used": self.llm_calls_used,
            "max_llm_calls": self.max_llm_calls,
            "judge": self.judge,
            "reasoning_writer_model": self.reasoning_writer_model,
            "pipeline_version": self.pipeline_version,
            "failures": self.failures,
            "rejudge_sample_size": self.rejudge_sample_size,
            "rejudge_disagreements": self.rejudge_disagreements,
            "rejudge_disagreement_rate": self.rejudge_disagreement_rate,
        }


def rejudge_sft_sample(
    sft_examples: list[dict],
    judge,
    *,
    sample_rate: float = 0.10,
    max_count: int = 50,
    seed: int = 0,
    using_mock: bool = False,
    max_workers: int = 1,
) -> tuple[int, int]:
    """Sample emitted SFT examples and ask the judge to re-validate them.

    Spec section 5/7/12.8. Returns ``(sample_size, disagreement_count)``.
    Skipped when ``using_mock`` is True -- the mock would just return ``True``
    for everything and the rate would be meaninglessly zero.
    """
    import math
    import random

    if using_mock or not sft_examples or sample_rate <= 0:
        return (0, 0)
    target = min(max_count, max(1, math.ceil(len(sft_examples) * sample_rate)))
    target = min(target, len(sft_examples))
    rng = random.Random(seed)
    sample_idxs = rng.sample(range(len(sft_examples)), target)

    if max_workers > 1:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [
                ex.submit(
                    judge.rejudge_example,
                    sft_examples[i].get("input", []),
                    sft_examples[i].get("output", {}),
                )
                for i in sample_idxs
            ]
            results = [f.result() for f in futures]
    else:
        results = [
            judge.rejudge_example(
                sft_examples[i].get("input", []),
                sft_examples[i].get("output", {}),
            )
            for i in sample_idxs
        ]

    disagreements = sum(1 for ok in results if not ok)
    return (target, disagreements)


def _is_assistant_action_message(msg: dict) -> bool:
    return msg.get("role") == "assistant" and bool(msg.get("tool_calls"))


def verify(
    *,
    sft_examples: list[dict],
    scored_by_traj: list[list[ScoredStep]],
    backfill_by_traj: list[BackfillResult],
    assemble_by_traj: list[AssembleResult],
    emit_result: EmitResult,
    policy_axis_approximate: bool,
    llm_calls_used: int,
    max_llm_calls: int | None,
    judge: str,
    reasoning_writer_model: str,
    pipeline_version: str,
    judge_obj=None,
    using_mock: bool = True,
    verify_sample_rate: float = 0.10,
    seed: int = 0,
    max_workers: int = 1,
) -> VerificationReport:
    rep = VerificationReport(
        policy_axis_approximate=policy_axis_approximate,
        dpo_answer_rejected_skipped=emit_result.dpo_answer_rejected_skipped,
        llm_calls_used=llm_calls_used,
        max_llm_calls=max_llm_calls,
        judge=judge,
        reasoning_writer_model=reasoning_writer_model,
        pipeline_version=pipeline_version,
    )

    all_spans: list[Span] = []
    for asm in assemble_by_traj:
        all_spans.extend(asm.spans)
        rep.long_answer_spans.extend(asm.long_answer_spans)

    rep.kept_spans = len(all_spans)
    masked_actions = sum(
        1 for sp in all_spans if sp.kind == "action" and sp.loss_mask == 0
    )
    rep.masked_action_count = masked_actions

    # Dropped spans = scored steps that did not produce an emitted span. A
    # scored_step yields at most one span (plus possibly a synthetic reasoning
    # /reflection); the comparison here is at the step level.
    total_scored = sum(len(s) for s in scored_by_traj)
    rep.dropped_spans = max(0, total_scored - rep.kept_spans)

    # Section 12.5 / 6 invariants.
    clean_action_spans = sum(
        1 for sp in all_spans if sp.kind == "action" and sp.loss_mask == 1
    )
    recovery_buggy_spans = (
        masked_actions  # all loss_mask=0 actions are buggy under our rules
    )
    if recovery_buggy_spans > 0:
        rep.success_vs_recovery_ratio = clean_action_spans / recovery_buggy_spans
    else:
        rep.success_vs_recovery_ratio = None

    # Recoveries preserved: every buggy with linked fix has a reflection span
    # AND the buggy span is present in the assembled output.
    span_step_ids = {
        sp.provenance.get("step_id")
        for sp in all_spans
        if isinstance(sp.provenance.get("step_id"), int)
    }
    for scored in scored_by_traj:
        for ss in scored:
            if ss.label == "error_recovery_buggy":
                # Must be present in spans (we did not drop it).
                if ss.step.step_id not in span_step_ids:
                    rep.recoveries_preserved = False
                    rep.failures.append(
                        f"error_recovery_buggy step {ss.step.step_id} missing from emitted spans"
                    )
                # Find linked fix.
                linked_fix = next(
                    (f for f in scored if f.resolves_step_id == ss.step.step_id),
                    None,
                )
                if linked_fix is None:
                    rep.recoveries_preserved = False
                    rep.failures.append(
                        f"error_recovery_buggy step {ss.step.step_id} has no linked fix"
                    )
                else:
                    bf_idx = scored_by_traj.index(scored)
                    if (
                        linked_fix.step.step_id
                        not in backfill_by_traj[bf_idx].reflections
                    ):
                        rep.recoveries_preserved = False
                        rep.failures.append(
                            f"fix step {linked_fix.step.step_id} for buggy {ss.step.step_id} lacks reflection"
                        )

    # Empty output check: each SFT example's ``output`` message must have
    # some content or non-empty tool_calls.
    for ex in sft_examples:
        out = ex.get("output", {})
        content = out.get("content") or ""
        tool_calls = out.get("tool_calls") or []
        if not content.strip() and not tool_calls:
            rep.empty_output_lines += 1
            rep.failures.append("empty output line in sft.jsonl")

    # No loss_mask==1 action should also be flagged invalid by Stage 2.
    flagged_emitted = 0
    for scored in scored_by_traj:
        for ss in scored:
            if ss.step.kind != "action":
                continue
            if ss.local_validity >= 0.5:
                continue
            # Invalid action; check if any emitted span trains on it.
            for sp in all_spans:
                if (
                    sp.kind == "action"
                    and sp.loss_mask == 1
                    and sp.provenance.get("step_id") == ss.step.step_id
                ):
                    flagged_emitted += 1
                    rep.failures.append(
                        f"invalid action step {ss.step.step_id} emitted with loss_mask=1"
                    )
    if flagged_emitted:
        rep.recoveries_preserved = False  # treat as a recovery-discipline failure

    # Optional 10% re-judge sample (section 12.8). Only meaningful with a
    # real judge -- the mock would just say YES to everything.
    if judge_obj is not None:
        sample_size, disagreements = rejudge_sft_sample(
            sft_examples,
            judge_obj,
            sample_rate=verify_sample_rate,
            seed=seed,
            using_mock=using_mock,
            max_workers=max_workers,
        )
        rep.rejudge_sample_size = sample_size
        rep.rejudge_disagreements = disagreements
        if sample_size > 0:
            rep.rejudge_disagreement_rate = disagreements / sample_size

    return rep


def write_report(out_dir: str | Path, report: VerificationReport) -> None:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    p = Path(out_dir) / "verification_report.json"
    p.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, sort_keys=True, indent=2)
    )
