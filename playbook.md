# Berzerk + Gemma playbook

Working reference for an opencode session against Gemma-4-31B (ScalarLM).
Read principles.md first if you've never run this before; this doc is what
you keep open in a side panel while working.

---

## TL;DR

You bootstrap a JS Berzerk clone in three loose turns, you (the user) git-init
locally, then you drop in a Claude-authored spec + rubrics + checker and
iterate against the checker's scores. Each rubric score improvement is one
cohesive Edit, committed by you. Gemma never runs git commands — that's
always your hand.

---

## Quick-start: where am I, what's next?

| Your state | Go to |
|---|---|
| Empty repo, fresh opencode session | Stage 1 below |
| Game built, no docs/checker yet | "Drop in the bundle", then Stage 2 |
| Score baseline taken, ready to iterate | "Improvement loop" |
| Gemma is repeating itself / context error | "Recovery patterns" |

Working directory on the opencode node: `/home/user/sudnya/berzerk`.

### Vocabulary

**Fresh opencode session** — a *new* opencode conversation with empty context;
none of the prior turns are loaded. **Disk state survives, chat context does
not.** `/exit` does NOT start a fresh session — it just exits the TUI, and
reopening picks up the most recent session with its full token history intact.
The actual binding varies by opencode version and platform. **In your TUI,
type `/help` and look for the session-new binding.** Common candidates worth
trying: the slash command `/new`, the leader-key combo `Ctrl+X` then `N`, or
a session-list picker (`/sessions` or similar) that lets you create a new
one. If none of these work on your install, the worst-case fallback is to
move the on-disk session store aside (typically `~/.local/share/opencode/`
or `~/.config/opencode/`) before relaunching opencode. Use a fresh session
at milestone transitions (Stage 1 → Stage 2 is the textbook case), but
also: **don't fight it.** If your current session is under ~50% context, just
staying in it and sending Prompt 0 from there is fine. Fresh sessions are a
nice-to-have, not a must-have, until you cross ~75%.

**`/compact`** — opencode command that summarizes the current session's
context to free up tokens while keeping you in the same conversation. Lossy
but preserves momentum. Use mid-stage when context fills up.

**Recovery prompts** (the two prompts in the "Recovery patterns" section
below) — sent after `/compact` to reset state and constraints inside the
same session. **NOT a replacement for Prompt 0.** Prompt 0 is once per
Stage 2 session; the recovery prompts are for compactions inside that
session. Fall back to sending Prompt 0 again only if the recovery prompts
don't restore behavior after a few turns.

---

## Visual marker — USER ACTION

Every step the user (you) performs personally — outside opencode, in a
shell on the pod or the Mac — is flagged with a 🛠 marker and bracketed by
horizontal rules. Skip those at your own risk; they are the ones easiest to
miss inside a wall of paste-able prompts.

---

## Stage 1 — Bootstrap (3 prompts + your git setup)

Three short turns, then you set up the repo by hand. No workflow rules yet —
loading them too early makes Gemma over-engineer a thin "structured" game.

### Turn 1 — Prime context
```
Tell me about the arcade game berzerk. What is interesting to gamers, game developers.
```

### Turn 2 — Build the game
```
Write a simple berzerk game and serve it on port 3000. There should be a single script start_server.sh. Create both index.html and start_server.sh at the current working directory (/home/user/sudnya/berzerk) — do NOT make a subdirectory.
```

The "no subdirectory" line is the one structural constraint added to your
original wording. Without it, Gemma frequently nests the game in
`./berzerk_game/`, which causes the checker to score nothing later because
its rubrics declare `Files: index.html` at the repo root. Everything about
the game *design* is still un-prescribed; the only thing pinned is where
the files land.

### Turn 3 — Run it
```
run the server
```

**Sanity check before continuing.** Load `http://localhost:3000` in a browser.
You should see scoring, lives, multiple robots, walls. If you see "Directory
listing for /" instead, Gemma nested the files; tell it "the server shows a
directory listing; either move index.html to the repo root or update
start_server.sh." Confirm `ls -la` shows no filenames with stray backticks
or quotes.

---

### 🛠 USER ACTION — initialize git locally and push the baseline

**Outside opencode**, in a shell at `/home/user/sudnya/berzerk`:

