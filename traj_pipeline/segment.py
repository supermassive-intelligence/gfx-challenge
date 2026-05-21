"""Stage 1: segment the flat Step list into single-task trajectories.

Every ``user_text`` is a candidate boundary; the judge decides via
``is_new_task(prev_goal, user_text)`` whether to start a new trajectory or
merge as a follow-up. Non-user_text steps always append to the current
trajectory. Spec references: section 5 Stage 1, section 12.11.

Under ``--no-llm`` the section 12.11 mock returns ``False`` for every
``is_new_task`` call except when ``prev_goal`` is empty/None. Combined with
the natural-segmentation algorithm below this produces **exactly one
trajectory** on the fixture: the first user_text creates the initial
trajectory; every subsequent user_text merges into it. (Section 5 Stage 1
also states "yields exactly 2 trajectories" -- that line is inconsistent with
the literal section 12.11 contract; the implementation follows section 12.11
since the user marked it authoritative.)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from traj_pipeline.judge import LLMJudge
from traj_pipeline.load import Step


@dataclass
class Trajectory:
    """Spec section 4.3. ``steps`` here is the segmenter output; later stages
    add scoring, labels, and (in Stage 6) ``spans``.
    """

    task_goal: str
    steps: list[Step] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


def segment(steps: list[Step], judge: LLMJudge) -> list[Trajectory]:
    """Split steps into a list of trajectories in source order."""
    trajectories: list[Trajectory] = []
    current: Trajectory | None = None
    prev_goal: str | None = None

    for s in steps:
        if s.kind == "user_text":
            text = s.text or ""
            if judge.is_new_task(prev_goal, text):
                if current is not None:
                    trajectories.append(current)
                current = Trajectory(task_goal=text, steps=[s])
                prev_goal = text
            else:
                # Follow-up: merge into the current trajectory. prev_goal
                # stays anchored to the current trajectory's task_goal so a
                # subsequent decision still compares against the goal-
                # introducing user_text, not the latest follow-up.
                assert current is not None, (
                    "is_new_task=False with no prior trajectory; the mock"
                    " contract guarantees True when prev_goal is None"
                )
                current.steps.append(s)
        else:
            if current is None:
                # No user_text has opened a trajectory yet. The fixture starts
                # with a user_text so this branch is unused there, but it
                # keeps the segmenter total over malformed inputs.
                continue
            current.steps.append(s)

    if current is not None:
        trajectories.append(current)

    return trajectories
