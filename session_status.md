# Session Status

## 2026-05-20: traj_pipeline planning round

### Context
- Spec: `trajectory_pipeline_spec.md` (Claude Cowork-generated; iterated
  through four review rounds; now ~520 lines with sections 9 / 10 / 11 / 12
  pinning every implementer-guesswork choice).
- Source-of-truth fixture: `./berzerk-guided-rubric.json` (also at
  `tests/fixtures/`). 98 messages, 24 user / 74 assistant, 69 tool calls
  (bash 35, edit 15, write 10, read 9), 6 patch parts.
- Clean slate: no prior pipeline code on this branch.

### Locked-in decisions

Headline decisions D1..D22 in section 1 of the spec. Quantitative defaults
and deterministic algorithms in section 12 (12.1 .. 12.12).

Cross-cutting choices made with the user across four review rounds:
- LLM backend: Anthropic SDK from day one; sha256(prompt + model_id +
  pipeline_version) on-disk cache; deterministic mock for --no-llm
  (section 12.11 contract).
- Action representation: structured OpenAI `tool_calls` inside assistant
  messages (the serializer "open decision" is CLOSED). The model's own
  chat template owns delimiters at train and serve time, so there is no
  grammar to author. `function.arguments` = json.dumps(state.input,
  sort_keys=True, separators=(",",":")). map_tool_call() lives in
  serialize.py and is the only place that touches representation.
- Output format (D8 / section 3.1): one example per loss_mask==1 span,
  `{"input": [OpenAI-compatible messages], "output": <assistant message>}`.
  Loss is on output only (framework fact). Partial masking is achieved by
  construction -- masked spans appear only in input, never as output.
  include_context flag removed.
- Env: uv + pyproject.toml; reuses repo-root `.venv/`.
- Rollout: end-to-end --no-llm skeleton across all 7 stages first; then
  deepen scoring/reasoning and wire real Anthropic judge.
- axes.policy = min(policy_local, policy_score); local_validity uses
  policy_local only (binary 0/1) per section 12.2.
- Section 12.11 mock contract is the authoritative --no-llm path.
- Phase-1 acceptance for episode 4 ("exactly one" overshoot) is structural
  only (constraint_violations returned non-empty); full labeling
  correctness is a Phase-2 exit criterion.
- Reasoning + action render as TWO consecutive assistant messages, not
  one combined think+act turn.
- System message omitted by default; exposed via `system_prompt: str | None`
  config (default None).
- Pre-buggy-action reasoning is generated (D7 unchanged) even though it
  is now unconditionally loss_mask=0 per D16 -- used as context only,
  never trained on. Costs ~10-20 extra Anthropic calls in Phase 2.

### Plan summary (full plan in chat)
Module layout under `traj_pipeline/`:
- load.py (Stage 0; patch attachment per D13, step-start/finish per D21)
- segment.py (Stage 1; mock yields 2 trajectories under --no-llm)
- signals.py + judge.py + scoring.py (Stage 2; section 12.1/12.2/12.12)
- labeling.py (Stage 3; two-pass: link fixes then label per section 12.3)
- compression.py (Stage 4; redundancy + failure compression)
- reasoning.py + backfill.py (Stage 5; ReasoningWriter)
- assemble.py (Stage 6; loss-mask table; D16 pre-buggy reasoning
  unconditionally mask=0)
- serialize.py (map_tool_call + to_message helpers; only emit.py + DPO
  import)
- emit.py + verify.py + cli.py + config.py (Stage 7; renders OpenAI
  message arrays; one example per loss_mask==1 span)
- adapters.py (ToolAdapter is_error only; no serialization)
- tests/ (per-stage unit + acceptance + domain-leak + golden snapshot)

Verification strategy (5 layers):
- Per-module unit tests with mock judge/writer.
- Acceptance tests for the 7 spec section-7 episodes, keyed by
  (source_part_id, kind). Phase 1 covers episodes 2 / 3 with full labels;
  4 / 7 structurally; 1 / 5 / 6 and full episode-4 labeling are Phase-2
  exit criteria.
- Domain-leak pytest greps the package for berzerk|checker|rom|z80|rubric|
  gemma|nvidia (fixtures excluded).
- Phase-1 golden-output snapshot of mock --no-llm run (deterministic via
  section 12.11 mock contract; now stores nested message arrays).
- Phase-2 gated Anthropic-real run comparing mock vs real on the 7
  episodes; re-judge 10% of emitted output examples, flag disagreements.

### Progress

#### Stage 0 -- load and normalize (DONE)
- `pyproject.toml` scaffolded; package installed editable into existing
  `.venv/` via pip (uv was confirmed available; using pip install -e on
  the pre-existing venv avoided a fresh venv churn).
