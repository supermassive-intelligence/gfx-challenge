"""``ReasoningWriter`` protocol + Phase-1 deterministic mock.

Real (Anthropic-backed) impl is deferred to Phase 2. The mock returns
template strings keyed by ``source_part_id`` so the Phase-1 golden
snapshot is reproducible (spec section 12.11).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from traj_pipeline.load import Step


class ReasoningWriter(Protocol):
    def reason(self, context: list[Step], action: Step) -> str: ...

    def reflect(
        self,
        buggy_action: Step,
        tool_result: Step | None,
        corrective_action: Step,
    ) -> str: ...


@dataclass
class MockReasoningWriter:
    """Section 12.11 deterministic mock.

    ``reason`` does NOT see ``action.metadata`` or anything beyond the
    action; ``context`` is the list of preceding steps the caller passes
    (must not include hindsight). The template just records the part id so
    the golden snapshot is byte-stable.
    """

    def reason(self, context: list[Step], action: Step) -> str:
        return f"[reasoning:{action.source_part_id}]"

    def reflect(
        self,
        buggy_action: Step,
        tool_result: Step | None,
        corrective_action: Step,
    ) -> str:
        return f"[reflection:{corrective_action.source_part_id}]"