```
git init
echo "docs/scores.json" > .gitignore
git config --global credential.helper store   # one-time, so future pushes aren't prompted
git add -A
git commit -m "Stage 1 bootstrap: playable Berzerk clone"
git remote add origin https://github.com/supermassive-intelligence/llm-game-dev.git
git branch -M main
git push -u origin main
```

On first push you'll be prompted for credentials. Enter your GitHub username
as the username, and a **Personal Access Token (PAT)** as the password
(GitHub no longer accepts account passwords). The PAT character won't echo
to the terminal as you paste it — that's normal. With `credential.helper
store` set above, you only authenticate once; subsequent pushes are silent.

If you tried with the SSH form (`git@github.com:...`) and got `Permission
denied (publickey)`, run `git remote remove origin` first before re-running
`git remote add origin https://...`.

You now have a rollback baseline. Every Stage 2 edit that goes wrong can be
reverted with `git checkout <file>`.

---

---

---

### 🛠 USER ACTION — drop in the bundle (between Stage 1 and Stage 2)

The bundle (`berzerk_visual_spec.md`, four `rubric_*.md` files, `checker.py`)
lives on your Mac at `/Users/sudnya/checkout/smi/gfx-challenge/dropins/`.
The destination is the pod at `/home/user/sudnya/berzerk/`. This means you
need a two-step transfer: Mac → pod, then in-pod copy.

