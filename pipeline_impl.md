# traj_pipeline -- implementation notes

This document is for an engineer onboarding to the trajectory-to-training-data
pipeline. It explains what the pipeline does, how it is structured, what each
stage decides, where to look for evidence of those decisions in the code, and
which decisions are intentional bets versus open problems. The authoritative
specification is `trajectory_pipeline_spec.md`; this document maps the spec
onto the codebase and surfaces the implementation choices not visible from
either.

## 1. What it does

Given a single OpenCode agentic-coding session as JSON, produce three files
that can train (or DPO-tune) a smaller agent to do the same work in fewer
turns with fewer mistakes:

- `sft.jsonl` -- supervised fine-tuning examples, one per loss-bearing span.
- `dpo.jsonl` -- preference pairs `(prompt, chosen, rejected)` for error
  episodes.
- `trajectories.json` -- the full intermediate representation for debugging.
- `verification_report.json` -- automated quality stats.

The source session is the ground truth. The reference methodology paper
(*Converting Agentic Coding Trajectories into Post-Training Data*) is what
informs **how** we restructure those traces -- preserving error/recovery
episodes, compressing redundancy, backfilling synthetic reasoning.

Critically, the pipeline is **domain-agnostic by construction**: nothing in
`traj_pipeline/*.py` mentions any tool-specific or fixture-specific string.
A pytest test (`test_load.py::test_no_domain_strings_in_module_code` and
`test_acceptance.py::test_no_domain_strings_anywhere_in_traj_pipeline`)
enforces this with a word-boundary regex over the package code.

## 2. Quick start

The package uses uv + pyproject.toml and lives in `traj_pipeline/`. Tests
live in `tests/`.

```
# install editable
.venv/bin/pip install -e .

# run all tests
.venv/bin/python -m pytest tests/

# Phase-1 mock run (no LLM, deterministic, free):
.venv/bin/python -m traj_pipeline \
    --input berzerk-guided-rubric.json \
    --out-dir ./out \
    --no-llm --emit sft,dpo

# Phase-2 real-LLM run (needs ANTHROPIC_API_KEY):
.venv/bin/python -m traj_pipeline \
    --input berzerk-guided-rubric.json \
    --out-dir ./out_phase2 \
    --judge claude-sonnet-4-6 \
    --emit sft,dpo \
    --max-llm-calls 500 \
    --max-workers 10
```

Outputs land in `--out-dir`. The LLM response cache lives at
`.cache/traj_pipeline/` and persists across runs so re-runs are nearly free.

## 3. Input format

OpenCode session JSON. Top-level: `{"info": {...}, "messages": [...]}`.

Each message has `info` (role + ids + timing) and `parts` (the message
content). Part `type` values observed in practice:

- `text` -- prose. Becomes a `user_text` or `assistant_text` Step.
- `step-start` / `step-finish` -- assistant sub-turn delimiters. Ignored on
  the current single-step-per-message fixture; the loader walks parts in
  source order so multi-step messages are handled by that ordering alone.
- `tool` -- a tool call. `part.tool` is the tool name (treated opaque);
  `part.state` has `status`, `input`, `output`, `metadata`, `time`,
  `callID`. Expands to **two** Steps: one `action` (the call) and one
  `tool_result` (its outcome). The two Steps share `source_part_id` and
  `metadata.callID`.
- `patch` -- a diff blob. **Not a Step.** Attached to the preceding
  `edit`/`write` action's `metadata["patches"]` per D13. The OpenCode
  export carries only a hash + file list, not the diff text -- this turns
  out to constrain Stage-2 syntactic detection (see section 9).

The reference fixture is `berzerk-guided-rubric.json` (also copied to
`tests/fixtures/`). 98 messages: 24 user / 74 assistant; 69 tool calls
(bash 35, edit 15, write 10, read 9); 6 patch parts.

## 4. Output formats

### 4.1 `sft.jsonl`

One JSON object per line. Each is one training example:

```json
{
  "input": [<list of OpenAI chat messages, the prior context>],
  "output": <one assistant message -- this is what the model trains on>
}
```

Loss is on `output` only (training-framework fact, spec section 3.1).
Partial masking is encoded **by construction**: spans we want conditioned
on but not trained on (buggy actions, tool results, pre-buggy reasoning,
user turns) appear in `input` arrays of subsequent examples but never as
an `output`. There is no `loss_mask` field in `sft.jsonl` -- the file
shape itself is the mask.

Message shapes inside `input` / `output`:

| Role + fields | Span kind it came from |
|---|---|
| `{"role": "user", "content": "..."}` | `user` |
| `{"role": "assistant", "content": "..."}` | `reasoning` / `reflection` / `answer` (indistinguishable from shape alone; cross-reference `trajectories.json`) |
| `{"role": "assistant", "content": "", "tool_calls": [{"id": "...", "type": "function", "function": {"name": "...", "arguments": "<JSON string>"}}]}` | `action` |
| `{"role": "tool", "tool_call_id": "...", "content": "..."}` | `tool_result` |

`function.arguments` is a JSON **string** per OpenAI spec (not a JSON
object). It is byte-stable: `json.dumps(args, sort_keys=True,
separators=(",",":"))`. This means the chat template at train and serve
time owns the tool-call delimiters -- the pipeline never emits a
hand-authored grammar (see decision D-serializer below).

### 4.2 `dpo.jsonl`

One JSON object per error/recovery episode (default
`dpo_granularity=canonical`):

```json
{
  "prompt":   [<OpenAI message list up to the reasoning span before the buggy action, inclusive of that reasoning>],
  "chosen":   <corrective action as an assistant tool_calls message>,
  "rejected": <buggy action as an assistant tool_calls message>
}
```

`chosen` and `rejected` go through the same `map_tool_call` serializer so
preference pairs differ in semantic content, not format noise. Phase-1
exclusion: if the buggy step would be an `answer` span (text, not a tool
call), the pair is skipped and recorded as
`dpo_answer_rejected_skipped` (D-skip-answer-rejected).

### 4.3 `trajectories.json`

The full intermediate representation. Top-level:

```json
{
  "meta": {
    "pipeline_version": "0.0.1",
    "judge": "claude-sonnet-4-6" or "mock",
    "reasoning_writer_model": "...",
    "no_llm": false,
    "input_path": "...",
    "session_info_id": "..."
  },
  "trajectories": [
    {
      "task_goal": "<the user_text that opened this trajectory, verbatim>",
      "scored_steps": [<every Step with axes, scores, label, resolves_step_id, constraint_violations, governing_user_text, compressed_out>],
      "reasonings": { "<step_id>": "<synthetic reasoning prose>" },
      "reflections": { "<fix_step_id>": "<synthetic reflection prose>" },
      "spans": [<assembled Spans with loss_mask + weight + provenance>],
      "long_answer_spans": []
    }
  ]
}
```

The debug artifact ships every decision the pipeline made, traceable back
to `source_part_id` (which is the OpenCode `prt_...` id and is stable
across Stage-0 reorderings, per D18). Spans appear in source order; the
ith mask-1 span corresponds to the ith line of `sft.jsonl`.

### 4.4 `verification_report.json`

Small flat object. Required fields:

- `kept_spans`, `dropped_spans`, `masked_action_count`
- `success_vs_recovery_ratio`
- `recoveries_preserved` (every `error_recovery_buggy` has a linked fix
  + reflection and was not dropped from the emitted spans)
- `empty_output_lines` (must be 0)
- `policy_axis_approximate` (true under `--no-llm`)
- `dpo_answer_rejected_skipped`, `long_answer_spans`
- `llm_calls_used` / `max_llm_calls`
- Provenance: `judge`, `reasoning_writer_model`, `pipeline_version`
- Re-judge sample: `rejudge_sample_size`, `rejudge_disagreements`,
  `rejudge_disagreement_rate`
- `failures` (list of strings; empty = clean)

The headline quality signal is `rejudge_disagreement_rate`: an
independent re-judge pass over a 10% sample of emitted SFT examples
(capped at 50, only when judge != mock) reports the fraction the
judge would flag as not-a-good-training-example. Under 10% is healthy;
above 20% suggests the corpus has noticeable noise worth investigating.

## 5. Architecture and data flow