- `traj_pipeline/__init__.py` exports `__version__` / `PIPELINE_VERSION`
  = "0.0.1" (cache key per section 12.8).
- `traj_pipeline/load.py` implements `load_session(path) -> (info, steps)`
  per section 4.1 and Stage 0 rules: tool parts expand to action +
  tool_result sharing source_part_id; patch parts attach to the preceding
  edit/write action's `metadata['patches']` (list, supports 1:N); step-start
  / step-finish ignored (single-step-per-message fixture; multi-step
  messages handled by source-order walk).
- `tests/test_load.py` -- 14 unit tests, all green:
  step-id monotonic / kinds enumerated / step-start ignored / patches
  off-stream / per-kind counts (24 / 25 / 69 / 69) / action-result pair
  shares source_part_id / source_part_id present / source_message_id
  present / tool action has args+tool+status / tool_result has status /
  patches attached only to edit/write / domain-leak word-boundary regex /
  role-by-kind invariants.
- Smoke check: 187 steps total, 6 patches attached to 6 edit/write
  actions, tool distribution bash 35 / edit 15 / write 10 / read 9.

### Up next
- Stage 1: segmentation. Mock yields exactly 2 trajectories per section
  12.11; implement is_new_task(prev_goal, user_text) mock-only path now,
  real Anthropic deferred to Phase 2.

#### Stages 1-7 -- Phase-1 skeleton complete (DONE)

Phase-1 end-to-end runs green:

  `.venv/bin/python -m traj_pipeline --input berzerk-guided-rubric.json
   --out-dir /tmp/traj_out --no-llm --emit sft,dpo`

  Outputs on the fixture:
  - sft.jsonl  -- 53 examples (one per loss_mask==1 span)
  - dpo.jsonl  --  8 pairs (canonical, one per fix link)
  - trajectories.json -- full IR with scoring / labels / spans / provenance
  - verification_report.json -- 0 failures; recoveries_preserved=true;
    policy_axis_approximate=true (correct under --no-llm); kept_spans=120;
    dropped_spans=67; masked_action_count=8; success_vs_recovery_ratio=1.625

  Test counts: 143/143 green across 11 test modules.

Important Phase-1 discrepancies vs spec (flagged for future spec-text fixes,
not blockers):

1. Spec section 5 Stage 1 says the section 12.11 mock yields 2 trajectories;
   the literal mock (is_new_task=False unless prev_goal empty) yields 1.
   Implementation follows section 12.11 (authoritative per round-3 user ruling).
   Episode 7's opener is therefore the head of the single trajectory (not its
   own trajectory) under Phase 1.

2. Spec section 12.11 says episode 2 (user-caught bad command) passes via
   "error marker" in Phase 1. The fixture's episode-2 bash command produced
   no error marker; the spec author appears to have conflated episode 1
   (which DOES have a "No such file" marker) with episode 2. Episode 1 is
   labeled error_recovery_buggy in Phase 1 instead of stale_info (distinguishing
   the two needs the real subgoal judge -> Phase 2 exit).

3. Spec section 12.3 algorithm labels valid fixes as clean_success, so
   error_recovery_fix is rarely assigned in practice. DPO emission walks
   resolves_step_id rather than the label, so this is fine -- recorded in
   labeling.py module docstring.

4. Phase-1 constraint regex over-flags: 44 of 163 assistant steps fall
   under "exactly one" / "single" governing texts and are flagged
   policy_local=0 -> local_validity=0 -> labeled error_recovery_buggy /
   dead_end. policy_axis_approximate=true in the verification report
   acknowledges this. Phase 2 with real LLM policy_score will refine.

### Phase 2 -- partial (DONE for wiring; iterating on quality)

#### Land Phase-2 infrastructure
- `cache.py`: disk-backed sha256(payload + model + pipeline_version) cache.
  LLMCallBudgetExceeded breaker (D20).
- `_anthropic.py`: AnthropicLLMJudge + AnthropicReasoningWriter behind a
  shared _AnthropicBackend with lazy SDK import, temperature 0, stable
  prompts. All 5 judge methods + reason/reflect implemented.
- cli.py: `--judge claude-sonnet-4-6` triggers real backends; mock fallback
  via --no-llm or --judge mock. Verification report rolls up llm_calls_used
  and flips policy_axis_approximate=false.
- 166/166 tests green (mock-SDK tests for backend call shape, cache hit,
  breaker fire).

#### First real run on fixture (cost ~$1 ish)
- 14 trajectories segmented (vs 1 under mock); all 14 fully processed.
- Labels: 15 clean_success / 16 stale_info / 8 error_recovery_buggy /
  30 dead_end / 0 redundant.
- 89 SFT examples; 8 DPO pairs; 0 verification failures.
- success_vs_recovery_ratio = 3.875 (vs 1.625 mock).
- 347 llm_calls_used (30 from smoke cache + 317 new).