**Step A — From your Mac**, push the bundle onto the pod (adjust hostname/user
to match your pod's actual SSH target):

```
scp -r /Users/sudnya/checkout/smi/gfx-challenge/dropins user@<pod-host>:/home/user/sudnya/berzerk/dropins
```

If `scp` is not how you usually move files to the pod, use whatever sync
mechanism you have — the goal is `/home/user/sudnya/berzerk/dropins/`
existing on the pod with the bundle contents inside it.

**Step B — On the pod**, in `/home/user/sudnya/berzerk`:

```
mkdir -p docs
cp dropins/checker.py ./
cp dropins/berzerk_visual_spec.md docs/
cp dropins/rubric_*.md docs/
pip install openai
git add -A && git commit -m "drop in spec, four rubrics, checker.py" && git push
```

After this, your repo on the pod has `checker.py` at the root and the spec +
four rubrics in `./docs/`, all pushed to origin.

---

## Stage 2 — Systematic workflow

### Prompt 0 — Session rules (paste before any Stage 2 work)

Front-loads environment, single-responsibility, disk-as-truth,
checker-verification, help-first CLI, output cap. Send this once at the
start of every Stage 2 session.

```
You are working on a Berzerk reimplementation in /home/user/sudnya/berzerk.
Read these rules and acknowledge them in one line before doing anything else.

ENVIRONMENT
- Shell has sudo. Network is on. Use apt for system packages.
- Working directory is the current repo root (/home/user/sudnya/berzerk).
- Server must serve on port 3000.
- Design docs live in ./docs. Z80 ROMs (when added) live in ./roms.

WORKFLOW
- One responsibility per turn.
- At session start, list ./docs and read every .md file there. Reply with a
  one-line repo-state summary (e.g. "rom0-3 analyzed, 4 rubrics, baseline
  2.00, next pending: rom4 analysis"). Do this whether starting fresh or
  resuming.
- Write your current plan to ./docs/plan.md and progress to
  ./docs/progress.md. Re-read these any time I say "resume".
- Treat ./docs as the canonical source for project knowledge. Don't re-read
  raw artifacts (./roms/, disasm files) once they have been distilled into
  design docs.
- When a code edit changes how a feature works, update the corresponding
  ./docs/*.md in the same turn. A design doc that lies is worse than none.
- When asked to "verify", run `python checker.py` and paste the JSON output.
  Never claim a feature is "done" without re-running the checker.
- Prefer `head`, `tail`, `grep`, `wc -l`, line-range reads over `cat` for
  any file larger than a few hundred lines. Never `cat` an asm file.

CLI TOOLS (help-first rule)
- Before invoking any tool outside basic coreutils (ls, grep, cat, find,
  sed, awk, cp, mv, mkdir, tar, git, curl, python3), run `<tool> --help`
  and paste the output. Quote the flags you plan to use, citing the line
  in the help output. If --help contradicts the prompt, --help wins.

GIT
- I (the user) run all git commands. You do NOT run git add, git commit,
  or git push. If you think a commit is appropriate, say so and stop —
  I will run it.

OUTPUT
- Keep narrative text under 6 lines per turn. Work goes in files.
- One Edit call per turn maximum. If you find yourself wanting more,
  stop and tell me why.
- If you find yourself writing more than ~30 lines of analysis or self-
  debate in chat, stop and ask me instead of spiraling.

Reply with: "Acknowledged. Plan stored in docs/plan.md."
Then create docs/plan.md with an empty plan I can fill in.
```

### Prompt 1 — Disassemble the ROMs (recon)

---

#### 🛠 USER ACTION — before sending Prompt 1

Place the Z80 ROMs in `/home/user/sudnya/berzerk/roms/berzerk/`. The
filenames are MAME-style — example expected set:

```
berzerk_r_vo_1c.1c
berzerk_r_vo_2c.2c
berzerk_rc31_1c.rom0.1c
berzerk_rc31_1d.rom1.1d
berzerk_rc31_3d.rom2.3d
berzerk_rc31_5d.rom3.5d
berzerk_rc31_6d.rom4.6d
berzerk_rc31a_5c.rom5.5c
```

Do NOT ask Gemma to fetch them — copyright. Verify with `ls /home/user/sudnya/berzerk/roms/berzerk/`
before sending the prompt below.

---

Now send to Gemma:

```
ROMs are in ./roms/berzerk/. Filenames are MAME-style (no consistent
extension, e.g. berzerk_rc31_1c.rom0.1c). Do this in one turn, do NOT
run the disassembly yet:

1. Install z80dasm via apt if not present (you have sudo).
2. Run `ls ./roms/berzerk/` and paste the output.
3. Run `z80dasm --help` and paste it.
4. Print the EXACT for-loop you intend to run, including any output
   redirect. Then STOP. I will approve or correct the command.
```

**⚠ Common wrong pattern to watch for in Gemma's echoed command.** Gemma
reliably proposes the variant on the left below; you want the variant on
the right. The wrong version writes `.asm` files next to the ROMs (no
`disasm/` subdirectory), and on any re-run it re-globs the `.asm` files
it just created. Reject and replace it with the corrected version before
approving.

```
# WRONG — Gemma's default proposal
for f in ./roms/berzerk/*; do
  z80dasm -a -l "$f" > "${f}.asm"
done

# RIGHT — what to make Gemma run instead
mkdir -p ./roms/berzerk/disasm
for f in ./roms/berzerk/*; do
  [ -d "$f" ] && continue
  [ "${f##*.}" = "asm" ] && continue
  base=$(basename "$f")
  z80dasm -a -l "$f" > "./roms/berzerk/disasm/${base}.asm"
done
```

After you approve the corrected command, follow up with:

```
Approved. Run the corrected loop. Then:
- ls -la ./roms/berzerk/disasm/
- wc -l ./roms/berzerk/disasm/*.asm

If any .asm file is 0 lines, the redirect failed — STOP and report.
Then write ./docs/disassembly.md documenting the exact command used.
Do not analyze the disassembly yet.
```

z80dasm 1.1.6 reminders for cross-checking: `-o FILE` is the OUTPUT flag
(not origin), `-g ADDR` sets origin (default 0x100), `-a/-l/-t/-u` are
flag-only (no arguments). Also expect two informational warnings during
disassembly: `Warning: Code might not be 8080 compatible!` (z80dasm noticing
Z80-specific instructions — expected and correct) and `Warning: Self
modifying code detected!` (Berzerk does use this pattern in places — also
expected). Neither blocks the disassembly.

---

#### 🛠 USER ACTION — after disassembly succeeds

Commit the disassembly output and docs:

```
git add -A && git commit -m "disassemble ROMs via z80dasm" && git push
```

---

### Prompt 2 — Per-ROM analysis (one prompt per ROM)

Send one prompt per ROM. Don't merge. Each prompt starts with a `wc -l`
size check and works in chunks if the disasm is large — never `cat` the
whole file.

The six **program ROMs** below are required. The two voice ROMs come
after — they're sample data, not Z80 code, and none of the rubrics depend
on them; include them only for completeness.

**rom0:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31_1c.rom0.1c.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31_1c.rom0.1c.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom0_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**rom1:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31_1d.rom1.1d.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31_1d.rom1.1d.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom1_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**rom2:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31_3d.rom2.3d.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31_3d.rom2.3d.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom2_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**rom3:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31_5d.rom3.5d.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31_5d.rom3.5d.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom3_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**rom4:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31_6d.rom4.6d.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31_6d.rom4.6d.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom4_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**rom5:**
```
Survey ./roms/berzerk/disasm/berzerk_rc31a_5c.rom5.5c.asm:
1. Run `wc -l ./roms/berzerk/disasm/berzerk_rc31a_5c.rom5.5c.asm` and report the count.
2. If > 2000 lines, work in chunks via `sed -n '1,500p'`, `sed -n '501,1000p'`, etc. — never `cat` the whole file.
3. Use `head`, `tail`, and `grep -n "call\|jp\|ret\|push\|pop"` to find subroutine boundaries.

Then write ./docs/rom5_analysis.md with exactly these three sections:
1. ## Subroutines — table of (address, name-guess, 1-line purpose), 5–10 rows
2. ## Memory layout — RAM regions you identified, with addresses
3. ## Gameplay relevance — 2 paragraphs on which subroutines drive: robot AI, maze, collision/combat

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm. Do not analyze any other ROM. Do not edit any other file.
```

**vo_1c (optional, for completeness):**
```
Survey ./roms/berzerk/disasm/berzerk_r_vo_1c.1c.asm — this is a voice/sample ROM, NOT Z80 program code, so the disassembly will be mostly meaningless opcodes. Do NOT invent fake subroutines.

1. Run `wc -l ./roms/berzerk/disasm/berzerk_r_vo_1c.1c.asm` and report the count.
2. Run `head -50` and `tail -50` on the .asm file to confirm there is no clean control-flow structure (no obvious RET/CALL distribution, no jump tables).
3. Run `wc -c ./roms/berzerk/berzerk_r_vo_1c.1c` to get the original ROM byte size.
4. Run `xxd ./roms/berzerk/berzerk_r_vo_1c.1c | head -100` and `strings ./roms/berzerk/berzerk_r_vo_1c.1c` to look for sample-data structure.

Then write ./docs/vo_1c_analysis.md with exactly these two sections:
1. ## File facts — size in bytes, plus a one-line confirmation that the disassembly contains no recognizable code patterns.
2. ## Sample boundaries — 5 bullets max. Note any byte patterns that look like sample headers, length prefixes, or repeated silence (long runs of 0x00 or 0xff).

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm or binary. Do not analyze any other ROM. Do not edit any other file.
```

**vo_2c (optional, for completeness):**
```
Survey ./roms/berzerk/disasm/berzerk_r_vo_2c.2c.asm — this is a voice/sample ROM, NOT Z80 program code, so the disassembly will be mostly meaningless opcodes. Do NOT invent fake subroutines.

1. Run `wc -l ./roms/berzerk/disasm/berzerk_r_vo_2c.2c.asm` and report the count.
2. Run `head -50` and `tail -50` on the .asm file to confirm there is no clean control-flow structure (no obvious RET/CALL distribution, no jump tables).
3. Run `wc -c ./roms/berzerk/berzerk_r_vo_2c.2c` to get the original ROM byte size.
4. Run `xxd ./roms/berzerk/berzerk_r_vo_2c.2c | head -100` and `strings ./roms/berzerk/berzerk_r_vo_2c.2c` to look for sample-data structure.

Then write ./docs/vo_2c_analysis.md with exactly these two sections:
1. ## File facts — size in bytes, plus a one-line confirmation that the disassembly contains no recognizable code patterns.
2. ## Sample boundaries — 5 bullets max. Note any byte patterns that look like sample headers, length prefixes, or repeated silence (long runs of 0x00 or 0xff).

The doc must be self-sufficient — a future fresh session must understand this ROM by reading the doc alone, without re-reading the asm or binary. Do not analyze any other ROM. Do not edit any other file.
```

---

#### 🛠 USER ACTION — after all per-ROM analyses are done

Commit and push the rom analysis docs:

```
git add -A && git commit -m "rom0-5 (and vo_*) analyses" && git push
```

---

### Prompt 3 — Baseline score (and sanity-check the checker wiring)

The baseline is also your one chance to catch a broken checker. A checker
that can't find its source files looks identical to a game where every
feature is missing — both produce all-1s. So this prompt asks for both
score and evidence.

```
Run `python checker.py` and paste:
1. The summary table printed to stdout (note the "Source bytes" column).
2. The FULL contents of docs/scores.json — especially the `evidence` field
   for each feature.

Do not modify any source files.

Sanity check before reporting "baseline done":
- The "Source bytes" column must be > 0 for every rubric. If any is 0, the
  rubric's Files: line points at a non-existent path — STOP.
- The `evidence` field must quote actual lines from index.html. If empty,
  generic, or quoting filenames instead of code, the judge is not reading
  the source — STOP.

After verifying both, tell me which feature scored lowest.
```

---

#### 🛠 USER ACTION — record the baseline

Write the baseline average down somewhere outside this playbook. Every later
improvement is measured against this number. Also commit:

```
git add -A && git commit -m "baseline scores recorded" && git push
```

---

### Prompt 4 — Improve one feature (the loop)

The prompt you'll send most. Replace `<slug>` with `visual_identity`,
`robot_ai`, `maze_walls_otto`, or `player_combat`.

```
Improve only the <slug> feature in index.html to raise its rubric score
from its current band to EXACTLY ONE band higher. Constraints:

1. First run `python checker.py rubric_<slug>` and quote the current score.
2. Read ./docs/rubric_<slug>.md. Quote both the current band and the next
   band you are targeting. If you find yourself reading Band 3 or higher
   when the current score is 1, STOP — that is wrong.
3. Make a single cohesive edit. ONE Edit call. Bigger is not better.
4. LIFECYCLE AUDIT — required when the target band introduces any rule that
   affects entity creation, deletion, death, spawn, or respawn:
   a. Identify the existing init/spawn code for the affected entity type.
   b. Ask: would the existing spawn produce entities that immediately
      violate the new rule? (Examples below.)
   c. If yes, update the spawn/init code AS PART OF THIS SAME EDIT — do
      NOT push the fix to a later turn. The interim broken state is the
      regression that costs you a debug cycle.
   Concrete past regressions in this project:
     - Adding wall-collision to robots (new rule) without updating robot
       spawn (existing code spawns at canvas edges where walls now sit) →
       robots vanish on spawn.
     - Adding a `findSafeSpawn()` helper without wiring it into the
       existing spawn call site → helper exists but isn't used; same bug.
     - Adding electrified walls (rule: walls kill player) without updating
       player respawn to find a wall-free position → player stuck on death.
   If your edit would only PASS the lifecycle audit when this turn is
   limited to a smaller scope than the band requires, that's also a sign
   you've misread the target band — re-check step 2.
5. Do not touch any other rubric area or any file outside index.html.
6. Update the corresponding ./docs/rubric_<slug>.md ONLY if the rubric is
   factually wrong; do NOT relax it to make the score easier.
7. After editing, run `python checker.py rubric_<slug>` and paste the JSON.
   Also report: are the entity types your new rule affects still VISIBLE
   and FUNCTIONAL? If you added a death condition, robot-spawn rule, or
   anything else that touches entity lifecycle, the affected entity type
   must still appear and behave in the game. If you cannot tell from code
   alone, say "I cannot verify runtime visibility from code; please
   playtest" — do NOT claim success based on the score alone. The checker
   validates code shape; it does not validate that robots still exist
   when the user opens the page.
8. If the score did not go up, tell me what blocked you and STOP. Do not
   "try again" without my approval. Do not run `git checkout` — I'll
   decide whether to revert.

Total narrative text in your response must be under 10 lines.
```

---

#### 🛠 USER ACTION — after the improvement turn

**STEP 1: Play before commit.** Load `http://localhost:3000` and play for 20
seconds. The checker is text-only — if the new rule broke an entity lifecycle
(no robots appearing, player stuck on respawn, lasers not firing, walls not
visible), play-testing catches what the checker can't. Specifically watch:
- Robots: do they appear, pursue, and fire (where the rubric says they should)?
- Player: can you move, fire, take damage, and respawn?
- Walls: are they drawn? Do you stop at them?
- Anything the new rule affected: is it visibly working?

If the game is visibly broken, **do NOT commit** even if the score went up.
The checker score and gameplay must BOTH be valid. Either:
- Revert with `git checkout index.html` and try a different angle, OR
- Send a follow-up diagnostic turn (no edits, just diagnosis) and then a
  contained fix turn, before committing.

**STEP 2: Commit only when both gates pass.**

If the game plays cleanly AND the score went up:
```
git add -A && git commit -m "rubric_<slug>: <old> -> <new>" && git push
```

If the score did not go up, read Gemma's "what blocked you" explanation and
decide whether to revert (`git checkout index.html`) or leave the change in
place as a setup for the next improvement.

This play-before-commit step is non-negotiable. In past sessions, the most
common failure mode has been Gemma reporting a clean rubric score increase
while the running game silently lost an entire entity class (robots vanishing
from spawn, etc.). The checker cannot see this. You can.

---

### Prompt 5 — Visual verification (use when scores plateau)

The checker can't see your screen. When a score stops moving, or the game
feels wrong:

```
Verify the current state of the game:

1. Run `curl -s http://localhost:3000/ | head -200` and confirm index.html
   is served.
2. Use playwright to load the page and screenshot to
   ./docs/screenshots/<slug>_<timestamp>.png. pip install playwright if needed.
3. Look at the screenshot. In <= 4 bullets, describe what is visible vs.
   what the rubric for this feature says should be visible. List visual bugs.

Do not edit the game in this turn.
```

### Prompt 6 — Add a new rubric mid-session

If you discover a feature that's not covered by the four rubrics
(rendering order, spawn placement, etc.):

```
Add a new rubric for <feature>. Copy the format of ./docs/rubric_robot_ai.md
into ./docs/rubric_<slug>.md and fill in:
- Line 1: `# Rubric: <feature name>`
- Line 2: `Files: index.html`
- Objective + Why this matters
- ## Scoring section, bands 1-4, each with concrete code-smell or positive
  markers (not just "basic"/"faithful")
- Required evidence list

Do NOT modify index.html in this turn. After writing the rubric, run
`python checker.py rubric_<slug>` to baseline the new rubric.
```

---

#### 🛠 USER ACTION — after the new rubric lands

```
git add -A && git commit -m "add rubric_<slug>" && git push
```

---

---

## Recovery patterns

### "Gemma is repeating itself" / context warning

Run `/compact` in opencode, then send these **two** prompts in order before
any new work — the first re-establishes *state*, the second re-establishes
*constraints*. Past experience: state alone isn't enough; the constraints
from Prompt 0 (file layout, git ownership, edit-call cap, band-skip
discipline) consistently drift after compaction and cause the same failures
that hit you before.

**Do NOT re-send full Prompt 0 here.** Prompt 0 is once per Stage 2 session
(or once per fresh opencode session). These two recovery prompts are a
deliberately shorter distillation of Prompt 0's rules, tuned for the
post-`/compact` situation where you want to preserve the context you just
freed. Fall back to re-sending full Prompt 0 only if these two recovery
prompts don't restore correct behavior after a couple of work turns, or if
`/compact` produced a garbled disk-state recap.

**Step 1 — Recover state.**
```
A compaction may have occurred. Before doing any work, read:
- ./docs/plan.md
- ./docs/progress.md
- ./docs/scores.json (if it exists)

Reply with the most recent average score, the next pending item in plan.md,
and any items that look stale. Do not start work until I confirm.
```

**Step 2 — Reset constraints.** Send this immediately after Step 1, before
any work prompt. The acknowledgments force Gemma to re-encode the rules
that get lost in compaction:

```
Before I send the next work prompt, re-confirm the constraints. These
are the rules from the original session-setup prompt that tend to drift
after compaction — based on past failures in this project. Reply
"Acknowledged" plus a one-line restatement of each rule in your own
words. Do not just say "yes":

1. File layout: index.html is at /home/user/sudnya/berzerk/ (repo root),
   NOT in any subdirectory.

2. Git: I (the user) run ALL git commands. You do NOT run `git add`,
   `git commit`, or `git push`. Ever.

3. One Edit call per turn maximum. No chaining. If you want more, stop
   and tell me why first.

4. Output cap: narrative under 10 lines per turn. The work goes in files.
   If you find yourself writing analysis longer than 10 lines, you are
   spiraling — stop and ask me.

5. If you're blocked or hitting a contradiction (file not found, rubric
   conflicts the code, any ambiguity), STOP and tell me. Do not write
   more analysis trying to resolve it yourself.

