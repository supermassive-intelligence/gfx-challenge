# goals.md — Berzerk emulator (driver-mode contract)

> **Audience:** you, the OpenCode agent (Gemma-4-31B-IT-NVFP4 by default).
> **Not the user.** The user reads `MILESTONES.md` and `phases/phase_*.md` and drives turn-by-turn.
>
> **You do not plan.** The user picks the next subtask, pastes it to you, and you execute. This file is the minimum you need: paths, environment, tool hygiene. Read it once at session start (rule M1), then wait for the user.

---

## 0. Project (one paragraph)

Build a literate-programming C++ emulator for the **Stern Berzerk** arcade machine (1980). `noweb` for tangle/weave. MAME's `src/mame/stern/berzerk.cpp` is the authoritative blueprint. All emulated memory access goes through callbacks (no raw pointer dereferences). A second `BerzerkMachine` implementation will be cosim-verified against the emulator at subroutine return boundaries.

---

## 1. Invariants

| Fact | Value |
|---|---|
| `PROJECT_ROOT` | `/home/user/sudnya/checkout/orbits/games/arcade/berzerk/` |
| Runbook (the user drives from this; you read it for context) | `<root>/MILESTONES.md` + `<root>/phases/phase_*.md` |
| Append-only log (one line per completed subtask) | `<root>/session_status.md` |
| ROM dir | `<root>/rom/berzerk/` (8 files, RC31A + 2 voice). If absent, **ask**. |
| Z80 test corpus | `<root>/third_party/SingleStepTests/z80/v1/*.json`. Pre-fetched once. If absent, **ask** — do not clone into `tests/z80/`. |
| `REFERENCE_REPO` (READ-ONLY, ASK FIRST) | `/home/user/sudnya/checkout/gfx-challenge/` |
| Tangle command | `notangle -R'<chunk>' file.nw > out.cpp` — **NOT** `noweb -t`. The `noweb` binary is a meta-wrapper and does not tangle. |
| Weave command | `noweave -autodefs c -index file.nw > out.tex` |
| Build env | **No Docker on this pod.** Use `make` host targets only. `make docker-*` is forbidden (§1.6 of the old contract; archived). |
| Bootstrap | `sudo bash scripts/host-bootstrap.sh` — idempotent; apt-installs `g++ make noweb texlive-latex-base libsdl2-dev gdb python3`. |

**Do not run `notangle` bare.** It reads stdin and hangs the shell. Verify presence with `command -v notangle`.

---

## 2. Tool-use rules (labeled — the user will cite these when you drift)

Every label is something the user can drop into chat to redirect you ("E3. stop." / "R4 violation. revert."). Memorize the labels; the text reminds you what each means.

- **E1** — Read 30 lines of context before any Edit.
- **E2** — If Edit returns "multiple matches", `grep -n` to count, choose the occurrence, rebuild `oldString` with ≥ 3 lines of unique surrounding context.
- **E3** — Two-strike protocol. On the second identical Edit error, **STOP**. Switch to `Write` of the whole file or write a BLOCKER to `session_status.md`. Never retry a third time.
- **E4** — "No changes to apply: identical" means the edit is already done. Move on.
- **B1** — Stay inside `PROJECT_ROOT`. Never `cd ~`, `cd /home/user/`, `cd /tmp`, or `cd $REFERENCE_REPO` without an explicit reason that follows R4.
- **B2** — Use the canonical command literals in §1. `notangle`, not `noweb -t`. Don't invoke `notangle` bare.
- **W1** — New code lives in `noweb/*.nw`. Tangled `src/*.cpp` and `include/*.h` are build artifacts; never hand-edit them.
- **W2** — After every completed subtask, append a one-line entry to `session_status.md`: `## YYYY-MM-DD HH:MM — <subtask title> — pass|fail|blocked — <one short note>`. This is lighter than V3's heredoc — the user drives now, so a trail is enough. Use a heredoc if multi-line.
- **W3** — Never write outside `PROJECT_ROOT`. Transient smoke-test files in `/tmp` are fine; project files in `/tmp` are not.
- **R1** — No claims without tool evidence. If you write "the file contains X", a Read or Grep result proving it must be in the conversation.
- **R4** — `REFERENCE_REPO` is read-only and ask-first. `ls` and `git log` without asking; reading any `.cpp/.h/.nw/.asm/.md` requires the user to say yes.
- **F1** — Any tool error twice on the same target → stop, change strategy, write a BLOCKER. Do not call it a third time.
- **F3** — Never silently abandon literate programming or pivot toolchains. If `noweb`/`notangle` errors, write a BLOCKER and ask — do **not** pivot to plain `.cpp/.hpp`.
- **C4** — User-visible text is a *report*, not a thinking pad. No "Wait, I'll…", "Actually, let me…", "OK, let's go". Writing the same phrase twice in one reply is a degenerate-loop signal — STOP the reply.
- **C5** — Cap user-visible text replies at ~500 words. If you have more to say, make tool calls instead.

---

## 3. Session start (rule M1)

On every new context, in order, before any other tool call:

1. Read this file (`goals.md`).
2. Read `MILESTONES.md` for the runbook overview (you do not need to read the individual `phases/phase_*.md` files until the user names one).
3. Read `tail -n 30 session_status.md` (or note "missing/empty" → user will tell you the starting point).

Then **stop and wait**. Do not propose a plan. The user owns the plan; they will paste the next subtask.

---

## 4. Subtask contract (when the user pastes a subtask)

A subtask the user pastes will look like one of these forms, drawn from `phases/phase_*.md`:

**Form A — description + verify (atomic / small subtasks):**

> **Action:** <prose description of what to do>
> **Verify:** `<literal shell command — exit 0 means done>`

**Form B — paste-ready prompt (finicky subtasks):**

> <a fenced block of literal text you should follow verbatim, plus a Verify command>

In both cases:

1. Run the action.
2. Run the Verify command.
3. Report:
   - the verbatim command(s) you ran (truncated if long),
   - the verbatim output (first/last 20 lines if long),
   - **pass** / **fail** / **blocked**,
   - one short note (one sentence) if anything was unexpected.
4. Append one line to `session_status.md` per W2.
5. Stop. Wait for the next subtask.

**Do not chain subtasks.** One per turn unless the user explicitly says "do A.1 through A.4 in this turn."

---

## 5. When something fails

- **Tool error twice on the same target** → F1. Stop. Write a BLOCKER to `session_status.md` with: verbatim commands, verbatim error, what you suspect, what you need from the user.
- **Verify command exits non-zero** → report `fail`, do not retry the action without explicit user instruction. The user will decide whether to retry or pivot.
- **You don't recognize the subtask format** → ask one specific question (rule C3-style). Don't guess.
- **The user cites a rule label at you** ("E3", "R4", "F1") → that's a course-correction. Apply the rule, do not argue.

Everything else lives in `MILESTONES.md`. The user owns the plan.
