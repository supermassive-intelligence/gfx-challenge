# MILESTONES.md — Berzerk emulator runbook (driver mode)

> **Audience:** you, the human, running OpenCode + Gemma-4-31B-IT-NVFP4 on a Kubernetes pod.
> **Source of truth:** this file plus `phases/phase_a.md` … `phases/phase_h.md`.
> **Premise:** previous attempts to give the agent autonomy (V1, V2, V3) ended in drift, stutter loops, and 23 KB chain-of-thought leaks. You are now the planner. The agent is the executor. One subtask at a time.
>
> **First time on a fresh pod?** Read `SETUP.md` first — it covers SSH config, reference-repo clone, ROM copy, SingleStepTests pre-fetch, and the `c-cowork/` deploy. Once that's done, return here.

---

## The two-terminal pattern

You will run with **two SSH terminals open on the pod**:

- **Terminal 1** — OpenCode (`opencode --agent berzerk`). This is where Gemma works.
- **Terminal 2** — a plain shell at the project root. This is where **you** run the independent-verify command for each subtask.

This pattern matters because Gemma can confabulate a "pass" claim. The Terminal 2 verify is your truth check; `grep` cannot lie. Do not advance to the next subtask on Gemma's word alone.

## How a turn works

1. Open `phases/phase_<letter>.md` for the phase you are in.
2. Find the lowest-numbered subtask that does not yet have a `pass` entry in `session_status.md`.
3. Copy the subtask's **Paste this to Gemma** block verbatim into Terminal 1.
4. Gemma runs the action(s) and reports verbatim output. Compare its report against the subtask's **What Gemma should report**.
5. In Terminal 2, run the subtask's **Independent verify** command. If it prints `OK`, the subtask is done. If not, do not advance.
6. Send `next` in Terminal 1 (or paste the next subtask). Gemma also appends a one-line entry to `session_status.md`; spot-check it.

That is the loop. There is no autonomous multi-step planning. The agent never picks the next subtask itself; you do.

## Where the system prompt lives

OpenCode loads its agent config from `<cwd>/.opencode/agent/<agent-name>.md`. When you run `opencode --agent berzerk` from the project root, OpenCode reads `.opencode/agent/berzerk.md`:

- The **YAML frontmatter** at the top declares `mode: primary`, `model: scalarlm/nvidia/Gemma-4-31B-IT-NVFP4`, the enabled `tools:`, and the `permission:` rules (deny writes into `$REFERENCE_REPO`, ask before destructive bash).
- The **markdown body** beneath the frontmatter is the literal system prompt Gemma sees in its system message every turn. ~60 lines covering the M1 startup ritual, the labeled rules cheatsheet, and the "user drives — wait for the subtask" mandate.

`goals.md` is a separate, deeper reference that Gemma reads *via the Read tool* at session start (rule M1). It's not in the system prompt — it's loaded into the conversation as the agent's first action. The split keeps the system prompt small (so it doesn't steal Gemma's context window) while still giving Gemma a place to look up path invariants and full rule text.

You don't paste `goals.md` anywhere yourself. You paste subtask prompts from `phases/phase_*.md`.

---

## Subtask shape

Every subtask in `phases/phase_*.md` follows the same five-section template, intentionally verbose so Gemma's bandwidth is filled with literal instructions instead of inference:

1. **Why** — one line of motivation (kept so the subtask survives without reference to surrounding context).
2. **Paste this to Gemma** — a fenced block of literal text. Copy it verbatim into Terminal 1. Do not paraphrase.
3. **What Gemma should report** — the expected output, so you can compare Gemma's response and spot drift early.
4. **Independent verify** — a single bash command you run in Terminal 2. Exit 0 (and printing `OK`) is the truth check.
5. **If it fails** — common failure modes and one-line corrective prompts to send.

Subtasks are sized adaptively. Bootstrap-class subtasks bundle several quick actions into one Paste block. Finicky subtasks (anything touching a known hard-won bug — 74181 ALU, RNG, `$6400`, WZ/MEMPTR, active-low input, noweb chunk syntax) are kept narrow with a literal heredoc in the Paste block so Gemma can't paraphrase the wrong way.

---

## Phase summary

