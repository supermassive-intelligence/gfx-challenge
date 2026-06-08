"""Stage 3: episode labeling.

Two ordered passes per spec section 5 Stage 3 / section 12.3:
  Pass A -- link fixes: for each candidate buggy step (action with
            local_validity below the threshold), forward-scan for the first
            valid action that plausibly resolves it; the heuristic accepts
            same-target or same-tool matches, with ``LLMJudge.resolves`` as
            backstop for cross-tool repairs (section 9.5).
  Pass B -- assign labels: the deterministic algorithm in section 12.3.

Section 12.7 (one buggy ↔ one fix) is enforced by collapsing per-fix
multi-buggy proposals to the canonical (latest) buggy step before recording
``resolves_step_id``. Other failed attempts in the same episode keep their
``error_recovery_buggy`` label only if they also link to *some* fix; per
section 12.3 unlinked invalid actions fall to ``dead_end``.

Section 12.2 post-adjustment: any step with ``resolves_step_id`` set on a
later fix that points to it (i.e. a step that *is* the canonical buggy of an
episode) has its ``retrospective_usefulness`` kept low; the fix step itself
gets its ``retrospective_usefulness`` boosted to ``max(.., 0.8)`` (the boost
is applied here rather than in scoring because it depends on linking).

Implementation note on section 12.3: the algorithm assigns
``error_recovery_fix`` only when the fix step itself is *invalid*, which is
rare in practice. A *valid* fix is labeled ``clean_success`` (section 12.3
prose: "a step that is both valid and is_fix is just clean_success").
Downstream emit / DPO logic identifies the fix via ``resolves_step_id``
rather than the label, so this label-vs-link split is intentional.
"""

from __future__ import annotations

from typing import Iterable

from traj_pipeline.judge import LLMJudge
from traj_pipeline.load import Step
from traj_pipeline.scoring import ScoredStep

DEFAULT_VALIDITY_THRESHOLD = 0.5
DEFAULT_USEFULNESS_THRESHOLD = 0.5

# Args keys that identify a per-tool "target" (file path, mostly).
_TARGET_KEYS: tuple[str, ...] = ("filePath", "file_path", "path", "file")


def _extract_target(step: Step) -> str | None:
    """Return a single identifier for what the step operates on, if any.

    For file-touching tools (edit / write / read), this is the file path
    from args. For bash and other tools without a clear target, returns
    ``None``.
    """
    if step.kind != "action":
        return None
    args = step.args or {}
    for key in _TARGET_KEYS:
        v = args.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def _find_fix(
    buggy_idx: int,
    scored_steps: list[ScoredStep],
    judge: LLMJudge,
    validity_threshold: float,
) -> int | None:
    """Return the trajectory index of the canonical fix candidate, or None.

    Three-tier search per spec section 9.5: same-target heuristic first,
    same-tool heuristic next, ``LLMJudge.resolves`` backstop last (the
    cross-tool repair case). Heuristics are *exhaustive within their tier*
    -- we do not fall to the LLM until both heuristic tiers fail, so that a
    promiscuous mock judge does not pre-empt a clean structural match.
    """
    n = len(scored_steps)
    buggy = scored_steps[buggy_idx]

    candidates: list[tuple[int, ScoredStep]] = []
    for j in range(buggy_idx + 1, n):
        cand = scored_steps[j]
        if cand.step.kind == "action" and cand.local_validity >= validity_threshold:
            candidates.append((j, cand))
    if not candidates:
        return None

    # Tier 1: same target file.
    bt = _extract_target(buggy.step)
    if bt is not None:
        for j, cand in candidates:
            if _extract_target(cand.step) == bt:
                return j

    # Tier 2: same tool kind.
    for j, cand in candidates:
        if cand.step.tool == buggy.step.tool:
            return j

    # Tier 3: cross-tool LLM backstop on the first candidate.
    j_first, c_first = candidates[0]
    intervening = [
        ss.step
        for ss in scored_steps[buggy_idx + 1 : j_first]
        if ss.step.kind == "action"
    ]
    if judge.resolves(buggy.step, c_first.step, intervening):
        return j_first

    return None


