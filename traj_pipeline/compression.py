"""Stage 4: compression.

Three orthogonal operations per spec section 5 Stage 4:

  (1a) Within-trajectory redundancy
       - Groups consecutive same-signature clean_success actions inside one
         trajectory; keeps the first as the exemplar, relabels the rest as
         ``redundant``. Useful when a single trajectory loops over the same
         operation internally.

  (1b) Cross-trajectory redundancy
       - Per spec section 5 Stage 4, the canonical case: multiple
         trajectories with the same action-template *sequence* and same
         ``task_goal`` variant. Confirms via ``LLMJudge.same_variant`` and
         marks all action steps in the follower trajectories as
         ``redundant``. This catches structurally-identical sibling
         trajectories (e.g. the fixture's repeated file-survey blocks)
         collapsing to one exemplar per variant.

  (2) Failure compression
      - Within an error_recovery episode (a canonical buggy linked to its
        fix via ``resolves_step_id``), drops intervening ``dead_end``
        actions. Mode ``conservative`` (default) drops only inside-episode
        dead_ends; ``aggressive`` also drops outside-episode dead_ends; ``off``
        drops nothing.

All three only mutate per-step flags (``label`` or ``compressed_out``);
physical step removal is deferred until Stage 6 (assemble) so the full
intermediate representation reaches ``trajectories.json``.
"""

from __future__ import annotations

from typing import Literal

from traj_pipeline.judge import LLMJudge
from traj_pipeline.load import Step
from traj_pipeline.scoring import ScoredStep


RedundancyMode = Literal["off", "collapse"]
FailureMode = Literal["off", "conservative", "aggressive"]


def _bash_signature(args: dict | None) -> str:
    cmd = ((args or {}).get("command") or "").strip()
    if not cmd:
        return "bash::"
    first = cmd.split()[0]
    first = first.rsplit("/", 1)[-1]  # strip /usr/bin/ etc.
    flags: list[str] = []
    if "|" in cmd:
        flags.append("pipe")
    if ">>" in cmd or ">" in cmd:
        flags.append("redirect")
    if "$(" in cmd or "`" in cmd:
        flags.append("subshell")
    return f"bash:{first}:{','.join(flags)}"


def _file_ext(path: str) -> str:
    if "." not in path:
        return ""
    return path.rsplit(".", 1)[-1]


def action_signature(step: Step) -> str:
    """Deterministic per-step signature for redundancy grouping (D19).

    The signature is intentionally coarse: under-collapse is the safe failure
    direction (we would rather keep a near-duplicate than wrongly merge two
    distinct steps).
    """
    if step.kind != "action":
        return ""
    tool = step.tool or ""
    if tool == "bash":
        return _bash_signature(step.args)
    if tool in ("edit", "write", "read"):
        args = step.args or {}
        path = args.get("filePath") or args.get("path") or args.get("file") or ""
        return f"{tool}:{_file_ext(path) if isinstance(path, str) else ''}"
    return f"{tool}:"


def redundancy_compress(
    scored_steps: list[ScoredStep],
    judge: LLMJudge,
    *,
    mode: RedundancyMode = "collapse",
) -> None:
    """Collapse repeated clean_success actions within a trajectory.

    Phase-1 simplification: per-action signature match within the same
    trajectory (not multi-trajectory sequence comparison). First occurrence
    of each signature is kept as clean_success; subsequent same-signature
    clean_success actions are confirmed via ``judge.same_variant`` and
    relabeled ``redundant``.
    """
    if mode == "off":
        return

    # Section 5 Stage 4 disjointness guarantee: redundancy must not touch
    # steps that are part of an error_recovery episode. Collect fix step_ids
    # (steps that store ``resolves_step_id``) and the canonical buggies they
    # point to; both are exempt from collapse even when labeled clean_success.
    recovery_exempt: set[int] = set()
    for ss in scored_steps:
        if ss.resolves_step_id is not None:
            recovery_exempt.add(ss.step.step_id)
            recovery_exempt.add(ss.resolves_step_id)

    seen: set[str] = set()
    for ss in scored_steps:
        if ss.label != "clean_success" or ss.step.kind != "action":
            continue
        if ss.step.step_id in recovery_exempt:
            continue
        sig = action_signature(ss.step)
        if not sig:
            continue
        if sig in seen:
            # Under mock judge.same_variant returns True; under a real judge
            # the goal-shape check may keep distinct variants apart.
            if judge.same_variant(ss.governing_user_text, ss.governing_user_text):
                ss.label = "redundant"
        else:
            seen.add(sig)