| Phase | One-liner | State | File |
|---|---|---|---|
| A | Bootstrap the host toolchain (no Docker). Tangle a stub end-to-end. | **done** | `phases/phase_a.md` |
| B | Memory subsystem: `AddressSpace`, the Berzerk memory map, ROM loader + CRC. | **done** | `phases/phase_b.md` |
| C | Z80 CPU: state + 256 unprefixed + CB/ED/DD/FD/DDCB/FDCB. Pass 1.6M SingleStepTests. | sub-phased (C0–C9) | `phases/phase_c0.md` (state) onward |
| D | Video (74181 ALU — `1 ^ ((!p) & g)`), sound stubs, interrupt timing. Boot to attract mode. | TBD | `phases/phase_d.md` |
| E | SDL2 platform + headless PNG capture. Pixel-diff against goldens < 1%. | TBD | `phases/phase_e.md` |
| F | Disassembly docs + static analysis. 100% byte coverage, ≥ 99% mnemonic match. | TBD | `phases/phase_f.md` |
| G | Cosim infrastructure: `BerzerkMachine` interface, `EventLogger`, harness. Self-cosim returns 0 mismatches. | TBD | `phases/phase_g.md` |
| H | Native C++ reimplementation, cosim-verified one subroutine at a time. | TBD | `phases/phase_h.md` |

**State** column: update to `done` when the phase's exit criterion is verified by you (not just claimed by the agent). Append a `## Phase X COMPLETE` block to `session_status.md` the same turn.

---

## Per-phase file format

Every `phases/phase_*.md` follows the same template (see `phases/phase_a.md` for the canonical example):

```
# Phase X — <Name>

## TL;DR (3-5 lines)
## How to use this file (two-terminal pattern reminder)
## Before you start — entry criteria (literal bash commands you run in Terminal 2)
## Session start (the first message you send to Gemma in Terminal 1)

## Subtasks
  ### X.1 — <name>
    Why: 1 line
    Paste this to Gemma: ``` fenced literal block ```
    What Gemma should report: bullet list of expected output
    Independent verify (Terminal 2): `<literal bash command>`
    If it fails: common failure modes + corrective prompts
  ### X.2 — ...

## Exit criterion (whole phase) — bash checklist you run before declaring Phase X done
## Known gotchas / quick reference — table of symptom → cause → fix
## Reference pointers — paths to cdoc/* files (rule R4 still applies)
```

---

## Panic table (when things go sideways mid-turn)

