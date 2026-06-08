"""Deterministic signal extractors used by Stage 2 scoring.

All functions are pure and domain-agnostic. Spec references: section 5 Stage 2,
section 12.1 (axis values), section 12.9 (empty stdout not an error),
section 11.3 (governing_user_text), section 11.4 (verifier_delta encoding),
section 11.5 (is_verifier_event seed list).
"""

from __future__ import annotations

import re

from traj_pipeline.load import Step

# Generic error markers; not domain-specific. Looked up in tool_result text.
ERROR_MARKERS: tuple[str, ...] = (
    "traceback",
    "command not found",
    "no such file",
    "no such directory",
    "permission denied",
    "syntaxerror",
    "syntax error",
    "fatal:",
    "error:",
)

# Section 11.5 seed patterns for verifier events (bash commands by first verb).
DEFAULT_VERIFIER_PATTERNS: tuple[str, ...] = (
    "pytest",
    "python -m pytest",
    "unittest",
    "eslint",
    "lint",
    "ruff",
    "mypy",
    "tsc",
    "make",
    "cargo",
    "go test",
    "npm test",
    "npm run",
    "curl",
    "wget",
    "git diff",
    "git status",
)


_NEGATION_RE = re.compile(r"\b(?:do\s+not|don'?t)\s+(\w+)", re.IGNORECASE)


# Tools to which a forbidden verb in the governing user_text maps. Per
# spec section 12.1, only verbs that *cleanly* map to a real tool name
# trigger the deterministic flag; ambiguous verbs ("run the disassembly")
# fall through to the LLM via ``policy_score``.
_VERB_TO_TOOL: dict[str, set[str]] = {
    "edit": {"edit"},
    "modify": {"edit"},
    "change": {"edit"},
    "write": {"write"},
    "create": {"write"},
    "read": {"read"},
    "open": {"read"},
}


# Patterns that bound the number of <tool> calls in a governed segment.
# Each entry is ``(regex, limit, tool_group_idx)`` -- ``limit`` is the
# maximum allowed count, ``tool_group_idx`` selects the regex group whose
# value is the tool name (case-insensitive). A constraint phrase that
# names a non-tool noun ("single script", "exactly one band") is *not*
# matched by these patterns and is left to ``LLMJudge.policy_score``.
_TOOL_TOKEN_RE = r"(?:edit|write|bash|read|tool)"
_COUNT_PATTERNS: tuple[tuple[re.Pattern[str], int], ...] = (
    (re.compile(rf"\bsingle\s+({_TOOL_TOKEN_RE})(?:\s+call)?\b", re.IGNORECASE), 1),
    (
        re.compile(
            rf"\bexactly\s+one\s+({_TOOL_TOKEN_RE})(?:\s+call)?\b", re.IGNORECASE
        ),
        1,
    ),
    (re.compile(rf"\bonly\s+one\s+({_TOOL_TOKEN_RE})(?:\s+call)?\b", re.IGNORECASE), 1),
)


def _matched_tools_with_limits(text: str) -> list[tuple[str, int]]:
    """Return ``(tool_name_lowercase, max_allowed)`` pairs detected in ``text``.

    Empty list when no count-bounded constraint is matched.
    """
    out: list[tuple[str, int]] = []
    for pattern, limit in _COUNT_PATTERNS:
        for m in pattern.finditer(text):
            tool_name = m.group(1).lower()
            # ``tool`` is a wildcard meaning "any one tool call in the segment".
            out.append((tool_name, limit))
    return out


def _has_error_markers(text: str | None) -> bool:
    if not text:
        # Section 12.9: empty output is not an error.
        return False
    lowered = text.lower()
    return any(marker in lowered for marker in ERROR_MARKERS)


def _own_tool_result(step: Step, following: list[Step]) -> Step | None:
    """The immediately-following tool_result that shares ``source_part_id``.

    Per spec section 9.4 (D14), this is part of the action's *own outcome* and
    is allowed in the local-validity pass.
    """
    if not following:
        return None
    nxt = following[0]
    if nxt.kind == "tool_result" and nxt.source_part_id == step.source_part_id:
        return nxt
    return None