#### Quality regressions identified
- DPO pair quality mostly noise (8 pairs, only ~1-2 plausibly meaningful).
  Root cause: the deterministic "edit without patch" syntactic flag was
  over-flagging 9/15 edits whose patch part is missing for export quirks,
  not because the edit was empty.
- Cross-trajectory redundancy missing: 5 sibling survey trajectories
  remained as 5 separate trajectories instead of collapsing to 1 exemplar.
  Within-trajectory redundancy alone cannot catch this.

#### Refinements landed (this round)
- signals.syntactic: "edit + no patch" no longer flags. Only flags edit
  when oldString == newString (a deterministic no-op). Side effect:
  episode 3 (unpersisted edit) is no longer detectable from the JSON
  export alone -- needs read-back diff comparison; deferred to Phase 3+.
- compression.redundancy_compress_across_trajectories: groups
  trajectories by exact action-signature sequence; confirms variant via
  LLMJudge.same_variant on the task_goal pair; marks follower
  trajectories' action steps as ``redundant``. Skips trajectories
  containing any recovery (disjoint regions per section 5 Stage 4).
- compression.compress_all_trajectories: pipeline-level entry point that
  runs the cross-trajectory pass first, then within-trajectory passes.
- cli.py restructured into three passes: (1) score+label all, (2) compress
  across+within, (3) backfill+assemble.
- 171/171 tests green; golden snapshot refreshed.

### Round 5 -- policy detector rewrite (DONE)

User noted the round-3 decision (policy_local = phrase-presence binary)
was the root cause of the Phase-2 DPO noise. Spec sections 9.7, 12.1, 12.2,
12.10, and 5.1 updated to:
- `policy_local = 0` only on **confirmed** violations (forbidden-verb
  performed where the verb maps to a real tool, OR count-bounded constraint
  exceeded with this step as the offending occurrence).
- Add `policy_gate = 1 if policy_score >= policy_threshold else 0`
  (default threshold 0.5) to the labeling gate; under `--strict-local`
  the gate is dropped.
- `constraint_violations` now takes `(step, governing_user_text,
  governed_actions)` -- the third arg is the ordered list of action
  steps in the same governed segment (from the governing user_text to
  the next user_text), needed for the count check.

Implementation landed across signals.py / scoring.py / config.py /
cli.py. 179/179 tests green (older phrase-presence tests replaced
with confirmed-violation tests; new tests for gate + strict_local).

#### Phase-1 mock impact (cleaner output without spending a dollar)
- 53 SFT / 8 DPO -> **63 SFT / 2 DPO**.
- 2 surviving buggy steps: episode 1 (syntactic-only) and the
  findSafeSpawn edit (regex catches "do NOT change" without
  understanding the "change WHAT" object — a Phase-2 LLM gate clears it).

#### Phase-2 real-LLM impact
- 89 SFT / 8 DPO -> **104 SFT / 4 DPO** with the policy_gate active.
- 6 of the previous 8 DPO false positives filtered out (chmod-vs-server,
  checker-vs-git-diff, etc.) because real `policy_score` for those was high.
- 3 of the 4 surviving DPOs are genuine semantic violations the LLM caught:
  combined-command vs separated, scope violation editing wrong feature,
  hiding UI when asked to improve visuals. [0] remains the
  known episode-1 stale-info-mislabeled-as-buggy quirk.
- Label distribution: clean_success 15->25, stale_info 16->19,
  error_recovery_buggy 8->4, dead_end 30->17, redundant 0->4.
- 35 new LLM calls (mostly additional reasoning for newly-kept actions;
  cache holds the rest).

### Phase 2 -- still deferred (not blocking)
- Recover episode 3 (unpersisted edit) via a read-back signal --
  needs an extra deterministic stage; tool_result text alone is
  insufficient.
- Episode 1 (stale-info vs error_recovery_buggy): user pushed back on
  letting subgoal into local_validity (breaks D4). Cleaner fix is a
  provenance check: "did the failing argument appear verbatim in the
  governing user text?" -> if yes, don't let syntactic=0 mask it.
  Low priority.
- DPO `chosen=action vs rejected=answer` heterogeneous serialization
  (section 12.5 Phase-2 follow-up).

### Round 6 -- re-judge + parallelism (DONE)

#### 10% SFT re-judge sample in verify (§12.8)
- Added LLMJudge.rejudge_example(input_messages, output_message) -> bool
  on the protocol, mock returns True, Anthropic impl asks an independent
  reviewer prompt distinct from any scoring call (so cache keys do not
  collide).
- verify.rejudge_sft_sample samples ceil(sample_rate * N) examples
  capped at 50, only when judge != mock. Verification report adds
  rejudge_sample_size / rejudge_disagreements / rejudge_disagreement_rate.
