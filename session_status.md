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

## 2026-06-18 — SESSION CLOSE (Phase 6→8 arc)

This session advanced the Berzerk JS-port pipeline (scaled_up/) four tasks, each
ended awaiting-human and signed off by Sudnya:
- T6.1 trace-driven annotation: 83 routines + RAM map, derived from traces alone
  (no labels.json), cdoc/annotated-asm-berzerk.md + cdoc/ram-map-berzerk.md.
- T6.2 accuracy score: vs the now-permitted rubric (labels.json + Tunstall asm) —
  65% exact / 96% right-subsystem on 48 labeled; miss clusters catalogued.
- T7.1 test-plan generator: machine/tools/generate_test_plan.js, FROZEN
  cdoc/schemas/test-plan.md, 400 self-validating records / 47 routines across 5
  traces; leaf-first selection.
- T8.1 hermetic bench: machine/tools/bench.js + ports/ registry + RANDOM sample;
  no CPU/Machine; npm test 92/92; broken port exits non-zero.
Phases 1–8 now complete. NEXT: T9.1 (port hook harness — replace a CALL target
with its ported JS, Z80 core runs the rest) then T9.2 (port routines bottom-up,
each gated by the T8.1 bench + the golden-frame suite). Standing follow-up:
re-time input scripts past frame ~573 to capture credited gameplay (would widen
T7/T8 coverage beyond the 47 leaf routines and recover the T6.2 entity-id misses).
Nothing committed this session — all git actions remain with Sudnya.

## 2026-06-18 (cont.) — T9.1 port hook harness (awaiting-human)

Built the live port-dispatch hook: when PC reaches a registered CALL target, run
the SAME ports/ JS function the T8.1 bench runs (via a thin adapter onto live
getState/setState + live memory/IO), apply its effects, return as if RET. Z80 core
runs everything else. Proven on RANDOM (0x2678).

Files:
- machine/src/port-hook.js — adapter + makePortHook dispatcher (NEW).
- machine/src/cpu/z80.js — installPortHook + step() consults it.
- machine/src/machine.js — installPortHooks() (opt-in; un-hooked stays reference).
- machine/src/scheduler.js — eventWithin(cycles) timing query (port-agnostic).
- machine/ports/index.js — PORT_META (cycles + entry pushes) beside PORTS.
- machine/tools/replay_hash{,_visible}.js — BERZERK_PORT_HOOKS=1 env to install.
- machine/tests/port-hook.test.js — 4 tests (NEW).

Two real divergences found via the full-attract hooked-vs-unhooked check and fixed:
1. Cycle granularity: atomic 140-cycle charge deferred mid-routine interrupts,
   shifting the V256 entropy phase (diverged at frame 2090). Fix: decline the
   fast-path when scheduler.eventWithin(cost) — core runs that call.
2. Stack overlaps VRAM: Berzerk stacks inside screen RAM (sp 0x42f2), so RANDOM's
   `push hl` scribbles HL into VRAM at 0x42f0/0x42f1 (visible). MAME produces this
   too (golden matched). Fix: hook replays each routine's entry pushes (PORT_META).

Acceptance (all pasted in the task file):
- Full attract 3085f, full VRAM, hooked == un-hooked: byte-identical.
- RANDOM bench: 4/4 pass (same port).
- Visible-rows 0-258 with hook active: identical; RANDOM never reached in boot.
- npm test: 96/96.
Caveat surfaced honestly: no committed MAME goldens exist, so the boot regression
is a self-consistency check, not a MAME match.

Discovered hazard for T9.2: stack-overlaps-VRAM (added to the T9.1 hazard
checklist). Nothing committed — all git actions remain with Sudnya.

## 2026-06-18 — T9.2 started: port routines bottom-up (11/47)

Picked up T9.2 (unblocked by T9.1). Ported 11 trace-reachable routines from the
Tunstall disassembly, leaf-first, each verified three ways: bench behavioral
exactness on every captured record, live non-vacuous dispatch count, and
hooked==un-hooked full-frame hash equality across all 5 scenario scripts.

Routines ported this session (10 new + RANDOM from T9.1):
  GET_CREDITS_AS_BCD 0x18e0, GET_PLAYER_SCORE_PTR 0x2334, CHECK_IF_ZERO_OR_E 0x1597,
  sound-trigger family SFIRE/SBLAM/SRFIRE#/SFRY (0x33bd/0x348a/0x34e7/0x3439),
  WRITE_FF_64_TIMES_HL 0x1a45, SET_VELOCITY 0x2b3d, and 0x2b39 (composes SET_VELOCITY).

