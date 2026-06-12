# Z80 Arcade → JavaScript Port (Berzerk first)

High-fidelity JS ports of Z80 arcade games. Full plan: `cdoc/z80-port-plan.md`.
Architecture: ONE emulator (the JS machine) serves as emulation platform →
trace-capture platform → port scaffold. MAME is an unmodified black-box oracle.

## How to work in this repo (the loop)

1. Read `tasks/STATUS.md`. Pick the first task that is `pending` with all
   dependencies `done`.
2. Open its task file in `tasks/P<n>/`. Run the **Entry criteria** checks.
   If any fail, STOP and report — do not rebuild upstream work.
3. Do the work described. Stay inside **Out of scope** boundaries.
4. Run the **Verification** command(s). Done iff they exit 0. PASTE the
   actual command output into the task file's Result section — a Result
   that summarizes instead of pasting is treated as unverified.
5. Items marked `HUMAN-GATE` cannot be self-certified — EVER. If a task
   contains any HUMAN-GATE item, finish the machine-checkable work, set its
   Status to `awaiting-human` (in the task file AND STATUS.md), and end the
   session by telling the human exactly what they must verify and how.
   ONLY the human flips `awaiting-human` → `done`. Marking such a task
   `done` yourself is a protocol violation even if all commands pass.
   Tasks that depend on an `awaiting-human` task are NOT unblocked.
6. Update the task's Status line and `tasks/STATUS.md`. Append any design
   decision (anything a future session might re-litigate) to `cdoc/decisions.md`.

## Layout

- `cdoc/` — plan, hardware contract, schemas, decision log. Docs live here.
- `tasks/` — one file per task; `_template.md` is the required skeleton.
- `disassembler/` — Phase 1 tooling (Python, pytest, oracle data). Exists.
- `machine/` — Phase 2+ JS machine: `src/`, `tests/`, `tools/`, `fixtures/`.
- `traces/` — captured input scripts and trace output (gitignore large files).

## Conventions

- Disassembler tooling: Python 3, `pytest` from `disassembler/`.
- JS machine: vanilla ES modules, Node ≥ 20, built-in `node:test` runner,
  no bundler/build step. Browser shell uses the same modules directly.
- Schemas in `cdoc/schemas/` are FROZEN once their task marks them so.
  Changing one requires a `cdoc/decisions.md` entry and human sign-off.
- Never modify files in `machine/fixtures/` (goldens) without a decisions.md
  entry. Tests compare against goldens; goldens are regenerated only by the
  documented tool, never hand-edited.
- MAME is never patched. Interaction is via stock binary + Lua scripts in
  `machine/tools/mame/`.
- ROMs are user-supplied and never committed.
- NEVER run `git commit`, `git push`, or any history-modifying git command.
  Git is operated exclusively by the human. End each task by summarizing
  what changed; the human reviews the diff and commits.