```
traj_pipeline/
  __init__.py          PIPELINE_VERSION (cache key suffix)
  load.py              Stage 0: parse JSON -> List[Step]
  segment.py           Stage 1: split into Trajectories
  signals.py           Deterministic signal extractors (syntactic, constraint, verifier)
  judge.py             LLMJudge Protocol + MockLLMJudge (re-exports Anthropic impl)
  reasoning.py         ReasoningWriter Protocol + MockReasoningWriter
  _anthropic.py        AnthropicLLMJudge + AnthropicReasoningWriter + _AnthropicBackend
  scoring.py           Stage 2: per-step axes -> local_validity + retrospective_usefulness
  labeling.py          Stage 3: link fixes (Pass A) + assign label (Pass B)
  compression.py       Stage 4: cross-traj + within-traj redundancy + failure compression
  backfill.py          Stage 5: synthetic reasoning + reflection prose
  assemble.py          Stage 6: spans + loss_mask per section 6 table
  serialize.py         Single swappable action serializer (map_tool_call + span_to_message)
  emit.py              Stage 7a: write sft.jsonl, dpo.jsonl, trajectories.json
  verify.py            Stage 7b: write verification_report.json (+ 10% re-judge)
  adapters.py          ToolAdapter protocol (is_error only; not serialization)
  cache.py             PromptCache (sha256-keyed file cache) + LLMCallBudgetExceeded
  config.py            Config dataclass with defaults from spec sections 5.2 and 12.10
  cli.py               argparse + run() that wires Stages 0..7
  __main__.py          entrypoint for `python -m traj_pipeline`

tests/
  test_load.py         Stage 0 invariants
  test_judge.py        MockLLMJudge contract (spec section 12.11)
  test_segment.py      Stage 1 + the 1-vs-N trajectory mock note
  test_signals.py      Deterministic signal extractors
  test_scoring.py      Stage 2 + policy_gate behavior
  test_labeling.py     Stage 3 Pass A linking + Pass B labeling
  test_compression.py  Stage 4 cross-traj + within-traj + failure
  test_backfill.py     Stage 5
  test_assemble.py     Stage 6 loss_mask invariants
  test_serialize.py    serialize.py shape
  test_emit.py         Stage 7 emit
  test_pipeline.py     End-to-end smoke + golden snapshot
  test_acceptance.py   Spec section 7 episode-by-episode assertions
  test_cache.py        Cache key stability + roundtrip
  test_anthropic_backends.py  SDK-mocked backend tests
  test_cli.py          CLI flag wiring
  test_rejudge_and_parallelism.py  10% re-judge + ThreadPool prefetch
  fixtures/berzerk-guided-rubric.json  the reference session
  golden/sft.jsonl.sha256, dpo.jsonl.sha256  golden mock snapshots
```

The data flow is strictly forward; nothing later mutates earlier output:

```
JSON -> load -> Step[]
            -> segment(judge) -> Trajectory[]
                              -> score_trajectory(judge, signals) -> ScoredStep[]   per traj
                                                                  -> label_trajectory(judge)
              compress_all_trajectories(judge)  applies cross-traj + within-traj passes
              for each traj:  backfill(writer) -> BackfillResult
                              assemble_trajectory(scored, bf) -> AssembleResult(spans)
              emit_sft(spans) / emit_dpo(spans, scored)
              trajectories_payload(...)
              verify(judge_obj, ...) -> VerificationReport
              write_outputs(...)
              write_report(...)
```

`cli.py::run()` is the one place that orchestrates this.

## 6. Stage-by-stage

### Stage 0 -- load.py

`load_session(path) -> (info, list[Step])`. Pure, deterministic. The Step
schema (section 4.1):

```python
@dataclass
class Step:
    step_id: int                       # global source order
    source_message_id: str
    source_part_id: str | None         # OpenCode prt_... id; stable acceptance key (D18)
    role: "user" | "assistant"
    kind: "user_text" | "assistant_text" | "action" | "tool_result"
    tool: str | None
    args: dict | None                  # for actions, mirrors state.input
    text: str | None
    status: str | None                 # for actions / tool_results
    ts: int | None
    metadata: dict                     # callID, patches (for edit/write)
```

Implementation choices:
- `tool` parts fan out to two Steps (action + tool_result) sharing
  `source_part_id`. The Stage-6 assembler uses this to find the action's
  own tool_result without scanning the trajectory.
- `patch` parts attach to `last_edit_write_step.metadata["patches"]` as
  a list. They never become Steps.
- `step-start` / `step-finish` parts are skipped entirely. If a future
  session has multiple sub-turns per message, walking parts in source
  order still produces correct Step ordering -- nothing downstream cares
  about message boundaries.

### Stage 1 -- segment.py

