# Phase A — Bootstrap (host toolchain on a Docker-less k8s pod)

## TL;DR

Get `g++`, `noweb`, `texlive`, `libsdl2-dev`, `python3` installed on the pod. Verify the tangle → compile → run loop works on a 4-line `noweb/main.nw` stub. Land a host-mode `Makefile`. Six subtasks. ~1 hour for a capable model; expect Gemma to take 2–4×.

---

## How to use this file

You will be SSH'd into the pod with **two terminals open**:

- **Terminal 1:** running `opencode --agent berzerk`. This is where you paste subtask prompts and Gemma works.
- **Terminal 2:** a plain shell at the project root. This is where **you** run the independent-verify command after each subtask, before sending Gemma `go` on the next.

Per subtask, the flow is:

1. Read the subtask's **Paste this to Gemma** block. Copy it verbatim into Terminal 1.
2. Wait for Gemma to finish. Read its response against **What Gemma should report**.
3. In Terminal 2, run the **Independent verify** command. If it prints `OK`, the subtask is done. If not, do not advance.
4. In Terminal 1, send Gemma `next` (or paste the next subtask).

You do not have to trust Gemma's "pass" claim — the independent verify is your truth check. Gemma can confabulate; `grep` cannot.

---

## Before you start — entry criteria

**First time on a fresh pod?** Do `c-cowork/SETUP.md` (Step 0 laptop, Step 1 pod) before this checklist. SETUP.md gets you SSH'd in, the reference repo cloned, ROMs copied, SingleStepTests pre-fetched, and the `c-cowork/` bundle deployed.

Once Steps 0 and 1 of SETUP are done, run these in Terminal 2. Every line should print `OK` or the expected count.

```bash
# 1. SSH'd into the right pod
hostname && echo OK

# 2. You're at the project root
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk && pwd && echo OK
[ "$(pwd)" = "/home/user/sudnya/checkout/orbits/games/arcade/berzerk" ] && echo OK

# 3. The driver-mode docs are present
test -f goals.md && test -f MILESTONES.md && test -f phases/phase_a.md && echo "OK docs"

# 4. The OpenCode agent file is present at the canonical OpenCode path
test -f .opencode/agent/berzerk.md && echo "OK agent"

# 5. ROMs are present (expect 8 files)
ls rom/berzerk/ | wc -l                  # 8

# 6. SingleStepTests Z80 corpus is pre-fetched at the canonical path
#    (NOT tests/z80/ — that was the V2 mistake)
ls third_party/SingleStepTests/z80/v1/ | head -1   # expect a *.json filename
ls third_party/SingleStepTests/z80/v1/ | wc -l     # expect ~1812

# 7. The reference repo is available read-only (rule R4)
ls /home/user/sudnya/checkout/gfx-challenge/ > /dev/null && echo "OK reference repo"

# 8. session_status.md exists (may be empty or have a RESET marker — that's fine)
test -f session_status.md && echo "OK log"
```

If any of these fail, fix in Terminal 2 before launching OpenCode. Common fixes:

