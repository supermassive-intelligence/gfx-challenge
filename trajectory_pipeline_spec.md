# Trajectory-to-Training-Data Pipeline — Implementation Spec

**Status:** spec for code generation (Claude Code consumes this; do not treat as final code).
**Project root / working directory:** `/Users/sudnya/checkout/smi/gfx-challenge`. Claude Code runs from here; **all relative paths in this spec are relative to this directory**, and all code, tests, and outputs live under it.
**Purpose:** Convert a raw agentic-coding session log (OpenCode-style JSON) into post-training data, following the methodology in *Converting Agentic Coding Trajectories into Post-Training Data*. The source session is the **ground truth**; the PDF is the **methodology**.

**Inputs expected in the project root:** place the source session JSON at `./berzerk-guided-rubric.json` (also copied to `./tests/fixtures/` for tests). Outputs are written under `./out/` by default.

> **Hard constraint — domain-agnostic.** Nothing in this pipeline may key off "berzerk," "checker.py," game rubrics, ROMs, or any task-specific string. Every stage operates on *generic* trajectory signals so it works equally for a game, an analytics dashboard, a CLI tool, or any executable program. The berzerk session is only the first test fixture.

---

## 1. Goal and headline decisions

Train a smaller agent (the source model in the fixture is `nvidia/Gemma-4-31B-IT-NVFP4`) to accomplish the same work in **fewer turns and with fewer mistakes, while still learning to recover from mistakes**. We therefore do **not** scrub errors — we preserve and *restructure* error/recovery episodes, and we compress redundancy and dead-end flailing.

Decisions locked with the user (encode these as defaults):

| # | Decision | Value |
|---|----------|-------|
| D1 | Source of truth | the session JSON; PDF = methodology only |
| D2 | Scoring unit | **step-level** (one user text, one assistant text, or one tool call), not message-level |
| D3 | Look-ahead horizon | **end-of-session** for small traces; parameterized (`task-boundary` \| `end-of-session` \| integer window). Default `end-of-session`. |
| D4 | Two scores per step | `local_validity` (causal, no future) **and** `retrospective_usefulness` (full look-ahead) — kept separate to avoid hindsight leakage |
| D5 | Compression ≠ deletion | preserve `reason → buggy action → tool_result → reflection → corrective action`; drop only redundant repetition and non-contributing dead-ends |
| D6 | Redundancy collapse granularity | collapse repeated **successful** subtasks to **one exemplar per distinct variant** |
| D7 | Reasoning backfill | synthetic, plausible, authored by a strong model; pre-action reasoning is good-faith (never omniscient); the **reflection that names a failure goes _after_ the failing tool_result**, before the correction |
| D8 | Output format | **JSONL; one example per `loss_mask==1` span; `{"input": [OpenAI-compatible messages, no loss], "output": <trained assistant message, loss-only>}`.** Loss is on `output` only (framework fact); partial masking is by construction — masked spans live only in `input`. Context always included (no `include_context` flag). See §3.1. |
| D9 | Secondary output | DPO preference pairs (chosen = corrective action, rejected = buggy action, shared prefix) — emitted when `--emit` includes `dpo` |
| D10 | "explain Berzerk"-type no-tool opening turns | **in scope** (kept as a trajectory) |
| D11 | Terminal natural-language output | new span kind **`answer`** (distinct from `reasoning`), `loss_mask=1`, emitted as **one** span for the whole answer (no paragraph chunking). Covers no-tool turns and post-tool summaries. See §9.1. |
| D12 | DPO granularity per episode | default **`canonical`** — one pair: `chosen` = corrective fix, `rejected` = the buggy step the reflection actually critiques (the one linked by `resolves_step_id`). Config `dpo_granularity: canonical\|all\|first\|last`. See §9.2. |
| D13 | `patch` parts | not their own `Step`; **attach to the preceding `edit`/`write` action's metadata** so the "claimed change but empty diff" signal can read them. See §9.3. |
| D14 | Action's "own outcome" vs "future" | an action's own outcome = `{status, the tool_result it produced, the patch it produced}` and is usable by `local_validity`. Anything emitted by a **later, separate step** (a subsequent action, user message, or verifier run) is "future" and feeds only `retrospective_usefulness`. See §9.4. |
| D15 | `resolves_step_id` linking | heuristic first (same target / verifier-improved), with **`LLMJudge.resolves(...)`** as backstop when the heuristic is ambiguous. See §9.5. |
| D16 | Pre-buggy-action reasoning | reasoning preceding an `error_recovery_buggy` action is always `loss_mask=0` — it appears only in `input` context, never as a trained `output` — so we never train good-faith reasoning that leads to a masked bad action. (Unconditional now that context is always emitted; §3.1.) See §9.6. |
| D17 | Policy detector (revised) | deterministic detector fires **only on confirmed tool-call-count violations**, flagging just the offending action — never on mere constraint-phrase presence (the round-3 false-positive bug). Semantic violations go to `LLMJudge.policy_score`, which enters the gate via `policy_gate` (§12.2). Under `--no-llm`, semantic violations uncaught → `policy_axis_approximate: true`. See §9.7. |
| D18 | Acceptance-test keys | key assertions by **`(source_part_id, kind)`** (OpenCode-assigned, stable across Stage-0 tweaks), never by `step_id`. See §9.8. |
| D19 | Bash redundancy signature | signature = first verb (`wc`,`sed`,`python`,`apt`,`git`,…) + structural flags (pipes/redirects/subshell). Conservative; **under-collapse is the safe failure direction**. See §9.9. |
| D20 | LLM cost circuit breaker | `max_llm_calls` config aborts a run that exceeds the budget. Full uncached run ≈400 calls (~$1–3); cached re-runs free. See §9.10. |
| D21 | `step-start`/`step-finish` | Stage 0 must **use them to delimit assistant sub-turns when a message has more than one**; do not assume one step per message. Redundant (ignorable) on the current single-step fixture. See §9.11. |
| D22 | Reasoning style is Claude's, not Gemma's | acknowledged property, not a bug (STaR: structure transfers). Config `reasoning_writer_model` (default a strong model) can be switched to a same-family model if reasoning-style match to the deployment harness is later required. See §9.12. |

---

## 2. Input format (OpenCode session JSON)

Top-level object with `info` and `messages`. Each message: `{ "info": {role, time, ...}, "parts": [...] }`.