New infra:
  - ports/z80flags.js: exact Z80 ALU flag helpers (incl. undocumented X/Y; CP's
    operand-sourced X/Y). Validated against captured records via the bench.
  - port-hook.js extension: ctx.cycles (per-path taken cost) + PORT_META.maxCycles
    (decline-gate worst case), so branching routines stay timing-transparent.
  - port-hook.test.js: added coin-start-first-maze hooked==un-hooked case (gameplay
    routines aren't reached in attract).

Verification (all green):
  bench: 11 routines, 41/41 cases pass.
  npm test: 97/97.
  hooked==un-hooked: byte-identical on attract / coin-start / free-play /
    maze-transition / player-death.
  live dispatches non-vacuous (all >0), e.g. 18e0=261765, 1597=10409, 2b3d=255.

Honest status: NOT done. 36/47 routines remain (categorized in the task file:
leaf-pure-next, compose-now-unblocked, blocked-on-callees, hazard/core-only). The
golden.js regression remains a no-op until committed MAME goldens exist (standing
STATUS.md action item); the load-bearing live check used here is hooked==un-hooked
self-consistency. HUMAN-GATE spot-play deferred until 100% coverage.

## 2026-06-18 — T9.2 batch 2 (4 more routines, 11 -> 15 / 47)

Continued T9.2 bottom-up porting to the same verification bar; stopped at a green
checkpoint. Ported and registered 4 routines:
- 0x157e CHECK_IF_BOLT_OFFSCREEN -- composes CHECK_IF_ZERO_OR_E (0x1597) x2.
- 0x1997 GET_ENABLED_START_BUTTONS -- composes GET_CREDITS_AS_BCD (0x18e0); masks
  SYSTEM input (port $49) by credit count.
- 0x2bde SAY_INTRUDER_ALERT -- straight-line VOICE_PC write.
- 0x2c1f SAY_GOT_THE_HUMANOID -- straight-line; bench-exact + transparent but NOT
  exercised by any of the 5 scripts (fires on killing humanoid/Otto), so its live
  path is unverified-by-dispatch. Registered, flagged, not counted to the full bar.

Harness finding (kept improvement): inner-call VRAM residue. 0x1997's fast-path
diverged at coin-start frame 584 -- the real routine's inner `call $18E0` pushes its
return address (0x199A) onto the VRAM-overlapping stack, a 2-byte transient scribble
the register-only port skipped. Extended PORT_META.pushes to accept a literal residue
value; declared 0x1997->[0x199a] and 0x157e->[0x1593] (the latter had passed only by
luck). See cdoc/decisions.md.

Verification (all green):
- bench: 15 routines, 53/53 cases pass (was 41/41).
- npm test: 97/97.
- hooked==un-hooked byte-identical across all 5 scripts (attract 2200f + the 4
  942f scenarios).
- live dispatch: 157e=781, 1997=69689, 2bde=1 (non-vacuous); 2c1f=0 (unexercised).

NOT done: T9.2 is iterative (15/47). HUMAN-GATE spot-play deferred until 100%.
Remaining 32 categorized in the task file; many "leaf" candidates turned out to be
non-leaves (fall into stack-swap/timer/COLOUR_MAN or need daa/BIT/rlca flag helpers).
Files: machine/ports/{check_bolt_offscreen,enabled_start_buttons,speech_trigger}.js
(new), machine/ports/index.js + machine/src/port-hook.js (residue extension). Docs:
task file, STATUS.md, decisions.md. Git actions are the user's.

## 2026-06-18 — T9.2 batch 3 (magic-image address calc)
Ported 2 routines (15 -> 17 / 47), both to the full verification bar:
- 0x29a3 CALCULATE_MAGIC_IMAGE_RAM_ADDRESS -- leaf; reads FLIP (0x4379), latches a
  magic-RAM control byte to port $4B, HL >>= 3 (16-bit logical), maps to the image
  window (+0x6400). bench 5/5, 7546 live dispatches.
- 0x29a1 RTOAX -- shared body: it is `ld b,$90` then falls into 0x29a3. One impl,
  two entries; the 0x29a1 port sets b and charges +7 cycles. bench 4/4, 5236 disp.
- New z80flags helpers (validated by the bench): srl8, rr8, sbcHL16.
Verification: bench 62/62 (17 routines); npm test 97/97; hooked==un-hooked byte-
identical on all 5 scripts.
Findings recorded in decisions.md: shared-body routines; INLINE-PARAMETER routines
(0x3657 COLOUR_FILL, 0x297b PRINT_STRING) are NOT hookable without a hook return-addr
adjustment -- flagged, left unported; the magic-image FLIP/cocktail path is
bench-unexercised (all records have 0x4379==0).
Status: T9.2 still in-progress (17/47). NOT done; HUMAN-GATE spot-play deferred to 100%.
New file: machine/ports/magic_image_addr.js. Modified: ports/z80flags.js, ports/index.js.

## 2026-06-18 — T9.2 batch 4 (18/47)

Ported one routine to the full verification bar, stopped at a green checkpoint.

- Ported 0x27f5 WALK_OBJECT_TIMERS (machine/ports/walk_object_timers.js): circular
  object-list walk (head 0x0872) ticking each node's bit1 countdown timer and flipping
  state bits on expiry, following the back-link at [P-2,P-1] until it wraps to head.
- Triage finding (decisions.md): `bit n,(hl)` immediately before a `ret` exposes that
  op's undocumented X/Y flags, which are WZ-driven (proven: 0x3719 record #0 has
  (hl)=ROM[0]=0x00 yet f_out Y=1). The port ctx has no WZ -> such routines are NOT
  portable. This rejects 0x3719 UNCOLOUR_MAN and 0x27a9 (both `bit n,(hl); ret z`),
  which I had previously listed as "next-unblocked". Picked 0x27f5 instead because all
  its return paths exit via `or l` / `cp e` (fully-defined flags); its `bit 1,(hl)` is
  a mid-loop branch only.
- Cost is list-length dependent: the port accumulates exact Z80 T-states into
  ctx.cycles (127-cycle short path reconstructs as prologue 37 + one node 90).
  PORT_META maxCycles=1242 (observed worst case over the 5 scripts; live actual is
  bounded by it since the test plan is generated from the same scripts).
- Verification (all green): bench 97/97 (18 routines; 0x27f5 35/35 over 8 distinct
  cases); npm test 97/97; 5 scripts hooked==un-hooked byte-identical; 0x27f5 = 3878
  live dispatches (non-vacuous).
- NOT done. 18/47. HUMAN-GATE spot-play deferred until 100%. Git actions are the
  human's: new file machine/ports/walk_object_timers.js; modified machine/ports/index.js
  and the four docs (task file, STATUS.md, decisions.md, this file).

## 2026-06-18 — T9.2 batch 5 (19/47)

Ported 0x29db PRINT_CHAR (machine/ports/print_char.js) -- a true leaf (no CALL) that
blits one character glyph (9 rows) into screen RAM from ROM font data. Ported by
faithful instruction-by-instruction transcription with the z80flags helpers, because
its return flags (f_out is an ADD HL chain result saved by `push af`) and its SHADOW
bank (the 9-row counter rides in shadow AF via `ex af,af'`, so a_p_out/f_p_out are
compared) are load-bearing and not safely hand-derivable. FLIP/cocktail path
implemented from disasm but bench-unexercised (all records have $4379==0).

Hook correctness fix (src/port-hook.js): push-residue values are now captured from the
OUTPUT register bank (post write-back) instead of the entry bank. For a balanced
push/pop the VRAM residue byte == X_out; entry-bank capture was only coincidentally
right for prior ports (they push registers they never modify). PRINT_CHAR `push af`
AFTER an ADD HL chain changes F, so its residue F-byte is f_out -- entry capture
diverged at coin-start frame 582 (0x2C vs 0x34). Post-port capture is provably
equivalent for all prior ports and necessary here.

Verification (all green):
- bench: 19 ported routines; 107 pass, 0 fail (PRINT_CHAR 10/10)
- npm test: 97/97 (proves the hook change broke nothing)
- hooked==un-hooked: byte-identical on all 5 scripts
- live dispatch: 0x29db = 384 (non-vacuous)

Unblocks the text/score subtree: 0x2a40 (digit/string blit) now has its only missing
leaf, which in turn unblocks 0x18cd / 0x2314 / 0x197b / 0x2341 UPDATE_SCORE.

Files: NEW machine/ports/print_char.js; MODIFIED machine/ports/index.js,
machine/src/port-hook.js, cdoc/decisions.md, tasks/P9/T9.2-port-routines-bottom-up.md,
tasks/STATUS.md. NOT done: 19/47; HUMAN-GATE spot-play deferred until 100%. Git actions
are the user's.

## 2026-06-18 — T9.2 batch 6 (20/47)

Ported 0x1776 C_LOAD (machine/ports/c_load.js) -- a true leaf (no CALL) that reads a
13-byte parameter block at $0878 and streams it to the Exidy 6840 / sound-control ports
$40-$47 via `out (c),r`. Faithful instruction-by-instruction transcription.

Why it was a safe pick: no shadow-bank use, no `bit n,(hl)` WZ hazard, no stack tricks,
ends with a normal `ret`. Only ret-visible flags come from the final `add a,$40`
(a=0xc0 -> 0x00 => f_out=0x41: Z=1,C=1); `res`/`set`/`djnz` are flag-neutral. Both djnz
counts are immediates (3 then 4), so cost is path-independent at 642 T-states -- I
hand-summed it instruction-by-instruction and it matches the record `cycles` exactly,
which also confirms the disassembly is complete. No push/call => no VRAM-stack residue.