def syntactic(step: Step, following: list[Step]) -> float:
    """Deterministic syntactic / structural validity (section 12.1).

    Returns ``1.0`` for text steps (no tool to fail) and for actions with no
    detected error indicator; ``0.0`` for tool failures, error markers in the
    own tool_result, or an ``edit`` with no patch attached (claimed change but
    no diff, section 12.1).
    """
    if step.kind in ("user_text", "assistant_text"):
        return 1.0
    if step.kind == "tool_result":
        # tool_result steps are scored as part of the action's own outcome,
        # not in their own right.
        return 1.0
    if step.kind != "action":
        return 1.0

    # Tool status.
    if step.status and step.status not in ("completed", "success"):
        return 0.0

    # Error markers in the action's own tool_result.
    own = _own_tool_result(step, following)
    if own is not None and _has_error_markers(own.text):
        return 0.0

    # "Claimed change but empty diff" (section 12.1): only flag the no-op
    # case where the edit's oldString and newString are identical. Patch-part
    # presence is not a reliable signal here -- the OpenCode export ships a
    # patch metadata blob (hash + file list) without diff text, and many
    # successful edits in the fixture lack a patch part for what appear to
    # be export quirks, not because the edit was empty. The unpersisted-edit
    # case (episode 3) that this used to catch needs a read-back diff
    # comparison the JSON alone cannot provide; that is deferred.
    if step.tool == "edit":
        args = step.args or {}
        old_s = args.get("oldString")
        new_s = args.get("newString")
        if (
            isinstance(old_s, str)
            and isinstance(new_s, str)
            and old_s == new_s
            and old_s != ""
        ):
            return 0.0

    return 1.0


def constraint_violations(
    step: Step,
    governing_user_text: str,
    governed_actions: list[Step] | None = None,
) -> list[str]:
    """Confirmed-only deterministic policy detector (spec section 9.7 / 12.1).

    Returns a non-empty list **only when this specific action confirmably
    violates a constraint** -- never on mere phrase presence. Two cases:

    1. **Forbidden verb performed.** ``do NOT <verb>`` / ``don't <verb>``
       in the governing text where ``<verb>`` maps to a real tool name
       (``edit``, ``write``, ``read`` -- the verbs that have an
       unambiguous tool mapping) and this action's tool *is* that tool.
       Ambiguous verbs ("run the disassembly", "implement", ...) do not
       map and are deferred to the LLM via ``policy_score``.

    2. **Count-bounded constraint exceeded.** A phrase like "single Edit
       call" / "exactly one Bash call" / "only one Write call" appears
       in the governing text *and* this action is the
       offending occurrence -- the (N+1)-th instance of the named tool
       within ``governed_actions``. Neighbors that are different tools
       are never flagged.

    Phrase-only patterns ("single script", "exactly one band higher")
    are intentionally NOT matched here -- they are semantic and require
    ``LLMJudge.policy_score``.

    ``governed_actions`` is the ordered list of action steps in the same
    governed segment (from the governing user_text to the next user_text);
    callers pass an empty list or ``None`` when there is no segment context
    (degrades count detection but keeps the forbidden-verb case working).
    """
    if step.kind not in ("action", "assistant_text", "answer"):
        return []
    if not governing_user_text:
        return []

    violations: list[str] = []

    # (1) Forbidden-verb performed: only when the negated verb maps cleanly
    # to a tool name and this action's tool is that tool.
    if step.kind == "action" and step.tool is not None:
        for match in _NEGATION_RE.finditer(governing_user_text):
            verb = match.group(1).lower()
            forbidden_tools = _VERB_TO_TOOL.get(verb)
            if forbidden_tools and step.tool in forbidden_tools:
                violations.append(
                    f"governing message says 'do not {verb}' but step performs tool '{step.tool}'"
                )

    # (2) Count-bounded constraint exceeded: only when this action is the
    # offending occurrence.
    if step.kind == "action" and step.tool is not None and governed_actions:
        constraints = _matched_tools_with_limits(governing_user_text)
        for constraint_tool, limit in constraints:
            # Count occurrences of the constraint's tool (or any tool if the
            # phrase used the wildcard "tool") in the governed segment up to
            # and including this step.
            count = 0
            for s in governed_actions:
                if s.kind != "action" or s.tool is None:
                    continue
                if constraint_tool != "tool" and s.tool != constraint_tool:
                    continue
                if s.step_id <= step.step_id:
                    count += 1
                if s.step_id == step.step_id:
                    if count > limit:
                        violations.append(
                            f"governing message limits {constraint_tool} calls to {limit}; "
                            f"this is occurrence {count}"
                        )
                    break

    return violations