`segment(steps, judge) -> list[Trajectory]`. Every `user_text` is a
candidate trajectory boundary. The judge's `is_new_task(prev_goal,
user_text)` decides start-new vs merge-as-follow-up.

Implementation choices:
- `prev_goal` is anchored to the trajectory's `task_goal`, not to the
  most recent user_text. So a follow-up like "have you applied the fix?"
  compares against the trajectory's original goal, not against the prior
  follow-up. This makes the judge's call grounded.
- Under `--no-llm` the section 12.11 mock returns `False` always (except
  when `prev_goal` is empty/None), so the fixture collapses to **one**
  trajectory. Under real LLM the fixture splits into **14** trajectories
  matching the actual task structure. The downstream pipeline tolerates
  both; tests assert per-trajectory invariants rather than counts.

### Stage 2 -- scoring.py + signals.py + judge.py

Per assistant step (action or text), compute three rubric axes and
combine them into two scores.

```
axes = { syntactic, subgoal, policy }
local_validity = min(syntactic, policy_local, policy_gate)    # the causal gate
retrospective_usefulness = subgoal_score (+ boost for fixes)  # the look-ahead score
```

The two-score separation (D4) is the load-bearing decision: a step can be
locally valid but later invalidated (`stale_info`), and that's not the
model's fault, so we keep the action unmasked.

#### Syntactic axis (deterministic, in signals.py)

`signals.syntactic(step, following) -> float` returns 1.0 unless one of:

1. Tool status != "completed" / "success".
2. Error markers present in the action's own tool_result text:
   `traceback`, `command not found`, `no such file`, `permission denied`,
   `syntax error`, `fatal:`, `error:` (case-insensitive substring match).
3. An `edit` whose `oldString == newString` and is non-empty (a
   deterministic no-op).

Two failure-modes worth knowing:
- **Empty stdout is not an error** (section 12.9). `chmod` returning no
  output is fine.
- **An edit without a patch part is *not* flagged** (this was a Phase-2
  refinement). The OpenCode export drops patch parts for many real,
  applied edits, so absence of a patch is uninformative.

#### Subgoal axis (LLM, in judge.policy_score)

`judge.subgoal_score(task_goal, step, outcome, lookahead) -> float in
[0,1]`. With-look-ahead score: "did this step's intended effect actually
materialize?" Becomes `retrospective_usefulness`. Mock returns 0.55
constant.

#### Policy axis (hybrid; this is the load-bearing one)

`policy_local` is binary 0/1 computed deterministically by
`signals.constraint_violations(step, governing_user_text,
governed_actions)`. It fires on exactly two confirmable cases (round-5
spec revision, section 12.1):

1. **Forbidden-verb performed**: governing text contains `do NOT <verb>`
   / `don't <verb>` where `<verb>` maps cleanly to a real tool name
   (`edit`, `modify`, `change` -> `edit` tool; `write`, `create` ->
   `write`; `read`, `open` -> `read`) and this action's tool is that
   tool. Ambiguous verbs like "do NOT run the disassembly" do not map
   and are deferred to the LLM.
2. **Count-bounded constraint exceeded**: governing text contains
   `single <tool>`, `exactly one <tool>`, or `only one <tool>` (where
   `<tool>` is in {`edit`, `write`, `bash`, `read`, `tool`}) and this
   action is the offending occurrence -- the (N+1)-th in
   `governed_actions`. Neighbors that are different tools are never
   flagged.

The detector does **not** fire on mere phrase presence. "Improve only
the player_combat feature" or "raise the score exactly one band higher"
are semantic constraints; they go to the LLM via `policy_score`.

`policy_score` is the LLM-graded value (continuous, in [0,1]). It enters
local_validity through a separate gate:

```
policy_gate = 1.0 if policy_score >= policy_threshold else 0.0
local_validity = min(syntactic, policy_local, policy_gate)
```

`policy_threshold` defaults to 0.5. Under `--strict-local`, the gate is
dropped (deterministic-only ablation, section 12.2). Under the section
12.11 mock, `policy_score = 0.95` so the gate is always 1 -- mock mode
relies entirely on the deterministic detector.

The composite reported axis is `axes.policy = min(policy_local,
policy_score)` (this is for reporting; the labeling gate uses both via
the formula above).

#### No-future boundary (D14)

`syntactic` and `policy_local` only consume the action's **own outcome**
(`status`, the tool_result with matching `source_part_id`, the
`metadata["patches"]` blobs). They never read steps further downstream.
`subgoal_score` is allowed full look-ahead because it feeds the
look-ahead score, not the causal one.

### Stage 3 -- labeling.py

Two ordered passes; both required (section 5 Stage 3).

**Pass A (link_fixes)**: for every invalid action (`local_validity <
threshold`), forward-scan for a corrective action. Three tiers (D15):

1. Same target file path.
2. Same tool name (if no same-target match anywhere).
3. `LLMJudge.resolves(buggy, candidate, intervening)` backstop on the
   first candidate (cross-tool repair case).

`fix.resolves_step_id = buggy.step_id`. If multiple buggies link to the
same fix, only the latest (canonical, section 9.2) keeps the link; the
others fall to `dead_end` in Pass B. This enforces section 12.7's
one-buggy-one-fix rule.

**Pass B (assign_labels)**: deterministic per section 12.3:

```
valid   = local_validity        >= validity_threshold
useful  = retrospective_usefulness >= usefulness_threshold
if valid and useful:            clean_success
elif valid and not useful:      stale_info
elif not valid and has_fix:     error_recovery_buggy
elif not valid and is_fix:      error_recovery_fix
else:                           dead_end
```

A valid fix is labeled `clean_success` (section 12.3 prose); the
`error_recovery_fix` label is reserved for the edge case of an invalid
fix. Downstream emit / DPO logic identifies fixes via
`resolves_step_id`, not via the label, so this split is intentional.

After labeling, `retrospective_usefulness` is boosted to `max(value,
0.8)` on any step with `resolves_step_id` set (the section 12.2 fix
boost).

### Stage 4 -- compression.py

Three operations, all mutate per-step flags only (physical removal is
deferred to Stage 6):

**(1a) Within-trajectory redundancy** (`redundancy_compress`): consecutive
same-signature `clean_success` actions inside one trajectory; relabel
followers as `redundant`. Useful when a trajectory loops over the same
operation.

**(1b) Cross-trajectory redundancy**
(`redundancy_compress_across_trajectories`): the canonical section 5
Stage 4 case. Trajectories with identical action-signature sequences are
compared via `LLMJudge.same_variant(goal_a, goal_b)`; follower
trajectories' action steps are relabeled `redundant`. Trajectories
containing any recovery (error_recovery_buggy / error_recovery_fix) are
exempt from cross-traj collapse so redundancy and failure compression
operate on disjoint regions.

**(2) Failure compression** (`failure_compress`): inside an
error_recovery episode (canonical buggy linked to its fix), drop
intervening `dead_end` actions. Three modes: `off`, `conservative`
(drop only inside-episode dead_ends, default), `aggressive` (also drop
outside-episode dead_ends). "Drop" = `compressed_out = True`.

Action signature (D19), in `compression.action_signature`:
- `bash`: `bash:<first-verb>:<flags>` where verb is the first whitespace
  token (`wc`, `sed`, `python`, `apt`, `git`, ...) stripped of any path
  prefix, and flags is a comma-joined subset of `pipe`, `redirect`,
  `subshell` based on `|`, `>`/`>>`, `$()` or backtick.
- `edit` / `write` / `read`: `<tool>:<file-extension>`.
- Other tools: `<tool>:`.

Conservative by design (D19): two bash sequences with different verbs
**will not** collapse; under-collapse is the safe failure direction.

### Stage 5 -- backfill.py + reasoning.py

`backfill(scored_steps, writer, max_workers=1) -> BackfillResult` with
two dicts: `reasonings[action_step_id]` and `reflections[fix_step_id]`.

- **Reasoning** is generated for every kept action (label in
  {`clean_success`, `stale_info`, `error_recovery_buggy`,
  `error_recovery_fix`} and not `compressed_out`). The writer receives
  `scored_steps[:idx]` -- a strict prefix -- making the "no hindsight"
  invariant (D7) structural, not conventional.
- **Reflection** is generated for every step whose `resolves_step_id`
  is set (i.e. every fix). The writer sees the buggy action, its
  tool_result, and the corrective action.

The Anthropic writer's prompts (`reason`, `reflect`) live in
`_anthropic.py`. The mock writer returns deterministic templates keyed
by `source_part_id` (section 12.11). Under `max_workers > 1` the prompts
are dispatched in parallel via `concurrent.futures.ThreadPoolExecutor`
before the sequential collection loop runs.

### Stage 6 -- assemble.py

`assemble_trajectory(scored_steps, backfill_result, validity_threshold,
min_answer_chars, answer_weight, answer_warn_chars) -> AssembleResult`.

Walks `scored_steps` in source order, drops `compressed_out` actions and
`redundant` / `dead_end` actions (and their tool_results), and emits
spans per the section 6 table:

| Span kind | loss_mask | Why |
|---|---|---|
| `user` | 0 | context |
| `tool_result` | 0 | context |
| `reasoning` (pre-clean / corrective / stale_info) | 1 | teach think-then-act |
| `reasoning` (pre-`error_recovery_buggy`) | 0 | D16 unconditional |
| `reflection` | 1 | teach diagnosis/recovery |
| `answer` | 1 iff `local_validity >= validity_threshold` (section 12.5) | scored; trivial answers below `min_answer_chars` dropped |
| `action` (clean / corrective / stale_info) | 1 | desired behavior |
| `action` (`error_recovery_buggy`) | 0 | conditioned-on, not reinforced |