- Missing ROMs → `cp -r /home/user/sudnya/checkout/gfx-challenge/rom/berzerk rom/` (you have rule R4 authorization to copy ROMs; they're inputs, not work product).
- Missing SingleStepTests → `mkdir -p third_party && git clone https://github.com/SingleStepTests/z80.git third_party/SingleStepTests/z80`
- Missing `.opencode/agent/berzerk.md` → it's at `c-cowork/.opencode/agent/berzerk.md` in this repo; copy it to the pod's project root via tar+ssh.

---

## Session start (Terminal 1 — OpenCode)

Once entry criteria pass, in Terminal 1:

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk
opencode --agent berzerk
```

OpenCode loads the system prompt from `.opencode/agent/berzerk.md` (YAML + body). Your **first message** to Gemma:

```text
Begin. Execute the three M1 startup reads (goals.md, MILESTONES.md, tail -n 30 session_status.md). Report back with:
  (a) the last entry in session_status.md (or "missing/empty"),
  (b) which phase you believe is active,
  (c) "ready" — and STOP. Do not propose a plan. I will paste the next subtask.
```

Gemma should reply with the three reads done, an entry summary, "Phase A active", and "ready". If it instead starts planning or proposes Phase A.1 itself, send: `STOP. Wait for me to paste the subtask. M1 startup reads only.`

When Gemma reports ready, paste subtask A.1.

---

## Subtasks

---

### A.1 — Install the host toolchain end-to-end

**Why:** without `g++`, `notangle`, `noweave`, `pdflatex`, and `python3` on PATH, every later phase is blocked. This subtask also pins cwd (rule B1) and pre-creates the project directory tree so later subtasks don't waste a turn on missing dirs.

**Paste this to Gemma:**

````text
Phase A.1 — Install host toolchain.

Run these steps in order. STOP at the first non-zero exit and report which step failed.

Step 1. Confirm cwd is the project root:
  pwd
The output must equal: /home/user/sudnya/checkout/orbits/games/arcade/berzerk

Step 2. Create the project directory tree (idempotent):
  mkdir -p noweb src include build/scratch cdoc tests scripts

Step 3. Check whether scripts/host-bootstrap.sh exists and is executable. If both, skip Step 4.
  test -x scripts/host-bootstrap.sh && echo "PRESENT" || echo "MISSING"

Step 4. ONLY if Step 3 printed MISSING, write scripts/host-bootstrap.sh with EXACTLY these contents using a heredoc. Do not add packages or modify the list:
  cat > scripts/host-bootstrap.sh <<'EOF'
  #!/usr/bin/env bash
  # Idempotent host bootstrap for the Berzerk emulator on a Docker-less k8s pod.
  set -euo pipefail
  PKGS=(
    build-essential
    noweb
    texlive-latex-base texlive-latex-recommended
    libsdl2-dev
    gdb
    python3
  )
  echo "Checking host packages..."
  MISSING=()
  for p in "${PKGS[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p")
  done
  if [ ${#MISSING[@]} -eq 0 ]; then
    echo "All required packages already installed."
    exit 0
  fi
  echo "Installing: ${MISSING[*]}"
  sudo apt-get update -y
  sudo apt-get install -y "${MISSING[@]}"
  echo "Done."
  EOF
  chmod +x scripts/host-bootstrap.sh

Step 5. Run the bootstrap script (may take 30-60s on first run):
  sudo bash scripts/host-bootstrap.sh

Step 6. Re-run it to confirm idempotency (must succeed silently without re-installing):
  bash scripts/host-bootstrap.sh

Step 7. Verify all 5 binaries are on PATH:
  command -v g++ notangle noweave pdflatex python3
This must print 5 non-empty paths, one per line. Do NOT run `notangle` bare — it reads stdin and hangs the shell.

Step 8. Append a one-line log entry:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — A.1 done — pass — toolchain installed
  EOF

Report back with:
  - which steps ran (and which were skipped),
  - the last 10 lines of stdout for Step 5 (the bootstrap install),
  - the verbatim output of Step 7 (the 5 paths),
  - any unexpected behavior.

Then STOP. Wait for me to paste A.2.
````

**What Gemma should report:**

- Step 1: `pwd` output matches the project root.
- Step 3: either `PRESENT` (skip Step 4) or `MISSING` (Gemma writes the file in Step 4).
- Step 5: ends with `Done.` (if installs happened) or `All required packages already installed.` (if not).
- Step 6: `All required packages already installed.` (idempotency check).
- Step 7: five lines that look like `/usr/bin/g++`, `/usr/bin/notangle`, `/usr/bin/noweave`, `/usr/bin/pdflatex`, `/usr/bin/python3`.
- Step 8: one line appended.

**Independent verify (Terminal 2):**

```bash
command -v g++ notangle noweave pdflatex python3 > /dev/null && echo OK
```

Expected: `OK`. If any binary is missing, the apt install partially failed — re-run Step 5 in Terminal 1 with verbose output (`sudo bash -x scripts/host-bootstrap.sh`) to see which package errored.

**If it fails:**

- Gemma proposes `apt install docker` → no Docker on this pod. Cite: "No Docker. Use only the packages in PKGS."
- Gemma runs `notangle` bare and the shell hangs → Ctrl-C. Send: "B2. Verify with `command -v notangle`, not bare invocation."
- `sudo apt-get` errors with "could not resolve host" → pod has no network temporarily; wait a minute and retry.

---

### A.2 — Write the minimal `noweb/main.nw` stub

**Why:** smoke-test input for the tangle/compile pipeline (A.3). The chunk syntax `<<chunk-name>>=` is where V2 Gemma wasted five turns trying `@start{main}` / `@end{main}`. This subtask forces the correct syntax with a literal heredoc.

**Paste this to Gemma:**

````text
Phase A.2 — Write the noweb stub.

Write noweb/main.nw with EXACTLY these four lines, using a heredoc. Do NOT use @start{...} / @end{...} — that is the wrong syntax and will not tangle. The correct noweb chunk syntax is <<chunk-name>>= on its own line, followed by the chunk body. A blank line ends the chunk.

  cat > noweb/main.nw <<'EOF'
  <<main>>=
  int main() {
      return 0;
  }
  EOF

Then verify and report:
  cat noweb/main.nw
  grep -q '^<<main>>=' noweb/main.nw && echo "syntax OK"
  ! grep -q '@start{' noweb/main.nw && echo "no wrong syntax"

Append a log line:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — A.2 done — pass — noweb/main.nw stub written
  EOF

Then STOP and wait.
````

**What Gemma should report:**

- The verbatim content of `noweb/main.nw` (4 lines, starting with `<<main>>=`).
- `syntax OK`
- `no wrong syntax`
- One log line appended.

**Independent verify (Terminal 2):**

```bash
test -f noweb/main.nw && grep -q '^<<main>>=' noweb/main.nw && ! grep -q '@start{' noweb/main.nw && echo OK
```

Expected: `OK`.

**If it fails:**

- File uses `@start{main}` syntax → cite: "Wrong syntax. The noweb chunk header is `<<main>>=` on its own line. Rewrite the file."
- File has more than 4 lines → Gemma added preamble. Cite: "Strip preamble. The stub is exactly 4 lines."

---

### A.3 — Smoke-test the tangle → compile → run pipeline

**Why:** confirms `notangle` works against the stub, `g++ -std=c++17` compiles its output, and the result executes. Smoke-test only — output goes to `/tmp` (rule W3 explicitly allows transient probes in `/tmp`; project files don't).

**Paste this to Gemma:**

````text
Phase A.3 — Smoke-test tangle → compile → run.

Run these in order. Do NOT use `noweb -t`; the tangle command is `notangle`.

Step 1. Tangle the main chunk out of the stub:
  notangle -R'main' noweb/main.nw > /tmp/main.cpp

Step 2. Confirm the output is non-empty (at least 3 lines):
  wc -l /tmp/main.cpp

Step 3. Compile:
  g++ -std=c++17 /tmp/main.cpp -o /tmp/main_stub

Step 4. Run and capture exit status:
  /tmp/main_stub
  echo "exit=$?"

Step 5. Append a log line:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — A.3 done — pass — tangle/compile/run smoke OK
  EOF

Report:
  - the verbatim output of Step 2 (`wc -l` count),
  - the verbatim output of Step 4 (`exit=0`),
  - the contents of /tmp/main.cpp (cat it).

Then STOP.
````

**What Gemma should report:**

- Step 2: `wc -l /tmp/main.cpp` prints `3 /tmp/main.cpp` (or more).
- Step 4: `exit=0`.
- The cat of `/tmp/main.cpp` shows `int main() { return 0; }` (formatted across 3 lines).

**Independent verify (Terminal 2):**

```bash
notangle -R'main' noweb/main.nw > /tmp/main.cpp && \
  g++ -std=c++17 /tmp/main.cpp -o /tmp/main_stub && \
  /tmp/main_stub && echo OK
```

Expected: `OK`.

**If it fails:**

- `notangle: command not found` → A.1 didn't finish. Go back.
- `notangle` errors with "unescaped << in documentation chunk" → Gemma ran `noweb -t` (the meta-wrapper) instead of `notangle`. Cite B2.
- `g++` errors → check `/tmp/main.cpp` content. If it's empty, A.2's stub is malformed.

---

### A.4 — Write the canonical host-mode `Makefile`

**Why:** every later phase runs `make build`, `make test-z80`, `make cosim-test`, `make weave`. The Makefile MUST be host-mode only — zero `docker` rules. V2 Gemma wasted ~30 turns trying `make docker-build` before being told.

**Paste this to Gemma:**

````text
Phase A.4 — Write the host-mode Makefile.

Step 1. Check whether Makefile exists and is docker-free:
  test -f Makefile && ! grep -q '^docker' Makefile && echo "PRESENT" || echo "MISSING"

Step 2. ONLY if Step 1 printed MISSING, write the Makefile with EXACTLY these contents (do not add docker rules, do not "improve"). IMPORTANT: Makefile recipes use TAB indentation. The lines starting with whitespace below MUST be a single literal TAB, not spaces. Use printf or a heredoc that preserves tabs:

  cat > Makefile <<'EOF'
  # Host-mode Makefile for the Berzerk emulator. NO docker.
  # Generated artifacts (src/, include/, build/, doc/) are gitignored.

  NW_FILES := $(wildcard noweb/*.nw)
  SRC_DIR  := src
  INC_DIR  := include
  BUILD    := build

  .PHONY: tangle build clean test-z80 cosim-test weave

  tangle:
  	@mkdir -p $(SRC_DIR) $(INC_DIR)
  	@for nw in $(NW_FILES); do \
  	  for chunk in $$(grep -oE '^<<[^>]+>>=' $$nw | sed -E 's/^<<(.+)>>=$$/\1/'); do \
  	    case $$chunk in \
  	      *.h)   notangle -R"$$chunk" $$nw > $(INC_DIR)/$$chunk ;; \
  	      *.cpp) notangle -R"$$chunk" $$nw > $(SRC_DIR)/$$chunk ;; \
  	      main)  notangle -R"$$chunk" $$nw > $(SRC_DIR)/main.cpp ;; \
  	    esac; \
  	  done; \
  	done

  build: tangle
  	@mkdir -p $(BUILD)
  	@if ls $(SRC_DIR)/*.cpp >/dev/null 2>&1; then \
  	  g++ -std=c++17 -Wall -Wextra -I$(INC_DIR) $(SRC_DIR)/*.cpp -o $(BUILD)/berzerk; \
  	fi

  clean:
  	rm -rf $(SRC_DIR)/*.cpp $(INC_DIR)/*.h $(BUILD)

  test-z80:
  	@echo "TODO: wired in Phase C"; true

  cosim-test:
  	@echo "TODO: wired in Phase G"; true

  weave:
  	@mkdir -p doc
  	@for nw in $(NW_FILES); do \
  	  noweave -autodefs c -index $$nw > doc/$$(basename $$nw .nw).tex; \
  	done
  EOF

Step 3. Verify the file uses real TABs in recipe lines:
  awk '/^\t/' Makefile | head -1   # must print at least one line that starts with TAB

Step 4. Verify shape:
  test -f Makefile && echo "exists"
  ! grep -q '^docker' Makefile && echo "no docker rules"
  grep -qE '^(tangle|build|clean|test-z80|cosim-test|weave):' Makefile && echo "targets present"

Step 5. Append log line:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — A.4 done — pass — host-mode Makefile in place
  EOF

Report what Step 1 found, Step 3's output (must be non-empty), Step 4's three "exists/no docker rules/targets present" lines. Then STOP.

If `make tangle` later errors with "missing separator", you have a tab/space issue — re-do this subtask, making sure heredoc preserves tabs.
````

**What Gemma should report:**

- Step 1: `PRESENT` (skip Step 2) or `MISSING` (Gemma writes it).
- Step 3: at least one line starting with TAB.
- Step 4: `exists`, `no docker rules`, `targets present`.
- One log line appended.

**Independent verify (Terminal 2):**

```bash
test -f Makefile && \
  ! grep -q '^docker' Makefile && \
  grep -qE '^(tangle|build|clean):' Makefile && \
  awk '/^\t/' Makefile | head -1 | grep -q . && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- Gemma added `docker-build` or similar → cite: "No Docker. Strip the docker rules."
- Step 3 prints nothing → Makefile uses spaces, not tabs. Cite: "Recipe lines must start with TAB. Rewrite using a heredoc that preserves tabs (e.g., write the file with printf or sed)."
- `make: *** missing separator` later → same tab/space issue.

---

### A.5 — Verify `make tangle` and `make clean` work end-to-end

**Why:** validates the Makefile's tangle and clean rules against the stub. Different from A.3 (which invoked `notangle` directly) — this exercises the per-chunk extraction loop in the Makefile.

**Paste this to Gemma:**

````text
Phase A.5 — Verify make tangle and make clean.

Run in order:

Step 1. Start from a clean tree:
  make clean
  ! test -f src/main.cpp && echo "clean works"

Step 2. Tangle via the Makefile:
  make tangle
  test -s src/main.cpp && echo "tangle works"

Step 3. Clean again to confirm round-trip:
  make clean
  ! test -f src/main.cpp && echo "clean again"

Step 4. Append log line:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — A.5 done — pass — make tangle/clean round-trip OK
  EOF

Report the verbatim output of Steps 1-3, then STOP.
````

**What Gemma should report:**

- Step 1: `clean works`
- Step 2: `tangle works`
- Step 3: `clean again`
- One log line.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  test -s src/main.cpp && \
  make clean > /dev/null 2>&1 && \
  ! test -f src/main.cpp && echo OK
```

Expected: `OK`.

**If it fails:**

- `make tangle` errors with "missing separator" → tab/space issue from A.4. Re-do A.4.
- `make tangle` produces no `src/main.cpp` → the chunk-name routing in the Makefile didn't match `main`. Check `case $$chunk in ... main) ...`; Gemma may have dropped that branch.

---

### A.6 — Mark Phase A complete

**Why:** phase-boundary marker. Future sessions grep for `Phase A COMPLETE` to know where to resume. Without it, the next session has no anchor.

**Paste this to Gemma:**

````text
Phase A.6 — Mark Phase A complete.

Step 1. Confirm A.1-A.5 are all logged:
  grep -E "^## .* — A\.[1-5] done" session_status.md | wc -l
The output must be at least 5.

Step 2. Append the Phase A COMPLETE block:
  cat >> session_status.md <<EOF

  ## $(date +'%Y-%m-%d %H:%M') — Phase A COMPLETE — Bootstrap host toolchain
  RESULT: pass
  TOUCHED: scripts/host-bootstrap.sh, noweb/main.nw, Makefile, src/main.cpp (regenerable)
  NOTES: A.1-A.5 all green. Host toolchain (g++, notangle, noweave, pdflatex, python3) on PATH.
         Makefile has host-mode targets only, zero docker rules. Tangle/compile/clean
         round-trip verified against the noweb/main.nw stub. Ready for Phase B (memory).
  EOF

Step 3. Verify:
  grep -q "Phase A COMPLETE" session_status.md && echo OK

Report Step 1's count, Step 3's OK, then STOP.
````

**What Gemma should report:**

- Step 1: a number ≥ 5.
- Step 3: `OK`.

**Independent verify (Terminal 2):**

```bash
grep -q "^## .* Phase A COMPLETE" session_status.md && echo OK
```

Expected: `OK`.

---

## Exit criterion (whole phase)

Run all of these in Terminal 2. Every line must print `OK` or the expected value.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

# Toolchain
command -v g++ notangle noweave pdflatex python3 > /dev/null && echo "OK toolchain"

# Bootstrap idempotent
bash scripts/host-bootstrap.sh > /dev/null 2>&1 && echo "OK bootstrap idempotent"

# noweb stub with correct syntax
grep -q '^<<main>>=' noweb/main.nw && ! grep -q '@start{' noweb/main.nw && echo "OK stub"

# Tangle/compile/run
notangle -R'main' noweb/main.nw > /tmp/main.cpp && \
  g++ -std=c++17 /tmp/main.cpp -o /tmp/main_stub && \
  /tmp/main_stub && echo "OK tangle+compile"

# Makefile present, host-mode only, with tabs
test -f Makefile && \
  ! grep -q '^docker' Makefile && \
  awk '/^\t/' Makefile | head -1 | grep -q . && \
  echo "OK makefile"

# make tangle/clean round-trip
make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  test -s src/main.cpp && \
  make clean > /dev/null 2>&1 && \
  ! test -f src/main.cpp && echo "OK make round-trip"

# Phase A COMPLETE marker
grep -q "^## .* Phase A COMPLETE" session_status.md && echo "OK marker"
```