def link_fixes(
    scored_steps: list[ScoredStep],
    judge: LLMJudge,
    *,
    validity_threshold: float = DEFAULT_VALIDITY_THRESHOLD,
) -> None:
    """Pass A: set ``resolves_step_id`` on the fix step for each linked buggy.

    Mutates ``scored_steps`` in place. After this call, a step is the
    canonical fix for an episode iff its ``resolves_step_id`` is non-None.
    """
    by_step_id = {ss.step.step_id: ss for ss in scored_steps}

    proposed: list[tuple[int, int]] = []  # (buggy_step_id, fix_step_id)
    for i, buggy in enumerate(scored_steps):
        if buggy.step.kind != "action" or buggy.local_validity >= validity_threshold:
            continue
        j_fix = _find_fix(i, scored_steps, judge, validity_threshold)
        if j_fix is not None:
            proposed.append((buggy.step.step_id, scored_steps[j_fix].step.step_id))

    # Section 12.7 canonical-buggy rule: per fix, keep only the latest buggy.
    fix_to_buggies: dict[int, list[int]] = {}
    for bsid, fsid in proposed:
        fix_to_buggies.setdefault(fsid, []).append(bsid)

    for fsid, bsids in fix_to_buggies.items():
        canonical = max(bsids)  # latest step_id = canonical (section 9.2)
        by_step_id[fsid].resolves_step_id = canonical


def assign_labels(
    scored_steps: list[ScoredStep],
    *,
    validity_threshold: float = DEFAULT_VALIDITY_THRESHOLD,
    usefulness_threshold: float = DEFAULT_USEFULNESS_THRESHOLD,
) -> None:
    """Pass B: assign ``label`` per section 12.3. Mutates in place.

    Apply the section 12.2 post-adjustment to ``retrospective_usefulness``
    for steps newly identified as fixes.
    """
    by_step_id = {ss.step.step_id: ss for ss in scored_steps}

    # is_fix = some later step's resolves_step_id == this step's id... no,
    # actually section 11.2: ``fix.resolves_step_id = buggy.step_id``. So:
    #   is_fix(s) = s.resolves_step_id is not None  (s itself stores the link)
    #   has_fix(s) = some other step's resolves_step_id points to s.step_id
    fix_step_ids: set[int] = set()
    has_fix_step_ids: set[int] = set()
    for ss in scored_steps:
        if ss.resolves_step_id is not None:
            fix_step_ids.add(ss.step.step_id)
            has_fix_step_ids.add(ss.resolves_step_id)

    for ss in scored_steps:
        if ss.step.role != "assistant" or ss.step.kind != "action":
            # Section 12.3 labels apply per-action; text steps are handled in
            # section 12.5 by the emit stage's answer-span scoring.
            continue

        valid = ss.local_validity >= validity_threshold
        useful = ss.retrospective_usefulness >= usefulness_threshold
        is_fix = ss.step.step_id in fix_step_ids
        has_fix = ss.step.step_id in has_fix_step_ids

        if valid and useful:
            ss.label = "clean_success"
        elif valid and not useful:
            ss.label = "stale_info"
        elif (not valid) and has_fix:
            ss.label = "error_recovery_buggy"
        elif (not valid) and is_fix:
            ss.label = "error_recovery_fix"
        else:
            ss.label = "dead_end"

    # Section 12.2 boost: a step that resolves a buggy (is_fix true) has its
    # retrospective_usefulness raised to at least 0.8. Applied to is_fix
    # steps regardless of label (most will be clean_success per section 12.3
    # since fix candidates usually have local_validity >= threshold).
    for fsid in fix_step_ids:
        ss = by_step_id[fsid]
        ss.retrospective_usefulness = max(ss.retrospective_usefulness, 0.8)


def label_trajectory(
    scored_steps: list[ScoredStep],
    judge: LLMJudge,
    *,
    validity_threshold: float = DEFAULT_VALIDITY_THRESHOLD,
    usefulness_threshold: float = DEFAULT_USEFULNESS_THRESHOLD,
) -> list[ScoredStep]:
    """Run Pass A then Pass B; return the same list, mutated."""
    link_fixes(scored_steps, judge, validity_threshold=validity_threshold)
    assign_labels(
        scored_steps,
        validity_threshold=validity_threshold,
        usefulness_threshold=usefulness_threshold,
    )
    return scored_steps