Relevant part types observed:
- `text` — natural-language content (`part.text`).
- `step-start` / `step-finish` — turn delimiters (metadata only).
- `tool` — a tool call: `part.tool` ∈ {`bash`,`read`,`write`,`edit`,…}; `part.state` has `status`, `input` (tool args), `output` (tool result string), `metadata`, `time`.
- `patch` — file diffs (metadata; can be used as a corroborating signal).

The implementation must **not** hardcode the tool set; treat tool names as opaque and rely on generic per-tool adapters (see §5.1).

---

## 3. Output formats

### 3.1 Primary: SFT JSONL (D8)

**Training-framework fact (authoritative):** the target framework computes **loss on the `output` only; nothing else carries loss.** Partial masking is therefore achieved **by construction**, not by per-message flags: anything we want conditioned-on-but-not-trained simply lives in the context (`input`) and never appears as an `output`.

One file, `sft.jsonl`. For **every span with `loss_mask == 1`**, write exactly one example:
```json
{"input": [ <prior context as OpenAI-compatible messages> ],
 "output": <the trained span as a single assistant message>}
```
- `input` = the full preceding trajectory context as OpenAI-compatible messages (`system`/`user`/`assistant`/`tool`), **including** the masked items (`loss_mask==0` buggy actions, tool results, user turns, prior reasoning). These carry no loss.
- `output` = the one span being trained: `reasoning`/`reflection`/`answer` → an assistant message with `content` prose; an `action` → an assistant message carrying a structured `tool_calls` entry (so the model's own chat template owns the delimiters — see §6.2).
- A `loss_mask==0` span is **never** an `output`; it appears only inside some later example's `input`. This is exactly how the buggy action is conditioned-on without being reinforced.

This supersedes the earlier "single `output` field, no context" sketch: because loss is output-only, including the context is free (it is never trained) and is required for the model to learn to produce the next step *given the trajectory*. The old `include_context` flag is therefore removed — context is always emitted.

### 3.2 Secondary: DPO JSONL (D9, D12, optional)
`dpo.jsonl`, by default **one line per error/recovery episode** (`dpo_granularity=canonical`):
```json
{"prompt": [ <shared context messages up to the decision point> ],
 "chosen":  <corrective action as an assistant message>,
 "rejected": <buggy action as an assistant message>}
```
`prompt` is the same OpenAI-compatible message list used for `input` in §3.1; `chosen`/`rejected` are assistant messages that share that identical prefix and differ only at the action (§12.6).
The `rejected` is the **canonical** buggy action — the step the episode's reflection actually critiques, i.e. the one linked to the fix via `resolves_step_id` (usually the last buggy attempt before the fix). `dpo_granularity` may be set to `all` (one pair per buggy attempt, all sharing the same `chosen`), `first`, or `last`. `chosen`/`rejected` must use the identical action serializer (§6.2).

### 3.3 Debug artifact (always)
`trajectories.json` — the full intermediate representation (all spans, both scores, labels, loss_masks, and provenance back to source message/part IDs) for inspection and for the verification stage (§7).

---

## 4. Intermediate representation

### 4.1 Normalized step
```
Step {
  step_id: int                 # global order
  source_message_id: str
  source_part_id: str | null
  role: "user" | "assistant"
  kind: "user_text" | "assistant_text" | "action" | "tool_result"
  tool: str | null             # for actions
  args: dict | null            # for actions
  text: str | null             # for text/tool_result
  status: str | null           # tool status
  ts: int | null
}
```
Flatten `messages[].parts[]` in order. A `tool` part expands to **two** steps: an `action` step (args) and a `tool_result` step (its `state.output`). `step-start`/`step-finish` are dropped after being used to delimit assistant turns.

### 4.2 Scored step (adds Pass-1 output)
```
local_validity: float in [0,1]            # causal, no future
retrospective_usefulness: float in [0,1]  # full look-ahead
axes: { syntactic: float, subgoal: float, policy: float }  # the 3 rubric axes
label: enum (see §5.3)
resolves_step_id: int | null  # for a corrective action, the buggy step it repairs
```

### 4.3 Span (emitted trajectory unit)
```
Span {
  kind: "user" | "reasoning" | "action" | "tool_result" | "reflection" | "answer"
  text: str | null
  tool: str | null
  args: dict | null
  loss_mask: 0 | 1
  weight: float        # = retrospective quality weight; multiplies loss for soft weighting
  provenance: {step_id | "synthetic"}
}
```
A **Trajectory** is `{ task_goal: str, spans: [Span], meta: {...} }`.

---

## 5. Stages

### Stage 0 — Load & normalize
Parse JSON → ordered `List[Step]` per §4.1. Pure, deterministic, no LLM.
- **`patch` parts (D13):** do **not** create a `Step`. Attach each `patch` to the preceding `edit`/`write` action's `metadata` (e.g. `step.metadata["patch"]`) so the syntactic signal "claimed a change but the diff is empty" can read it directly off the action.
- **`step-start`/`step-finish` (D21):** use them to delimit assistant **sub-turns** when a single message contains more than one. Do **not** assume one step per message. On the current fixture each assistant message has exactly one start/finish pair, so they are redundant here — but the loader must handle multi-step messages from other OpenCode sessions.
- Preserve `source_part_id` on every `Step`; it is the stable key for acceptance tests (D18).

### Stage 1 — Segment into single-task trajectories
Goal: split the session at task boundaries (PDF: "focused single-task trajectories").
- **Candidate boundaries:** every `user_text` step is a candidate new task.
- **Merge follow-ups:** short imperative follow-ups that continue the same goal ("run it", "check now", "have you applied the fix?") must merge into the parent task rather than starting a new one. Decide via the `LLMJudge.is_new_task(prev_goal, user_text)` call. Under `--no-llm` this is the **§12.11 mock** (`is_new_task=False` unless `prev_goal` is empty) — **authoritative**, and on the fixture it yields exactly **2 trajectories** (the opener + one combined trajectory). There is no separate token-length heuristic; the mock is the single `--no-llm` segmentation path.
- Each trajectory records `task_goal` = the goal-introducing user text (verbatim).
- No-tool trajectories (e.g., an "explain X" opening turn) are valid trajectories (D10).

### Stage 2 — Step scoring (Pass 1)
For each **assistant** step compute the three rubric axes from the PDF:

1. **Syntactic / structural validity** — *deterministic*. Did the tool call parse and execute without error? Signals (generic): tool `status`, presence of error markers in the result (`error`, `No such file`, `command not found`, non-zero exit, traceback), an `edit`/`write` that produced an **empty subsequent diff** when a change was claimed, etc. Implement as `signals.syntactic(step, following_steps)`.
2. **Subgoal achievement** — *LLM judge with look-ahead*. `LLMJudge.subgoal_score(task_goal, step, outcome, lookahead_window)`. The judge may read forward to the horizon (D3) to see whether the step's intended effect actually materialized.
3. **Policy / instruction consistency** — *hybrid*. Deterministic checks for explicit user constraints expressed in the immediately governing user message (e.g., "exactly one X", "single call", "do NOT edit yet"); generalized as `signals.constraint_violations(step, governing_user_text)` plus `LLMJudge.policy_score(...)`. (This is what catches the "jumped two bands instead of one" and "edited when told to wait" classes — expressed generically as *violated an explicit user constraint*, never as a game rule.)

Combine into:
- `local_validity` = function of (syntactic, policy) **using only the action's own outcome and prior context**. **No-future boundary (D14):** an action's *own outcome* = `{its status, the tool_result it produced, the patch it produced}` and **is** allowed in the local pass. Anything emitted by a **later, separate step** — a subsequent action, a later user message, or a later verifier run — is "future" and must **not** enter `local_validity`. (So "edit produced an empty diff" is local, because the patch is the action's own outcome; "a `ls`/test run two steps later disagreed" is future.)
- `retrospective_usefulness` = function of (subgoal, downstream resolution) **with full look-ahead** to the horizon.

This two-score separation (D4) is mandatory: a step may be `local_validity` high but `retrospective_usefulness` low (it was reasonable given stale information that was only corrected later) — that step is **kept and not penalized**.

**Policy axis under `--no-llm` (D17):** the deterministic detector is a regex set for explicit-constraint phrasings (`exactly one`, `single …`, `only`, numeric limits) plus a negation detector (`do NOT`, `do not`, `don't`). It will under-flag paraphrases; `LLMJudge.policy_score` covers the rest. When running `--no-llm`, set `policy_axis_approximate: true` in `verification_report.json` so downstream consumers know the policy axis is approximate.

### Stage 3 — Episode labeling
**Two ordered passes (required):**
- **Pass A — link fixes:** for every candidate corrective action, find its canonical buggy step (heuristic + `LLMJudge.resolves` backstop, §9.5/§11.2) and set `fix.resolves_step_id`. This must run **before** Pass B so `has_fix`/`is_fix` are defined.
- **Pass B — assign labels:** run the deterministic label algorithm in §12.3.

In an episode with multiple failed attempts, exactly one buggy step is linked to the fix (§12.7); the other unlinked failed attempts fall through to `dead_end` and are removed only by aggressive failure-compression (conservative keeps them).

Label values:
- `clean_success` — valid and useful.
- `stale_info` — `local_validity` high, `retrospective_usefulness` low, *not* a reasoning error (e.g., acted on a path the user later corrected). **Keep, full weight, do not mask the action.**
- `error_recovery_buggy` — locally invalid action that is later repaired. Link to its repair via `resolves_step_id` (D15): **heuristic first** — scan forward within horizon for an action with the same target (file/tool) or for a `verifier_delta` that improves — and fall back to **`LLMJudge.resolves(buggy_step, candidate_fix, intervening_steps)`** when the heuristic is ambiguous (e.g. a `bash`/`sed` edit repairing an `edit`-tool change). Cross-tool repairs are exactly why the heuristic alone is insufficient.
- `error_recovery_fix` — the corrective action.
- `dead_end` — failed/no-progress step that neither resolves nor is required to set up the eventual fix. **Compression candidate.**
- `redundant` — a step belonging to a repeated successful subtask group (Stage 4 fills group membership).

### Stage 4 — Compression (D5, D6)
Two **orthogonal** operations:

1. **Redundancy compression.** Detect groups of repeated *successful* subtasks (similar action templates against structurally similar `task_goal`s — compare normalized action sequences / tool-arg shapes, not domain text). Keep **one exemplar per distinct variant**, drop the rest. *Distinct variant* is determined by materially different handling, detected via `LLMJudge.same_variant(goal_a, goal_b)` or a structural signature; e.g., in the fixture the program-ROM surveys and the voice/sample-ROM surveys are different variants → keep one of each. **Action-template signature (D19):** for `read`/`write`/`edit` use `tool + file-extension class`; for `bash` use `first verb (wc, sed, python, apt, git, …) + structural flags (pipes / redirects / subshell)`. This is deliberately conservative — two bash sequences with different verbs will **not** collapse — and **under-collapse is the safe failure direction** (better to keep a near-duplicate than to wrongly merge two distinct steps). Controlled by `--redundancy {off|collapse}` (default `collapse`).
2. **Failure compression.** Within an `error_recovery` episode, retain the canonical chain `reason → buggy action → tool_result → reflection → corrective action`; drop intervening `dead_end` steps that add no diagnostic value. Controlled by `--failure-compression {off|conservative|aggressive}` (default `conservative`).

> Redundancy compression operates only on clean successes and therefore never reduces failure-compression opportunities — they touch disjoint regions of the trace.

### Stage 5 — Reasoning backfill (D7)
For each **kept** trajectory:
- Insert a `reasoning` span before every kept `action`. `ReasoningWriter.reason(context_up_to_action, action)` → plausible "think → plan → anticipate → act" prose. **No hindsight**: it must read as good-faith intent, even before a buggy action.
- After every failing `tool_result` that is followed by a corrective action, insert a `reflection` span: `ReasoningWriter.reflect(buggy_action, tool_result, corrective_action)` → names the failure mode and the fix rationale.
- Reasoning is synthetic; it is **not** a reconstruction of the source model's thoughts (acceptable per STaR / "structure not content").
- **Known property (D22):** because a strong model writes these blocks, the SFT data pairs **the writer model's reasoning style with Gemma-style actions**. We are not distilling Gemma's reasoning — we are teaching a new model that reasoning *shape* plus those actions. This is intended (STaR shows shape transfers), but be clear-eyed: the deployed model will think in the writer's prose style. If matching the deployment harness's native reasoning style ever becomes a requirement, set `reasoning_writer_model` to a same-family model. The writer model id is recorded in `trajectories.json.meta`.

### Stage 6 — Assemble spans & loss masks
Build `Span`s per trajectory and assign `loss_mask`:

| Span kind | loss_mask | Rationale |
|-----------|-----------|-----------|
| `user` | 0 | context only |
| `tool_result` | 0 | context only |
| `reasoning` (pre-action) | 1 | teach think-then-act shape |
| `reasoning` (pre-`error_recovery_buggy`) | **0 (always)** (D16) | emitted only in `input` context, never trained — don't reinforce good-faith reasoning that leads to a masked bad action |
| `reflection` (post-error) | 1 | teach diagnosis/recovery |
| `answer` (terminal NL output) (D11) | **conditional — see §12.5** | kept (`1`) only if it clears `validity_threshold`; a flagged misstep → `0`; emitted as one span; `answer_weight` down-weights; trivial confirmations < `min_answer_chars` dropped |
| `action` — clean / corrective / stale_info | 1 | desired behavior |
| `action` — `error_recovery_buggy` | 0 | conditioned on, **not** reinforced (partial masking) |

`weight = retrospective_usefulness` (and may be tuned); applies to `loss_mask==1` spans for optional soft weighting.

### Stage 7 — Emit + self-verification
- Emit `sft.jsonl` (§3.1), optional `dpo.jsonl` (§3.2), and always `trajectories.json` (§3.3).
- **Verification stage (required by methodology)** — run automated checks and write `verification_report.json`:
  - JSONL well-formed; no empty `output`.
  - Every `error_recovery_buggy` step retained an accompanying `reflection` and a linked `error_recovery_fix` (i.e., we never dropped a recovery).
  - No `action` with `loss_mask==1` is itself flagged invalid by Stage 2.
  - Report kept/dropped counts, masked-action count, and the success-vs-recovery span ratio.
  - For higher assurance, optionally re-judge a sample of emitted `output` lines with an independent `LLMJudge` pass and flag disagreements.

---

## 5.1 Component interfaces

```python
class ToolAdapter(Protocol):
    """Generic, per-tool. No domain knowledge."""
    def is_error(self, step: Step, following: list[Step]) -> bool: ...
    # NOTE: action serialization does NOT live here. There is exactly ONE serializer,
    # the swappable function in serialize.py (§6.2). ToolAdapter is error-detection only.

class SignalExtractor(Protocol):
    def syntactic(self, step, following) -> float: ...
    def constraint_violations(self, step, governing_user_text, governed_actions) -> list[str]: ...  # governed_actions = ordered action steps in the same governed segment; needed for count checks (§12.1)
    def is_verifier_event(self, step) -> bool: ...        # generic: tests/lint/build/diff/curl/etc. (seed list §11.5)
    def verifier_delta(self, step, following) -> int|None: ...  # +1 improved / -1 regressed / 0 unchanged / None = no verifier event (§11.4)
    def governing_user_text(self, step, trajectory) -> str: ...  # most recent in-trajectory user_text before step (§11.3)

class LLMJudge(Protocol):
    def is_new_task(self, prev_goal, user_text) -> bool: ...
    def subgoal_score(self, task_goal, step, outcome, lookahead) -> float: ...
    def policy_score(self, step, governing_user_text) -> float: ...
    def same_variant(self, goal_a, goal_b) -> bool: ...
    def resolves(self, buggy_step, candidate_fix, intervening_steps) -> bool: ...  # D15 backstop

class ReasoningWriter(Protocol):
    def reason(self, context, action) -> str: ...
    def reflect(self, buggy_action, tool_result, corrective_action) -> str: ...
```
- All LLM-backed components must have a deterministic **mock** implementation for `--no-llm` (tests, CI) and a **cached** real implementation (hash inputs → cache responses) for reproducibility.
- `is_verifier_event` is how the pipeline stays domain-agnostic about "did it pass": it recognizes *that a verification step occurred* from generic patterns (a test runner, a linter, a build, an HTTP probe, a diff), never a named script.

## 5.2 Config
```
input_path: str
out_dir: str
horizon: "task-boundary" | "end-of-session" | int   # default "end-of-session"  (D3)
emit: set[str]                                       # {"sft"} default; add "dpo"
redundancy: "off" | "collapse"                       # default "collapse"        (D6/D19)
failure_compression: "off" | "conservative" | "aggressive"  # default "conservative"  (D5)
action_repr: "structured" | "string"                 # default "structured" (OpenAI tool_calls; §6.2)
dpo_granularity: "canonical" | "all" | "first" | "last"  # default "canonical"   (D12)
strict_local: bool                                   # default False; True = local_validity uses only action.status (D14 ablation)
answer_weight: float                                 # default 1.0; down-weight terminal NL answers (D11)
min_answer_chars: int                                # default 0; drop trivial confirmations below this (D11)
max_llm_calls: int | null                            # circuit breaker; abort run if exceeded (D20)
reasoning_writer_model: "<model-id>"                  # default a strong Claude model; same-family option (D22)
judge: "mock" | "<model-id>"                          # default a strong Claude model; temperature 0 (§12.8)
seed: int
# additional defaults pinned in §12.10:
validity_threshold: float                            # default 0.5
usefulness_threshold: float                          # default 0.5
reasoning_granularity: "per_action" | "per_turn"     # default "per_action"
verify_sample_rate: float                            # default 0.10 (cap 50; judge != mock only)
answer_warn_chars: int                               # default 8000 (warn-only)
verifier_patterns: list[str]                         # default seed in §11.5
```

## 5.3 CLI
```
python -m traj_pipeline \
  --input session.json \
  --out-dir ./out \
  --horizon end-of-session \
  --emit sft,dpo \
  --judge claude \
  [--no-llm] [--redundancy collapse] [--failure-compression conservative]
```
Default end-to-end run on the fixture: `python -m traj_pipeline --input berzerk-guided-rubric.json --out-dir ./out`.

---

## 6. Implementation notes

### 6.1 Module layout (suggested)
All paths below are under the project root `/Users/sudnya/checkout/smi/gfx-challenge`.
```
traj_pipeline/
  __init__.py
  load.py            # Stage 0
  segment.py         # Stage 1
  scoring.py         # Stage 2  (signals + judge orchestration, two scores)
  labeling.py        # Stage 3
  compression.py     # Stage 4
  backfill.py        # Stage 5
  assemble.py        # Stage 6 (spans + loss_mask)
  emit.py            # Stage 7 outputs
  verify.py          # Stage 7 self-checks
  serialize.py       # the SINGLE swappable action serializer (§6.2); only emit.py + DPO import it
  adapters.py        # ToolAdapter implementations (bash/read/write/edit + generic default); is_error only
  judge.py           # LLMJudge real + mock + cache
  reasoning.py       # ReasoningWriter real + mock
  config.py, cli.py
tests/
  test_load.py ... test_verify.py
  fixtures/berzerk-guided-rubric.json
```

### 6.2 Action representation (the serializer "open decision" is now CLOSED)
Actions are represented as **structured OpenAI `tool_calls`** inside assistant messages, in both `input` context and `output`:
```json
{"role":"assistant","content":"",
 "tool_calls":[{"id":"c1","type":"function",
   "function":{"name":"bash","arguments":"{\"command\":\"...\"}"}}]}
```
`function.name` = the source `tool`; `function.arguments` = `json.dumps(state.input, sort_keys=True, separators=(",",":"))` (byte-stable for the golden test). Because the call lives in the structured field, **the model's own chat template owns the tool-call delimiters at both train and inference time** — there is no hand-authored grammar and no train/serve skew to reconcile. This closes the former §6.2.1 open decision and removes "delimiter ownership" as a risk, **provided the model is trained and served with the same tokenizer chat template** (the default when you fine-tune and serve the same base model).

`map_tool_call(step) -> dict` (build the `tool_calls` entry) lives in `serialize.py` and is the single place that touches representation; the rest of the pipeline uses structured `tool`+`args`. A `string` fallback (serialize the call to text) exists only if the framework cannot accept structured `tool_calls` in the loss-bearing `output`; default is `structured`.

#### 6.2.1 (RESOLVED) Former serializer "open decision"
Closed by the move to structured `tool_calls` (§6.2). The earlier worries — invented-vs-mirrored grammar, reconstructing OpenCode's emission tokens, and "delimiter ownership" — all dissolve because the delimiters are no longer authored by the pipeline; the model's chat template renders them identically at train and serve time. The single remaining condition is the trivially-met one: **train and serve with the same base model's chat template.** `chosen`/`rejected` use the same `map_tool_call`, so DPO format consistency is automatic.

### 6.3 Determinism & reproducibility
Seed everything; cache all LLM calls keyed by a hash of their full prompt; record the judge model id and pipeline version in `trajectories.json.meta` and `verification_report.json`.

---

## 7. Fixture episode checklist (must all be handled correctly)

The implementation must produce sensible results on these real episodes from the source session (used as acceptance tests; described generically so the asserts aren't game-specific). **Acceptance assertions key on `(source_part_id, kind)` (D18), never `step_id`** — `source_part_id` is the OpenCode-assigned `prt_…` id and is stable across Stage-0 changes; note a single `tool` part expands to an `action` and a `tool_result` sharing that id, so `kind` disambiguates.

1. **Stale-information step** — model acted on a path it was given that didn't exist, asked for correction, then succeeded. → `stale_info`: kept, action **not** masked, not penalized.
2. **User-caught bad command** — model proposed a command that would clobber its own outputs; user corrected; model used the safe version. → buggy proposal masked / reflection inserted / corrective kept.
3. **False-success / unpersisted-edit** — model claimed a verifier improvement but the diff was empty and it was reading the original file. → low `local_validity`; `error_recovery_buggy`; reflection names "claimed change not persisted."
4. **Explicit-constraint violation** — instruction was "exactly one increment," model overshot. → `policy` axis low; masked or routed to DPO `rejected`.
5. **Verifier-passes-but-runtime-broken multi-turn saga**, including a step where the model waited for approval when the user wanted action. → preserved as a compressed `reason → buggy → result → reflection → fix` chain; the "waited when it should have acted" step handled via the constraint/subgoal axes.
6. **Repeated successful subtask block** — collapse to one exemplar per distinct variant; verify no recovery signal was lost (none exists there).
7. **No-tool opening turn** — kept as its own trajectory; emitted as a single `answer` span (`loss_mask=1`), producing one `sft.jsonl` line (D11).

A reviewer must confirm none of stages 0–7 reference any string from the problem domain (no "berzerk", "rubric", "rom", "checker", "z80").

---

## 8. Expected output on the fixture
Roughly a handful of focused single-task trajectories + a small set of DPO pairs, an `sft.jsonl` of `{"input": [...], "output": <assistant message>}` examples (one per reasoning/reflection/answer/kept-or-corrective action span), and a `verification_report.json` confirming every recovery episode was preserved with masking. From one raw log: both SFT and preference data.

`verification_report.json` must include at least: `kept_spans`, `dropped_spans`, `masked_action_count`, `success_vs_recovery_ratio`, `recoveries_preserved` (every `error_recovery_buggy` has a linked fix + reflection), `empty_output_lines` (must be 0), `policy_axis_approximate` (bool, true under `--no-llm`), `dpo_answer_rejected_skipped` (§12.5), `long_answer_spans` (§11.6), `llm_calls_used` / `max_llm_calls`, and the `judge` + `reasoning_writer_model` + `pipeline_version` provenance.

---

## 9. Review resolutions (round 1) — binding decisions

This section is the authoritative, reproducible record of the first critical review. Each item states the decision and the reasoning so any future session reaches the same outcome. These resolve to defaults D11–D22 in §1.

### 9.1 Terminal natural-language output → new `answer` span kind (D11)
A no-tool turn (e.g. the opening "explain X") and post-tool summaries are **terminal deliverables**, not pre-action deliberation. We use a **distinct `answer` span kind** rather than reusing `reasoning`, even though a single-`reasoning`-span approach was the initially-recommended option. Reason: the rest of the pipeline relies on the invariant that a `reasoning` span *precedes an action* (the D16 masking rule, the think-then-act structure, the reflection placement). Overloading `reasoning` with terminal answers breaks that invariant and muddies those rules. The `answer` kind keeps the loss-mask table semantically honest and lets us weight terminal prose independently (`answer_weight`) and drop trivial confirmations (`min_answer_chars`) — neither of which is possible if it's fused into `reasoning`. Emit the whole answer as **one** span (no paragraph chunking; chunks become context-free fragments that are worse training signal). `loss_mask=1`.

### 9.2 DPO granularity with multiple buggy attempts (D12)
Default **`canonical`**: one pair per episode, `rejected` = the buggy step the episode's reflection actually critiques (the step linked by `resolves_step_id`, usually the last attempt before the fix), `chosen` = the corrective fix, `prompt` = shared prefix up to that buggy step's decision point. This matches "one line per error/recovery episode" and avoids the noise of pairing every flailing attempt against the same fix. `dpo_granularity ∈ {canonical, all, first, last}` exposes the alternatives for experimentation.

### 9.3 `patch` parts (D13)
Not their own `Step`. Attach each `patch` to the preceding `edit`/`write` action's `metadata`. This is what makes the local "claimed a change but the diff is empty" signal work as an *own-outcome* signal (see 9.4).

### 9.4 No-future boundary for `local_validity` (D14)
An action's **own outcome** = `{status, the tool_result it produced, the patch it produced}` and is in-scope for `local_validity`. Anything from a **later, separate step** is future and feeds only `retrospective_usefulness`. This lets "empty-diff-after-claimed-change" inform local validity (the patch is the action's own outcome) while keeping later disagreements (a verifier two steps on) out of the causal score. Ablation: `--strict-local` restricts `local_validity` to `status` only, for users who want the strictest reading of D4.

### 9.5 Linking buggy → fix (D15)
Heuristic first (same target file/tool, or `verifier_delta` improves); `LLMJudge.resolves(buggy_step, candidate_fix, intervening_steps)` as backstop when ambiguous. Pure heuristics miss cross-tool repairs (a `bash`/`sed` fix repairing an `edit`-tool change), so the backstop is required for correctness, not just polish.

### 9.6 Pre-buggy-action reasoning masking (D16)
Reasoning immediately preceding an `error_recovery_buggy` action is `loss_mask=0`: it is emitted into the `input` context (so the trajectory stays coherent and the later reflection→fix makes sense) but is **never** a trained `output`. This prevents training good-faith reasoning that leads to a masked bad action. (With the §3.1 output-only-loss format this is unconditional — there is no longer a span-vs-context mode to reconcile.)

### 9.7 Policy detector — confirmed-count only (D17, revised)
The deterministic detector fires on exactly two confirmable cases (§12.1): a **forbidden verb performed** (`do NOT <verb>` in the most-recent governing text where `<verb>` maps to this action's tool) and a **count-bounded constraint exceeded** ("single/exactly-N `X`" with this action the offending occurrence) — flagging only the offending action. It does **not** flag an action merely because a constraint phrase appears in the governing text (that conflation was the round-3 false-positive bug). Semantic constraints ("single script", "exactly one band") are left to `LLMJudge.policy_score`, which enters the labeling gate via `policy_gate` (§12.2). Under `--no-llm`, semantic violations are not caught (`policy_score` mocked high), so `policy_axis_approximate: true` is set in `verification_report.json`.

### 9.8 Acceptance-test keys (D18)
Key by `(source_part_id, kind)`. `step_id` is a Stage-0 ordinal and shifts if normalization changes; `source_part_id` is the OpenCode `prt_…` id and is stable. `kind` disambiguates the `action`/`tool_result` pair that share one part id.

### 9.9 Bash redundancy signature (D19)
`first verb + structural flags (pipes/redirects/subshell)`; `read`/`write`/`edit` use `tool + file-extension class`. Conservative by design — under-collapse is the safe failure direction; we'd rather keep a near-duplicate than merge two genuinely different steps.

### 9.10 LLM cost circuit breaker (D20)
`max_llm_calls` aborts a run that exceeds budget. Estimate: a full uncached run is ≈400 judge+reasoning calls (~$1–3); the prompt-hash cache (sha256 of prompt + model_id + pipeline_version) makes re-runs free, and prompt-template tweaks auto-invalidate.

### 9.11 `step-start`/`step-finish` (D21)
Used to delimit assistant sub-turns when a message has more than one; the loader must not assume one step per message. Redundant on the current single-step fixture but required for other OpenCode sessions — verify on the next fixture we obtain.

### 9.12 Synthetic reasoning is the writer's style, not Gemma's (D22)
Accepted, explicit property (not a defect): the SFT data teaches the writer model's reasoning *shape* paired with Gemma-style actions; STaR's "structure not content" is why this transfers. The deployed model will think in the writer's prose style. `reasoning_writer_model` can be set to a same-family model if matching the deployment harness's native reasoning style ever becomes a requirement.

---

## 10. Implementation rollout

**Build order: end-to-end skeleton first, then deepen the judgment stages.** This is deliberate. In this pipeline the integration/plumbing is the easy part; the hard, error-prone part is the *quality of the judgments* (two-score scoring, episode labeling, compression rules, masking, reasoning placement). Those judgments can only be reviewed meaningfully once you can see their effect on the final `sft.jsonl`/`dpo.jsonl` — reviewing a scoring change in isolation is low-signal. So we get a running pipeline first, then deepen with the data in front of us.

### Phase 1 — Runnable skeleton (mocks, no API)
Land **all seven stages** with deterministic `--no-llm` mocks so the pipeline runs end-to-end on the fixture in one sitting.
- Stage 0 loader (incl. D13 patch attachment, D21 step delimiting, stable `source_part_id`).
- Stages 1–7 wired with mock `LLMJudge`/`ReasoningWriter` (deterministic stubs).
- Actions represented as structured OpenAI `tool_calls` via `map_tool_call` in `serialize.py` (§6.2); `action_repr=structured`.
- Emit `sft.jsonl`, `dpo.jsonl`, `trajectories.json`, `verification_report.json`.
- **Phase-1 exit gate:** `python -m traj_pipeline --input berzerk-guided-rubric.json --out-dir ./out --no-llm` runs green; a **golden-output test** snapshots the mock outputs (deterministic via the §12.11 mock contract, so it locks behavior); the §7 acceptance episodes pass per §12.11 — **2 and 3 with full labels** (deterministic syntactic signal), **7** as a deterministic answer-span assertion — keyed by `(source_part_id, kind)`; episodes **1, 4, 5, 6** need real judgment and become **Phase-2 exit criteria** (asserted only at the structural-invariant level in Phase 1); the domain-leak pytest passes. **Do not treat this as a result — it's a scaffold.**

### Phase 2 — Deepen with review pauses (real Anthropic)
Now apply per-stage review, but only to the judgment-heavy stages, each reviewed *against its effect on the emitted data*:
1. Stage 2 scoring (two scores; real `subgoal_score`/`policy_score`) + `--strict-local` ablation check.
2. Stage 3 labeling + Stage 4 compression (incl. `LLMJudge.resolves` backstop, redundancy signatures).
3. Stage 5 reasoning backfill (real `ReasoningWriter`; verify reflection placement and D16 masking).
4. Wire real judge/writer with the prompt-hash cache and `max_llm_calls` breaker.
- **Phase-2 exit gate:** each step diffs the resulting `sft.jsonl`/`dpo.jsonl` against the prior version and is reviewed before proceeding; `verification_report.json` shows all recoveries preserved, zero empty outputs, and `policy_axis_approximate=false`.

### Pre-flight gate before FINAL training data
There is no longer a grammar/serializer pre-flight gate: structured `tool_calls` (§6.2) mean the model's chat template owns the delimiters, so the only condition is the trivially-met one — **train and serve with the same base model's chat template.** Final data generation has no remaining external blocker.

**Honest tradeoff:** first-pass scoring/reasoning in Phase 1 will be rough (mocks); the discipline is to treat the first green run as a scaffold, not a deliverable. The payoff is a regression-proof, runnable artifact from day one and high-signal review in Phase 2.

---

## 11. Resolved ambiguities (round 2) — binding

These resolve the second review. They are binding defaults; do not re-litigate.

### 11.1 Serializer-grammar question → CLOSED via structured `tool_calls`
Superseded by the §3.1/§6.2 decision: actions are structured OpenAI `tool_calls`, the chat template owns delimiters, and there is no hand-authored grammar to choose. Both the invented `<tool=NAME>{json}</tool>` form and the `{"tool":…,"input":…}` text-mirror are moot — the only place `state.input` is used now is as `function.arguments` inside the structured call.

### 11.2 `resolves_step_id` direction
The link is stored **on the corrective action** and points **to the buggy step** (`fix.resolves_step_id = buggy.step_id`). DPO emission walks the list of `error_recovery_fix` actions and, for each, reads `resolves_step_id` to find the `rejected` buggy step. §9.2's phrase "the step linked by `resolves_step_id`" means exactly this — the buggy step that the fix's link refers to. There is no separate buggy→fix field.

### 11.3 `governing_user_text`
= the **most recent `user_text` step within the same trajectory, occurring before the assistant step** being scored. This is the message that governs the action even when it is a merged follow-up (e.g. "have you applied the fix?"), which may differ from the trajectory's `task_goal`. If no user_text precedes the step in-trajectory (shouldn't happen post-segmentation), fall back to `task_goal`.

### 11.4 `verifier_delta` encoding
`int | None`: `+1` improved, `0` unchanged, `-1` regressed, `None` = no verifier event at this step. The docstring's "improved/regressed/unchanged" maps to `+1/-1/0`.

### 11.5 `is_verifier_event` starter heuristic
Bash verbs/patterns: `{pytest, python -m pytest, unittest, eslint, lint, ruff, mypy, tsc, make, cargo, go test, npm test, npm run, curl, wget, git diff, git status}`; plus a `read` step targeting a file edited earlier in the same trajectory. Approximate by design — it is only an *input* to scoring, never a hard gate — so false negatives degrade gracefully. Extendable via a config list `verifier_patterns` (the above is the default seed).

### 11.6 Answer-span length
No hard upper bound (the lower bound is `min_answer_chars`, default 0). Add `answer_warn_chars` (default 8000): answer spans longer than this emit a warning into `verification_report.json` (`long_answer_spans: [...]`) but are still emitted. Revisit a hard cap only if the target model's context budget requires it.

---

## 12. Quantitative defaults & deterministic algorithms

To remove implementer guesswork, these pin the numeric/algorithmic choices the prose left open. All are config-overridable; values below are defaults.

### 12.1 Axis values
Each axis ∈ [0,1]. Deterministic signals map as: syntactic = `1.0` if no error and (when a change was claimed) a non-empty patch, `0.0` on tool error / error markers / claimed-change-but-empty-diff.

**`policy_local` detects confirmed violations, NOT constraint presence (critical — this was the round-3 bug).** A constraint *phrase* in the governing user text is not a violation. Default `policy_local = 1.0`; it drops to `0` for an action **only** in these two deterministically-confirmable cases:
- **Forbidden-verb performed:** the governing text contains a `do NOT <verb>` (also `don't`/`do not`) where `<verb>` maps to a real tool name, and *this action's tool is that tool* (e.g. "do NOT edit" + an `edit` action). Evaluated against the **most-recent** governing user text only (§11.3), so a later action re-authorized by a subsequent message — e.g. an edit after "Approved, implement…" — does **not** fire. A negated verb that does not map cleanly to a tool ("do NOT run the disassembly") is semantic → LLM.
- **Count-bounded exceeded:** a constraint maps to a verifiable tool-call count ("single Edit call" / "exactly N `X` calls") and *this action* is the offending occurrence — the (N+1)-th `X` action onward within the governed segment. Only the offending action(s) are flagged, never their neighbors (a `chmod`, `read`, or `git diff` under the same instruction is untouched).

Anything not matching those two ("single script", "exactly one band higher" — semantic) → `policy_local = 1`, deferred to `LLMJudge.policy_score`.

The graded `LLMJudge.policy_score ∈ [0,1]` catches semantic/paraphrased violations the count detector cannot. **Composite reported axis: `axes.policy = min(policy_local, policy_score)`.** Both feed the labeling gate (§12.2). For a **text step** (`assistant_text`/`answer`), syntactic = `1.0`, `policy_local` runs the same confirmed-count check against the governing text, and `subgoal_score`/`policy_score` apply as usual (§12.12).

### 12.2 Score combination
- `local_validity = min(syntactic, policy_local, policy_gate)` where `policy_gate = 1 if policy_score >= policy_threshold else 0` (`policy_threshold` default `0.5`). A single confirmed violation (deterministic count **or** LLM-judged semantic) tanks local validity; a bare constraint phrase with no real violation does not. Under the `--no-llm` mock, `policy_score = 0.95` ⇒ `policy_gate = 1`, so only deterministic count violations flag in Phase 1 (keeps the golden snapshot clean and free of regex false positives). Under `--strict-local`, syntactic and `policy_local` are computed from `status` only, and `policy_gate` is dropped (deterministic-only ablation).
- `retrospective_usefulness = subgoal_score`, then **boosted to `max(subgoal_score, 0.8)` if the step is an `error_recovery_fix`** (a successful repair is useful even if its local subgoal reading is middling), and **set to the fix's value** for a `stale_info` step's eventual correction. A buggy step's `retrospective_usefulness` stays low.

### 12.3 Thresholds and the label-assignment algorithm
`validity_threshold = 0.5`, `usefulness_threshold = 0.5`. Compute labels deterministically per assistant **action** step (text/answer handled in 12.5):

```
valid   = local_validity        >= validity_threshold
useful  = retrospective_usefulness >= usefulness_threshold
if valid and useful:            clean_success
elif valid and not useful:      stale_info            # reasonable then, invalidated later — keep, not masked
elif not valid and has_fix:     error_recovery_buggy  # has a resolves link from some later fix
elif not valid and is_fix:      error_recovery_fix
elif not valid and not has_fix: dead_end              # compression candidate
```
`is_fix` = some buggy step's `resolves_step_id` points here. `has_fix` = this step has a later fix linked to it. A step that is both valid and is_fix is just `clean_success`. Redundancy grouping (Stage 4) overlays `redundant` on `clean_success` members beyond the kept exemplar.

### 12.4 Span ordering & assembly
Within a trajectory, spans are emitted in **source order**, with backfilled `reasoning` inserted **immediately before** its action and `reflection` inserted **immediately after** the failing `tool_result` and before the corrective action. `sft.jsonl` lines are written in trajectory order (source order), then span order — fully deterministic for the golden test. One `reasoning` span per kept action (`reasoning_granularity = per_action`; `per_turn` available to reduce verbosity).

### 12.5 Answer spans are scored, not free passes
An `answer` span inherits the scoring of its assistant step. It is `loss_mask = 1` **only if** `local_validity >= validity_threshold`; an answer that is itself a flagged misstep (e.g. the "I waited for approval instead of acting" turn — a policy/subgoal miss) gets `loss_mask = 0`. This prevents teaching the model to reproduce bad terminal behavior. Trivial confirmations below `min_answer_chars` are dropped regardless.

**DPO with an answer as `rejected` — Phase-1 exclusion:** the serializer is action-only (`tool`+`args`), and an answer has neither. So in Phase 1, do **not** emit any DPO pair whose `rejected` would be an `answer` span; instead record `dpo_answer_rejected_skipped: N` in `verification_report.json`. A unified `serialize_span` covering both prose and actions (and thus heterogeneous answer-vs-action pairs) is deferred to Phase 2 and only added if you decide you want those pairs.

### 12.6 DPO decision point / shared prefix
`prompt` = the context messages from trajectory start up to **and including the `reasoning` message that precedes the buggy action**, excluding the buggy action itself. `rejected` = the buggy action as an assistant `tool_calls` message; `chosen` = the corrective action as an assistant `tool_calls` message (both via `map_tool_call`). This guarantees `chosen` and `rejected` share an identical prefix and differ only at the action.

### 12.7 Multi-action fixes
When a repair spans several actions, the `error_recovery_fix` (and the DPO `chosen`) is the **single action after which the verifier improves or the subgoal is met** (per `resolves`); earlier/later actions in that repair are `clean_success`. One buggy step links to exactly one fix action.

### 12.8 LLM determinism & model defaults
All judge/writer calls use **temperature 0** and fixed prompts; responses cached by `sha256(prompt + model_id + pipeline_version)`. Default `judge` and `reasoning_writer_model` = a current strong Claude model (latest available Sonnet or Opus); `mock` is used under `--no-llm`. `pipeline_version` is a constant bumped on any change to prompt templates or scoring logic (invalidates the cache). Re-judge verification (§8) defaults to `verify_sample_rate = 0.10` capped at 50 lines, only when `judge != mock`.

### 12.9 Non-error empty outputs
Absence of tool output (e.g. `chmod` printing nothing) is **not** an error. `is_error` fires only on explicit error markers / non-success `status` / claimed-change-but-empty-diff — never on merely empty stdout.

### 12.10 Config additions (defaults)
```
validity_threshold: float = 0.5
usefulness_threshold: float = 0.5
policy_threshold: float = 0.5            # policy_score below this fails policy_gate (§12.2)
reasoning_granularity: "per_action" | "per_turn" = "per_action"
verify_sample_rate: float = 0.10        # capped at 50 lines; judge != mock only
answer_warn_chars: int = 8000           # warn-only, no hard cap
verifier_patterns: list[str] = <11.5 seed>
```

### 12.11 Phase-1 mock contract (pinned, deterministic)
The `--no-llm` mocks must return these exact constants so the golden snapshot is reproducible (no randomness, no "dumb but unspecified"):
- `is_new_task(prev_goal, user_text)` → `False` unless `prev_goal` is empty/None (then `True`).
- `subgoal_score(...)` → `0.55` (just above `usefulness_threshold`, so clean steps read as useful).
- `policy_score(...)` → `0.95` (the deterministic `policy_local` still hard-fails real violations).
- `same_variant(a, b)` → `True`.
- `resolves(buggy, fix, between)` → `True`.
- `reason(context, action)` → fixed template `"[reasoning:{source_part_id}]"`; `reflect(...)` → `"[reflection:{source_part_id}]"`.

**What this means for the §7 acceptance tests in Phase 1:**
- **Full deterministic labels:** episode **2** (error marker) and episode **3** (empty-diff) — the deterministic syntactic signal labels these `error_recovery_buggy` without any LLM.
- **Deterministic in Phase 1:** episode **7**'s opener is asserted kept as a valid `answer` span (text step, no violation).
- **Phase-2 exit criteria (structural invariants only in Phase 1):** episode **4** (constraint overshoot — "exactly one band" is *semantic*, so after the §12.1 detector revision it produces no deterministic signal and is caught only by `policy_score`), plus episodes **1** (stale_info), **5** (multi-turn saga), **6** (variant collapse) — all need real judgment (`policy_score`, `subgoal_score`, `same_variant`). Phase-1 invariants: a trajectory is produced; no `error_recovery_buggy` lacks a reflection; no empty `output`. (Note: a *count*-based constraint like "single Edit call" with 2+ edits **is** caught deterministically in Phase 1; episode 4 simply isn't of that form.)

### 12.12 Text-step scoring path
`assistant_text` and `answer` steps go through the same Stage-2 scoring as actions, with: syntactic = `1.0` (no tool), `policy_local` via `constraint_violations` on the text, `subgoal_score` via the judge. This is how a terminal answer can be flagged a misstep (§12.5). No tool adapter is involved for text steps.