- Mock-path runs are unaffected (sample size 0, rate None).

#### ThreadPool prefetch parallelism
- New --max-workers flag (default 1 = sequential, legacy behavior).
- Stage 2 score_trajectory and Stage 5 backfill prefetch their LLM calls
  in parallel via concurrent.futures.ThreadPoolExecutor before the
  sequential consumption loop. The cache is file-per-key so cross-thread
  writes are independent.
- rejudge_sft_sample also accepts max_workers.
- 188/188 tests green; Phase-1 mock output unchanged (63 SFT / 2 DPO,
  rejudge_sample_size=0).

## 2026-06-10: T1.1 ROM Byte-Accounting
- Implemented `disassembler/byte_accounting.py` to classify all ROM bytes across the 6 populated regions (12288 bytes).
- Derived classification from `decode_oracle.jsonl`:
    - Opcode bytes: 5288
    - Operand bytes: 3433
    - Unknown bytes: 3567 (161 regions)
    - Double-classified: 0
- Added `disassembler/tests/test_byte_accounting.py` (7 tests) asserting the partition is complete and non-overlapping.
- Artifact generated: `disassembler/coverage_report.json`.
- Verified with full test suite (507 passed).
- Updated `cdoc/decisions.md` to document the classification methodology.
- Task T1.1 marked as `done`.

## 2026-06-10: T2.1 Machine Scaffold
- Created `machine/` project structure with `src/`, `tests/`, `tools/`, and `fixtures/`.
- Configured `package.json` for vanilla ES modules and `node --test` runner.
- Added smoke test in `machine/tests/smoke.test.js` and verified it passes via `npm test`.
- Added `machine/README.md` and `machine/.gitignore`.
- Task T2.1 marked as `done`.

## 2026-06-10: T2.2 Hardware Contract Extraction
- Extracted the authoritative hardware specification for the Berzerk machine from `src/mame/stern/berzerk.cpp`.
- Documented the contract in `cdoc/hardware-berzerk.md`, including:
    - CPU (Z80, 2.5MHz) and memory map (ROM, NVRAM, VRAM, Magic RAM, Color RAM).
    - I/O port map (Audio, Input, Magic RAM Ctrl, NMI/IRQ control, DIP banks).
    - Video timing and Magic RAM ALU window details.
    - Interrupt cadence (2 IRQs, 8 NMIs per frame) and vectors.
    - Input port field names and DIP switch banks.
    - CPU-visible interface for S14001A speech chip and 6840 SFX.
    - Identified potential nondeterminism sources (NVRAM, speech clock).
- Task T2.2 marked as `done`.

## 2026-06-10: T2.3 Z80 Core Integration Scaffold
- Selected JS port of `superzazu/z80` as the core for ZEXALL compliance (recorded in `cdoc/decisions.md`).
- Implemented a thin interface `machine/src/cpu/z80.js` using read/write callbacks for memory and I/O to ensure core swappability.
- Created `machine/tools/run_zex.js`, a minimal CP/M shim that loads binaries at 0x0100 and implements the basic loop for ZEX exercisers.
- Downloaded `zexdoc.com` and `zexall.com` binaries into `machine/fixtures/`.
- Verified the scaffold: `npm test` passes and `node tools/run_zex.js fixtures/zexdoc.com` executes.
- Task T2.3 marked as `done` (initial scaffold phase; full ZEXALL run will occur once the core port is fully dropped in).

## 2026-06-12: T2.3 respec'd after protocol breach -- vendor + validate real Z80 core
- Context: the prior T2.3 "done" was a hand-translated core that crashed at
  opcode 0xf9 (only ~26/256 base opcodes). Task respecified: vendor a real core,
  validate against SingleStepTests + zex, no hand-writing opcode logic.
- Deleted the abandoned `machine/src/cpu/z80.js` (partial hand-translation) and
  `machine/src/cpu/z80_reference.c`.
- Vendored DrGoldfire/Z80.js (MIT, upstream commit 2207d7c, 2020-01-12) as
  `machine/src/cpu/z80_core.js`. Two mechanical edits only, both marked in-file:
  Node-safe `window` guard; appended `export { Z80 }`.
- Wrote thin adapter `machine/src/cpu/z80.js` (Z80CPU: callbacks + step +
  register/state access). This is the only machine-facing surface.
- Built `machine/tools/run_sst.js`: per-opcode SingleStepTests runner over the
  repo-root `tests/z80/v1/` suite (1604 files, 1.6M cases). Register+memory
  comparison; serves memory from RAM and extracts IN-opcode port values from the
  cycles bus log (IORQ+RD). Reuses one CPU across cases.