def is_verifier_event(
    step: Step,
    trajectory_steps: list[Step] | None = None,
    patterns: tuple[str, ...] = DEFAULT_VERIFIER_PATTERNS,
) -> bool:
    """Section 11.5 starter heuristic.

    Recognizes ``bash`` commands beginning with known verifier verbs, plus a
    ``read`` step whose target file was edited earlier in the same
    trajectory. Approximate; false negatives degrade gracefully.
    """
    if step.kind != "action":
        return False

    if step.tool == "bash":
        cmd = ((step.args or {}).get("command") or "").strip()
        cmd_lower = cmd.lower()
        return any(cmd_lower.startswith(pat) for pat in patterns)

    if step.tool == "read":
        if trajectory_steps is None:
            return False
        target = (step.args or {}).get("filePath") or (step.args or {}).get("path")
        if not target:
            return False
        for s in trajectory_steps:
            if s.step_id >= step.step_id:
                break
            if s.kind == "action" and s.tool in ("edit", "write"):
                edited = (s.args or {}).get("filePath") or (s.args or {}).get("path")
                if edited == target:
                    return True
        return False

    return False


def verifier_delta(step: Step, following: list[Step]) -> int | None:
    """Section 11.4 encoding: +1 / -1 / 0 / None.

    Phase-1 stub -- returns ``None`` (no verifier signal). Refining the delta
    requires cross-step state tracking (compare error counts against the most
    recent prior verifier event); deferred until Stage 3 demonstrates a need.
    The Phase-1 fallback in Stage 3 is the same-target heuristic plus the
    ``LLMJudge.resolves`` backstop, which is sufficient under the mock.
    """
    if not is_verifier_event(step):
        return None
    return 0


def governed_actions(step: Step, trajectory_steps: list[Step]) -> list[Step]:
    """Action steps in the same governed segment as ``step`` (spec section 12.1).

    The governed segment runs from the most-recent ``user_text`` strictly
    before ``step`` up to (but not including) the next ``user_text`` strictly
    after the segment-opening user_text. Includes ``step`` itself if it is
    an action. Crosses assistant message boundaries -- the segment is not
    the "current turn" but the entire span of actions under one user
    instruction.
    """
    # Locate the segment-opening user_text and the step's index in the
    # trajectory.
    govern_idx = -1
    step_idx = -1
    for i, s in enumerate(trajectory_steps):
        if s.step_id == step.step_id:
            step_idx = i
            break
        if s.kind == "user_text":
            govern_idx = i
    if step_idx < 0:
        # ``step`` is not in this trajectory; nothing to govern.
        return []

    # Locate the next user_text after the segment opener (or after the
    # step itself if no segment opener exists in the trajectory).
    segment_start = govern_idx + 1
    segment_end = len(trajectory_steps)
    for i in range(max(step_idx, segment_start) + 1, len(trajectory_steps)):
        if trajectory_steps[i].kind == "user_text":
            segment_end = i
            break

    return [
        s for s in trajectory_steps[segment_start:segment_end] if s.kind == "action"
    ]


def governing_user_text(
    step: Step, trajectory_steps: list[Step], task_goal: str
) -> str:
    """Most recent ``user_text`` step in trajectory before ``step`` (section 11.3).

    Falls back to ``task_goal`` if no preceding user_text exists (should not
    happen post-segmentation but kept as a safety net).
    """
    last: str | None = None
    for s in trajectory_steps:
        if s.step_id >= step.step_id:
            break
        if s.kind == "user_text":
            last = s.text or ""
    return last if last is not None else task_goal