| Symptom | Likely cause | Your one-line response to send |
|---|---|---|
| Agent emits "Wait, I'll… Actually, let me… OK, let's go" | C4 violation (CoT stutter — degenerate loop) | "C4. STOP the reply. Re-run the last action cleanly." |
| Agent writes a 1500-word text reply | C5 violation | "C5. Cap text replies at 500 words; tool-call the rest." |
| Agent retried an Edit a third time after "multiple matches" | E3 violation | "E3. Stop. Read the file and rebuild oldString with 3 lines of unique context." |
| Agent invokes `docker` or `make docker-*` | §1.6 violation | "No Docker on this pod. Use host targets only." |
| Agent runs `notangle` bare and the shell hangs | B2 violation | Send Ctrl-C. Then: "B2. Verify presence with `command -v notangle`, not bare invocation." |
| Agent copies code from `gfx-challenge/` without asking | R4 violation | "R4. Revert the copy. Ask permission first." |
| Agent claims "build successful" but emulator prints `Step 0: PC=0x1` over and over | Stub Z80, not a real port (v2 happened) | "V1 violation. Stub detected. Re-implement against SingleStepTests." |
| Agent reports `tests/z80/` for the SingleStep corpus | Wrong path | "Path is `third_party/SingleStepTests/z80/`. Don't clone elsewhere." |
| Agent says "the RNG is `seed * 5 + $3153`" | Trusted Tunstall's comment over the opcodes | "Wrong. Trace `$267E-$2681`. The RNG is `seed * 7 + $3153`." |
| Game stuck at `PC=0x0458` during Phase D | 74181 ALU bug | "74181 per-bit equation is `1 ^ ((!p) & g)`, not `(!p) & g`." |
| Agent asks "what is the latest status?" | Skipped M1 startup reads | "M1. Read `tail -n 30 session_status.md` now. Then tell me." |
| Agent stopped logging to session_status.md | W2 silence (the #1 v2 failure) | "W2. Append the heredoc to session_status.md. That was the last action you owed this turn." |

If the agent is stuck for more than two turns in a row on the same subtask, **stop, archive the session log, and restart** from the last `pass` line. Don't burn turns on a wedged agent.

---

## Verification ownership

| Action | Owner | Where |
|---|---|---|
| Pick the next subtask | You | `phases/phase_*.md` |
| Paste it into OpenCode | You | Terminal 1 |
| Run the action steps | Agent | Terminal 1 (OpenCode's bash tool) |
| Run the subtask's verify steps and report verbatim output | Agent | Terminal 1 |
| Run the **Independent verify** command (truth check) | **You** | Terminal 2 |
| Run cosim and PNG-diff checks at phase boundaries | You | Terminal 2 |
| Append the one-line entry to `session_status.md` | Agent (per W2) | Terminal 1 |
| Tag `Phase X COMPLETE` after re-running the exit criterion | You | Terminal 1 (paste A.6/B.x/...-style "mark phase complete" prompt) |

**The agent's "pass" is a claim, not a proof.** Always run the Independent verify in Terminal 2 before sending `next`.

---

## Definition of done (the whole project)

The project is *done* when **all** of the following hold simultaneously:

- `bash scripts/host-bootstrap.sh` exits 0 (idempotent) on a fresh pod; `command -v notangle noweave g++ pdflatex python3` prints five non-empty paths.
- `make build` exits 0 from a clean tree (host mode, no Docker).
- `make test-z80` reports `1,604,000 / 1,604,000 PASS`.
- `make cosim-test` reports `0 mismatches` across all implemented subroutines.
- Headless visual check: `python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/` reports < 1% pixel delta across ≥ 600 frames of recorded input.
- `make weave` produces PDFs in `doc/` for every `.nw` file with no LaTeX errors.
- `cdoc/phaseF_*.md` documents are present and complete (memory map, subroutines, data structures, algorithms).
- `session_status.md` has a `PROJECT COMPLETE` block summarizing totals, with zero open `BLOCKER:` lines.

Anything short of this is in-progress. Do not declare completion early.

---

## What lives where

**On the laptop**, this runbook is authored under `c-cowork/` (a deployable bundle):

```
gfx-challenge/                       (the laptop repo)
├── c-cowork/                        ← the driver-mode bundle (deployable to the pod)
│   ├── README.md                    ← layout + deployment instructions
│   ├── goals.md                     ← slim agent contract (~95 lines). Gemma reads this once.
│   ├── MILESTONES.md                ← this file. You read it.
│   ├── phases/
│   │   ├── phase_a.md               ← Bootstrap (authored)
│   │   ├── phase_b.md               ← Memory (TBD)
│   │   ├── phase_c.md               ← Z80 (TBD)
│   │   ├── phase_d.md               ← Video + 74181 + sound stubs + interrupts (TBD)
│   │   ├── phase_e.md               ← SDL + headless visual verify (TBD)
│   │   ├── phase_f.md               ← Disassembly docs + static analysis (TBD)
│   │   ├── phase_g.md               ← Cosim infrastructure (TBD)
│   │   └── phase_h.md               ← Native reimplementation (TBD)
│   └── .opencode/agent/berzerk.md   ← OpenCode system prompt + YAML config
├── cdoc/_retired/                   ← V3 docs preserved for forensic comparison
├── (existing reference-build files: SESSION_SUMMARY.md, session_status.md, session_history.md,
│   cdoc/architecture.md, cdoc/phase6_*.md, noweb/*.nw, src/, include/, rom/, third_party/, ...)
```

**Deployment to the pod** drops `c-cowork/`'s contents at the project root (see `c-cowork/README.md` for the exact tar+ssh command). After deploy:

```
/home/user/sudnya/checkout/orbits/games/arcade/berzerk/   ← PROJECT_ROOT on the pod
├── goals.md
├── MILESTONES.md
├── phases/phase_a.md
├── .opencode/agent/berzerk.md       ← OpenCode picks this up automatically
├── session_status.md                ← append-only log (one line per subtask)
├── scripts/host-bootstrap.sh        ← idempotent apt installer
├── noweb/*.nw                       ← literate sources
├── src/, include/                   ← tangled artifacts (gitignored)
├── cdoc/                            ← hand-written design docs (preserved from reference build)
├── rom/berzerk/                     ← 8 ROM files
└── third_party/SingleStepTests/z80/ ← ~1.6M Z80 JSON tests
```

Gemma reads only `goals.md` + `MILESTONES.md` + (when you point it at one) a single `phases/phase_*.md`. It does not need to read the retired docs.