Section 12.4 places `reflection` between the buggy tool_result and the
fix's reasoning. Concretely the emit order around a fix is:
`... buggy_action, buggy_tool_result, reflection, reasoning_for_fix,
fix_action, ...`.

`call_id` is propagated onto each `action` and `tool_result` span's
`provenance` so Stage 7's serializer can produce matching
`tool_call_id`s.

### Stage 7 -- emit.py + verify.py

`emit_sft(spans, system_prompt) -> list[dict]`: one example per
`loss_mask=1` span. Input = preceding spans rendered as OpenAI messages
(including masked ones). Output = the trained span as a single assistant
message. Use `serialize.span_to_message(span)` for each.

`emit_dpo(spans, scored_steps, granularity, system_prompt) -> (list[dict],
skipped_count)`: walks fix steps, builds canonical pairs. Skips and
counts pairs where rejected would be an `answer` span (section 12.5
Phase-1 exclusion).

`verify(...)` produces `VerificationReport`:
- Recomputes `kept_spans`, `dropped_spans`, `masked_action_count`,
  `success_vs_recovery_ratio`.
- Checks structural invariants (recoveries preserved, no empty outputs,
  no loss_mask=1 action is Stage-2-invalid).
- Calls `rejudge_sft_sample(sft_examples, judge_obj, ...)` for the
  10% sample (`verify_sample_rate` default 0.10, cap 50). Skips when
  `using_mock=True`.

## 7. Configuration

All defaults follow spec sections 5.2 and 12.10. CLI flags wrap the
`Config` dataclass; ones worth knowing:

| Flag | Default | What |
|---|---|---|
| `--input` | required | OpenCode session JSON path |
| `--out-dir` | `./out` | output directory |
| `--no-llm` | False | force mock judge + writer |
| `--judge` | `mock` | model id; non-mock value implies real Anthropic |
| `--reasoning-writer-model` | `claude-sonnet-4-6` | |
| `--emit` | `sft` | `,`-separated subset of `{sft,dpo}` |
| `--redundancy` | `collapse` | `off` \| `collapse` |
| `--failure-compression` | `conservative` | `off` \| `conservative` \| `aggressive` |
| `--dpo-granularity` | `canonical` | `canonical` \| `all` \| `first` \| `last` |
| `--policy-threshold` | 0.5 | `policy_score >= threshold` => gate passes |
| `--strict-local` | False | drop the policy_gate, deterministic-only |
| `--answer-weight` | 1.0 | down-weight terminal answers |
| `--min-answer-chars` | 0 | drop trivial confirmations |
| `--answer-warn-chars` | 8000 | warn-only threshold |
| `--max-llm-calls` | None | circuit breaker (D20) |
| `--max-workers` | 1 | parallel LLM call fan-out |
| `--system-prompt` | None | inject a system message if set |
| `--seed` | 0 | re-judge sampling seed |

## 8. LLM judge interface and the mock contract

`LLMJudge` Protocol (section 5.1):

```python
is_new_task(prev_goal, user_text) -> bool
subgoal_score(task_goal, step, outcome, lookahead) -> float in [0,1]
policy_score(step, governing_user_text) -> float in [0,1]
same_variant(goal_a, goal_b) -> bool
resolves(buggy_step, candidate_fix, intervening_steps) -> bool
rejudge_example(input_messages, output_message) -> bool
```

`ReasoningWriter` Protocol:

```python
reason(context, action) -> str       # pre-action prose, no hindsight
reflect(buggy_action, tool_result, corrective_action) -> str
```

### MockLLMJudge / MockReasoningWriter

Pinned by section 12.11 -- the entire point is that the Phase-1 golden
snapshot is deterministic:

| Method | Mock value |
|---|---|
| `is_new_task` | `False` unless `prev_goal` is empty/None (then `True`) |
| `subgoal_score` | `0.55` |
| `policy_score` | `0.95` |
| `same_variant` | `True` |
| `resolves` | `True` |
| `rejudge_example` | `True` (re-judge is skipped under mock anyway) |
| `reason()` | `f"[reasoning:{action.source_part_id}]"` |
| `reflect()` | `f"[reflection:{corrective_action.source_part_id}]"` |

### AnthropicLLMJudge / AnthropicReasoningWriter (`_anthropic.py`)

All calls go through `_AnthropicBackend.ask(system, user, max_tokens)`:

1. Compute `cache_key = sha256(payload + model_id + pipeline_version)`.
2. Cache hit -> return cached text, do not increment `calls_used`.
3. Cache miss -> check budget, call `messages.create(temperature=0)`,
   increment `calls_used`, store response.

