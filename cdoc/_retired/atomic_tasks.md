# atomic_tasks.md — Berzerk emulator execution queue

> **Authored by** a planner model (Opus 4.7) so that the executor model (Gemma-4-31B) can run pure execution without planning overhead. **Do not author new tasks in this file from the executor model** — if you (the executor) encounter a situation not covered by an existing task, write a `BLOCKER:` entry in `session_status.md` and stop. A new planner pass will add or revise tasks.
>
> **Executor protocol (you, the agent):**
> 1. After M1, `grep "^## T" cdoc/atomic_tasks.md | head -50` to see the task headers.
> 2. For each task in numeric order, check `grep -q "Txxx COMPLETE" session_status.md`. The lowest-numbered task with **no** matching completion entry is your active task.
> 3. Verify all `DEPENDS_ON` task IDs already appear as `COMPLETE` in `session_status.md`. If any are missing, you have a planning error — write a BLOCKER and stop.
> 4. Run `PRE-CHECK`. If it exits non-zero, write a BLOCKER citing the task ID and the pre-check output.
> 5. Run the steps in `ACTIONS` exactly. Do not add or reorder.
> 6. Run `POST-CHECK`. If it exits non-zero, run `ROLLBACK` and write a BLOCKER.
> 7. Append the `W2_LOG` entry to `session_status.md`. This entry MUST contain the literal string `Txxx COMPLETE` (where `Txxx` is the task ID) on its own line — that's how the next session finds where you left off.
> 8. Stop and yield control to the user. One task per turn.
>
> **One task per turn.** Do not chain. The user will say `go` to advance.

---

## Phase A — Bootstrap (host toolchain)

### T001 — Verify working directory is the project root

```
PHASE: A
DEPENDS_ON: (none — this is the entry task)
PURPOSE: Confirm we are operating in /home/user/sudnya/checkout/orbits/games/arcade/berzerk before any file operations. Pinning the cwd here is a Rule B1 safeguard.
PRE-CHECK: true
ACTIONS:
  1. Run: pwd
  2. Confirm output equals /home/user/sudnya/checkout/orbits/games/arcade/berzerk
POST-CHECK: [ "$(pwd)" = "/home/user/sudnya/checkout/orbits/games/arcade/berzerk" ]
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T001 COMPLETE — pwd verified at project root
  RESULT: pass
  TOUCHED: (none)
  NOTES: cwd pinned per Rule B1.
ROLLBACK: cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk   # then re-run task
```

### T002 — Verify or write scripts/host-bootstrap.sh

```
PHASE: A
DEPENDS_ON: [T001]
PURPOSE: The bootstrap script installs apt deps (g++, make, noweb, texlive-latex-base, libsdl2-dev, gdb, python3) and verifies the toolchain reachable on PATH. It is idempotent. If the file already exists (deployed via scp in PROMPTING_GUIDE.md Step 1.4), do not rewrite it.
PRE-CHECK: test -d scripts
ACTIONS:
  1. If `test -x scripts/host-bootstrap.sh` succeeds, skip to POST-CHECK.
  2. Otherwise write scripts/host-bootstrap.sh with the canonical contents from goals.md §2 Phase A. Then run: chmod +x scripts/host-bootstrap.sh
POST-CHECK: test -x scripts/host-bootstrap.sh && head -1 scripts/host-bootstrap.sh | grep -q '^#!/usr/bin/env bash'
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T002 COMPLETE — scripts/host-bootstrap.sh present and executable
  RESULT: pass
  TOUCHED: scripts/host-bootstrap.sh (or no change if already present)
  NOTES: Idempotent bootstrap script ready.
ROLLBACK: (none — script presence is forward-only)
```

### T003 — Run scripts/host-bootstrap.sh to install apt deps

```
PHASE: A
DEPENDS_ON: [T002]
PURPOSE: Install required system packages on the pod. Idempotent — if all packages already present, exits without modifying the system. Output ends with five verifier paths (g++, pdflatex, python3, notangle, noweave).
PRE-CHECK: test -x scripts/host-bootstrap.sh && command -v sudo
ACTIONS:
  1. Run: sudo bash scripts/host-bootstrap.sh
  2. Wait for the script to finish (it may take 0–60s depending on whether installs are needed).
POST-CHECK: bash scripts/host-bootstrap.sh > /dev/null 2>&1   # re-running must succeed silently (idempotent)
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T003 COMPLETE — host-bootstrap.sh ran successfully
  RESULT: pass
  TOUCHED: system apt packages (forward-only)
  NOTES: All required packages installed. Script is idempotent — safe to re-run.
ROLLBACK: (none — apt installs are forward-only; safe to leave)
```

### T004 — Verify all required toolchain binaries are on PATH

