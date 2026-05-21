# Prompting guide — driving Gemma-4 through the Berzerk emulator project (via OpenCode)

> **Companion to:** `goals.md` (the agent's contract).
> **Audience:** you, the human, sitting at the terminal. Assumes you have access to this `gfx-challenge` repo on your laptop and SSH access to a fresh k8s pod with sudo.
> **Goal:** stand up a productive OpenCode + Gemma-4 session without falling into the v1 failure modes (Edit loops, ROM-path confabulation, abandoned literate programming, lost project state).
> **Read time:** ~15 min. Keep it open in a side window during the session.
>
> **Convention used below:** I refer to your pod as `$POD`. Set it once at the start of any shell where you run commands from this guide:
> ```bash
> export POD=pod-XXXXXXXX           # replace with your actual pod hostname
> ```

---

## Step 0 — Prerequisites (one-time, before any of this)

On your **laptop**:
- [ ] You have this `gfx-challenge` repo checked out somewhere. Set a local var for clarity:
      ```bash
      export REPO=/Users/<you>/checkout/.../gfx-challenge   # your local path to this repo
      ls "$REPO/goals.md" "$REPO/scripts/host-bootstrap.sh" "$REPO/.opencode/agent/berzerk.md"
      # All three must exist. If any are missing, you have the wrong repo.
      ```
- [ ] **`~/.ssh/config` is set up for the proxy + pod hop.** k8s pods get rotated, which changes their SSH host key — without the right config, every rotation breaks `ssh $POD` with `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`. The block below makes pod hops resilient to that *and* removes the need for the `-A` flag. Append it to `~/.ssh/config` (create the file with `chmod 600` if it doesn't exist). Adjust the proxy host (`ssh.scalarlmforge.com`) to whatever your infrastructure uses:

      ```sshconfig
      Host *.scalarlmforge.com
          StrictHostKeyChecking accept-new
          UserKnownHostsFile /dev/null

      Host ssh.scalarlmforge.com
          ProxyCommand cloudflared access ssh --hostname %h
          User jump

      Host pod-*
          User user
          ProxyJump ssh.scalarlmforge.com
          StrictHostKeyChecking no
          UserKnownHostsFile /dev/null
          ForwardAgent yes
      ```

      Why these specific flags on the `pod-*` block: `StrictHostKeyChecking no` auto-accepts whatever key the pod presents on each connection; `UserKnownHostsFile /dev/null` keeps that accepted key from being saved (without this, the next pod rotation would conflict with the saved key and you'd be back to square one); `ForwardAgent yes` lets you drop `-A`. **Use `no` here, not `accept-new`** — `accept-new` saves the first key and then errors on the next rotation, which is exactly the problem we're trying to avoid.

      Security trade-off: MITM detection is preserved on the proxy hop (`*.scalarlmforge.com` uses `accept-new`); it's only relaxed on the inner pod hop, which is reached only *through* the verified proxy. For ephemeral k8s pods, that's the right balance.

- [ ] **If you've previously connected to a pod and it's now rotated**, clear any stale entries from `~/.ssh/known_hosts`:
      ```bash
      sed -i.bak '/^pod-/d' ~/.ssh/known_hosts   # removes all pod-* lines; .bak is a safety backup
      ```
      Skip this on a brand-new machine.

- [ ] `ssh $POD` reaches a shell (no `-A` needed once the config above is in place). If you still hit `Host key verification failed`, re-check that you really edited `~/.ssh/config` and re-ran the cleanup line above.
- [ ] You have ~30 min of uninterrupted attention for the first session — Gemma-4 needs more steering in the first hour than later.

On the **pod**:
- [ ] `sudo` works (`sudo true`) and `apt-get` is available — Docker is not available and cannot be installed; apt-install is the only way packages get on the pod.
- [ ] `git` is installed (`git --version`). If not, `sudo apt-get install -y git`.
- [ ] OpenCode is installed and authenticated to your model provider (you handle this). The frontmatter `model:` field in `berzerk.md` (`scalarlm/nvidia/Gemma-4-31B-IT-NVFP4`) must match one of the entries from `opencode auth list`; if your provider/model differs, edit that line in Step 2.
- [ ] **You must run `scripts/host-bootstrap.sh` before any build (Step 1.5).** This is a hard prerequisite, not optional — without it, `g++`, `notangle`, `pdflatex`, and `python3` are not on PATH.

---

## Step 1 — One-time setup on the pod

This step is fully idempotent. Re-running it is safe.

### 1.1 — SSH in and define paths

```bash
ssh $POD       # -A is already on by default if you set up ~/.ssh/config per Step 0
# from here on, all commands run on the pod
export ORBITS=/home/user/sudnya/checkout/orbits
export REFREPO=/home/user/sudnya/checkout/gfx-challenge        # reference build (read-only)
export PROJECT=$ORBITS/games/arcade/berzerk                     # where work happens
```

> **If you hit `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`** — you skipped the `~/.ssh/config` setup in Step 0. Go back and add the `pod-*` block, then run `sed -i.bak '/^pod-/d' ~/.ssh/known_hosts` to clear the stale entry, then retry.

### 1.2 — Clone the two external repos (if not already present)

```bash
mkdir -p /home/user/sudnya/checkout
cd /home/user/sudnya/checkout

# Reference repo — previous Claude Code build of this project (read-only per R4)
[ -d gfx-challenge/.git ] || git clone https://github.com/supermassive-intelligence/gfx-challenge.git

# Target monorepo — where Berzerk work and policy docs live
[ -d orbits/.git ] || git clone https://github.com/supermassive-intelligence/orbits.git
```

> **Auth note:** these are public-org URLs. If the repos are private, use the SSH form (`git@github.com:supermassive-intelligence/...`) and make sure your SSH agent forwarded (you used `ssh -A` to reach the pod).

Verify both clones:
```bash
ls "$ORBITS/policy/" && echo "policy dir OK"
ls "$REFREPO/rom/berzerk/" && echo "reference ROMs OK"
```

If either fails, **stop** — there's no point continuing without these.

### 1.3 — Create the target project dir and seed empty state files

```bash
mkdir -p "$PROJECT"/{noweb,cdoc,src,include,tests,scripts,.opencode/agent,rom,third_party,build/scratch}
cd "$PROJECT"
[ -d .git ] || git init -q
touch session_status.md
touch cdoc/implemented_so_far.md
```

### 1.4 — From your laptop, deploy the project files + ROMs in one shot

Open a second terminal (or background-tab the SSH). On your **laptop**, in a single command, tar the four guide-controlled files **plus the `rom/berzerk/` directory** and stream them straight into `$PROJECT` on the pod (preserves the `scripts/`, `.opencode/agent/`, and `rom/berzerk/` subpaths):

```bash
cd "$REPO"
COPYFILE_DISABLE=1 tar czf - \
  goals.md \
  scripts/host-bootstrap.sh \
  .opencode/agent/berzerk.md \
  PROMPTING_GUIDE.md \
  rom/berzerk \
  | ssh $POD "tar xzf - -C /home/user/sudnya/checkout/orbits/games/arcade/berzerk"
```

The `COPYFILE_DISABLE=1` prefix silences the harmless `LIBARCHIVE.xattr.com.apple.provenance` warnings that macOS's `tar` would otherwise emit.

> **Why `rom/berzerk/` lives on your laptop and not in the git remote.** Arcade ROM binaries are typically gitignored for copyright reasons, so a fresh `git clone` of `gfx-challenge` will not include them. You (the human deploying the agent) are the source of truth for the ROMs. Your local copy at `$REPO/rom/berzerk/` contains the 8 RC31A revision + voice ROM files; the tar pipe above ships all of them in one go.

Back on the **pod**, verify everything landed at the right paths:
```bash
ls -la "$PROJECT"/goals.md \
       "$PROJECT"/scripts/host-bootstrap.sh \
       "$PROJECT"/.opencode/agent/berzerk.md \
       "$PROJECT"/PROMPTING_GUIDE.md
ls "$PROJECT"/rom/berzerk/ | wc -l       # expect 8
```

Five lines from the first `ls`, all non-zero size; the second command should print `8`. If anything is missing, re-run the tar pipe.

> **Why tar over ssh instead of scp?** `scp` with multiple files only works when they all share a destination dir; ours don't. `rsync` would also work but isn't installed on every k8s image. `tar | ssh tar` is portable, preserves relative directory structure, and handles directories like `rom/berzerk/` in the same one-liner.

### 1.5 — Run host-bootstrap.sh

Installs apt packages (`g++`, `make`, `noweb`, `texlive-latex-base`, `libsdl2-dev`, `gdb`, `python3`). Idempotent — if all packages are present, it's a no-op.

```bash
cd "$PROJECT"
chmod +x scripts/host-bootstrap.sh
sudo bash scripts/host-bootstrap.sh
```

Expected output ends with five paths printed by the verifier (g++, pdflatex, python3, notangle, noweave).

Final sanity check:
```bash
command -v notangle noweave g++ pdflatex python3 && echo "toolchain OK"
```

Should print five paths and "toolchain OK".

> **Don't run `notangle` by itself to test it.** It reads stdin and will hang the terminal. Use `command -v` (above) to verify presence.

### 1.5b — Pre-fetch the Z80 SingleStepTests corpus

`goals.md` §1 specifies `<project root>/third_party/SingleStepTests/z80` as the location of the 1.6M-test Z80 corpus. Phase C requires it. Pre-fetching now avoids the agent guessing the wrong repo name or destination later. From `$PROJECT`:

```bash
mkdir -p "$PROJECT"/third_party
[ -d "$PROJECT"/third_party/SingleStepTests/z80/.git ] || \
  git clone https://github.com/SingleStepTests/z80.git \
    "$PROJECT"/third_party/SingleStepTests/z80
```

Verify:
```bash
ls "$PROJECT"/third_party/SingleStepTests/z80/v1/ | wc -l   # expect ~1812
```

The clone is large (~250 MB) and only needs to happen once per fresh pod. If the pod's `/home` is on a persistent volume, future sessions skip this step automatically because of the `[ -d ... ]` guard.

### 1.6 — Step 1 acceptance criteria

You should now have:

```bash
# All of these must succeed
test -d "$PROJECT"/.git
test -f "$PROJECT"/goals.md
test -f "$PROJECT"/scripts/host-bootstrap.sh
test -f "$PROJECT"/.opencode/agent/berzerk.md
test -f "$PROJECT"/PROMPTING_GUIDE.md
test -f "$PROJECT"/session_status.md
test -f "$PROJECT"/cdoc/implemented_so_far.md
test -d "$ORBITS"/policy
test -d "$REFREPO"/rom/berzerk
[ "$(ls "$PROJECT"/rom/berzerk/ 2>/dev/null | wc -l)" -eq 8 ]   # 8 ROM files deployed
test -d "$PROJECT"/third_party/SingleStepTests/z80/v1                                            # Z80 test corpus
[ "$(ls "$PROJECT"/third_party/SingleStepTests/z80/v1 2>/dev/null | wc -l)" -gt 1500 ]   # >= 1500 JSON test files
command -v notangle noweave g++ pdflatex python3 >/dev/null
echo "Step 1 done"
```

If "Step 1 done" prints, you're cleared for Step 2.

---

## Step 2 — Set up the system prompt (custom agent markdown file)

OpenCode has three places it will pick up a system prompt:

1. **`AGENTS.md` at the project root** — extra rules layered on top of the built-in Build agent. Good for "always-on" instructions, not great for fully replacing the default prompt.
2. **`.opencode/agent/<name>.md`** — a custom agent definition (YAML frontmatter + markdown body). This is the recommended path for the Berzerk project: ties the prompt to the project, version-controls cleanly, and lets you restrict tool permissions per project.
3. **`opencode.json` config** — fully declarative, useful when you want multiple agents sharing config.

We use option 2. We already deployed the file in Step 1.4; the substeps below are about *verifying* and (if needed) *editing* it.

### 2.1 — Inspect the agent file

The file is at `$PROJECT/.opencode/agent/berzerk.md` on the pod. Its shape:

```markdown
---
description: Berzerk arcade emulator (literate C++ + noweb on Ubuntu 24); strict guardrails for small/mid models per goals.md
mode: primary
model: scalarlm/nvidia/Gemma-4-31B-IT-NVFP4
tools:
  read: true
  write: true
  edit: true
  bash: true
  grep: true
  glob: true
  todowrite: true
  webfetch: false
permission:
  bash:
    "git push*": ask
    "git reset --hard*": ask
    "rm -rf*": ask
    "docker system prune*": ask
  edit:
    "/home/user/sudnya/checkout/gfx-challenge/**": deny
  write:
    "/home/user/sudnya/checkout/gfx-challenge/**": deny
---

You are a coding agent building the Stern Berzerk arcade emulator in literate
C++ on Ubuntu 24.04. The project is governed by a contract document.
[...full system prompt body — paths, ENV line, four startup actions, rule labels...]
```

Field-by-field:

| Frontmatter field | Meaning |
|---|---|
| `description` | Human-readable label, shown by `opencode agent list`. |
| `mode: primary` | This agent appears in the top-level switcher (Tab / `/agents`). Use `subagent` if you want it invocable only from another agent's Task tool. |
| `model` | Provider-prefixed identifier (`<provider>/<model>`). Check yours with `opencode auth list`. If your provider differs from `scalarlm`, edit this line: `model: <your-provider>/nvidia/Gemma-4-31B-IT-NVFP4`. |
| `tools.<name>: true\|false` | **Boolean**, not strings. Strings like `"allow"`/`"deny"` belong in `permission`, not `tools`. (This is the single most common cause of `Configuration is invalid` errors.) |
| `permission.<tool>.<glob>: ask\|deny\|allow` | Finer-grained matching by command pattern (`bash`) or path glob (`edit`/`write`). Use this for `git push*` confirmations and the read-only-reference-repo enforcement. |

Everything after the closing `---` is the **system prompt body**. It pins the contract path, the four startup actions, the `ENV:` line, and a short rule-label cheatsheet so Gemma-4 has them in working context even after compaction.

### 2.2 — If you needed to edit the model identifier, re-deploy

If you changed the `model:` line on the pod, that's fine — `opencode` will read the local file. If you edited the file on your laptop instead, scp it up:

```bash
scp "$REPO/.opencode/agent/berzerk.md" $POD:$PROJECT/.opencode/agent/berzerk.md
```

### 2.3 — Verify OpenCode can parse the file

On the pod, from the project root (this matters — opencode walks UP from cwd to find `.opencode/`):

```bash
cd "$PROJECT"
opencode agent list
```

**Pass**: a row showing `berzerk` with no errors.
**Fail**: a `Configuration is invalid` error message that names the offending field — read it carefully, the message tells you exactly what to fix. See 2.5 below.

### 2.4 — Verify the key lines actually landed in the file

Don't `cat` then `tail` — `tail` will show lines that were already in `cat`, making the body look duplicated when it isn't. Use a single `grep`:

```bash
grep -E "^(description:|mode:|model:|PROJECT_ROOT:|CONTRACT:|REFERENCE_REPO:|ENV:|YOUR FIRST FOUR ACTIONS)" \
  "$PROJECT"/.opencode/agent/berzerk.md
```

**Pass** if you see all eight lines, each appearing exactly once. The values should match:

```
mode: primary
model: scalarlm/nvidia/Gemma-4-31B-IT-NVFP4
PROJECT_ROOT:   /home/user/sudnya/checkout/orbits/games/arcade/berzerk
CONTRACT:       /home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md
REFERENCE_REPO: /home/user/sudnya/checkout/gfx-challenge   # READ-ONLY, ASK FIRST
ENV:            Docker-less k8s pod (§1.6). Build with host-mode `make` targets only.
YOUR FIRST FOUR ACTIONS in any new context, in order:
```

**Fail** if any line is missing, duplicated, or differs. Fix by re-scp'ing the local file.

### 2.5 — Common errors and fixes

| Error message / symptom | Cause | Fix |
|---|---|---|
| `Configuration is invalid` — `Expected boolean, got "allow"` | `tools` section uses string values (older docs say `"allow"`/`"deny"`) | Change `tools.<name>: allow` → `tools.<name>: true`. Strings only belong in `permission`. |
| `cat: .opencode/agent/berzerk.md: No such file or directory` | Your shell `pwd` isn't the project root | Either `cd` to the project root first or use absolute paths. |
| `opencode agent list` doesn't show `berzerk` | File landed in the wrong place | `find /home/user -name berzerk.md 2>/dev/null`; if it's elsewhere, `mkdir -p` the target and `mv` it. |
| `opencode --agent berzerk` silently falls back to `Build` | Launched from outside the project root; opencode walks UP from cwd to find `.opencode/` | `cd "$PROJECT"` first. |
| Provider/model error at session start | Model identifier isn't registered with `opencode auth` | Run `opencode auth login` for the relevant provider, or fix the `model:` field to match an existing entry from `opencode auth list`. |
| `notangle` hangs the terminal when called alone | `notangle` reads stdin; with no args and no input it waits forever | Verify presence with `command -v notangle`, not by invoking `notangle` bare. |
| Body looks duplicated when you `cat` then `tail` | The two commands' output ran together; the tail is showing lines already in the cat | Use `grep` (2.4) or just `cat` — never both back-to-back. |

### 2.6 — Updating the prompt after editing the file

OpenCode reads the agent file **once at session start**. If you edit `berzerk.md`, existing chat sessions do NOT pick up the change. To activate an edit:

```bash
# (1) if you edited locally, re-deploy
scp "$REPO/.opencode/agent/berzerk.md" $POD:$PROJECT/.opencode/agent/berzerk.md

# (2) on the pod, sanity-check the parse before launching
ssh $POD "cd $PROJECT && opencode agent list"

# (3) end the current chat (Ctrl-D or `/exit`) and start a new one in the same TUI
opencode --agent berzerk
```

A new chat inside the same opencode process **does** pick up the new file. You're only forced to relaunch opencode itself if you've changed `~/.config/opencode/opencode.json` (global config), which we are not using.

### 2.7 — Sanity-check the prompt is in the agent's working context

Disk content is necessary but not sufficient. Some opencode versions silently truncate very long system prompts. Before sending the canonical "Begin." message in Step 3, send a short probe to confirm the body actually made it into the model's working context:

```text
Quick sanity checks before we begin, answer each in one line:
1. What is your CONTRACT path?
2. What does rule E3 say?
3. What does ENV say about Docker?
4. What is your model identifier?
```

Expected answers:

| # | Expected | What it proves |
|---|---|---|
| 1 | `/home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md` | Path block in body landed |
| 2 | "On the 2nd identical Edit error, stop and change strategy. Never retry a third time." (or close) | Rules block landed |
| 3 | "Docker-less k8s pod; build with host-mode `make` only; never invoke `docker` or `make docker-*`." | ENV line landed |
| 4 | `nvidia/Gemma-4-31B-IT-NVFP4` (or your provider-prefixed form) | Frontmatter `model:` parsed |

**Do not proceed to Step 3 until all four answers are correct**; this is the single best way to catch a silent prompt-loading failure before it wastes real subtask time.

---

## Step 3 — Launch and send the first message

From the project root on the pod:

```bash
cd "$PROJECT"
opencode --agent berzerk
```

The TUI's header / status line should show the active agent as `berzerk` (not `Build`).

Send the §2.7 probe first (four sanity-check questions). After all four come back correct, paste this **verbatim** as the next user message:

```text
Begin. Execute the four startup actions (M1), then tell me which phase you are
starting and what your next subtask is. Do not start the subtask yet — propose
it in the SUBTASK template from §3 of the contract and wait for me to say "go".
```

That's the entire message. Do not add tips, hints, or "and please be careful." Gemma-4 follows short imperative messages better than long ones.

---

## Step 4 — Verify the four startup reads happened

The agent's response **must** include four reads, in this order:

1. `Read goals.md` (the contract)
2. `ls /home/user/sudnya/checkout/orbits/policy/` followed by a `Read` for each `.md` listed
3. `Read session_status.md` (or it notes the file is missing → Phase A)
4. `Read cdoc/implemented_so_far.md` (or it notes the file is missing)

**Acceptance bar:** if you see all four reads, with non-empty results (or explicit "missing" notes), proceed to Step 5.

**Reject and re-prompt** if the agent skips any of the four:

```text
You skipped the M1 startup actions. Do them now, in order, before anything
else: (1) Read goals.md, (2) ls /home/user/sudnya/checkout/orbits/policy/
and Read every .md there, (3) Read tail -n 50 of session_status.md (or note
missing), (4) Read cdoc/implemented_so_far.md (or note missing).
```

If it skips them again, kill the session, re-check the system prompt actually loaded (Steps 2.3, 2.4, 2.7), and start over.

---

## Step 5 — Approve (or correct) the first subtask

For Phase A on this Docker-less pod, a good first subtask proposal looks like this (matches Appendix C below):

```
SUBTASK: Run host-bootstrap.sh and verify the noweb toolchain is reachable on PATH
PHASE: A
INPUTS: scripts/host-bootstrap.sh
OUTPUTS: apt packages installed (idempotent); no project files modified
PLAN:
  1. test -x scripts/host-bootstrap.sh
  2. sudo bash scripts/host-bootstrap.sh
  3. command -v notangle noweave g++ pdflatex python3
PRE-CHECK: pwd  # expect /home/user/sudnya/checkout/orbits/games/arcade/berzerk
POST-CHECK: command -v notangle noweave g++ pdflatex python3
ROLLBACK: none required (apt install is forward-only; safe to leave)
```

If POST-CHECK or PLAN looks wrong, push back in the template format. Otherwise reply with exactly one word:

```text
go
```

> **Why one word?** Anything more invites Gemma-4 to re-plan. "go" is a clean execute signal.

> **What if the agent proposes a Dockerfile-based first subtask?** That's an ENV-line miss. Reject with: `ENV violation. This pod has no Docker (§1.6). Re-propose using host-mode targets only.`

---

## Step 6 — The steady-state turn loop

Every productive turn after Step 5 follows this rhythm:

```
[agent] executes the approved subtask (tool calls)
[agent] runs POST-CHECK and shows the verbatim output
[agent] appends a 3-6 line entry to session_status.md
[agent] proposes the next subtask in the §3 template
[you  ] approve with "go", or push back in the template format
```

**Your job per turn**:

1. **Read the POST-CHECK output yourself.** Don't trust the agent's "all good". Look at the exit code and the last 5 lines.
2. **Spot-check the `session_status.md` append.** In a second SSH terminal: `tail -n 10 $PROJECT/session_status.md`. If the entry is missing, that's a W2 violation — call it out.
3. **Read the next proposed subtask.** Most of your steering happens here. If the subtask is too big, split it. If it skips a verification, reject it.

If three turns in a row look clean, you can relax the spot-checks — but never skip checking POST-CHECK output.

---

## Step 7 — Recovery one-liners (the panic table)

Cite the rule label, then say what to do. Short.

| When you see... | Send (verbatim): |
|---|---|
| `Edit` keeps returning "multiple matches for oldString" | `stop. apply E3. read the file at the affected line numbers and propose a new oldString that includes 3 lines of unique surrounding context.` |
| Agent dropped literate programming and started editing `.cpp` directly | `F3. you must ask before changing the toolchain. show me the verbatim command that failed.` |
| `noweb -t` errors and agent retries with backslash escapes | `you ran noweb -t. that is wrong. the tangle command is notangle. retry with: notangle -R"<chunk>" file.nw > out.cpp` |
| Agent tries `docker`, `make docker-*`, or wants to write a Dockerfile | `ENV violation (§1.6). This pod has no Docker. Use host-mode make targets only.` |
| "What is the latest status?" / "Where were we?" | `Run M1 now. Read session_status.md. Quote the last entry verbatim.` |
| Wrote a file under `/home/user/` outside the project root | `W3 violation. revert. all writes go under $PROJECT.` |
| Read `*.cpp` / `*.nw` from the reference repo without asking | `R4 violation. close the file. you must ask before reading source files from the reference repo.` |
| Build fails twice and agent keeps "fixing" | `F4. stop patching. append a BLOCKER entry to session_status.md with the verbatim error and what you suspect, then wait.` |
| Subtask marked done but POST-CHECK didn't run / didn't pass | `V1 violation. POST-CHECK output, verbatim, please. if it didn't pass, mark the subtask as in_progress.` |
| Agent stated a fact (path, behavior, contents) without a tool call | `R1 violation. you stated X without a tool result. run the verification command and quote the output.` |
| Agent proposes a destructive command | (read carefully; only say "yes" if you actually want it. Default: no.) |
| Same tool call repeated unchanged 2x | `F1. two strikes. stop, change strategy. what specifically failed?` |
| `apt-get install` of a new package without asking | `§1.6 violation. you must ask before installing new packages. revert if possible and propose with a BLOCKER entry.` |
| Agent dumped the `## Goal / ## Constraints` boilerplate more than once in a row | `C4 + W2 violation. You repeated the goal block — that is a stuck signal. Run: tail -n 30 session_status.md, quote the last entry, then propose ONE next subtask in the §3 SUBTASK template format. Do not summarize the goal again.` |
| Agent reply contains "Wait, I'll…" / "Actually, let me…" / "OK, let's go" or any stream-of-consciousness chain-of-thought, especially repeating | **STOP the agent immediately** (Ctrl-C if needed). Send: `C4 violation. You leaked chain-of-thought into the user-visible output and entered a repetition loop. Restart: append a BLOCKER entry to session_status.md noting which subtask was open, then end this chat. We will resume in a fresh session.` Then exit and `opencode --agent berzerk` again. M1 will pick up from the BLOCKER. |
| Agent's text reply is > 1000 words with no tool calls in this turn | `C5 violation. Reply caps at ~500 words. If you have more to say, you should be making tool calls. Re-do this turn: do one tool call, then a ≤ 5-line report.` |

**Tip:** the more often you cite labels (`E3`, `R4`, `F3`), the better Gemma-4 follows them. The labels are short tokens it can pattern-match. Re-explaining the rule in plain English works less well.

See Appendix D for the full rule-label cheatsheet.

---

## Step 8 — When the model gets confused (escalation ladder)

Symptoms of a stuck or drifting model:

- Same tool call with identical arguments, twice or more
- Asking you the same question twice in a row
- Reciting parts of `goals.md` instead of doing work
- Long prose with no tool calls
- Proposing a subtask that doesn't reference the current phase

Escalation:

1. **Re-anchor:** send the §7 Quick-reference card from `goals.md` as a user message.
2. **Force a status read:** send `Stop. Run: tail -n 30 session_status.md. Quote the last entry. Then propose the next subtask.`
3. **Restart the session:** end the chat (Ctrl-D or `/exit`), open a new one (`opencode --agent berzerk` again, from the same project-root cwd), re-send Step 3's first message. Gemma-4 will re-run M1 from scratch and pick up where the log left off — that's exactly what the log is for.

Restart is cheap as long as `session_status.md` is up to date. Don't try to "save" a degraded session through 50 more turns.

---

## Step 9 — Phase transitions

When the agent claims a phase is complete, **don't take its word for it.** Open a separate SSH terminal and run the exit-criterion command for that phase from `goals.md` §2. For reference (per-phase, on this Docker-less pod):

| Phase | Exit verification (run from `$PROJECT`) |
|---|---|
| A | `bash scripts/host-bootstrap.sh && command -v notangle noweave g++ pdflatex python3` |
| B | `make build && ./build/test_memory` (CRC-verified ROM load, exit 0) |
| C | `make test-z80 2>&1 \| tail -3` (expect `1,604,000 / 1,604,000 PASS`) |
| D | Inspect `/tmp/frame*.png` or `build/frames/frame_*.png`; title screen matches reference; Magic RAM self-test passes |
| E | `python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/` reports < 1% pixel delta over ≥ 600 frames |
| F | `ls cdoc/phaseF_*.md` shows four files; `scripts/z80_disasm.py` decodes ≥ 99% of bytes / instructions |
| G | `make cosim-test 2>&1 \| tail -10` (expect `0 mismatches`, self-cosim sanity) |
| H | `make cosim-test` reports 0 mismatches for all implemented subroutines AND for ≥ 600 frames of recorded gameplay |

Then also:
1. `ls` each artifact listed for that phase in `goals.md` §2.
2. `tail -n 30 session_status.md` — confirm the last several entries are `pass` results, no open `BLOCKER:` blocks.

If all checks pass, send:
```text
Phase X confirmed complete. Proceed to Phase Y.
```

If any check fails, send:
```text
Phase X is not complete: <specific failure>. Reopen the relevant subtask.
```

Do not allow the agent to mark a phase done that you haven't independently verified. This is the single biggest insurance policy you have.

---

## Step 10 — Recovering after auto-compaction

OpenCode will silently compact context after some number of turns. Symptoms: agent suddenly forgets a path, asks "where were we?", or proposes a subtask from the wrong phase.

Recovery, in one message:
```text
Context was compacted. Run M1 now (the four startup reads). Then quote the
last entry of session_status.md and tell me which subtask was open.
```

Watch for the four reads. If you see them and the agent picks up from the right phase, you're back on track. If not, restart the session (Step 8.3).

---

## Step 11 — Reference-repo (gfx-challenge) escalations

The reference repo at `$REFREPO` is the previous, working build of this project. The agent must ask before reading source from it. Default to **no**, with three exceptions:

| Agent asks to copy... | Your answer |
|---|---|
| `rom/berzerk/*` ROM binaries | `yes — copy only, no symlinks. verify CRC32 in Phase B.` |
| `cdoc/berzerk_tunstall.asm` | `yes.` |
| `third_party/SingleStepTests/z80/` | `yes.` |
| Any `.cpp`, `.h`, `.nw`, `.md` source file | **default: no.** Ask the agent to explain why it can't produce that file from `goals.md` and the MAME blueprint. Approve only if the explanation is sound and the agent commits to cosim-verifying the copied content. |
| Any `Dockerfile` or `Makefile` | usually no — the spec is in `goals.md` §1 / §2. Approve only if the agent is using it as a structural reference, not transplanting wholesale. Note the `Dockerfile` is moot on this pod (§1.6). |

When you say yes, be specific:
```text
yes — copy /home/user/sudnya/checkout/gfx-challenge/rom/berzerk/* to ./rom/berzerk/.
do not copy anything else. verify CRCs as part of Phase B post-check.
```

---

## Step 12 — Pause, resume, and disconnect recovery

### 12.1 — End of day / pause

If you want to stop for the day mid-phase:

1. Ask the agent: `Stop here. Append a STATUS entry to session_status.md summarizing the current subtask, what's done, what's pending, and any open questions. Then exit.`
2. Confirm the entry was appended (`tail -n 10 session_status.md`).
3. Exit the chat (`Ctrl-D` or `/exit`).
4. SSH out.

Nothing else needs preserving. The file system has all the state.

### 12.2 — Resume next session

1. SSH back in (`ssh -A $POD`).
2. `cd "$PROJECT"`.
3. `opencode --agent berzerk` (new chat).
4. Send the §3 first message. Rule M1 makes the agent re-read everything; it'll pick up from the last `session_status.md` entry.

You should **not** need to re-run `host-bootstrap.sh` unless the pod was reimaged.

### 12.3 — Pod was killed / rescheduled

k8s pods get evicted. What survives and what doesn't:

| Survives | Lost |
|---|---|
| All committed git history | The opencode chat session (in-memory) |
| Files under `$PROJECT` (assuming PV-backed) | apt-installed packages (if pod rootfs is ephemeral) |
| `session_status.md` and `cdoc/implemented_so_far.md` | Any uncommitted `build/` artifacts |

After the pod comes back:

```bash
ssh -A $POD
export POD=...; export ORBITS=...; export REFREPO=...; export PROJECT=...    # re-export
cd "$PROJECT"
# (a) verify project files survived
ls goals.md scripts/host-bootstrap.sh .opencode/agent/berzerk.md
# (b) if apt packages got wiped, re-run bootstrap (it's idempotent)
sudo bash scripts/host-bootstrap.sh
# (c) confirm
command -v notangle noweave g++ pdflatex python3
# (d) resume per 12.2
opencode --agent berzerk
```

If `$PROJECT` itself was wiped (no persistent volume), you're back to Step 1.

---

## Step 13 — Termination (project complete)

The project is done when **all** the checkboxes in `goals.md` §6 pass. The agent will claim completion. Verify yourself:

```bash
cd "$PROJECT"

# 1. Bootstrap idempotency
bash scripts/host-bootstrap.sh && command -v notangle noweave g++ pdflatex python3 >/dev/null && echo "OK: bootstrap"

# 2. Clean host build
make build && echo "OK: build"

# 3. Z80 test corpus
make test-z80 2>&1 | tail -3        # expect: 1,604,000 / 1,604,000 PASS

# 4. Cosim
make cosim-test 2>&1 | tail -10     # expect: 0 mismatches

# 5. Headless visual verification (PNG diff against goldens)
python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/   # expect < 1% delta

# 6. PDFs from literate weave
make weave 2>&1 | tail -3 && ls doc/*.pdf

# 7. Phase F docs
ls cdoc/phaseF_*.md

# 8. session_status.md final entry
tail -n 5 session_status.md         # expect a "PROJECT COMPLETE" line
```

If all eight pass, commit and tag:
```bash
git config user.email "you@example.com"    # one-time if git user not set
git config user.name  "Your Name"
git add -A && git commit -m "Berzerk emulator complete (all phases A-H, cosim 0 diffs)"
git tag berzerk-v1
git push origin HEAD --tags                # if you have a remote configured
```

---

## Appendix A — All the prompts you'll send, in order

For copy-paste convenience.

**A.1 §2.7 prompt-landing probe (send before A.2):**
```text
Quick sanity checks before we begin, answer each in one line:
1. What is your CONTRACT path?
2. What does rule E3 say?
3. What does ENV say about Docker?
4. What is your model identifier?
```

**A.2 First "real" message of any new session:**
```text
Begin. Execute the four startup actions (M1), then tell me which phase you are
starting and what your next subtask is. Do not start the subtask yet — propose
it in the SUBTASK template from §3 of the contract and wait for me to say "go".
```

**A.3 Approve a subtask:**
```text
go
```

**A.4 Push back on a subtask** (template):
```text
revise. <one or two sentences of what's wrong>. Re-propose in the SUBTASK template.
```

**A.5 After auto-compaction:**
```text
Context was compacted. Run M1 now (the four startup reads). Then quote the
last entry of session_status.md and tell me which subtask was open.
```

**A.6 Phase transition (success):**
```text
Phase X confirmed complete. Proceed to Phase Y.
```

**A.7 Phase transition (failure):**
```text
Phase X is not complete: <specific failure>. Reopen the relevant subtask.
```

**A.8 Authorize a reference-repo read/copy:**
```text
yes — copy <specific path> to <specific destination>. do not copy anything else.
```

**A.9 Decline a reference-repo read:**
```text
no. produce that file from goals.md and the MAME blueprint. cosim-verify when done.
```

**A.10 End of day / pause:**
```text
Stop here. Append a STATUS entry to session_status.md summarizing the current
subtask, what's done, what's pending, and any open questions. Then exit.
```

**A.11 Project complete:**
```text
verified end-to-end. archive session_status.md and tag the commit.
```

---

## Appendix B — Anti-prompts (things to NOT say)

| Don't say | Why |
|---|---|
| "Be careful with edits" | Vague; cite E3 instead. |
| "Use the right tangle command" | Vague; cite B2 or paste the literal `notangle -R"<chunk>" ...`. |
| "Don't drift" / "stay focused" | Meaningless to a 30B model; cite M1, F3. |
| "What do you think?" | Invites speculation. Always ask for tool evidence. |
| "Try again" with no further detail | Will retry the same broken thing. Specify what changed. |
| Long multi-paragraph corrections | Gemma-4 attends best to short imperatives. Cap at ~3 sentences. |
| Multiple questions in one turn | Rule C3 says one at a time — applies to you too. |
| "Just use Docker for now" | Pod has none (§1.6). Cite ENV instead. |

---

## Appendix C — What "good" looks like (one ideal turn)

Phase A on this pod is host-mode bootstrap, not a Docker build (§1.6).

You: `go`

Agent:
```
Tool: bash
$ cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk && ls scripts/host-bootstrap.sh
scripts/host-bootstrap.sh

Tool: bash
$ sudo bash scripts/host-bootstrap.sh
==> Checking required host packages...
==> All required packages already installed.
==> Verifying toolchain reachability (no commands that read stdin):
g++ (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0
pdflatex 3.141592653-2.6-1.40.22 (TeX Live 2022/dev/Debian)
Python 3.10.12
notangle: /usr/bin/notangle
noweave: /usr/bin/noweave

Tool: bash (POST-CHECK)
$ command -v notangle noweave g++ pdflatex python3
/usr/bin/notangle
/usr/bin/noweave
/usr/bin/g++
/usr/bin/pdflatex
/usr/bin/python3

POST-CHECK passed (5 paths returned, all on PATH).

Tool: bash
$ cat >> session_status.md <<'EOF'

## 2026-05-08 14:32 — Phase A — Host bootstrap (no Docker; k8s pod)
RESULT: pass
TOUCHED: (no files modified; idempotent script reported all packages already installed)
NOTES: notangle/noweave/g++/pdflatex/python3 all on PATH. Phase A exit criterion holds.
EOF

Next subtask:

SUBTASK: Tangle a smoke-test chunk from noweb/main.nw to confirm the literate pipeline works end-to-end
PHASE: A
INPUTS: noweb/main.nw (write a 5-line stub if missing — one chunk named `main`)
OUTPUTS: /tmp/main.cpp (transient; smoke test only, gitignored)
PLAN:
  1. test -f noweb/main.nw || write a 5-line stub.
  2. notangle -R'main' noweb/main.nw > /tmp/main.cpp
  3. wc -l /tmp/main.cpp (expect > 0)
PRE-CHECK: command -v notangle
POST-CHECK: notangle -R'main' noweb/main.nw | wc -l    # expect a positive integer
ROLLBACK: rm noweb/main.nw (only if we just created it); rm /tmp/main.cpp
```

You: `go`

That's the rhythm. **Short approvals, short corrections, the agent does the work, you verify.**

---

## Appendix D — Rule-label cheatsheet

Full text lives in `goals.md` §4. This is a one-glance summary so you can cite rules without flipping back.

| Label | Surface | Rule |
|---|---|---|
| **E1** | Edit | Read 30 lines of surrounding context before any Edit. |
| **E2** | Edit | If the target string is non-unique, disambiguate with ≥ 3 lines of unique context. |
| **E3** | Edit | Two strikes — on a 2nd identical Edit error, stop, change strategy, never retry the same Edit a third time. |
| **E4** | Edit | If Edit says "no changes to apply, oldString and newString are identical", the change is done — move on. |
| **B1** | Bash | Stay inside `$PROJECT`. Never cd to `~`, `/tmp`, `/home/user/` parent, or `$REFREPO` without an explicit reason. |
| **B2** | Bash | Use canonical commands (`notangle -R"<chunk>" file.nw > out.cpp`, NOT `noweb -t`). |
| **B3** | Bash | Long-running commands get a `timeout`; don't open-loop on a frozen process. |
| **B4** | Bash | Never run two parallel `make` jobs against the same `build/` dir. |
| **W1** | Write | Algorithm code goes in `noweb/*.nw`. Tangled output is a build artifact; never edit `src/`/`include/` without updating `.nw`. |
| **W2** | Write | Append a 3-6 line entry to `session_status.md` after **every** subtask. |
| **W3** | Write | Never write outside `$PROJECT`. |
| **R1** | Read | No claims without tool evidence. Run a command before stating a fact. |
| **R2** | Read | No improvised paths — `ls` first, quote the output. |
| **R3** | Read | When mirroring MAME behavior, cite the file:line you mirrored. |
| **R4** | Read | `$REFREPO` is read-only and ask-first. ROMs/disassembly/test-corpus are pre-approved as inputs to copy; everything else needs explicit yes. |
| **V1** | Verify | No subtask is "done" until POST-CHECK exits 0. |
| **V2** | Verify | Run `make build` before any `git commit`. |
| **V3** | Verify | Phase H "implemented" means cosim returns 0 diffs in the visible region. |
| **F1** | Fail | Two-strike — any tool error twice on the same target → stop, change strategy. |
| **F2** | Fail | When stuck, append a `BLOCKER:` entry to `session_status.md` with the verbatim commands and errors. |
| **F3** | Fail | Don't silently abandon literate programming or pivot tools. Write a blocker and ask. |
| **F4** | Fail | One retry, then escalate. After a 2nd failed build, write a blocker and stop patching. |
| **M1** | Memory | At the start of every new context, do the four startup reads (CONTRACT, POLICY_DIR, LOG, implemented_so_far.md) before any other action. |
| **M2** | Memory | Update the TODO list after every subtask. |
| **M3** | Memory | No "where were we?" requests to the user — read the log. |
| **C1** | Comm | Honest assessments: what I did / what I observed / my read / what I'm unsure about. |
| **C2** | Comm | Ask before destructive actions (`git push`, `rm -rf`, etc.). |
| **C3** | Comm | One question at a time. |
| **C4** | Comm | No chain-of-thought leak. No "Wait, I'll..." / "Actually, let me..." stream-of-consciousness. Repeating a phrase twice in one reply is a stop signal. |
| **C5** | Comm | Cap user-visible text replies at ~500 words. If you have more, make tool calls instead. |
| **§1.6** | Env | This pod has no Docker. Use host-mode `make` targets only. |