The cache is a flat directory of `<sha256>.json` files. File-per-key
means cross-thread writes never collide. Bumping `PIPELINE_VERSION`
invalidates the entire cache.

Three prompt categories:
- **Booleans** (`is_new_task`, `same_variant`, `resolves`,
  `rejudge_example`): `max_tokens=8`, system prompt asks for "exactly one
  word: YES or NO", parser is `_parse_yes_no` (first character of first
  token == 'Y').
- **Scores** (`subgoal_score`, `policy_score`): `max_tokens=16`, system
  prompt asks for "exactly one number between 0.0 and 1.0", parser is
  `_parse_score` (regex-extract, accept 0-100 scales by dividing).
- **Prose** (`reason`, `reflect`): `max_tokens=300`, system prompt
  constrains style (no hindsight in `reason`; name failure mode in
  `reflect`).

Step rendering in prompts is via `_summarize_step` (compact one-line)
and `_summarize_context` (last 12 steps joined). Both are
deterministic; their output is part of the prompt and therefore the
cache key.

## 9. Determinism, caching, and reproducibility

The golden-snapshot test (`tests/test_pipeline.py::test_golden_snapshot_matches_mock_outputs`)
hashes `out/sft.jsonl` + `dpo.jsonl` and compares against
`tests/golden/*.sha256`. To regenerate after an intentional change,
`REGEN_GOLDEN=1 pytest tests/test_pipeline.py::test_golden_snapshot_matches_mock_outputs`.

Three invariants make the golden snapshot meaningful:

1. **Cache keys are content-addressed** (sha256 of prompt + model + version).
2. **Action serializer is byte-stable** (sorted keys, compact JSON,
   matching call_ids).
3. **Mock contract is pinned** (section 12.11).

If you change a prompt template or scoring rule, **bump `PIPELINE_VERSION`**
in `__init__.py` so existing caches don't return stale judgments.

## 10. Known limitations (honest list)

