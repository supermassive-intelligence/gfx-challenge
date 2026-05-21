"""Stage 0: load and normalize an OpenCode session JSON into ordered Steps.

Pure, deterministic, no LLM. See trajectory_pipeline_spec.md sections 2, 4.1, 5
(Stage 0), 9.3 (D13: patch attachment), 9.11 (D21: step-start/step-finish),
9.8 (D18: source_part_id stability).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


StepKind = Literal["user_text", "assistant_text", "action", "tool_result"]
Role = Literal["user", "assistant"]


@dataclass
class Step:
    step_id: int
    source_message_id: str
    source_part_id: str | None
    role: Role
    kind: StepKind
    tool: str | None = None
    args: dict[str, Any] | None = None
    text: str | None = None
    status: str | None = None
    ts: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def _part_ts(part: dict, msg_info: dict) -> int | None:
    t = part.get("time") or {}
    if "start" in t:
        return t["start"]
    if "created" in t:
        return t["created"]
    return (msg_info.get("time") or {}).get("created")


def _tool_state_ts(state: dict, key: str) -> int | None:
    return (state.get("time") or {}).get(key)


def load_session(path: str | Path) -> tuple[dict, list[Step]]:
    """Parse OpenCode session JSON and return ``(info, steps)``.

    ``steps`` is in source order. A ``tool`` part expands to two steps
    (``action`` + ``tool_result``) sharing one ``source_part_id``.
    ``patch`` parts attach to the preceding ``edit``/``write`` action's
    ``metadata['patches']`` (list) and never become Steps. ``step-start``
    and ``step-finish`` parts are ignored on the current fixture; the loader
    walks parts in source order so multi-step messages are handled by that
    ordering alone.
    """
    data = json.loads(Path(path).read_text())
    steps: list[Step] = []
    next_sid = 0
    last_edit_write: Step | None = None

    for msg in data.get("messages", []):
        msg_info = msg.get("info", {})
        msg_id = msg_info.get("id", "")
        role: Role = msg_info.get("role", "user")

        for part in msg.get("parts", []):
            ptype = part.get("type")

            if ptype in ("step-start", "step-finish"):
                continue

            if ptype == "text":
                kind: StepKind = "user_text" if role == "user" else "assistant_text"
                steps.append(
                    Step(
                        step_id=next_sid,
                        source_message_id=msg_id,
                        source_part_id=part.get("id"),
                        role=role,
                        kind=kind,
                        text=part.get("text"),
                        ts=_part_ts(part, msg_info),
                    )
                )
                next_sid += 1
                continue

            if ptype == "tool":
                state = part.get("state", {}) or {}
                tool_name = part.get("tool")
                action_step = Step(
                    step_id=next_sid,
                    source_message_id=msg_id,
                    source_part_id=part.get("id"),
                    role=role,
                    kind="action",
                    tool=tool_name,
                    args=state.get("input"),
                    status=state.get("status"),
                    ts=_tool_state_ts(state, "start"),
                    metadata={"callID": part.get("callID")},
                )
                steps.append(action_step)
                next_sid += 1
                if tool_name in ("edit", "write"):
                    last_edit_write = action_step

                steps.append(
                    Step(
                        step_id=next_sid,
                        source_message_id=msg_id,
                        source_part_id=part.get("id"),
                        role=role,
                        kind="tool_result",
                        text=state.get("output"),
                        status=state.get("status"),
                        ts=_tool_state_ts(state, "end"),
                        metadata={"callID": part.get("callID")},
                    )
                )
                next_sid += 1
                continue

            if ptype == "patch":
                if last_edit_write is not None:
                    last_edit_write.metadata.setdefault("patches", []).append(part)
                continue

            # Unknown part types are ignored; the spec says treat tool names as
            # opaque and not hardcode the set, so the same applies to part types
            # outside the documented set.

    return data.get("info", {}), steps