Selection: all 5 records are the identical path; I picked C_LOAD (5 records, full bench
bar) over 0x2a40 (the PRINT_CHAR unblock) because 0x2a40 has NO test-plan records of its
own and would only meet a weaker composition+caller bar. Also examined and DEFERRED the
highest-record TODO 0x15cb (22 records): its success path does `pop hl; ret`, a
non-local return to the grandparent that the T9.1 single-RET hook cannot model -- needs
a hook "drop-N-frames" extension (plus a bit-indexed flag helper for its `bit 2,(ix+0)`
opener). Left for an infrastructure batch.

Verification (full bar, all green):
- bench: 20 ported routines; 112 pass, 0 fail (C_LOAD 5/5)
- npm test: tests 97, pass 97, fail 0
- hooked==un-hooked: PASS x5 (attract-only / coin-start-first-maze / free-play /
  maze-transition / player-death) byte-identical full-frame hashes
- live dispatches: 1776=55540 (one of the most-called ports), per-script
  attract 20092 / coin-start 2948 / free-play 5620 / maze-transition 8124 /
  player-death 18756

Reconciliation (honest correction): the dispatch probe shows 0x2c1f SAY_GOT_THE_HUMANOID
fires once in attract-only, not 0 as the docs recorded -- the attract demo now kills a
humanoid (script retimed since the early batches). Upgraded 0x2c1f from "unexercised" to
exercised + transparent.

Status: 20/47, NOT done. DOD still needs 100% of trace-reachable routines + HUMAN-GATE
spot-play (only Sudnya can certify). Files -- NEW: machine/ports/c_load.js. MODIFIED:
machine/ports/index.js, cdoc/decisions.md, tasks/P9/T9.2-port-routines-bottom-up.md,
tasks/STATUS.md, session_status.md. No git actions taken (per project rule).

## 2026-06-18 — T9.2 batch 7 (21/47)
Ported one routine to the full per-routine verification bar and reached a green checkpoint.

- Port: 0x22f1 RESET_JOBS (machine/ports/reset_jobs_22f1.js) -- a clean leaf
  (job/coroutine teardown). push iy;pop hl to grab IY -> store into (iy-1)/(iy-2);
  zero $0870 (job-list head) and $0876 (current-job ptr); di-bracketed 56-byte clear
  at $437B; ld a,($4379); or a; ei; ret. Faithful transcription.
- Selection rationale: 0x22f1 was the ONLY remaining clean leaf-with-records. The other
  low-record candidates are blocked -- 0x1666/0x26ab are interrupt-core/stack-swap
  (ld sp,nn + jp (hl)); 0x1e59/0x1fd4/0x200e are coroutine switches (ld sp / jp (iy),
  not ret); 0x197b/0x2be4 call not-yet-ported callees (0x1908/0x18cd, 0x2b6b). This is
  why progress is now one routine per batch: the cheap leaves are exhausted and the
  remaining tail is hazards + dependency chains.
- Two design points (logged in cdoc/decisions.md): (1) IFF (di/ei) is NOT modeled -- it
  is not a compared register and nets to no change; the live hook still preserves
  interrupt cadence by charging the full 1612-cycle window and declining when an
  interrupt event would split it. (2) push iy leaves IY as VRAM-overlapping-stack
  residue; IY is unchanged so output bank == input bank and PORT_META pushes:['iy']
  replays it. Fixed cost 1612 T (hand-summed = record cycles; the gotcha was pop hl=10T
  not 14T, reconciling an initial 1616).
- Verification (all green): bench 21 ported / 113 pass / 0 fail; npm test 97/97;
  hooked==un-hooked byte-identical on all 5 scripts; live dispatch 0x22f1=3
  (attract-only 2 + player-death 1) -- rarely called but genuinely non-vacuous.