```
PHASE: A
DEPENDS_ON: [T003]
PURPOSE: Confirm g++, notangle, noweave, pdflatex, python3 are all reachable. This is the Phase A exit-criterion gate. DO NOT run notangle or noweave with no arguments — they read stdin and will hang.
PRE-CHECK: true
ACTIONS:
  1. Run: command -v g++ notangle noweave pdflatex python3
  2. Confirm 5 paths are printed (one per line) and the command exits 0.
POST-CHECK: command -v g++ notangle noweave pdflatex python3 > /dev/null
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T004 COMPLETE — toolchain reachable on PATH
  RESULT: pass
  TOUCHED: (none)
  NOTES: g++, notangle, noweave, pdflatex, python3 all on PATH.
ROLLBACK: re-run T003 if any binary is missing
```

### T005 — Ensure project directory structure exists

```
PHASE: A
DEPENDS_ON: [T001]
PURPOSE: Create the canonical project directories (noweb/, src/, include/, build/, build/scratch/, cdoc/, tests/). All are required by later phases. mkdir -p is idempotent.
PRE-CHECK: true
ACTIONS:
  1. Run: mkdir -p noweb src include build/scratch cdoc tests
POST-CHECK: test -d noweb && test -d src && test -d include && test -d build/scratch && test -d cdoc && test -d tests
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T005 COMPLETE — project directory tree created
  RESULT: pass
  TOUCHED: noweb/, src/, include/, build/, build/scratch/, cdoc/, tests/ (created if absent)
  NOTES: All seven directories present.
ROLLBACK: (none — directory creation is non-destructive)
```

### T006 — Write minimal noweb/main.nw stub (correct chunk syntax)

```
PHASE: A
DEPENDS_ON: [T005]
PURPOSE: Create a minimal 4-line noweb file that uses the CORRECT chunk syntax `<<chunk-name>>=` (NOT `@start{...}` / `@end{...}`). This stub is the smoke-test input for tangle/compile in T007–T009.
PRE-CHECK: test -d noweb
ACTIONS:
  1. Write noweb/main.nw with these exact contents (4 lines, no `@start`/`@end`):
     <<main>>=
     int main() {
         return 0;
     }
POST-CHECK: test -f noweb/main.nw && grep -q '^<<main>>=' noweb/main.nw && ! grep -q '@start{' noweb/main.nw
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T006 COMPLETE — minimal noweb/main.nw stub written
  RESULT: pass
  TOUCHED: noweb/main.nw (4 lines)
  NOTES: Uses canonical <<chunk>>= syntax. Will be replaced with real main.nw in Phase D.
ROLLBACK: rm noweb/main.nw
```

### T007 — Tangle the stub to /tmp/main.cpp and verify non-empty output

```
PHASE: A
DEPENDS_ON: [T004, T006]
PURPOSE: Smoke-test the notangle pipeline end-to-end. Successful tangle proves the toolchain and chunk syntax are both correct. Use redirection — do NOT run `notangle` with no input args.
PRE-CHECK: test -f noweb/main.nw
ACTIONS:
  1. Run: notangle -R'main' noweb/main.nw > /tmp/main.cpp
  2. Run: wc -l /tmp/main.cpp
  3. Confirm wc -l output is at least 3.
POST-CHECK: test -s /tmp/main.cpp && [ "$(wc -l < /tmp/main.cpp)" -ge 3 ]
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T007 COMPLETE — tangle pipeline verified end-to-end
  RESULT: pass
  TOUCHED: /tmp/main.cpp (transient, smoke-test only)
  NOTES: notangle extracted the `main` chunk to a non-empty C++ file.
ROLLBACK: rm -f /tmp/main.cpp
```

### T008 — Compile the tangled stub with g++ as a smoke test

```
PHASE: A
DEPENDS_ON: [T007]
PURPOSE: Confirm g++ can compile the tangled output. This validates the toolchain has matching libstdc++ headers and proves notangle output is actually valid C++.
PRE-CHECK: test -s /tmp/main.cpp
ACTIONS:
  1. Run: g++ -std=c++17 /tmp/main.cpp -o /tmp/main_stub
  2. Run: /tmp/main_stub
  3. Confirm exit status 0.
POST-CHECK: g++ -std=c++17 /tmp/main.cpp -o /tmp/main_stub && /tmp/main_stub && echo OK
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T008 COMPLETE — tangled C++ compiles and runs
  RESULT: pass
  TOUCHED: /tmp/main_stub (transient binary)
  NOTES: g++ -std=c++17 path works. Stub returns exit 0.
ROLLBACK: rm -f /tmp/main_stub
```

### T009 — Verify or write canonical Makefile with host-mode targets