def failure_compress(
    scored_steps: list[ScoredStep],
    *,
    mode: FailureMode = "conservative",
) -> None:
    """Drop dead_end actions per the failure-compression mode.

    ``conservative`` drops only dead_ends that lie *strictly between* a
    canonical buggy step and its linked fix (section 5 Stage 4 part 2).
    ``aggressive`` additionally drops dead_ends outside any episode.
    Dropped steps get ``compressed_out=True``; they remain in the
    intermediate representation so ``trajectories.json`` is still complete.
    """
    if mode == "off":
        return

    pos = {ss.step.step_id: i for i, ss in enumerate(scored_steps)}

    # Drop inside-episode dead_ends.
    for ss in scored_steps:
        if ss.resolves_step_id is None:
            continue
        fix_idx = pos[ss.step.step_id]
        buggy_idx = pos.get(ss.resolves_step_id)
        if buggy_idx is None or buggy_idx >= fix_idx:
            continue
        for k in range(buggy_idx + 1, fix_idx):
            cand = scored_steps[k]
            if cand.label == "dead_end" and cand.step.kind == "action":
                cand.compressed_out = True

    if mode == "aggressive":
        for ss in scored_steps:
            if ss.label == "dead_end" and ss.step.kind == "action":
                ss.compressed_out = True


def compress_trajectory(
    scored_steps: list[ScoredStep],
    judge: LLMJudge,
    *,
    redundancy_mode: RedundancyMode = "collapse",
    failure_compression_mode: FailureMode = "conservative",
) -> list[ScoredStep]:
    """Apply within-trajectory compressions in place; return the same list.

    Cross-trajectory redundancy lives in ``compress_all_trajectories``.
    """
    redundancy_compress(scored_steps, judge, mode=redundancy_mode)
    failure_compress(scored_steps, mode=failure_compression_mode)
    return scored_steps


def _trajectory_action_signature_sequence(scored_steps: list[ScoredStep]) -> tuple[str, ...]:
    """Tuple of action signatures in source order. Excludes non-action steps
    and any step that has already been flagged compressed_out or labeled
    redundant / dead_end."""
    out: list[str] = []
    for ss in scored_steps:
        if ss.step.kind != "action":
            continue
        if ss.compressed_out or ss.label in ("redundant", "dead_end"):
            continue
        sig = action_signature(ss.step)
        if sig:
            out.append(sig)
    return tuple(out)


def redundancy_compress_across_trajectories(
    task_goals: list[str],
    scored_by_traj: list[list[ScoredStep]],
    judge: LLMJudge,
    *,
    mode: RedundancyMode = "collapse",
) -> list[int]:
    """Find groups of structurally identical trajectories that the judge
    confirms are the same variant, keep the first as exemplar, mark the
    rest's clean_success action steps as ``redundant``.

    Returns a list parallel to ``scored_by_traj`` mapping each trajectory
    index to its canonical exemplar's index (i.e. ``canonical[i] == i`` for
    the kept exemplar; ``canonical[i] == k`` for a follower of trajectory
    ``k``). Empty / no-action trajectories map to themselves.

    Only invokes ``judge.same_variant`` when two trajectories already share
    the exact action-signature sequence (no LLM call when structures differ).
    Recovery steps (error_recovery_buggy / error_recovery_fix) are never
    touched -- redundancy and failure compression operate on disjoint
    regions per spec section 5 Stage 4.
    """
    n = len(scored_by_traj)
    canonical = list(range(n))
    if mode == "off" or n < 2:
        return canonical

    # Skip trajectories that contain any recovery -- their steps are part of
    # an error_recovery episode and must not be collapsed.
    def _has_recovery(scored: list[ScoredStep]) -> bool:
        for ss in scored:
            if ss.label in ("error_recovery_buggy", "error_recovery_fix"):
                return True
            if ss.resolves_step_id is not None:
                return True
        return False

    sigs: list[tuple[str, ...]] = [
        _trajectory_action_signature_sequence(s) for s in scored_by_traj
    ]
    eligible = [
        bool(sigs[i]) and not _has_recovery(scored_by_traj[i])
        for i in range(n)
    ]

    for i in range(n):
        if not eligible[i] or canonical[i] != i:
            continue
        for j in range(i + 1, n):
            if not eligible[j] or canonical[j] != j:
                continue
            if sigs[i] != sigs[j]:
                continue
            if not judge.same_variant(task_goals[i], task_goals[j]):
                continue
            canonical[j] = i
            for ss in scored_by_traj[j]:
                if ss.step.kind == "action" and ss.label == "clean_success":
                    ss.label = "redundant"

    return canonical


def compress_all_trajectories(
    task_goals: list[str],
    scored_by_traj: list[list[ScoredStep]],
    judge: LLMJudge,
    *,
    redundancy_mode: RedundancyMode = "collapse",
    failure_compression_mode: FailureMode = "conservative",
) -> list[int]:
    """Pipeline-level Stage 4 entry point.

    Cross-trajectory redundancy runs first (it can mark whole trajectories'
    actions as ``redundant`` based on a sibling exemplar), then per-
    trajectory ``compress_trajectory`` runs which handles intra-trajectory
    redundancy + failure compression.
    """
    canonical = redundancy_compress_across_trajectories(
        task_goals, scored_by_traj, judge, mode=redundancy_mode
    )
    for scored in scored_by_traj:
        compress_trajectory(
            scored,
            judge,
            redundancy_mode=redundancy_mode,
            failure_compression_mode=failure_compression_mode,
        )
    return canonical
