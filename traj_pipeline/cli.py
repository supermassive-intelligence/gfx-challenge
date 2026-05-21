"""Stage 7 entry point: ``python -m traj_pipeline ...``.

Wires Stages 0-7 with the mock judge / writer under ``--no-llm`` (the only
mode wired in Phase 1) and writes the four output artifacts. Real Anthropic
judging is deferred to Phase 2.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
from pathlib import Path

from traj_pipeline import PIPELINE_VERSION
from traj_pipeline.assemble import AssembleResult, assemble_trajectory
from traj_pipeline.backfill import BackfillResult, backfill
from traj_pipeline.cache import LLMCallBudgetExceeded, PromptCache
from traj_pipeline.compression import compress_all_trajectories
from traj_pipeline.config import Config
from traj_pipeline.emit import (
    EmitResult,
    emit_dpo,
    emit_sft,
    trajectories_payload,
    write_outputs,
)
from traj_pipeline.judge import LLMJudge, MockLLMJudge
from traj_pipeline.labeling import label_trajectory
from traj_pipeline.load import load_session
from traj_pipeline.reasoning import MockReasoningWriter, ReasoningWriter
from traj_pipeline.scoring import score_trajectory
from traj_pipeline.segment import segment
from traj_pipeline.verify import verify, write_report


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="traj_pipeline")
    p.add_argument("--input", required=True, help="path to OpenCode session JSON")
    p.add_argument("--out-dir", default="./out")
    p.add_argument("--horizon", default="end-of-session")
    p.add_argument("--emit", default="sft", help="comma-separated subset of {sft,dpo}")
    p.add_argument("--redundancy", choices=["off", "collapse"], default="collapse")
    p.add_argument(
        "--failure-compression",
        choices=["off", "conservative", "aggressive"],
        default="conservative",
    )
    p.add_argument("--judge", default="mock")
    p.add_argument("--no-llm", action="store_true",
                   help="force mock judge / writer (Phase 1 default)")
    p.add_argument("--dpo-granularity",
                   choices=["canonical", "all", "first", "last"],
                   default="canonical")
    p.add_argument("--strict-local", action="store_true")
    p.add_argument("--policy-threshold", type=float, default=0.5)
    p.add_argument("--max-workers", type=int, default=1,
                   help="parallel LLM call fan-out (1 = sequential)")
    p.add_argument("--answer-weight", type=float, default=1.0)
    p.add_argument("--min-answer-chars", type=int, default=0)
    p.add_argument("--answer-warn-chars", type=int, default=8000)
    p.add_argument("--max-llm-calls", type=int, default=None)
    p.add_argument(
        "--reasoning-writer-model",
        default="claude-sonnet-4-6",
    )
    p.add_argument("--system-prompt", default=None)
    p.add_argument("--seed", type=int, default=0)
    return p


def config_from_args(args: argparse.Namespace) -> Config:
    emit_set = {kind.strip() for kind in args.emit.split(",") if kind.strip()}
    return Config(
        input_path=args.input,
        out_dir=args.out_dir,
        horizon=args.horizon,
        emit=emit_set,
        redundancy=args.redundancy,
        failure_compression=args.failure_compression,
        dpo_granularity=args.dpo_granularity,
        strict_local=args.strict_local,
        policy_threshold=args.policy_threshold,
        max_workers=args.max_workers,
        answer_weight=args.answer_weight,
        min_answer_chars=args.min_answer_chars,
        answer_warn_chars=args.answer_warn_chars,
        max_llm_calls=args.max_llm_calls,
        reasoning_writer_model=args.reasoning_writer_model,
        judge=args.judge,
        seed=args.seed,
        system_prompt=args.system_prompt,
        no_llm=args.no_llm or args.judge == "mock",
    )


def _build_backends(config: Config) -> tuple[LLMJudge, ReasoningWriter, PromptCache | None]:
    """Choose mock or Anthropic backends based on config."""
    if config.no_llm or config.judge == "mock":
        return MockLLMJudge(), MockReasoningWriter(), None

    # Lazy import so the package works without ``anthropic`` installed when
    # only the mock path is used.
    from traj_pipeline._anthropic import (
        DEFAULT_CACHE_DIR,
        AnthropicLLMJudge,
        AnthropicReasoningWriter,
        _AnthropicBackend,
    )

    cache = PromptCache(DEFAULT_CACHE_DIR)
    judge_backend = _AnthropicBackend(
        model_id=config.judge,
        cache=cache,
        max_calls=config.max_llm_calls,
    )
    writer_backend = _AnthropicBackend(
        model_id=config.reasoning_writer_model,
        cache=cache,
        max_calls=config.max_llm_calls,
    )
    return (
        AnthropicLLMJudge(backend=judge_backend),
        AnthropicReasoningWriter(backend=writer_backend),
        cache,
    )


def run(config: Config) -> dict:
    """Run all 7 stages and write outputs. Returns a small summary dict.

    Under a budget cap (``max_llm_calls``), an ``LLMCallBudgetExceeded`` from
    any stage aborts the run; the partial state from already-completed stages
    is summarized so the user can decide whether to lift the cap. The cache
    on disk retains everything paid for, so a follow-up run starts from there.
    """
    judge, writer, cache = _build_backends(config)
    budget_aborted_at: str | None = None

    info, steps = load_session(config.input_path)
    try:
        trajectories = segment(steps, judge)
    except LLMCallBudgetExceeded:
        budget_aborted_at = "segment"
        trajectories = []

    # Pass 1: score + label every trajectory (cross-trajectory compression
    # cannot run until all trajectories have labels assigned).
    scored_by_traj: list = []
    for traj in trajectories:
        if budget_aborted_at is not None:
            break
        try:
            scored = score_trajectory(
                traj, judge,
                policy_threshold=config.policy_threshold,
                strict_local=config.strict_local,
                max_workers=config.max_workers,
            )
            label_trajectory(
                scored, judge,
                validity_threshold=config.validity_threshold,
                usefulness_threshold=config.usefulness_threshold,
            )
            scored_by_traj.append(scored)
        except LLMCallBudgetExceeded:
            budget_aborted_at = "score/label"
            break

    # Pass 2: cross-trajectory + within-trajectory compression in one shot.
    if budget_aborted_at is None and scored_by_traj:
        task_goals = [trajectories[i].task_goal for i in range(len(scored_by_traj))]
        try:
            compress_all_trajectories(
                task_goals,
                scored_by_traj,
                judge,
                redundancy_mode=config.redundancy,  # type: ignore[arg-type]
                failure_compression_mode=config.failure_compression,  # type: ignore[arg-type]
            )
        except LLMCallBudgetExceeded:
            budget_aborted_at = "compress"

    # Pass 3: backfill + assemble each fully-processed trajectory.
    backfill_by_traj: list[BackfillResult] = []
    assemble_by_traj: list[AssembleResult] = []
    for scored in scored_by_traj:
        if budget_aborted_at is not None:
            break
        try:
            bf = backfill(scored, writer, max_workers=config.max_workers)
            asm = assemble_trajectory(
                scored, bf,
                validity_threshold=config.validity_threshold,
                min_answer_chars=config.min_answer_chars,
                answer_weight=config.answer_weight,
                answer_warn_chars=config.answer_warn_chars,
            )
            backfill_by_traj.append(bf)
            assemble_by_traj.append(asm)
        except LLMCallBudgetExceeded:
            budget_aborted_at = "backfill/assemble"
            break

    # Trim scored list to whatever fully completed backfill/assemble too --
    # downstream emit/verify only see fully-processed trajectories.
    fully_processed = len(assemble_by_traj)
    scored_by_traj = scored_by_traj[:fully_processed]

    # Flatten spans for SFT / DPO emission.
    sft_examples: list[dict] = []
    dpo_pairs: list[dict] = []
    emit_result = EmitResult()
    for scored, asm in zip(scored_by_traj, assemble_by_traj):
        sft_examples.extend(emit_sft(asm.spans, system_prompt=config.system_prompt))
        if "dpo" in config.emit:
            pairs, skipped = emit_dpo(
                asm.spans, scored,
                granularity=config.dpo_granularity,
                system_prompt=config.system_prompt,
            )
            dpo_pairs.extend(pairs)
            emit_result.dpo_answer_rejected_skipped += skipped

    emit_result.sft_count = len(sft_examples)
    emit_result.dpo_count = len(dpo_pairs)

    using_mock = config.no_llm or config.judge == "mock"
    meta = {
        "pipeline_version": PIPELINE_VERSION,
        "judge": "mock" if using_mock else config.judge,
        "reasoning_writer_model": "mock" if using_mock else config.reasoning_writer_model,
        "no_llm": using_mock,
        "input_path": config.input_path,
        "session_info_id": info.get("id"),
    }
    traj_doc = trajectories_payload(
        trajectories, scored_by_traj, backfill_by_traj, assemble_by_traj, meta
    )
    write_outputs(
        config.out_dir,
        sft_examples=sft_examples,
        dpo_pairs=dpo_pairs,
        trajectories_doc=traj_doc,
        write_dpo="dpo" in config.emit,
    )

    # Roll up LLM call counts (zero under mock; sum of backend counters under
    # Anthropic).
    llm_calls_used = 0
    judge_backend = getattr(judge, "backend", None)
    writer_backend = getattr(writer, "backend", None)
    if judge_backend is not None:
        llm_calls_used += getattr(judge_backend, "calls_used", 0)
    if writer_backend is not None and writer_backend is not judge_backend:
        llm_calls_used += getattr(writer_backend, "calls_used", 0)

    report = verify(
        sft_examples=sft_examples,
        scored_by_traj=scored_by_traj,
        backfill_by_traj=backfill_by_traj,
        assemble_by_traj=assemble_by_traj,
        emit_result=emit_result,
        policy_axis_approximate=(config.no_llm or config.judge == "mock"),
        llm_calls_used=llm_calls_used,
        max_llm_calls=config.max_llm_calls,
        judge="mock" if (config.no_llm or config.judge == "mock") else config.judge,
        reasoning_writer_model="mock" if (config.no_llm or config.judge == "mock") else config.reasoning_writer_model,
        pipeline_version=PIPELINE_VERSION,
        judge_obj=judge,
        using_mock=(config.no_llm or config.judge == "mock"),
        verify_sample_rate=config.verify_sample_rate,
        seed=config.seed,
        max_workers=config.max_workers,
    )
    write_report(config.out_dir, report)

    return {
        "sft": emit_result.sft_count,
        "dpo": emit_result.dpo_count,
        "trajectories_segmented": len(trajectories),
        "trajectories_fully_processed": len(scored_by_traj),
        "verification_failures": len(report.failures),
        "out_dir": str(Path(config.out_dir).resolve()),
        "llm_calls_used": llm_calls_used,
        "budget_aborted_at": budget_aborted_at,
    }


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = config_from_args(args)
    summary = run(config)
    print(summary)
    return 0 if summary["verification_failures"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