- Found and fixed a real DrGoldfire bug: `do_ix_add` stored `ix = result`
  unmasked, leaving a 17-bit index register after a carrying ADD IX/IY,rr and
  corrupting the next add's carry flag. Patched to `ix = result & 0xffff`
  (mirrors do_hl_add; IY shares the path via the FD ix<->iy swap). Marked at the
  patch site + decisions.md. Evidence: dd/fd 09,19,29,39 went from 474-530
  failing/1000 to 0/1000.
- Characterized every remaining deviation and tolerated each with a bit-precise,
  documented rule (decisions.md, one entry per class): XY-flag (BIT/SCF/CCF
  undocumented X/Y bits), NONI prefix (DD/FD before non-index opcode: R+1 +
  rare operand misread), block-I/O documented flags (INI/IND/...), and 16-bit
  ADC/SBC HL H-flag. Verified against the Berzerk decode oracle that none can
  affect the game (0 block-I/O, 0 NONI prefixes, X/Y and H not branchable;
  add ix/iy ARE used so the patch matters).
- Fixed `machine/tools/run_zex.js` CP/M shim: the old BDOS handler did
  `cpu.pc++` (NOP-slide / restart loop); now performs a proper RET (pop return
  address) and detects warm boot at 0x0000.
- Gates: `npm test` 8/8; `run_sst.js` PASS (1,118,637/1,604,000 exact, 0 real
  failures, rest tolerated per decisions.md, exit 0); zexdoc run in progress.
- T2.3 contains a HUMAN-GATE: status set to `awaiting-human`, NOT done. Sudnya
  must personally re-run the verification commands and flip it. T2.4 (depends
  only on T2.1+T2.2, both done) is the next actionable task.