```
PHASE: A
DEPENDS_ON: [T005]
PURPOSE: The Makefile is the build entrypoint for every later phase. It must have host-mode targets (`tangle`, `build`, `clean`, `test-z80`, `cosim-test`, `weave`) and MUST NOT call `docker` anywhere — this pod has no Docker (§1.6). If the file is absent or contains a `docker` invocation, write the canonical version per goals.md §2 Phase A.
PRE-CHECK: true
ACTIONS:
  1. If `test -f Makefile` succeeds AND `grep -q '^docker' Makefile` fails (no docker rules), skip to POST-CHECK.
  2. Otherwise write a Makefile with these targets, all host-mode:
       tangle:  scan noweb/*.nw, run notangle for each <<root>> chunk to src/ or include/
       build:   tangle ; compile src/*.cpp with -Iinclude into build/berzerk
       clean:   rm -rf build/ src/*.cpp include/*.h
       test-z80, cosim-test, weave: stubs that print TODO and exit 0 for now
       NO `docker` commands anywhere.
POST-CHECK: test -f Makefile && ! grep -q '^docker' Makefile && grep -q '^tangle:' Makefile && grep -q '^build:' Makefile && grep -q '^clean:' Makefile
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T009 COMPLETE — host-mode Makefile in place
  RESULT: pass
  TOUCHED: Makefile (created or verified)
  NOTES: Targets: tangle, build, clean, test-z80, cosim-test, weave. No docker rules.
ROLLBACK: rm Makefile (only if we just created it)
```

### T010 — Verify `make tangle` works against the stub

```
PHASE: A
DEPENDS_ON: [T006, T009]
PURPOSE: End-to-end Makefile test. `make tangle` should process noweb/main.nw into src/main.cpp without errors. This proves the Makefile's tangle rule is wired correctly.
PRE-CHECK: test -f Makefile && test -f noweb/main.nw
ACTIONS:
  1. Run: make tangle
  2. Confirm exit 0.
  3. Verify src/main.cpp exists and is non-empty.
POST-CHECK: make tangle > /dev/null 2>&1 && test -s src/main.cpp
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T010 COMPLETE — make tangle produces src/main.cpp from stub
  RESULT: pass
  TOUCHED: src/main.cpp (regenerable)
  NOTES: Makefile tangle rule verified end-to-end.
ROLLBACK: make clean
```

### T011 — Verify `make clean` works

```
PHASE: A
DEPENDS_ON: [T010]
PURPOSE: Confirm the clean target removes generated artifacts. Without this, `make build` may pick up stale tangled output from a previous Phase A and produce confusing errors in Phase B.
PRE-CHECK: test -f src/main.cpp   # something to clean
ACTIONS:
  1. Run: make clean
  2. Confirm exit 0.
  3. Verify src/main.cpp is gone OR build/ is removed.
POST-CHECK: ! test -f src/main.cpp
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — T011 COMPLETE — make clean removes tangled output
  RESULT: pass
  TOUCHED: src/main.cpp (removed)
  NOTES: Makefile clean rule verified.
ROLLBACK: (none — clean is forward-only)
```

### T012 — Append Phase A COMPLETE marker to session_status.md

```
PHASE: A
DEPENDS_ON: [T001, T002, T003, T004, T005, T006, T007, T008, T009, T010, T011]
PURPOSE: Phase-boundary marker. Future M1 reads can grep for "Phase A COMPLETE" to know Phase B is the next entry point. This task is NOT optional — it's the gate between Phase A and Phase B.
PRE-CHECK: grep -q "T011 COMPLETE" session_status.md
ACTIONS:
  1. Append a Phase A completion block to session_status.md using the heredoc below.
POST-CHECK: grep -q "Phase A COMPLETE" session_status.md
W2_LOG:
  ## $(date +'%Y-%m-%d %H:%M') — Phase A COMPLETE — Bootstrap host toolchain
  RESULT: pass
  TOUCHED: scripts/host-bootstrap.sh, noweb/main.nw, Makefile, src/main.cpp (regenerable)
  NOTES: T001–T011 all green. Host toolchain (g++, notangle, noweave, pdflatex, python3) on PATH.
         Makefile has host-mode targets and zero docker rules. Tangle/compile/clean pipeline
         end-to-end verified against a stub. Ready for Phase B (memory subsystem).
ROLLBACK: (none — Phase A is foundational)
```

---

## Phase A — How to use this list (executor cheat sheet)

```
# Find your current task (lowest-numbered task without "Txxx COMPLETE" in the log)
for n in 001 002 003 004 005 006 007 008 009 010 011 012; do
  if ! grep -q "T${n} COMPLETE" session_status.md 2>/dev/null; then
    echo "Active task: T${n}"
    break
  fi
done

# After completing a task, before yielding to the user:
# 1. Append the W2_LOG block from the task to session_status.md
# 2. Confirm: grep "Txxx COMPLETE" session_status.md
# 3. Stop. Wait for user's next "go".
```

If a POST-CHECK fails: run ROLLBACK, then write a BLOCKER block to `session_status.md` naming the task ID, the verbatim POST-CHECK command and its output, and what you suspect. Do not proceed to the next task.

---

## Notes for the planner (when generating Phase B onwards)

- Phase A tasks are 1–3 actions each. Phase B (memory subsystem) will be larger per task because the work is more substantive. Aim for ~15–20 tasks for Phase B.
- Each task should still fit on one screen and require no decision-making by the executor — only execution and verification.
- Where Phase B touches multiple files, split into per-file tasks (one task to author `noweb/memory.nw`'s AddressSpace chunk, separate task for the ROM loader chunk, etc.).
- POST-CHECK for Phase B tasks should be a single bash command, not a chain — if you need a chain, the task is too big.