All seven `OK`s → Phase A is done. Open `phases/phase_b.md` and start there.

---

## Known gotchas / quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Gemma proposes `apt install docker` or `make docker-build` | No Docker on this pod | "No Docker. Host targets only." |
| `notangle` hangs the shell | Ran bare (no `-R` or no stdin) | Ctrl-C. Use `command -v notangle` for presence. |
| "unescaped << in documentation chunk" | Ran `noweb -t` instead of `notangle` | "B2. Use `notangle`, not `noweb -t`." |
| `make: *** missing separator` | Spaces instead of tabs in Makefile recipes | Re-do A.4 with tab-preserving write. |
| `noweb/main.nw` uses `@start{}` | Wrong noweb syntax | "Use `<<chunk-name>>=`, not `@start{}`." |
| `tests/z80/` instead of `third_party/SingleStepTests/z80/` | Wrong corpus path | Fix in entry criteria; never clone into `tests/`. |
| Gemma loops "Wait, I'll… Actually, let me…" | C4 violation (CoT stutter) | "C4. STOP the reply. Re-run the last action cleanly." |
| Gemma claims pass but verify fails | Either confabulation or partial install | Re-run in Terminal 2. Don't trust the claim. |

---

## Reference pointers (rule R4 — agent must ask before reading)

- `$REFERENCE_REPO/scripts/host-bootstrap.sh` — canonical bootstrap from Claude Code. Identical to A.1's heredoc.
- `$REFERENCE_REPO/Makefile` — has both host and docker targets. We use only host. Do NOT copy wholesale (R4).
- `$REFERENCE_REPO/SESSION_SUMMARY.md` — Phase 0+1 section describes the reference build's bootstrap.
