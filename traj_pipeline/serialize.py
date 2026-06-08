"""The single swappable action serializer + per-span message renderer.

Spec section 6.2: actions are represented as structured OpenAI ``tool_calls``
inside assistant messages. The model's chat template owns delimiters at
both train and serve time, so there is no hand-authored grammar to switch.
``function.arguments`` is a JSON *string* (per OpenAI spec) with sorted
keys and compact separators so the Phase-1 golden snapshot is byte-stable.

This is the only place the pipeline turns structured spans into wire-format
messages. Everything upstream uses the structured ``tool``+``args`` form.
"""

from __future__ import annotations

import json
from typing import Any

from traj_pipeline.assemble import Span
from traj_pipeline.load import Step


def _arguments_json(args: dict | None) -> str:
    return json.dumps(
        args or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def map_tool_call(step: Step) -> dict[str, Any]:
    """Build the structured ``tool_calls`` entry for an action ``Step``."""
    call_id = (step.metadata or {}).get("callID") or f"call_{step.step_id}"
    return {
        "id": call_id,
        "type": "function",
        "function": {
            "name": step.tool or "",
            "arguments": _arguments_json(step.args),
        },
    }


def span_to_message(span: Span) -> dict[str, Any]:
    """Render one ``Span`` as an OpenAI-compatible chat message."""
    if span.kind == "user":
        return {"role": "user", "content": span.text or ""}
    if span.kind in ("reasoning", "reflection", "answer"):
        return {"role": "assistant", "content": span.text or ""}
    if span.kind == "action":
        call_id = (
            span.provenance.get("call_id")
            or f"call_{span.provenance.get('step_id', '?')}"
        )
        return {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": span.tool or "",
                        "arguments": _arguments_json(span.args),
                    },
                }
            ],
        }
    if span.kind == "tool_result":
        call_id = (
            span.provenance.get("call_id")
            or f"call_{span.provenance.get('step_id', '?')}"
        )
        return {
            "role": "tool",
            "tool_call_id": call_id,
            "content": span.text or "",
        }
    raise ValueError(f"unknown span kind: {span.kind!r}")