6. Improvement turns: read the rubric file, then quote BOTH the CURRENT
   band AND the target band. Target = current + 1 only. Never skip bands.
   If current is 1, you target 2 — not 3, not 4.

7. Before invoking any tool outside basic coreutils (z80dasm, playwright,
   pip, sed, etc. count as "outside"), run --help and quote the flags
   you intend to use. Never invent flags.

8. Never `cat` an asm file or other large file. Use `wc -l` first, then
   `head`, `tail`, `grep -n`, or `sed -n 'N,Mp'` for chunks.

9. Score claims need numbers. If you claim to have improved a feature,
   run `python checker.py rubric_<slug>` and paste the JSON before I
   accept the claim.

After acknowledging, wait for my next instruction. Do not start work.
```

The "restate in your own words" requirement matters. If Gemma just types
"Acknowledged" without rephrasing, the rules didn't actually land — and the
behavior will revert within a few turns. Watch the restatements: any that
come back garbled or evasive are the rules you should worry about most.

### `BadRequestError: maximum context length is 262144 tokens`
A single large tool call (usually `cat` of a big asm) pushed input past the
hard cap before compaction could fire. `/compact`, then send the same
recovery prompt as above.

### All-1s baseline with empty `evidence` fields
The checker is scoring "file not found." Check that the rubric's `Files:`
line points at a real path. The "Source bytes" column from
`python checker.py` shows you exactly what was loaded.

### Gemma made multiple Edit calls / 200-line monologue / band-skip
Stop the turn. Read the latest output. Decide whether to keep changes or
revert with `git checkout index.html`. Don't continue without resetting
context — the model is in a spiral. /compact if the spiral keeps recurring.

### z80dasm or another CLI errors out with a flag complaint
The model invented a flag. Make it run `<tool> --help` and quote the flag
it actually plans to use. See Prompt 0's CLI TOOLS rule.

### A change broke the game without affecting the score
The checker is text-only — it can't see render-order bugs, spawn-inside-wall
bugs, etc. Send Prompt 5 (visual verification). Likely you also need to
add a new rubric covering whatever class of bug this is (Prompt 6) so the
checker can measure it next time.

### Improvement turn passed the checker but broke an entity class
This is the most common regression in this project — score went up but the
game now has no robots / no lasers / player stuck on respawn / similar. The
root cause is almost always a lifecycle audit miss (see Prompt 4 step 4):
the new rule killed existing entities the moment it took effect, because
the spawn/init code was never updated to match.

**Diagnose before fixing — do not let Gemma "try again" without diagnosis.**
Send this prompt (no edits, read-only):

```
The score went up but the game is visibly broken (describe what's missing).
Diagnose, do NOT edit yet:

1. Run `git diff HEAD~1 index.html` (or `git diff` if uncommitted) and
   report what changed in the affected entity's lifecycle code paths
   specifically — spawn, update, deletion.
2. Trace one instance mentally: when the entity is created, what is the
   first frame's update doing? Where does it die or get removed?
3. The most likely cause is one of:
   a. The new rule was applied beyond the target band's scope (e.g.,
      collision-causes-death added to robots when Band 2 only required
      player to respect walls).
   b. The new rule is correctly scoped, but the existing init/spawn code
      now produces entities that immediately trigger the new rule.
   c. A new helper was added (e.g., findSafeSpawn) but never wired into
      the actual call site.
4. Report findings in <= 6 lines. Propose a fix in 1 line. STOP. I will
   approve before any code change.
```

Once Gemma diagnoses, send a *separate* fix prompt that addresses only what
the diagnosis identified. Don't bundle diagnosis and fix into one turn —
Gemma will skip the diagnosis and over-edit.

---

## Milestone commits — your hand, never Gemma's

| Milestone | Commit message |
|---|---|
| End of Stage 1 (game playable) | `Stage 1 bootstrap: playable Berzerk clone` |
| Bundle dropped in | `drop in spec, four rubrics, checker.py` |
| ROM analyses complete | `rom0-5 analyses` |
| Baseline scored | `baseline scores recorded` |
| Each successful rubric improvement | `rubric_<slug>: <old> -> <new>` |
| New rubric added | `add rubric_<slug>` |
| Visual fix from screenshot | `<slug>: fix render order` (or similar) |

Don't commit broken state. If a turn left the tree dirty and you don't
want the changes, `git checkout <file>` to revert.

---

## When to use principles.md

Read it once end-to-end before starting your first session. After that,
keep it closed unless something here in playbook.md doesn't make sense
and you want to know why the prompt is shaped the way it is. Principles
are the "why," this is the "what."
