"""Anthropic-backed ``LLMJudge`` + ``ReasoningWriter`` (Phase 2).

Spec section 12.8: temperature 0; cached by sha256 of prompt + model_id +
pipeline_version; default model = a current strong Claude model.

The module is prefixed with an underscore so the top-level ``judge`` and
``reasoning`` modules can re-export the public names while keeping the SDK
import lazy (the package imports cleanly even without ``anthropic``
installed; the real backends only need it when constructed).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from traj_pipeline import PIPELINE_VERSION
from traj_pipeline.cache import LLMCallBudgetExceeded, PromptCache, cache_key
from traj_pipeline.load import Step


DEFAULT_MODEL_ID = "claude-sonnet-4-6"
DEFAULT_CACHE_DIR = Path(".cache/traj_pipeline")


def _summarize_step(step: Step | None, *, max_text: int = 240) -> str:
    """Compact, deterministic single-line rendering for use in prompts.

    Stable across runs (we use this string in the cache key), so prompts
    are reproducible.
    """
    if step is None:
        return "(none)"
    if step.kind == "user_text":
        text = (step.text or "").replace("\n", " ")[:max_text]
        return f"USER: {text}"
    if step.kind == "assistant_text":
        text = (step.text or "").replace("\n", " ")[:max_text]
        return f"ASSISTANT_TEXT: {text}"
    if step.kind == "action":
        args = json.dumps(step.args or {}, sort_keys=True)[:max_text]
        return f"ACTION[{step.tool}]: {args}"
    if step.kind == "tool_result":
        text = (step.text or "").replace("\n", " ")[:max_text]
        return f"TOOL_RESULT[status={step.status}]: {text}"
    return f"{step.kind}"


def _summarize_context(steps: list[Step], *, tail: int = 12) -> str:
    """Take the last ``tail`` steps and join their summaries.

    The bounded window keeps prompts cheap; the head of the trajectory is
    summarized via the ``task_goal`` parameter passed alongside.
    """
    tail_slice = steps[-tail:] if len(steps) > tail else steps
    return "\n".join(_summarize_step(s) for s in tail_slice)


def _summarize_message(msg: dict, *, max_text: int = 400) -> str:
    """One-line rendering of an OpenAI chat message (for re-judge prompts)."""
    role = msg.get("role", "?")
    if msg.get("tool_calls"):
        tc = msg["tool_calls"][0]
        fn = tc.get("function", {})
        args = (fn.get("arguments") or "")[:max_text]
        return f"{role} -> tool_call[{fn.get('name','?')}] {args}"
    if role == "tool":
        text = (msg.get("content") or "")[:max_text]
        return f"tool_result[{msg.get('tool_call_id','?')}]: {text}"
    text = (msg.get("content") or "")[:max_text]
    return f"{role}: {text}"


def _summarize_messages(msgs: list[dict], *, tail: int = 12) -> str:
    tail_slice = msgs[-tail:] if len(msgs) > tail else msgs
    return "\n".join(_summarize_message(m) for m in tail_slice)


def _parse_yes_no(text: str) -> bool:
    head = text.strip().split()[0:1]
    if not head:
        return False
    return head[0].upper().startswith("Y")


def _parse_score(text: str) -> float:
    """Extract a number in [0, 1] from the model's reply (lenient)."""
    import re

    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return 0.5  # neutral fallback when the model refuses to give a number
    v = float(m.group(0))
    if v > 1.0:
        # Allow 0-100 scales just in case.
        v = v / 100.0 if v <= 100.0 else 1.0
    return max(0.0, min(1.0, v))