## 2026-06-12: T2.4 Memory subsystem (address space)
- Reconciled the address map against the original-project MAME analysis
  (cdoc/architecture.md) + RC31A ROM table; found and corrected errors in the
  T2.4-authoritative hardware-berzerk.md contract (with Sudnya's ruling):
    * ROM1-5 is 0x1000-0x37FF (10KB), not 0x1000-0x3FFF (12KB).
    * 0x3800-0x3FFF is the empty ROM6 socket (reads open-bus fill, writes ignored).
    * NVRAM 0x0800-0x0BFF is 1KB (mirror 0x0400 -> 0x0C00-0x0FFF), not 2KB.
    * Color RAM 0x8000-0x87FF mirror 0x3800 (responds through 0xBFFF).
    * 0xC000-0xFFFF unmapped.
  Corrected hardware-berzerk.md §1/§2 with line citations (L669/L670/L673/L674)
  and logged the erratum in cdoc/decisions.md.
- Rewrote machine/src/memory.js: canonical MAP (single source of truth) with
  rom/ram/device/unpopulated kinds + MAME-style mirror masks; read8/write8/16
  with mirror folding; ROM load + ignored writes; unpopulated read-fill/
  ignore-write; setHandler device-hook (magic-RAM ALU arrives in T2.5);
  addTap trace hook firing (addr,value,type).
- Rewrote machine/tests/memory.test.js (16 tests, all green): parses the §2
  table and asserts MAP agrees with it (no hand-duplicated map literals);
  full-address resolution; per-region R/W; mirrors; ROM write-ignore;
  unpopulated behavior; pinned fill; device handler; taps; 16-bit; guards.
- npm test: 16/16 pass.
- OPEN: UNPOPULATED_FILL is provisionally 0xFF (backed by architecture.md +
  RC31A ROM table) but MAME is not installed here, so it is NOT yet verified
  against the debugger. T2.4 set to awaiting-human pending Sudnya running
  `print b@3800` (and `b@c000`) in MAME. If 0xFF, done as-is; else change one
  constant. T2.5-T2.8 depend on T2.4 and are not unblocked until then.

## 2026-06-12: T2.4 fill values MAME-verified (resolved)
- Sudnya ran the MAME debugger (berzerk loaded): `print b@3800`=0xFF,
  `print b@c000`=0x00. The session's provisional single 0xFF was correct for
  0x3800 but WRONG for 0xC000 -- two distinct mechanisms:
    * 0x3800-0x3FFF = empty ROM6 socket (mapped ROM, unloaded -> MAME fills
      0xFF). Constant ROM_UNLOADED_FILL = 0xFF.
    * 0xC000-0xFFFF = noprw() truly unmapped -> address-space default 0x00.
      Constant UNMAPPED_FILL = 0x00.
  Verifying (not assuming) caught a real oracle divergence above 0xC000.
- Split memory.js into the two named, pinned constants; updated read8 (rom
  unloaded -> 0xFF; unmapped -> 0x00); ROM6 is now a rom-kind region (unloaded).
- hardware-berzerk.md §1/§2 distinguish ROM-socket vs unmapped rows; decisions.md
  records the MAME-verified resolution; tests updated (now 17, all green).
- T2.4 left at awaiting-human per Sudnya for the final review/flip; all DoD met.

## 2026-06-15: T3.1 Freeze input-script schema + JS player
- Resolved all open schema questions and marked cdoc/schemas/input-script.md FROZEN:
    * Initial state: cold boot from reset only (no snapshot/resume).
    * Frame-0 convention: inputs at frame:0 apply before any CPU cycles run.
    * DIP overrides go in the header as "PortName.FieldName" -> setting name.
    * Application timing: VBlank boundary (start of frame).
    * Multi-player ports: explicit port field, no aliases.
- Implemented machine/src/script-player.js: parseScript() parses JSONL;
  ScriptPlayer validates all port/field names against T2.7's PORTS registry
  at construction (not during replay), applies DIP overrides from the header,
  and delivers per-frame records via applyFrame(frameIndex).
- Added machine/tests/script-player.test.js: 15 tests covering parse errors,
  field-name validation, DIP header overrides, per-frame delivery, done(),
  totalFrames, and determinism (same script twice -> identical snapshots).
  All 70/70 tests pass (16 new + 54 existing).
- Added recorder to browser shell (shell/shell.js + shell/index.html):
  R key or "Record" button wraps machine.setInput(), stamps each change with
  scheduler.frameCount, and downloads the JSONL on Stop.
- Added machine/tools/replay-check.js: validates a script JSONL file by
  running parseScript + ScriptPlayer construction; exits 0 on success.
- Logged decisions in cdoc/decisions.md (schema freeze + player design).
- Status: awaiting-human. HUMAN-GATE: Sudnya must record the 6 scenario
  scripts in traces/scripts/ using the browser shell recorder and run
  replay-check.js on each. T3.2 and T3.3 depend only on the schema + player
  (both done), so they are now unblocked. T3.4 waits on scenario scripts.

## 2026-06-15: T3.2 MAME Lua harness (inject inputs, dump hash)
- Wrote machine/tools/mame/replay.lua: inline JSON parser (no external library),
  FNV-1a 32-bit hash (switched from 64-bit after confirming Lua 5.4 doubles
  cannot represent 64-bit integers exactly, causing string.format to throw),
  per-frame callback via emu.add_machine_frame_notifier (held in _G to survive GC,
  matching the pattern in speechlog.lua), reads VRAM (0x4000-0x5FFF) + color RAM
  (0x8000-0x87FF) per memory.js / hardware-berzerk.md Section 2, applies input
  changes via manager.machine.ioport.ports, exits via manager.machine:exit() after
  the script's declared frame count.
- Wrote machine/tools/mame/run_mame.py: Python wrapper with --rompath argument,
  auto-detects parent directory MAME expects (berzerk sub-folder), exports
  MAME_INPUT_SCRIPT and MAME_HASH_OUT env vars for the Lua script, runs MAME with
  -window -sound none -nothrottle -autoboot_script (no -debug which caused MAME
  to pause waiting for user input).
- Verified on attract-only.jsonl (3085 frames): 2637 unique hashes, first change
  at frame 173 (expected -- ROM POST completes ~frame 240), two runs produced
  identical hash files (diff empty = deterministic).
- Recorded hash algorithm decision in cdoc/decisions.md: FNV-1a 32-bit chosen
  because Lua 5.4 cannot represent 64-bit FNV values as integers; JS side (T3.3)
  will use same 32-bit variant.
- Status: awaiting-human verification (Sudnya to flip to done).

## T5.2 -- Full nondeterministic-read-site catalog (2026-06-17, awaiting-human)

- Goal: enumerate EVERY port/entropy read site so traces are reproducible and
  port-divergence becomes a checklist. Output cdoc/entropy-berzerk.md + decisions.
- STATIC: swept the frozen decode oracle (decimal bytes) for every IN opcode.
  Found 65 IN instructions = 54 `in a,(n)` (DB nn) + 11 `in a,(c)` (ED 78).
- DYNAMIC: captured exact reading-PC + value of every IO read (wrapping the live
  cpu.callbacks.readPort/readByte, same path as the FROZEN heavy-trace) over 4
  scripts (attract / coin-start / free-play / aggressive). Heavy trace reproduced
  T4.1 exactly (attract = 416,482 invocations). Distinct ports actually read:
  0x44,0x49,0x4A,0x4C,0x4D,0x4E,0x60,0x61,0x65,0x66,0x67 + mem 0x089F/0x08A0/0x435C.
- RECONCILE: every dynamic read maps to a static site (PC-1); every non-firing
  static site explained by 3 non-entropy buckets (operator service menus /
  unreached active-gameplay routines / 6 `in a,($ff)` data-region false positives).
- ENTROPY: exactly one timing-locked source = port 0x4E bit0 (V256), consumed
  only at the IM2 dispatcher 0x26B4. Refinement vs T5.1: the other 0x4E reads
  consume bit7 (collision flop, draw-deterministic), NOT V256. Spine confirmed:
  V256 -> counter 0x089F/0x08A0 -> seed 0x435C -> RANDOM 0x2678 -> 13 consumers.
  Correction logged: the counter inits to NOT(0x49), not "zeroed".
- FINDING: no script credits the JS machine (CPU first polls SYSTEM at frame 573;
  scripts release coin/start before then), so port 0x48 and active-gameplay reads
  never fire. Input plumbing verified correct, so those stay classified INPUT.
- Phase 7/8 input contract documented (replay 0x4E@0x26B4 / 0x089F / 0x435C;
  everything else reproducible from reset+script+DIPs+NVRAM).
- Status: awaiting-human. Sudnya reviews entropy-berzerk.md for completeness and
  flips awaiting-human -> done. Committed nothing.

## 2026-06-17 — T6.1 trace-driven annotation (Phase 6)

- Captured the attract heavy trace fresh (416,482 invocations / 3085 frames,
  matches T4.1) and re-aggregated per-routine read/write sets, ports, register
  deltas, and the parent/child call graph by instrumenting the same Machine +
  ScriptPlayer capture path the FROZEN heavy trace uses.
- Wrote a Z80 disassembler (machine/tools/t61/z80dis.js), validated 5286/5288 vs
  decode_oracle.jsonl (2 diffs = oracle signed-decimal cp -2/-4 vs canonical
  cp $fe/$fc). Used it to CFG-walk every reachable routine.
- METHOD: trace-driven from scratch — names/contracts from observed behaviour
  only (read/writes x hardware-berzerk.md + entropy-berzerk.md, arg regs,
  call-graph). labels.json / published source NOT consulted (T6.2 rubric).
- DELIVERABLES:
  - cdoc/annotated-asm-berzerk.md — 83 routines: behaviour-derived name + contract
    (inputs/outputs/side-effects) + purpose + entropy flag + call graph + disasm.
  - cdoc/ram-map-berzerk.md — RAM variable map (NVRAM 0x0800-0x0BFF word-pairs +
    the VRAM-low variable/stack band 0x4000-0x43FF), addr->name->meaning with
    trace r/w counts + writer routines per row.
  - machine/tools/t61/ — generators + README to reproduce.
- KEY STRUCTURE found: IM2 frame engine (0x26AB) ties entropy + draw + objects;
  NMI sound/speech service (0x0066->0x1721); coroutine actor scheduler
  (0x1E6D/0x1E78); bolt engine (0x14F3 tree); magic-RAM blitter (0x2817); maze/
  robot generation (0x1685->0x209D->0x2540). VRAM 0x4000-0x43FF is reused as
  coroutine STACKS + game variables, not visible bitmap.
- COUNT: 83 distinct entry PCs; 8 are shared-tail secondary entries (reconciles
  toward the "~81" scope). Nothing invented; gameplay routines out of scope
  (attract never credits play). 8 routines flagged entropy-touching, all
  consistent with entropy-berzerk.md.
- Status: awaiting-human. Sudnya spot-reviews a sample of annotations vs the
  traces (suggested: RANDOM 0x2678, dispatcher 0x26AB, blitter 0x2817, bolt
  0x1553, and a conf-L routine) before flipping awaiting-human -> done.
  Committed nothing.

## 2026-06-18 — T6.2 annotation accuracy score (Phase 6)

- Scored T6.1's trace-only annotations against the now-permitted rubric:
  disassembler/oracle/labels.json + Scott Tunstall's commented src/berzerk.asm
  (carries Frenzy's ported comments). Did NOT edit T6.1 (would void the measure).
- Mapped all 83 entry PCs to canonical labels (exact, or enclosing label +
  comment), assigned HIT / PARTIAL / MISS / NOLABEL by semantic judgement.
  Reproducible: machine/tools/t61/score.js.
- SCORE: of 48 routines the rubric names distinctly -> 31 HIT (65% exact),
  15 PARTIAL, 2 MISS = 96% right-subsystem, 4% wrong. Across all 83: 60% correct,
  33% partial, 7% wrong. Entropy spine (T5.2) independently 100% correct.
- MISS CLUSTERS (the generalizable finding -- what trace-only cannot recover):
  (1) slot-FIELD semantics: 0x2B3D SET_VELOCITY read as SET_ANIM_FRAME (the only
  2 hard misses); (2) entity identity from attract-only: credits-vs-score,
  player-vs-robot; (3) identical magic-RAM blit shape -> life-icons mislabelled
  as maze (0x25CA/25D4/264C/2662); (4) trigger context (0x2BE4). Root cause of
  2-4: attract never enters credited play (entropy-berzerk.md sec4).
- RECOVERED WELL incl. cryptic canonicals where the descriptive name beat the
  label (C.LOAD, RTOAX, SR.TAB, LTABLE, CLEAR_CHYRON, SHOWO).
- DELIVERABLES: cdoc/t62-annotation-score.md (full table + analysis), decisions.md
  entry, machine/tools/t61/score.js.
- Status: awaiting-human. Verdicts are semantic judgement calls; Sudnya ratifies
  the scoring (cluster analysis is the durable result, not the single %).
  Committed nothing.

## 2026-06-18 — T7.1 test-plan generator (Phase 7 start)

- Built machine/tools/generate_test_plan.js: turns heavyweight traces into
  hermetic per-routine test cases (cdoc/schemas/test-plan.md, now FROZEN).
- KEY DESIGN: validate/consume each record by EXECUTING the routine on a fresh
  Z80 core against a mock memory (real ROM loaded + writable-region read seeds +
  ordered per-port IO FIFO), NOT by scripting the raw read_set. Executing from
  real ROM sidesteps every read_set artifact (code-fetch noise note #1, not-taken
  JR-displacement gap note #6).
- SELF-VALIDATING SELECTION: every candidate invocation is replayed during
  generation; only those that reproduce regs_out+writes are emitted. "Leaf-first"
  is emergent: an invocation's heavy-trace sets exclude its callees, but standalone
  replay runs callees inline, so only leaf/early-return invocations self-validate.
  Non-leaf/ISR/coroutine excluded -> tested bottom-up in T9 (heavy-trace.md note 4).
- `r` excluded from regs compare (kept in record): inflated by interrupts that
  fired mid-invocation; never load-bearing in Berzerk (T5.1). IO normalized to
  device-port low byte. path_id = FNV-1a of executed PC sequence; dedup per path,
  cap N=8 paths/routine.
- DELIVERABLES: tool + FROZEN schema + machine/tests/test-plan.test.js (in npm
  test) + traces/test-plans/*.jsonl (5 scripts). decisions.md selection-policy
  entry. machine/tools/t61/ unchanged.
- RESULTS: npm test 86/86 pass. 400 records across 47 distinct routines (union of
  5 traces); all 400 reproduce on independent from-disk replay. Path diversity:
  DRAW_SPRITE 8, COORD_TO_MAZECELL 8, actor scheduler 8, MOVE_ANIMATE_VECTOR 6.
  maxKeptPath 279 (<< 50k step cap) confirms no legit routine is cut.
- 36 of 83 attract-reachable routines are non-leaf/ISR/coroutine -> no hermetic
  leaf test yet (by design; bottom-up in T9).
- Status: awaiting-human. Sudnya reviews coverage + ratifies the leaf-first /
  r-exclusion selection policy before done. Committed nothing.

## 2026-06-18 — T8.1 hermetic JS test bench (Phase 8)

- Built machine/tools/bench.js: runs test-plan cases against hand-ported JS
  routines with NO emulator (no CPU core, no Machine -- imports only node builtins
  + the pure src/roms.js; verified by grep). Mocks memory from the case (ROM image
  + writable read-seeds) + an IO FIFO, runs the port, diffs regs_out + writes.
- PORT CONTRACT: port(ctx) mutates ctx.{regs,flags,mem,io} in place. Registry at
  machine/ports/index.js (entry_pc -> port fn); Phase 9 grows it bottom-up.
- 3 STRIPPED QUANTITIES a register-transfer port must NOT reproduce: (1) STACK
  scaffolding (push/pop of saved regs + return address) -- stripped as the
  contiguous mem-access block descending from sp+1, so only DATA writes are
  compared; (2) sp (ret pops return addr: out=in+2); (3) r (refresh). Everything
  else MUST match, incl. full F byte (Y/X) and clobbered regs.
- SAMPLE PORT: RANDOM @0x2678, flag-accurate (S/Z/P preserved by ADD HL,rr; H,C
  from add; Y,X from result high byte). Passes 4/4 committed cases. The bench
  CAUGHT a real bug during bring-up (RANDOM ends `ld de,$3153`; first port forgot
  to clobber DE) -- proves it's a real check.
- DELIVERABLES: tool + ports/{index,random}.js + machine/tests/bench.test.js
  (6 tests: harness pass/fail/stack-strip/throw/skip + RANDOM integration).
  decisions.md entry.
- RESULTS: npm test 92/92 pass. CLI: RANDOM 4/4 (exit 0); broken port -> fail,
  exit 1 (DoD non-zero-on-mismatch). 396/400 cases skipped (routines not ported
  yet -> Phase 9).
- Status: awaiting-human. Sudnya ratifies the port contract + stack/sp/r stripping
  before done. Committed nothing.