1. **Episode 1 (stale-info) is mislabeled** under the current detector.
   The bash `ls ./roms/...` that returned "No such file or directory" is
   labeled `error_recovery_buggy` because syntactic catches the error
   marker; spec section 7 wants it `stale_info` (the path was supplied
   by the user, the action was reasonable given the info available at
   the time). The proposed fix is a provenance check ("did the failing
   argument appear verbatim in the governing user_text?") -- not
   implemented.

2. **Episode 3 (unpersisted edit) is no longer caught.** The earlier
   "edit + no patch part" heuristic was disabled because it over-flagged
   most real edits in the OpenCode export. The correct catch needs a
   read-back diff signal the JSON export doesn't carry.

3. **DPO data has residual noise.** The most recent Phase-2 run produces
   4 DPO pairs; 3 are real semantic violations the LLM caught (multi-step
   batched command, scope creep, hiding UI when asked to improve), 1 is
   the episode-1 mislabel above. The 27% re-judge disagreement rate is
   high enough that we should not consider this corpus deployment-ready.

4. **DPO heterogeneous pairs deferred.** When the buggy step is an
   `answer` (text) and the fix is an `action`, the pair has mismatched
   shapes -- the serializer is action-only today. Phase-1 exclusion
   skips and counts these; a `serialize_span` covering both shapes is
   future work (section 12.5 follow-up).

5. **Re-judge logs counts only, not which examples disagreed.** A
   ~10-line follow-up would record `(span_kind, provenance.step_id,
   judge_reason)` for each disagreement so failures are inspectable.

6. **Cross-trajectory redundancy depends on real LLM segmentation.** The
   mock collapses everything into one trajectory, so cross-traj
   compression has no input to work on -- the variant-collapse acceptance
   episode is Phase-2-only.

7. **Mock subgoal_score = 0.55 means under `--no-llm` you cannot
   distinguish `stale_info` from `clean_success` semantically.** Either
   both pass the usefulness gate (0.55 > 0.5) or both fail. Real LLM is
   required for that distinction.

8. **The pipeline assumes one session per run.** No batching, no merging
   across sessions. Scaling to many sessions requires a small wrapper.

## 11. Testing strategy

Five layers, cheapest first:

1. **Per-module unit tests with the mock judge.** Fast, deterministic,
   run on every change. ~190 tests.
2. **Acceptance tests for the section-7 episodes** (`tests/test_acceptance.py`).
   Keyed by `(source_part_id, kind)` per D18 -- stable across
   stage-0 reorderings. Mix of Phase-1 deterministic assertions and
   Phase-2-only structural assertions.
3. **Domain-leak audit** (`tests/test_load.py::test_no_domain_strings_in_module_code`,
   `tests/test_acceptance.py::test_no_domain_strings_anywhere_in_traj_pipeline`).
   Word-boundary regex over `traj_pipeline/*.py` for `berzerk`,
   `checker`, `rom`, `z80`, `rubric`, `gemma`, `nvidia`. Fixtures
   excluded.
4. **End-to-end smoke + golden snapshot under `--no-llm`** (`tests/test_pipeline.py`).
   Locks the mock output bytes.
5. **Mocked-SDK Anthropic backend tests** (`tests/test_anthropic_backends.py`).
   Validates call shape, parse logic, cache hit, budget breaker -- no
   real API calls.

Real Anthropic runs are not in CI. They're run manually by setting
`ANTHROPIC_API_KEY` and invoking the CLI.

## 12. Common tasks

### Run the pipeline on a new fixture

```
.venv/bin/python -m traj_pipeline \
    --input path/to/new_session.json \
    --out-dir ./out_newsession \
    --judge claude-sonnet-4-6 --emit sft,dpo \
    --max-workers 10
```

Same cache, same model id => most calls hit cache if the new fixture
overlaps the old.

### Add a new tool to the redundancy signature

`compression.action_signature` currently special-cases `bash`, `edit`,
`write`, `read`. To add `grep` or whatever: add a branch returning a
deterministic signature string. Test in `test_compression.py`.

### Tune the policy detector

Two places matter:
- `signals._VERB_TO_TOOL`: add verb -> tool mappings for the
  forbidden-verb case.
- `signals._COUNT_PATTERNS`: add regex patterns for count-bounded
  constraints.

Bump `PIPELINE_VERSION` in `__init__.py` after either change (the cache
won't notice the regex change otherwise).

### Inspect why a step got a particular label

Open `trajectories.json`, find the trajectory, find the step by
`source_part_id`. Look at `axes`, `local_validity`,
`retrospective_usefulness`, `constraint_violations`, `resolves_step_id`,
`label`, `compressed_out`. Cross-reference `spans` to see if it became a
span and at what `loss_mask`.

### Trace an SFT line back to its source

`sft.jsonl` line N corresponds to the Nth `loss_mask=1` span in source
order across all trajectories. Each Span has `provenance.step_id` in
`trajectories.json`. Looking up `step_id` in `scored_steps` gives you
the full Step + scoring path.

### Add a new judge call

1. Add the method to `LLMJudge` Protocol in `judge.py`.
2. Add a mock impl returning a deterministic value to `MockLLMJudge`.
3. Add a real impl to `AnthropicLLMJudge` in `_anthropic.py` -- wrap
   `self.backend.ask(system=..., user=..., max_tokens=...)` and a
   parser.
4. Bump `PIPELINE_VERSION`.
5. Write unit tests for both impls.

### Add a new verification check

`verify.py` builds the `VerificationReport`. Add the new field to the
dataclass + `to_dict`, compute it inside `verify(...)`, append a
`failures` entry on violation. Update the section 8 expected-output list
in the spec if the field is a required one.

## 13. The cache

`.cache/traj_pipeline/<sha256>.json`. Each file:

```json
{
  "meta": { "system": "...", "user": "...", "max_tokens": 256 },
  "response": "<the model's reply text>"
}
```

`meta` is informational; the file is keyed on the hash. The hash is over
`(payload, model_id, pipeline_version)` where `payload` is exactly what
gets sent. Two consequences:

- Changing `_summarize_step` or any prompt template changes the cache
  key and invalidates entries. Bump `PIPELINE_VERSION` if the change is
  intentional.
- Two `LLMJudge` instances with the same model id share cache entries.
  This is why one `PromptCache` is constructed in `cli._build_backends`
  and passed to both the judge and writer backends.

To wipe the cache: `rm -rf .cache/traj_pipeline/`.

## 14. Where to look for the spec authority

`trajectory_pipeline_spec.md` at the repo root. Sections most worth
reading first:

- Section 1: the D-codes (D1..D22). These are the load-bearing decisions
  and the rest of the spec reads as elaboration.
- Section 12: quantitative defaults and deterministic algorithms. This
  is where the implementation guesswork goes to die. Section 12.3 has
  the exact label-assignment algorithm; section 12.11 pins the mock.
- Section 9: the round-1 decision rationales. Useful when you're
  tempted to "improve" something and want to know if it was already
  considered.
- Section 11: round-2 ambiguity resolutions.

Where the implementation deviates from the spec text, it's because the
deviation was negotiated explicitly during implementation; those moments
are recorded in `session_status.md` with the date and reasoning.