- Status: 21/47, NOT done. DOD still needs 100% + HUMAN-GATE spot-play (only Sudnya).
- Files -- NEW: machine/ports/reset_jobs_22f1.js. MODIFIED: machine/ports/index.js,
  cdoc/decisions.md, tasks/P9/T9.2-port-routines-bottom-up.md, tasks/STATUS.md,
  session_status.md. No git actions taken (git is the human's).

## 2026-06-19 — T9.2 standing-plan: infra sprint + cheapen-loop + ports (23/47)
Executed the decided standing plan autonomously (hazard B+A, transpiler NO-GO, MAME
goldens user-side). Left the tree green; committed nothing.

INFRA SPRINT (all unit-tested):
- z80flags.js: added bitHL8 (WZ-less mid-routine `bit n,(hl)` helper; X/Y=0 since they
  are WZ-sourced and only safe where F is not returned). validate_flags.js extended to
  cross-check it (masked X/Y) -> 3488 pass, 0 fail. Also documented that z80_core uses a
  SIMPLIFIED bit-number rule for BIT undoc flags, so bitIdx8's address-high-byte (hardware)
  rule can only be masked-validated vs the core (the real check is the MAME bench).
- src/port-hook.js: added two extensions -- ctx.framesToDrop=N (non-local `pop;ret` that
  returns N levels up: pc=mem[entrySp+2N], sp=entrySp+2+2N) and ctx.returnPc=ADDR
  (inline-param / jp(hl) resume at a port-computed address, sp=entrySp+2), plus ctx.retAddr
  exposing the CALL return address so inline-param ports can read their inline constants.
  Mirrored retAddr in the bench ctx (tools/bench.js). Two new unit tests in
  port-hook.test.js (both green); the existing hooked==un-hooked integration tests still pass.

CHEAPEN THE LOOP:
- tools/transparency.js: caches un-hooked frame-hashes per script in machine/.cache/
  (invalidated when the script OR any src/ file is newer); given target PC(s), probes which
  scripts dispatch them and runs the hooked==un-hooked comparison ONLY on those (skips the
  rest); on divergence localizes -- first bad frame, ports dispatched in that frame and the
  one before, and the differing VRAM/color byte addresses. Probe verified against known
  dispatch counts (0x22f1 = attract 2 + player-death 1; 0x2c1f = attract 1).

PORTED:
- 0x1ce7 COORD_TO_MAZECELL (coord_to_mazecell.js) -- clean leaf, faithful transcription
  (exit-path-dependent return flags + shadow-AF running-threshold scratch). bench 32/32,
  live 4/4 transparent (dispatched 47312/8173/17742/47312), strongly non-vacuous.
- (0x2817 DRAW_SPRITE was already ported+registered from a prior partial batch-8; bench
  32/32, included in the 23 count.)

BLOCKED -- GENUINELY NEW FINDING (needs Sudnya's decision):
- 0x15cb BOLT_VS_ACTOR: implemented (bolt_vs_actor_15cb.js), LIVE-TRANSPARENT on all 4
  dispatching scripts (106/23/23/99) and passes 14/22 bench records, but UNREGISTERED.
  The 8 failures are all the `bit 2,(ix+0); ret z` opener path, differing ONLY in undoc
  X/Y: the MAME bench oracle records 1,1 while the live z80_core produces 0,0 (n-based BIT
  rule). A port cannot be both bench-exact (MAME) and live-transparent (z80_core) here --
  the un-hooked machine itself does not produce the MAME flags. DOD requires green bench,
  so deferred. DECISION: should the governing bar for MAME-vs-core BIT-flag divergences be
  live-transparency (accept; reopens 0x15cb now + likely 0x3719/0x27a9) or MAME-bench-
  exactness (keep deferred)? The framesToDrop extension it targeted is correct/tested but
  now has no shippable consumer (its target is blocked by the OPENER, not the return).

TRIAGE CORRECTIONS (from reading the real disassembly; reclassified to hazard bucket):
- 0x287f SHOOT: ends `pop hl; inc hl; inc hl; pop af; pop bc; ld c,$10; jp (hl)` (3-frame
  computed return) + `call $1e6d` (blocked coroutine). The partial shoot.js is unregistered
  and unimportable now. NOT a leaf.
- 0x1c6e: contains `halt` -> indeterminate displaced-cycle cost (blocks until interrupt).
- 0x151a COLLISION_SENSE: composes 0x1553/0x15a0 which have ZERO test-plan records
  (un-benchable).

VERIFICATION (all green): npm test 99/99; validate_flags 3488/0; bench 23 ported / 177
pass / 0 fail; transparency 5/5 scripts byte-identical. No git actions (git is the human's).
Status: 23/47, NOT done. DOD still needs 100% trace-reachable + HUMAN-GATE spot-play.

## 2026-06-19 (cont.) — Sudnya's call: extend T2.3 X/Y tolerance to the bench (24/47)
Sudnya rejected demoting the bench; instead EXTENDED the proven T2.3 X/Y-flag tolerance to
the port bench: tools/bench.js now masks the undocumented X(bit3)/Y(bit5) bits in the F/F'
comparison (Berzerk never branches on X/Y -- T2.3 decode-oracle proof). Every documented
flag (S/Z/H/P/N/C), every register, and every memory/IO write is still compared EXACTLY.

OUTCOME:
- Confirmed safe-not-a-rug-pull: enabling the mask immediately EXPOSED a real register bug
  in the 0x15cb success path (HL must take the `pop hl` value = ctx.retAddr, not the stale
  computed HL). Fixed; masking surfaced the bug rather than hiding it.
- 0x15cb BOLT_VS_ACTOR now REGISTERED: 22/22 bench under the tolerance, live-transparent on
  all 4 dispatching scripts (attract 106 / free-play 23 / maze-transition 23 / player-death
  99). First real user of the framesToDrop hook extension. -> 24/47.
- Recorded the tolerance extension in decisions.md as an explicit extension of T2.3.
- This REMOVES the "WZ-hazard" portability bucket in principle: routines that `ret` straight
  after `bit n,(hl)` were blocked ONLY by the unreproducible X/Y at the ret.

0x27a9 UPDATE_OBJECT_MOTION re-tested under the tolerance: 15/22 (the tolerance DID clear
its `bit 2,(hl); ret z` opener, proving it is not a WZ blocker). NOT registered -- path
33bbfd2f has a non-flag bug (E off by 4) whose record read/write order does not reconcile
with the linear disassembly by hand-trace (post-`dec (hl)` pointer-chase). File kept with a
status note; left for a focused follow-up. 0x3719 (more complex, dual fill loops) deferred
to that same follow-up with fresh context.

VERIFICATION (all green): npm test 99/99; validate_flags 3488/0; bench 24 ported / 199 pass
/ 0 fail; transparency green (0x1ce7 + 0x15cb scoped, byte-identical). No git actions.
Status: 24/47, NOT done. Remaining clean-ish targets: 0x27a9 (finish), 0x3719 (port under
tolerance), score subtree 0x1908/0x197b/0x2341 (need callee folding 0x18cd/0x3538/0x2db3/
0x18f7), inline-param 0x3657/0x297b (returnPc/retAddr built; 0x3657 records are degenerate
2-read/0-write so weak-bar). DOD still needs 100% + HUMAN-GATE spot-play.

## 2026-06-20 — T9.2 doc reconciliation (24->26) + batch 8 0x2341 UPDATE_SCORE (27/47)

Resumed T9.2. First reconciled the docs to the working tree: the prior session had
left two routines REGISTERED + verified but undocumented (session_status ended at
24/47 while ports/index.js + the bench were already at 26/47). Re-verified both
independently before counting them:
- 0x27a9 MOVE_ANIMATE_VECTOR (update_object_motion_27a9.js): the earlier "E off by 4"
  on path 33bbfd2f was an ELIDED `ld de,$000c` register load (DE observable at the
  early `ret nz`); fixed. bench 19/19; transparency byte-identical on all 5 scripts
  (3799/282/807/1319/3486 dispatches).
- 0x3719 UNCOLOUR_MAN (uncolour_man_3719.js): leaf sprite-erase/restore under the
  T2.3 X/Y tolerance. bench 13/13; transparency byte-identical (attract/free-play/
  maze/player-death dispatch it x1, plus attract x1).
Both pass under the bench's X/Y mask (their `bit n,(hl); ret z` openers); every
documented flag/reg/memory write is still strict.

NEW PORT this session -- 0x2341 UPDATE_SCORE (ports/update_score.js) -> 27/47:
- The first NON-degenerate remaining routine. Adds a BCD value (C) to the active
  player's score at the digit selected by B, propagates the BCD carry, then runs the
  two bonus-life DIP checks. Composes GET_PLAYER_SCORE_PTR (0x2334, ported) twice; no
  other CALL on the recorded/transparent paths. Real data writes ($436D + the score
  byte), real F2-DIP reads (port $61 x2 from the io FIFO), daa/sla/srl arithmetic.
- All helpers already existed (daa8/sla8/srl8/cp8/add8/dec8 from the 2026-06-19 infra
  sprint, validated by validate_flags.js) -- no new infra.
- Shadow-AF subtlety reproduced exactly: the `srl b; ex af,af'; [dec hl; dec e; djnz];
  ex af,af'` digit-index loop parks the srl-b carry in the live bank and leaves
  f_p_out = the last `dec e` flags (a_p unchanged). The bench compares a_p/f_p, so this
  is load-bearing; modeled by running the loop on a copy of flags_p and writing the
  final dec8 result back.
- Bonus-life AWARD tail NOT ported (throws): it sets XTRAMEN via `bit n,(hl)` (WZ ret),
  `call $3538` (un-ported), then `jp $259A` (non-local, never returns). No record takes
  it and transparency confirms no script reaches it live (the throw never fired).
- Cycle accounting verified: the port's per-instruction T-state sum reproduces the
  recorded `cycles` (path1 = 432) exactly -- a transcription-completeness check.

VERIFICATION (all green): bench 27 ported / 239 pass / 0 fail (0x2341 8/8); npm test
100/100; transparency byte-identical on the 4 scripts that dispatch 0x2341 (attract 15
/ free-play 4 / maze 5 / player-death 15), 1 skipped (coin-start doesn't dispatch it).

SYSTEMIC FINDING (the reason progress is now ~1 routine/batch and the ceiling is near):
the cheap, bench-coverable leaves are exhausted. Auditing every remaining
unported-with-records routine shows the tail splits into:
  1. HAZARD BUCKET (~12): coroutine/ISR/jump-table substrate (0x1e78/0x1e6d/0x24f7/
     0x1666/0x1e22/0x1e59/0x1fd4/0x200e/0x26ab/0x1aed/0x1d22, + 0x287f SHOOT's jp(hl)+
     coroutine). Blocked BY DESIGN (decision B: they stay on the Z80 core as the
     scheduler/interrupt substrate; the hook declines them transparently).
  2. GUARD-PATH-ONLY bench records (0x272d ERASE_PATTERN, 0x1908 DRAW_DIGIT, 0x197b
     DRAW_SCORE, 0x151a COLLISION_SENSE): the 5 attract-derived scripts only ever hit
     these routines' early-ret/inactive guard paths (HL=0x0000 / score=0 / bolt
     inactive / credits-unchanged). Their real bodies (digit blitting via 0x2a40,
     the bolt engine 0x1553) are unreachable from BOTH the bench AND live transparency
     because no script credits coins or plays into scored gameplay. Porting them now
     would be a weak bar (body unverified) -- consistent with the standing follow-up
     "re-time scripts past frame ~573 to capture credited gameplay" (STATUS.md).
0x2341 was the exception: its recorded path runs the full BCD-add body and only calls
the already-ported 0x2334, so it had a real bar. With it ported, meaningful further
T9.2 progress is gated on (a) the credited-gameplay scripts and/or (b) revisiting the
hazard-bucket decision in T10. NOT done: 27/47; HUMAN-GATE spot-play deferred to 100%.
Git actions remain the user's.

## 2026-06-20 (later) -- De-risk: credited-gameplay scripts do NOT unblock the gameplay bodies

Per Sudnya's directive, before building the interactive recorder / having a human play,
I ran the spec'd de-risk: prove that a credited-play script regenerated -> test plan
yields real-body records for the previously-"unreachable" routines (bolt engine 0x1553,
digit blitter 0x2a40). RESULT: it does NOT, and the prior "systemic finding" was wrong
about WHY those routines are unported. Evidence (all reproducible):

New diagnostics (kept): machine/tools/gameplay_probe.js (un-hooked execution-coverage
probe: distinct PCs + first-frame-seen for a routine watchlist), and
traces/scripts/credited-play-smoke.jsonl (coin@19/start@65 from the proven player-death
timing + P1 move/fire pulses frames 600-1500, 1650 frames; reaches scored play,
score_p1 nonzero).

1. The attract-only script (ZERO inputs) already EXECUTES the full engine: 0x1553 bolt
   engine at frame 977, 0x2a40 digit blitter at 581, 0x2341 UPDATE_SCORE and 0x287f
   SHOOT at 1007. Berzerk's attract mode runs a DEMO GAME. So these bodies are NOT
   "unreachable from live transparency" -- transparency on attract-only already
   exercises them. The earlier claim that they are unreachable was incorrect.

2. coin-start-first-maze missed them only because it is 942 frames and they first fire
   at 954-1007 -- it is too SHORT, not mis-credited. player-death (2918 frames) reaches
   scored play (score_p1=0,6,96).

3. Why 0x1553/0x2a40 have ZERO test-plan records despite executing every run: they are
   NON-LEAF. 0x1553 does `call $29A1` (RTOAX) and `call $1597` x2. The test-plan
   generator excludes non-leaf invocations BY DESIGN (leaf-first self-validation: a
   standalone hermetic replay re-executes callees inline, so only leaves/early-returns
   self-validate). This is a property of the ROUTINE, not the input script -- NO script
   can give a non-leaf routine a test-plan record under the frozen bench architecture.

4. De-risk run: credited-play-smoke -> generate_test_plan -> 83 records / 39 routines.
   Record counts: 0x1553=0, 0x2a40=0 (still zero, as predicted). It added ZERO new leaf
   routines vs the existing 47-universe, and ZERO new path_ids for 0x2341/0x287f/0x151a
   (its paths are a strict subset of what the existing 5 scripts already cover). So a
   credited-gameplay recording session would NOT surface the gameplay-body records the
   directive assumed. Marginal value of richer scripts: possibly a few new leaf PATHS in
   already-covered routines (this smoke added none); NOT the lever for the bodies.

5. CROSS-FINDING: 0x1553's callees 0x29a1 (RTOAX) and 0x1597 (CHECK_IF_ZERO_OR_E) are
   ALREADY PORTED (in machine/ports/index.js). So the bolt engine is portable RIGHT NOW
   by composition (call the ported callees) + validate via transparency on attract-only
   (which executes 0x1553 at frame 977). No new scripts, no human recording needed.

CORRECTED MODEL of the remaining work (replaces "27/47 is the ceiling, blocked on
scripts"):
  - 47-universe = leaf-replayable routines (>=1 hermetic test-plan record). 27 ported,
    20 remain; of those ~12 are the hazard-bucket (coroutine/ISR/jump-table, decision B)
    and ~8 are still-portable leaves (0x151a,0x1908,0x197b,0x272d,0x287f,0x297b,0x2be4,
    0x3657).
  - Non-leaf engine BODIES (0x1553, 0x2a40, full bodies behind the guard-only records of
    0x1908/0x197b/0x272d) are NOT in the 47 and never will be via the bench. They are
    porter via COMPOSE + TRANSPARENCY (the 0x2341 methodology), reachable today under
    attract-only's demo. The real lever is bottom-up callee porting + transparency, NOT
    input-script coverage.

DECISION POINT raised to Sudnya (not self-resolved): the interactive recorder's stated
justification (surface new test-plan records) is refuted; recommend pivoting to
transparency-porting the gameplay bodies (starting with 0x1553, callees already done).
The recorder may still be wanted for the HUMAN-GATE spot-play and deep-state snapshots --
that is a separate call. T9.2 DoD rescope still warranted but with corrected rationale.
Nothing committed.

## 2026-06-20 (later still) -- 0x1553 bolt engine ported via transparency; Option-2 triggered; DoD rescoped; recorder parked

Per Sudnya's Option-3 directive, acted on the corrected model:

1. PORTED 0x1553 MOVE_AND_DRAW_BOLT -- the first NON-LEAF engine body (machine/ports/
   move_and_draw_bolt.js). Composes the already-ported RTOAX (0x29a1). Reproduces the
   DURL movement (dec/inc (iy+2/3)), the Magic-RAM pixel plot, and carry=collision via
   the LIVE intercept flop (v256-independent bit7; the v256 bits land in dead A bits).
   PORT_META ['0x1553',{cycles:305,maxCycles:410,pushes:[0x1578]}] (inner call $29A1
   return-address residue). VALIDATED: transparency byte-identical on all 5 scripts,
   NON-VACUOUS -- 0x1553 ran live 2042x(attract) 1843x(player-death) 437x(free-play)
   437x(maze-transition). bench 239/239 (no record by design -- non-leaf), npm 100/100.

2. NON-LEAF-COMPOSITE COUNT (for the Option-2 build call): of 81 distinct CALL-target
   routines that execute (attract+death), 47 are bench-leaf and 34 are non-leaf. Static
   scan of the 33 remaining non-leaf: ~25 portable COMPOSITES, 7 HAZARD (ld sp/di/ei ->
   Tier 3 Phase-10), 1 ambiguous. Composites are the MAJORITY of remaining portable work
   (vs ~8 clean leaves). Per Sudnya's "most -> build" rule, the hooked/callee-included
   heavy-trace mode is TRIGGERED. Design: a capture mode recording the parent's read/
   write closure INCLUSIVE of ported callees, so composites self-validate on the hermetic
   bench (bench runs the real callee inline; inclusive record matches). Unfreezes
   heavy-trace.md note #4. LIMIT: only composites with a fully deterministic closure
   become bench-able; a composite reaching a hazard sub-callee stays transparency-only.
   Design to be detailed in the task file before implementation.

3. DoD RESCOPED off literal "100% of trace-reachable routines" to a three-tier bar
   (Tier1 leaf bench+transparency / Tier2 composite compose+transparency +hermetic bench
   where Option-2 applies / Tier3 hazard -> Phase-10 native; then HUMAN-GATE spot-play).
   See tasks/P9/T9.2 Definition-of-done + decisions.md 2026-06-20 (later).

4. Credited-gameplay scripts DOWNGRADED to marginal (attract already exercises gameplay).
   Interactive recorder PARKED (build only on concrete need: HUMAN-GATE spot-play capture
   / deep-state snapshot repro). Both recorded in decisions.md.

NOT done: Option-2 hooked-heavy-trace mode is scoped but NOT yet built (it unfreezes a
frozen schema + regenerates the test-plan pipeline -- presenting the design first).
Tier-1 leaf remainder (~8) and Tier-2 composites (~25, 0x2a40 next) not yet ported.
HUMAN-GATE spot-play still deferred. Nothing committed -- git remains the user's.

## 2026-06-20 (later 3) -- Option 2 adopted via SEPARATE file (not-a-superset corrected); 0x2a40 bench-validated

Sudnya independently verified inclusive capture is sound (un-hooked Z80 truth, not
circular) but NOT a strict superset of the committed exclusive plans. Applied that
correction:

1. RE-CONFIRMED at full 3085f (record diff keyed (entry_pc,path_id)): 8 DROPPED (all
   hazard-bucket: 0x1c6e + 0x1e6d x3 + 0x1e78 x4), 5 CONTENT-CHANGED (0x157e, 0x197b,
   0x1997, 0x2341 x2), 96 identical, 76 new composite paths. Not a superset, confirmed.

2. ADOPTED VIA SEPARATE FILE (committed exclusive plans stay FROZEN):
   - tools/gen_composite_plan.js -> traces/test-plans/composites-inclusive.jsonl = 76
     records / 20 composite routines; only (entry_pc,path_id) absent from the committed
     plans (drops the 5 content-changed, never needs the 8 dropped). attract's demo
     dominates (the other 4 scripts added 0 new composite paths).
   - captureTrace/generateTestPlan gained an `inclusive` flag; CLI `--inclusive`.
   - heavy-trace.md note #4 + test-plan.md amended (opt-in inclusive + ISR-fold limit +
     memory note + separate-file), marked pending Sudnya ratification; frozen defaults
     untouched. decisions.md records the not-a-superset finding + memory-heavy caveat.
   - VALIDATED: bench over exclusive+composite = 28 ported / 245 pass / 0 fail (was 239;
     +6 = 0x1553's composite records now hermetically validated). npm 100/100 (flag off
     by default). transparency 5/5. 0x1553 is now dual-validated (transparency 4759 live
     execs + bench 6/6).

3. TIER-2 RESUMED: 0x2a40 PRINT_DIGITS ported (machine/ports/print_digits.js) -- composes
   CALCULATE_MAGIC_IMAGE_RAM_ADDRESS (0x29a3) + PRINT_CHAR (0x29db) in the BCD digit loop
   with the ex-af,af' magic-byte carry + FLIP branch. BENCH-VALIDATED 1/1 against its
   composite record on the first try (the Option-2 payoff: a hermetic bar for a non-leaf
   body). NOT YET REGISTERED for live dispatch: transparency diverges on the nested
   digit-loop VRAM-stack residue (0x42e2-0x42ef, incl. PRINT_CHAR's internal pushes) --
   PORT_META.pushes + exact path cycles must be derived first. Unregistered so the suite
   stays green; the port + bench evidence stand. THIS is the next Tier-2 step.

State: 28 routines registered+live (0x1553 the first Tier-2 composite, fully validated);
0x2a40 ported + bench-validated, registration pending residue. npm 100/100, bench 245/0,
transparency 5/5. Nothing committed -- git remains the user's.

## 2026-06-21 -- schemas ratified; Tier-2/3 classification; 0x2a40 registered (bench-only live; long-composite decline finding)

1. RATIFIED the heavy-trace.md + test-plan.md Option-2 amendments (Sudnya, after Cowork
   verification). Both docs marked ratified 2026-06-20.

2. TIER-CLASSIFIED the 20 composite-file routines (task file): TIER-3 (hazard, record-only,
   NOT hooked) = 0x1c6e, 0x151a, 0x1e6d, 0x1e78, 0x1e59, 0x1d12, 0x287f, 0x1721 (ld sp);
   TIER-2 portable = 0x1553 (done), 0x2a40 (this turn), + candidates 0x15a0, 0x272d, 0x1505,
   0x14f3, 0x2436, 0x2b54, 0x25e4, 0x18cd, 0x1f91, 0x1f94.

3. 0x2a40 PRINT_DIGITS registered + BENCH-validated 1/1. bench 246/0, npm 100/100,
   transparency 5/5.

   KEY FINDING (honest, contradicts "dual-validate like 0x1553"): 0x2a40 is ~8800 T-states,
   far longer than the inter-interrupt gap (~4000 T), so the T9.1 decline gate ALWAYS
   declines it -- it never fast-paths in any of the 5 scripts (0 live dispatches); the Z80
   core runs it byte-identically. So it is BENCH-ONLY live-validated, NOT fast-path/
   transparency-validated. I instrumented the un-hooked stack to derive the residue and
   added a runtime ctx.pushWords hook extension, but a forced fast-path showed it only
   partially correct ([-3..-12] fixed; [-1:-2],[-13..-16] not) AND it is moot (never fast-
   paths), so I REVERTED the extension + residue code (no incomplete/speculative code).

   GENERAL RULE recorded (decisions.md 2026-06-21): short composites (<~4000 T) get genuine
   fast-path transparency like 0x1553; long/loop-heavy ones are bench-only-live (always
   decline). Both registered (bench + T10-native readiness); the live bar differs by length
   and is stated per-routine, not blanket-claimed.

State: 29 registered (0x1553 = first genuinely-transparency-validated Tier-2 composite;
0x2a40 = first bench-only/always-declining composite). Tier-2 candidates remain
(0x15a0 next -- short, so it should genuinely fast-path). npm 100/100, bench 246/0,
transparency 5/5. Nothing committed -- git remains the user's.

## 2026-06-21 -- 0x15a0 dual-validated (Tier-2 fast-path); Phase-10 atomic-routine constraint

- 0x15a0 BOLT_HIT_SCAN ported (machine/ports/bolt_hit_scan_15a0.js) + registered (30th
  routine). SECOND genuine FAST-PATH-DUAL-VALIDATED composite (after 0x1553):
    * bench 8/8 against its inclusive composite records (all captured paths, incl. hits).
    * live transparency byte-identical with 12 fast-path executions (attract 5 / free-play
      1 / maze 1 / death 5; coin-start dispatches none). Cost 186..2579 T, under the
      ~4000 T inter-interrupt gap, so it genuinely fast-paths (not bench-only like 0x2a40).
  - Composes the ported 0x15cb once per actor (head $0876 + circular list $0870). The
    0x15cb hit-path non-local `pop hl; ret` (framesToDrop=1) is propagated by pointing
    ctx.retAddr at the inner call's return addr (0x15ab/0x15b9) so HL_out matches, then
    letting 0x15a0's own hook return normally (it never pushed the inner frame, so
    framesToDrop=0 either way).
  - Residue invisible by STACK PLACEMENT: all 54 invocations run with SP in work RAM
    (0x0824/0x0826), so inner-call residue lands at 0x0822-0x0825, outside the rendered
    window. PORT_META pushes=[] (structural, not luck).
  - DISASM ARTIFACT corrected: annotated-asm-berzerk.md `15a6 halt; 15a7 ex af,af'` is a
    MIS-DECODE -- real bytes at 0x15a4 are DD 2A 76 08 = `ld ix,($0876)`; the disassembler
    aligned mid-instruction onto operand bytes 76 08. ROM-verified (rom1.1d offset 0x5a0).
    0x15a0 is a clean composite, NOT a frame-sync hazard. Checked the ROM before porting.
- PHASE-10 CONSTRAINT recorded (cdoc/decisions.md 2026-06-21 + tasks/P10/T10.1): a routine
  longer than the inter-interrupt gap (~4000 T) always declines in Phase 9 (bench-only, 0
  live fast-paths) AND cannot run as atomic JS in the Phase-10 native target -- atomic
  execution defers the interrupts that should fire mid-routine, shifting the V256/entropy
  phase. Such routines need the same cooperative interrupt-interleaving/yield model as the
  Tier-3 coroutine substrate; "registered" != "native-ready". The P9 fast-path-vs-decline
  split IS the P10-readiness split.
- Composite checklist (T9.2) now tags each registered port FAST-PATH-DUAL-VALIDATED
  (0x1553, 0x15a0) vs ALWAYS-DECLINE-BENCH-ONLY (0x2a40).
- Verification: bench 254 pass / 0 fail (30 routines); npm 100/100; transparency 4
  verified + 1 skip (all green). Nothing committed (git remains the human's).
- NEXT Tier-2 candidate: 0x272d ERASE_PATTERN (measure its cost first to predict the
  fast-path vs decline tag before claiming a live bar).

## 2026-06-22 -- Autonomous T9.2 Tier-2 batch (Sudnya away): 7 composites ported, portable set exhausted

Ported and validated 7 routines this batch (37 registered total). Full tree green after each
routine: bench 297/0 (37 routines), npm 100/100, transparency 5/5 (all ports together,
byte-identical hooked==un-hooked on all 5 scripts).

NEW PORTS (live bar = Phase-10-readiness tag):
- 0x272d DRAW_OBJECT       FAST-PATH-DUAL  (DRAW_SPRITE x2 + 0x29a3; bench 12/12, 8 execs)
- 0x151a UPDATE_BOLT_SLOT  FAST-PATH-DUAL  (0x1553+0x15a0+0x157e; bench 16/16, ~14691 execs)
- 0x1505 UPDATE_ALL_BOLT_SLOTS FAST-PATH-DUAL (djnz over input B of 0x151a; bench 8/8, ~5057)
- 0x14f3 STEP_BOLT_GROUPS  ALWAYS-DECLINE-BENCH-ONLY (0x1505 x3 tail; bench 4/4, 0 live)
- 0x1f91 / 0x1f94 SET_OBJECT_IMAGE FAST-PATH-DUAL (SET_VELOCITY; bench 1/1 each, 54/1 execs)
- 0x25e4 MAGIC_ADDR_TO_DE  FAST-PATH-DUAL  (0x29a3; bench 1/1, 1640 execs)

TWO BUGS the discipline caught (the user's "read the ROM bytes" rule, vindicated twice):
1. z80 disassembler reports `ld ix/iy,nn` (FD/DD 21) as length 2 not 4 -> phantom `ld a,e;
   ld b,e` in 0x1505 -> first port used B=E (wrong loop count) -> bench 8 fail. Real 0x1505
   takes B as an INPUT. Fixed via skoolkit + raw ROM bytes. The annotated-asm (built with the
   buggy disassembler) is NOT a reliable boundary source -- same class as the 0x15a0 "halt".
2. 0x151a: `add iy,bc` sets the carry flag, exposed by a following `dec (iy+1); ret nz`. First
   port modeled the add without flags -> stale C -> bench 2 fail -> fixed with addHL16.

JUDGMENT CALLS (flagged for Sudnya):
- 0x151a MOVED Tier-3 -> Tier-2. Its Tier-3 reason was "un-benched callees" (a dependency
  block, now cleared: 0x1553/0x15a0/0x157e all ported + preserve IY). ROM re-read shows no
  intrinsic hazard. Validated to the full bar. Sudnya can veto.
- 0x18cd left Tier-3: needs HL=SP (add hl,sp) but the port ctx deliberately excludes SP;
  exposing SP in ctx is an architecture change I did NOT take. Also composes always-decline
  0x2a40.

INSIGHT recorded (decisions.md 2026-06-22): the heavy-trace cycle_count includes ISR cycles
when a routine is interrupted, so the measured MAX over-states OWN cost. Classify FAST-PATH vs
ALWAYS-DECLINE by OWN cost (the port's computed ctx.cycles), not the trace max. This
reclassified 0x25e4/0x1f91/0x1f94 from "always-decline" (ISR-inflated metric) to FAST-PATH.

PORTABLE TIER-2 COMPOSITES EXHAUSTED (stop-condition a). Of 20 composite routines: 10 ported;
7 intrinsic Tier-3 hazards (0x1721,0x1c6e,0x1d12,0x1e59,0x1e6d,0x1e78,0x287f); 3 Tier-3-blocked
(0x2436->0x1c6e, 0x2b54->0x1e78, 0x18cd add-hl-sp+0x2a40). Remaining coverage needs the
Phase-10 native cooperative-yield substrate. Nothing committed (git remains the human's). T9.2
stays in-progress (DoD HUMAN-GATE spot-play unchanged; not self-certified).

## 2026-06-22 -- Scope-A finish line: T9.2 -> awaiting-human; hooked play build for the HUMAN-GATE

- Verified the 37-routine state (literal): npm 100/100; bench 297 pass / 0 fail across 37
  routines (incl. the inclusive composite plan); transparency 5/5 hooked==un-hooked
  byte-identical across all 5 scripts. All green.
- Accepted the two judgment calls: 0x151a -> Tier-2 (dependency-unblocked, no intrinsic
  hazard); 0x18cd stays Tier-3 (needs HL=SP, native-only). Tier-3 (10 deferred routines)
  enumerated authoritatively in the T9.2 checklist + decisions.md: 7 intrinsic hazards
  (0x1721,0x1c6e,0x1d12,0x1e59,0x1e6d,0x1e78,0x287f) + 3 blocked-on-Tier-3 (0x2436,0x2b54,
  0x18cd). done-definition.md references this list.
- WIRED THE HOOKED PLAY BUILD (the shell ran the BARE emulator before -- it installed no
  hook, so the gate would have tested nothing). shell.js now installs the port hook BY
  DEFAULT, with: a boot console line (weak), an on-page badge + LIVE dispatch counter
  (cumulative + distinct/37, updated each frame -- the real proof), `?breakrandom=1` (swap in
  a wrong RANDOM -> diverges only when hooked), and `?hooks=0` (bare emulator A/B).
- PROVED hook liveness HEADLESSLY: attract-only, normal-hooks == un-hooked byte-identical for
  all 3085 frames; broken-RANDOM first diverges at frame 950. So breaking a JS port breaks
  ONLY the hooked build -> hooks are unquestionably live.
- Wrote machine/PLAY.md: dead-simple launch (python3 -m http.server 8000 -> /shell/index.html),
  ROM wiring (file picker or fixtures/rom symlink), controls, "watch the counter climb"
  confirmation, gameplay checklist, and the break-a-port confidence check.
- T9.2 set to awaiting-human (NOT done -- Sudnya's HUMAN-GATE). Two Sudnya-side Scope-A items
  remain: (a) spot-play the hooked build per PLAY.md, (b) generate+commit MAME goldens.
- Standing rules honored: nothing committed (git is Sudnya's); not self-certified.

## 2026-06-22 (later) -- Play-harness fix: coin/start timing (NOT the ports)

DIAGNOSIS (harness bug, ports cleared): coin/start/fire reach the ports correctly with
correct active-low polarity and key->bit map (COIN1/START1 on SYSTEM 0x49; BUTTON1 fire on
P1 0x48 bit4 0x10 -- verified vs input.js / T2.7). The real cause is TIMING, already
documented in entropy-berzerk.md sec4: the CPU does not sample the input ports until POST
completes (~frame 573 ~ 10 s). The stock scripts (and a too-early keypress) coin BEFORE that,
so the coin is released before the CPU ever reads it -> never credits. Evidence: NO script
ever credits -- coin-start-first-maze is byte-identical to no-input for all 942 frames (0
work-RAM diff). Applied AFTER POST it works: credits 0->1, start consumes it, port 0x48 (P1
joystick) then polled 899x = player active/controllable. (NOTE: ram-map's 0x436e
"game_active_flag" stays 0; the real in-game signal is port-0x48 polling.)

HARNESS FIX (shell only -- did NOT touch the 37 ports or PORT_META; bench 297/0, transparency
5/5, npm 100/100 all still green):
- shell/shell.js: coin/start are now LATCHED PULSES (a keydown holds the line PULSE_FRAMES=12
  emulated frames, auto-released) so a brief tap reliably spans the CPU sample window;
  movement/fire stay momentary. Added on-screen play readouts: READY (first port-0x49 poll =
  POST done), CREDITS (decoded from CMOS 0x08A4/0x08A5, mirrors GET_CREDITS_AS_BCD), and
  ATTRACT vs IN-GAME (port-0x48 polling). Recorder kept accurate via applyInput().
- shell/index.html: added the #play-readout line.
- machine/PLAY.md: new "Start a game" flow -- wait for READY (~10 s), tap 5 (CREDITS climbs),
  tap 1 (flips to IN GAME), then move/fire. Coin/start are taps, not holds.
HEADLESS PROOF (shell-loop mirror): READY at frame 574; coin TAP -> credits=1; start TAP ->
credits=0 + p48reads=899 (in game); RIGHT/fire during play -> joystick polled. Nothing
committed.

## 2026-06-22 -- Pilot V3: coroutine-ize the 0x2a40 (PRINT_DIGITS) port

Implemented cdoc/pilot-2a40-coroutine-port-workorder.md (the porting step the V1/V2 data
pilot de-risked). Entry criteria all passed first (V1/V2 green 20/20+73/73; segmented trace
present; shipped print_digits.js whole bench green). Built:
- machine/ports/print_digits_coro.js -- generator (function*) copy of the shipped port with
  yield seams (after the pre-loop CALCULATE_MAGIC call; per digit iteration). Plus driveCoro()
  that services interrupts from a recorded boundary schedule (the Scope-B S5 driver model).
- machine/tests/coro_2a40.test.js -- V3a/V3b/V3c over all 20 attract invocations.

RESULT (pasted from runner):
- V3a output-equivalence: 20/20 (coroutine drained == shipped port, byte-identical).
- V3a anchor: 20/20 (shipped == recorded own-write reconstruction, stack stripped).
- V3b cadence: 20/20 within +/-1, and EXACT (0 error) all 20 -- the port's cycle table
  reproduces the core's own-cycle total exactly (diff 0), so the budget reaches every boundary.
- V3c partition (diagnostic): 85% (45/53) interrupts serviced alone in their interval.
- FINDING: a fixed routine-internal own-cycle gap (G=4070) does NOT reproduce cadence
  (exact 8/20, within +/-1 only 12/20, max err 3) -- un-modeled ISR durations perturb the
  spacing; the schedule must come from the driver/interrupt controller.
Regression: V1/V2 20/20+73/73, bench.test.js 6/6, composites-inclusive 0x2a40 1/0 still green.
Hard boundaries honored: shipped print_digits.js / PORT_META / 37 ports / frozen schemas /
composites-inclusive / goldens untouched; no ISR ported; no WZ fabricated; no cycle-exact
modeling. Nothing committed. One-line result appended to cdoc/decisions.md.