@dataclass
class _AnthropicBackend:
    """Shared LLM caller -- handles client, cache, circuit breaker.

    Lazily imports ``anthropic`` so importing ``traj_pipeline`` does not
    require the SDK to be installed (mock paths work without it).
    """

    model_id: str = DEFAULT_MODEL_ID
    cache: PromptCache | None = None
    max_calls: int | None = None
    calls_used: int = 0
    _client: Any = None

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        import anthropic  # lazy

        self._client = anthropic.Anthropic()
        return self._client

    def ask(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 256,
    ) -> str:
        payload = {"system": system, "user": user, "max_tokens": max_tokens}
        key = cache_key(payload, self.model_id, PIPELINE_VERSION)
        if self.cache is not None:
            cached = self.cache.get(key)
            if isinstance(cached, str):
                return cached

        if self.max_calls is not None and self.calls_used >= self.max_calls:
            raise LLMCallBudgetExceeded(
                f"max_llm_calls limit reached: {self.max_calls}"
            )

        client = self._ensure_client()
        msg = client.messages.create(
            model=self.model_id,
            max_tokens=max_tokens,
            temperature=0.0,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        # Anthropic SDK returns a list of content blocks; the first is text.
        text = msg.content[0].text  # type: ignore[attr-defined]
        self.calls_used += 1
        if self.cache is not None:
            self.cache.put(key, payload, text)
        return text


@dataclass
class AnthropicLLMJudge:
    """``LLMJudge`` backed by Anthropic. See spec section 5.1 + 12.8."""

    backend: _AnthropicBackend = field(default_factory=_AnthropicBackend)

    # --- helpers -----------------------------------------------------------

    def _ask_bool(self, system_extra: str, user: str) -> bool:
        system = (
            "You are a precise binary classifier for a code-trace analysis "
            "pipeline. Reply with exactly one word: YES or NO. "
            + system_extra
        )
        text = self.backend.ask(system=system, user=user, max_tokens=8)
        return _parse_yes_no(text)

    def _ask_score(self, system_extra: str, user: str) -> float:
        system = (
            "You are a precise scorer for a code-trace analysis pipeline. "
            "Reply with exactly one number between 0.0 and 1.0 (no other text). "
            + system_extra
        )
        text = self.backend.ask(system=system, user=user, max_tokens=16)
        return _parse_score(text)

    # --- LLMJudge interface -----------------------------------------------

    def is_new_task(self, prev_goal: str | None, user_text: str) -> bool:
        if not prev_goal:
            return True
        user = (
            f"Previous task goal:\n{prev_goal}\n\n"
            f"New user message:\n{user_text}\n\n"
            "Is the new user message a NEW task, or a short follow-up that "
            "continues the previous one? Answer YES if it is a new task; NO "
            "if it is a follow-up."
        )
        return self._ask_bool("", user)

    def subgoal_score(
        self,
        task_goal: str,
        step: Step,
        outcome: Step | None,
        lookahead: list[Step],
    ) -> float:
        user = (
            f"Trajectory goal:\n{task_goal}\n\n"
            f"Step under review:\n{_summarize_step(step)}\n\n"
            f"Step's own outcome:\n{_summarize_step(outcome)}\n\n"
            f"Look-ahead (next steps, in order):\n{_summarize_context(lookahead)}\n\n"
            "Score 0.0..1.0 for how much this step's intended effect actually "
            "materialized toward the trajectory goal (0 = no progress / undone; "
            "1 = clearly advanced the goal)."
        )
        return self._ask_score("", user)

    def policy_score(self, step: Step, governing_user_text: str) -> float:
        user = (
            f"Governing user instruction:\n{governing_user_text}\n\n"
            f"Step under review:\n{_summarize_step(step)}\n\n"
            "Score 0.0..1.0 for how well the step respects EXPLICIT constraints "
            "stated in the governing instruction (0 = clear violation; "
            "1 = no violation)."
        )
        return self._ask_score("", user)

    def same_variant(self, goal_a: str, goal_b: str) -> bool:
        user = (
            f"Goal A:\n{goal_a}\n\nGoal B:\n{goal_b}\n\n"
            "Are these two task goals the SAME variant (i.e. would be handled "
            "by structurally identical steps), or DIFFERENT variants (would "
            "require materially different handling)? Answer YES if SAME, NO "
            "if DIFFERENT."
        )
        return self._ask_bool("", user)

    def resolves(
        self,
        buggy_step: Step,
        candidate_fix: Step,
        intervening_steps: list[Step],
    ) -> bool:
        user = (
            f"Buggy step:\n{_summarize_step(buggy_step)}\n\n"
            f"Candidate fix step:\n{_summarize_step(candidate_fix)}\n\n"
            f"Intervening steps:\n{_summarize_context(intervening_steps)}\n\n"
            "Does the candidate-fix step correct or compensate for the bug in "
            "the buggy step? Answer YES if it does, NO otherwise."
        )
        return self._ask_bool("", user)

    def rejudge_example(
        self,
        input_messages: list[dict],
        output_message: dict,
    ) -> bool:
        """Independent quality re-check on a single emitted SFT example.

        Uses a different prompt template from any scoring call, so the
        cache will not collide with scoring entries and disagreement
        signals are real. Returns True if the re-judge agrees that the
        output is a reasonable training example.
        """
        ctx = _summarize_messages(input_messages)
        out = _summarize_message(output_message)
        user = (
            "You are independently auditing a single training example for an "
            "agentic-coding fine-tuning pipeline.\n\n"
            f"Conversation context so far:\n{ctx}\n\n"
            f"Proposed assistant message to train on:\n{out}\n\n"
            "Is this a reasonable training example -- i.e. would a strong "
            "agent produce this response in this context, and does it "
            "represent desirable behavior we want the trained model to "
            "imitate? Answer YES if yes, NO if you would flag it for review."
        )
        return self._ask_bool("", user)


@dataclass
class AnthropicReasoningWriter:
    """``ReasoningWriter`` backed by Anthropic.

    ``reason`` receives ONLY the prior context (no hindsight) -- the caller
    in ``backfill.py`` is responsible for slicing accordingly. This class
    just renders the call.
    """

    backend: _AnthropicBackend = field(default_factory=_AnthropicBackend)

    def reason(self, context: list[Step], action: Step) -> str:
        system = (
            "Write a brief good-faith reasoning span (1-3 sentences) describing "
            "the agent's intent BEFORE performing the action. Do NOT use "
            "hindsight; do NOT refer to outcomes; do NOT criticize. Read as "
            "plausible 'think then plan then act' prose."
        )
        user = (
            f"Recent context (steps so far):\n{_summarize_context(context)}\n\n"
            f"About to perform:\n{_summarize_step(action)}\n\n"
            "Reasoning:"
        )
        text = self.backend.ask(system=system, user=user, max_tokens=300)
        return text.strip()

    def reflect(
        self,
        buggy_action: Step,
        tool_result: Step | None,
        corrective_action: Step,
    ) -> str:
        system = (
            "Write a brief reflection (1-3 sentences) that NAMES the failure "
            "mode of the buggy step and explains why the corrective step "
            "addresses it. Be concrete; avoid generic phrasing."
        )
        user = (
            f"Buggy action:\n{_summarize_step(buggy_action)}\n\n"
            f"Tool result of the buggy action:\n{_summarize_step(tool_result)}\n\n"
            f"Corrective action:\n{_summarize_step(corrective_action)}\n\n"
            "Reflection:"
        )
        text = self.backend.ask(system=system, user=user, max_tokens=300)
        return text.strip()
