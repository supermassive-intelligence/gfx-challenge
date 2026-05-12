# goals.md — Berzerk Emulator (smaller-model-friendly edition)

> **Audience:** any coding agent (Claude, Qwen, Gemma, Llama, etc.) running with shell + read/write/edit tools, including 7B–32B class open models.
> **Source of truth:** this file is the contract. `goals_v0` is the original, looser brief and is kept for history. If the two disagree, this file wins.

---

## 0. Main goal (one paragraph, do not paraphrase)

Build a literate-programming C++ emulator for the **Stern Berzerk** arcade machine (1980), using **noweb** for tangle/weave and the **MAME** Berzerk driver as the authoritative blueprint. The emulator is a backend-abstracted, memory-callback-instrumented implementation of an abstract `BerzerkMachine` interface so that a *second*, higher-level C++ implementation of the game can be co-simulated against it for bit-accurate verification at subroutine return boundaries. **The entire system — opencode, the agent, the build, the tests, the visual verification — runs on a single Kubernetes pod with `sudo` + `apt-get` and no Docker.** Build, debug, and verify directly on that pod's host environment (§1.6). Use SDL2 as the only host backend. Document everything that is not obvious from the code in `cdoc/`.

### Non-negotiables (NEVER break these)

1. **No freehanding.** When MAME has a behavior, mirror it. When the original ROM has a behavior, mirror it. If you cannot find the source-of-truth behavior, **stop and ask**, do not invent.
2. **All emulated memory access goes through callbacks.** Every read/write on emulated chips is observable and instrumentable. No raw pointer dereferences into emulated address spaces.
3. **Literate programming is the default.** New code lives in `noweb/*.nw` files and is *tangled* into `src/`/`include/`. Editing tangled output directly is a temporary fix and must be reflected back into the `.nw` source within the same task.
4. **One backend.** We want to build a host abstraction layer but we will build only one backend. SDL2 only. No WebGL/SFML/Allegro/etc. fallbacks until the SDL backend is feature-complete.
5. **Cosim correctness model.** Compare side effects (register writes, memory writes, IRQs) at *call-return boundaries*, not cycle boundaries. Set-equality for unordered events; sequence-equality for events targeting the same address. Magic RAM and sound are memory-mapped IO that may be replaced by higher-level abstractions later.

---

## 1. Project invariants (filesystem + tooling)

These are facts about the project that an agent must treat as fixed. **Do not test, retry, or "discover" these.** Read them and proceed.

| Fact | Value |
|---|---|
| Project root (target — all work goes here) | `/home/user/sudnya/checkout/orbits/games/arcade/berzerk/` |
| Parent target repo | `/home/user/sudnya/checkout/orbits/` (artifacts must live somewhere under here per `orbits/policy/`) |
| Working directory for ALL writes | the project root above (no `~`, no `/home/user/` outside this tree, no `/tmp/foo`) |
| Reference repo (READ-ONLY, ASK FIRST) | `/home/user/sudnya/checkout/gfx-challenge/` — the previous Claude Code build of this same project. Use only as last-resort reference; see §1.5. |
| Policy docs (READ AT SESSION START) | `/home/user/sudnya/checkout/orbits/policy/*.md` — repo-wide conventions for storing artifacts. Treat as part of the contract. |
| ROM directory | `<project root>/rom/berzerk/` (8 files: RC31A revision + voice ROMs). If absent, copy from reference repo `gfx-challenge/rom/berzerk/` after asking the user. |
| Disassembly source | `<project root>/cdoc/berzerk_tunstall.asm` (Scott Tunstall, mirrored at https://seanriddle.com/berzerk.asm). If absent, copy from reference repo or download from the URL after asking. |
| Literate sources | `<project root>/noweb/*.nw` |
| Tangled C++ | `<project root>/src/*.cpp`, `<project root>/include/*.h` (gitignored — generated, never hand-edit when in literate mode) |
| Hand-written design docs | `<project root>/cdoc/*.md` |
| Append-only log | `<project root>/session_status.md` |
| Build entrypoint | `make build` on host. **Docker is unavailable on this k8s pod**; do not call `make docker-*` targets. See §1.6. |
| Tangle command | **`notangle -R"<chunk>" file.nw > out.cpp`** — *not* `noweb -t`. The `noweb` binary is a meta-wrapper; it does not tangle. |
| Weave command | **`noweave -autodefs c -index file.nw > out.tex`** |
| Z80 test corpus | `<project root>/third_party/SingleStepTests/z80` (JSON, ~1.6M tests, `v1/*.json` layout). Pre-fetched once via `git clone https://github.com/SingleStepTests/z80.git` into that exact path. If absent, **stop** and ask the user — do not invent the path or clone into a different location (e.g., `tests/z80/`). |
| Build environment | **Host build, NOT Docker.** k8s pod (Ubuntu/Debian, with sudo). Required apt packages: `g++`, `make`, `noweb`, `texlive-latex-base`, `libsdl2-dev`, `gdb`, `python3`. Optional for visual verification: `xvfb`, `x11vnc`, `novnc`, `websockify`. |
| MAME blueprint | https://github.com/mamedev/mame, driver at `src/mame/stern/berzerk.cpp`, Z80 core at `src/devices/cpu/z80/z80.cpp` |

### Canonical command literals

When in doubt, use these exact strings. **Do not "improve" them.**

```bash
# Tangle one chunk:
notangle -R"<chunk-name>" noweb/foo.nw > src/foo.cpp

# Weave for PDF:
noweave -autodefs c -index noweb/foo.nw > doc/foo.tex && pdflatex -output-directory=doc doc/foo.tex

# Full build (HOST mode — Docker is NOT available on this pod):
sudo bash scripts/host-bootstrap.sh   # one-time: installs apt deps; idempotent
make tangle                           # noweb -> src/, include/
make build                            # tangle + compile
make test-z80                         # 1.6M-test Z80 suite (host)
make cosim-test                       # native vs emulator cosim (host)
# For Phase E visual verification (no Docker), see §1.7.

# DO NOT use:
#   make docker-build / docker-shell / docker-test-z80 / docker-cosim-test / docker-play
# These require a Docker daemon which this k8s pod lacks. If you find yourself
# tempted to run them, stop and re-read §1.6.
```

If `noweb` errors with `unescaped << in documentation chunk`, the command name is wrong — you ran `noweb -t` instead of `notangle`. Switch to `notangle` and retry.

---

## 1.5. Reference repo policy and artifact storage policy

**Two external sources of truth exist outside the project root. Treat them differently.**

### 1.5.1 Reference repo at `/home/user/sudnya/checkout/gfx-challenge/`
This is a *previous* build of the same Berzerk project, produced by a more capable agent. It is **read-only** and **ask-first**.

- The instructions in `goals.md` (this file) are designed to be *sufficient by themselves* to drive the build. The reference repo is a backstop, not a primary input.
- **Allowed without asking:** `ls`, `tree`, `git log` against the reference repo for the limited purpose of confirming a file *exists* there (e.g., "yes, the ROMs are present at `<ref>/rom/berzerk/`").
- **Allowed only after asking the user "may I read X from the reference repo?":** reading any source file (`.cpp`, `.h`, `.nw`, `.asm`, `.md`) from the reference repo, or copying any file from there into the project root.
- **Forbidden:** writing into the reference repo. Period. It is read-only.
- **Forbidden:** treating the reference repo as a substitute for actually doing the work. Do not transplant `noweb/z80.nw` from the reference into the target without solving the corresponding subtasks. Cosim-verify everything you copy.
- **Acceptable copy use cases:** the ROM binaries (`rom/berzerk/*`), the canonical Tunstall disassembly (`cdoc/berzerk_tunstall.asm`), and `third_party/` external test corpora. These are *inputs*, not project work product.

### 1.5.2 Policy docs at `/home/user/sudnya/checkout/orbits/policy/`
This directory contains repo-wide conventions for the orbits monorepo (where artifacts go, naming, build conventions, etc.).

- **At the start of every new context** (rule M1), `ls /home/user/sudnya/checkout/orbits/policy/` and `Read` every `*.md` file there. Treat them as additions to this contract.
- If a policy doc conflicts with `goals.md` on **storage location or naming**, the policy doc wins (it knows the broader repo conventions).
- If a policy doc conflicts with `goals.md` on **emulator-specific behavior** (Z80, cosim, MAME blueprint), `goals.md` wins.
- If you can't tell which type of conflict you're looking at, **stop and ask**.

---

## 1.6. Build environment policy (k8s pod, no Docker, apt-install only)

**The entire software system — opencode itself, the agent, the build, the tests, the cosim, the visual verification — runs on a single Kubernetes pod.** That pod has no Docker, and Docker cannot be installed on it (no privileged daemon, no nested-virt). It does have `sudo` and `apt-get`, and that is the *only* mechanism for adding packages to the pod.

**Concrete consequences:**

- The `Dockerfile` in the repo is reference-only on this pod. Do not try to `docker build`. If `docker` is ever invoked and returns "command not found" or "Cannot connect to the Docker daemon", that is a violation of this policy — stop and re-read §1.6, **do not try to install Docker**.
- The Makefile contains both host targets (`tangle`, `build`, `test-z80`, `cosim-test`, `weave`) and `docker-*` targets. **Use only the host targets.** The `docker-*` targets are explicitly forbidden on this pod.
- **One-time bootstrap is `scripts/host-bootstrap.sh`. This is a hard prerequisite — without it, the toolchain (`g++`, `notangle`, `noweave`, `pdflatex`, `python3`) is not on PATH and nothing builds.** The script is idempotent, so it's safe to re-run on a fresh pod or after a k8s reschedule.
- If a build needs a package that isn't yet installed, the agent must:
  1. Check `dpkg -l <pkg>` first.
  2. If missing, write a BLOCKER entry naming the package and the command that needs it, **and ask the user**. Do not silently `apt-get install` new packages — the user wants visibility into what gets added to the pod.
  3. Once the user approves, install with `sudo apt-get install -y <pkg>` and append a `BOOTSTRAP:` entry to `session_status.md` recording it.
- Visual verification (Phase E) cannot use the Docker noVNC pattern. Use the headless framebuffer + PNG snapshot path instead (§1.7 Option 1). The host-mode noVNC stack (§1.7 Option 2) is allowed only on explicit user request because it requires `kubectl port-forward` choreography on the user's end.

**Why this matters for a smaller model:** The v1 OpenCode/Gemma-4 run wasted ~30 messages trying to use Docker before being told to skip it. This policy front-loads that reality so the agent never starts down that path.

## 1.7. Visual verification on a headless pod (Phase E)

The `make docker-play` target spins up a noVNC browser session via Docker. We don't have Docker. Two acceptable substitutes for Phase E exit verification:

**Option 1 — Headless framebuffer + PNG snapshots (recommended).**
- Build with `SDL_VIDEODRIVER=dummy` to suppress the X requirement.
- The emulator already has a code path to dump VRAM as PNG every N frames (or add one if it doesn't). Run for ~600 frames after a recorded coin/start input sequence.
- Phase E exit: a tooling-comparable diff between captured PNGs and a reference set (committed under `cdoc/screenshots/`) shows < 1% pixel delta in the frame body.
- This avoids any X server, any noVNC, any port forwarding.

**Option 2 — Host-mode noVNC stack (only if user explicitly asks).**
Install (one-time) `xvfb x11vnc novnc websockify` via apt. Start the stack:
```bash
Xvfb :1 -screen 0 1024x768x24 &
DISPLAY=:1 ./build/berzerk &
x11vnc -display :1 -forever -shared -rfbport 5900 &
websockify --web=/usr/share/novnc 6080 localhost:5900 &
```
The user must `kubectl port-forward pod/<name> 6080:6080` from their laptop to view it. **Do not start this stack without the user asking** — it requires port-forwarding choreography on the user's end.

For day-to-day cosim verification, Option 1 is sufficient.

---

## 2. Phase plan (small chunks, machine-verifiable exits)

Each phase is sized so a 7B–32B model can complete the *next* sub-task without re-deriving project context. Each phase has:

- **Enter when:** prereqs that must be true before starting.
- **Do exactly:** the ordered subtasks, each ≤ 1 file or 1 conceptual unit.
- **Exit criterion:** a single command whose exit status / stdout decides "done".
- **Artifacts:** the files that must exist after the phase.

### Phase A — Bootstrap (host toolchain on the k8s pod)
- **Enter when:** repo present, `goals.md` and §1.6 read.
- **Do exactly:**
  1. Run `scripts/host-bootstrap.sh` (write it first if missing — see template below). It must `apt-get install -y` the §1 host packages and be idempotent (re-running is a no-op).
  2. Run `command -v notangle && command -v noweave` and confirm both print a path (not empty). **DO NOT** run `notangle` with no args — it reads stdin and will hang the shell. Use `command -v` or `which` to verify presence; use `notangle -R<chunk> file.nw` to actually invoke it.
  3. Write a 5-line `noweb/main.nw` stub if one doesn't exist yet (one chunk named `main`), then run `notangle -R'main' noweb/main.nw > /tmp/main.cpp` and confirm exit 0 *and* `wc -l /tmp/main.cpp` is non-zero.
- **Exit criterion:** `bash scripts/host-bootstrap.sh` exits 0; `command -v notangle noweave g++ pdflatex python3` prints five non-empty paths.
- **Artifacts:** `scripts/host-bootstrap.sh` (idempotent), all dependencies installed on the pod.

#### `scripts/host-bootstrap.sh` (canonical contents)
```bash
#!/usr/bin/env bash
# Idempotent host bootstrap for the Berzerk emulator on a Docker-less k8s pod.
set -euo pipefail
PKGS=(
  build-essential   # g++, make
  noweb             # notangle, noweave
  texlive-latex-base texlive-latex-recommended  # pdflatex (for weave)
  libsdl2-dev       # SDL backend headers/libs
  gdb               # debugging
  python3           # scripts/z80_disasm.py
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
```

### Phase B — Memory subsystem
- **Enter when:** Phase A exit criterion holds.
- **Do exactly:**
  1. In `noweb/memory.nw`, define `AddressSpace` with `read8(uint16_t)`, `write8(uint16_t,uint8_t)`, `install_read(handler,start,end)`, `install_write(handler,start,end)`.
  2. Encode the Berzerk memory map: ROM `$0000-$3FFF`, scratch RAM `$0400-$07FF` (visible portion is sub-region of VRAM), VRAM `$4000-$5FFF`, Magic RAM `$6000-$7FFF` (mirrors VRAM through 74181 ALU), Color RAM `$8400-$87FF`, CMOS RAM `$8800-$8FFF` (battery-backed).
  3. Write a ROM loader that opens all 8 files in `rom/berzerk/` and verifies CRC32 against MAME's `berzerk.cpp` ROM definitions. **Hard-fail if any CRC mismatches** — do not "fix up" silently.
- **Exit criterion:** `make build && ./build/test_memory` exits 0 with all CRCs verified.
- **Artifacts:** `noweb/memory.nw`, `tests/test_memory.cpp` (hand-written or tangled), CRC-verified ROM load.

### Phase C — Z80 CPU core
- **Enter when:** Phase B exit criterion holds.
- **Do exactly:** port the MAME Z80 core into `noweb/z80.nw` *one opcode group at a time* in this order: 8-bit loads → 16-bit loads → ALU → rotates/shifts → bit ops → jumps/calls → IO → CB prefix → ED prefix → DD/FD prefix → DDCB/FDCB. After each group, tangle and run the relevant slice of `SingleStepTests/z80`.
- **Hard rules:**
  - Use `union PAIR16 { uint16_t w; struct { uint8_t l, h; }; }` for all register pairs (matches MAME).
  - Compose the F register with a 256-entry lookup table for `SZP`. Do not derive flags from scratch in each opcode.
  - Track `WZ`/`MEMPTR` and `Q` register; cosim correctness depends on these.
  - `EI` delays interrupts by one instruction; bake this in from the start.
- **Exit criterion:** **1,604,000 / 1,604,000** SingleStepTests pass. No partial credit.
- **Artifacts:** `noweb/z80.nw`, `noweb/z80_test.nw`, `tests/z80/` runner.

### Phase D — Video, ALU, sound stubs, interrupts
- **Enter when:** Phase C exit criterion holds.
- **Do exactly:**
  1. `noweb/video.nw`: VideoState with 8 KB VRAM + 2 KB color RAM + framebuffer; `render_frame()` mirrors MAME `screen_update`.
  2. **74181 ALU**: implement bit-by-bit. The per-bit equation is `1 ^ ((!p) & g)` — *not* `(!p) & g`. Without the XOR, S=0000 outputs identity instead of complement and Magic RAM self-test stalls at PC=$0458. (This bug cost a full debugging session in v1.)
  3. `noweb/sound.nw`: stubs for S14001A speech and Exidy 6840 timers — register behavior must be correct (polling loops must terminate) but audio output can be silent.
  4. `noweb/interrupts.nw`: 2 IRQs + 8 NMIs per frame at scanline-accurate offsets. `run_frame()` chunks Z80 execution between interrupt events.
- **Exit criterion:** the emulator boots ROM, passes the Magic RAM self-test, and reaches attract mode (no input). Confirmed by inspecting `/tmp/frame*.png` snapshots — the title screen pattern must match a reference image diff of < 1% pixels.
- **Artifacts:** `noweb/{video,sound,interrupts}.nw`, ALU truth table doc in `cdoc/`.

### Phase E — SDL platform + headless visual verification
- **Enter when:** Phase D exit criterion holds.
- **Do exactly:**
  1. `noweb/platform.nw`: SDL2 window/renderer/texture, input mapping (arrows/Ctrl/Space/1/2/5/Esc → ports `$48/$49/$4A` bits). Build under `SDL_VIDEODRIVER=dummy` for headless runs.
  2. Add a frame-dump path: every N frames (configurable), serialize VRAM+color RAM into a PNG under `build/frames/frame_NNNNNN.png`. This works without any display server.
  3. Record a deterministic input sequence (coin → start → 60s of canned input) and produce 600 frames of PNGs.
  4. Commit a small reference set of golden PNGs under `cdoc/screenshots/golden/` (captured from Claude Code's reference run, with user permission per R4 / §1.5.1, or generated by the user once Phase D is solid).
- **Exit criterion (headless, primary):** `python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/` reports < 1% pixel delta across all 600 frames.
- **Exit criterion (interactive, optional):** if and only if the user explicitly asks to inspect interactively, run the §1.7 Option 2 noVNC stack on the pod and have the user `kubectl port-forward pod/<name> 6080:6080`. Not required for sign-off.
- **Artifacts:** SDL backend in `noweb/platform.nw`, frame-dump path, `scripts/compare_frames.py`, reference goldens, optional `scripts/start-novnc.sh` for the host-mode VNC stack.

### Phase F — ASM analysis (documentation-only, no code)
- **Enter when:** Phase E exit criterion holds.
- **Do exactly:** working **only from `cdoc/berzerk_tunstall.asm`**, produce these documents in `cdoc/`:
  1. `phaseF_memory_map.md`: every named RAM variable with address, size, semantics. Target ≥ 40 entries.
  2. `phaseF_subroutines.md`: every subroutine entry point with signature (in/out registers + memory effects), called-by, calls. Target ≥ 100 entries.
  3. `phaseF_data_structures.md`: VECTOR (14 bytes), BOLT (8 bytes), LINKED_LIST_ITEM (6 bytes incl. negative-offset prev/next), sprite/pattern double-indirection format.
  4. `phaseF_algorithms.md`: maze gen ($2540), robot spawn ($2117), 11-slot 4-3-4 grid, difficulty tables ($3794), `seed * 7 + $3153` RNG, BCD scoring, Evil Otto AI, room transitions, `CALCULATE_MAGIC_IMAGE_RAM_ADDRESS` ($29A3).
- **Exit criterion:** an independent disassembler script in `scripts/z80_disasm.py` decodes ≥ 99% of instruction bytes and matches Tunstall's mnemonic for ≥ 99% of decoded instructions. Bytes coverage **100%**.
- **Artifacts:** four `cdoc/phaseF_*.md` files, `scripts/z80_disasm.py`.

### Phase G — Cosim infrastructure
- **Enter when:** Phase F exit criterion holds.
- **Do exactly:**
  1. `noweb/cosim.nw`: define `BerzerkMachine` abstract base with `init/reset/step_frame/snapshot/restore/set_input/take_frame_log`. Define `MachineSnapshot` (full Z80 + RAM + VRAM + color RAM + magic state) and `EventRecord` tagged by region.
  2. `noweb/emulator.nw`: `BerzerkEmulator : BerzerkMachine` wrapping the existing engine. `EventLogger` flag-gated so cost is zero when off.
  3. `noweb/cosim_harness.nw`: `CosimRunner`, set-equality for unordered events within a frame, sequence-equality when two events target the same address. Binary input recording format.
- **Exit criterion:** `make cosim-test` (host) exits 0 against the emulator self-cosim'd with itself (sanity check: an implementation must agree with itself).
- **Artifacts:** `noweb/{cosim,emulator,cosim_harness}.nw`.

### Phase H — Native reimplementation (the actual deliverable)
- **Enter when:** Phase G exit criterion holds.
- **Do exactly:** a *second* `BerzerkMachine` implementation written **only from Phase F docs**, not from disassembly tangle. Add subroutines to it incrementally, cosim-verifying each:
  - RNG → maze generation → `CALCULATE_MAGIC_IMAGE_RAM_ADDRESS` → text rendering (`PRINT_CHAR`, `PRINT_DIGITS`, `SHOW_SCORE`) → sprite pipeline (`draw_sprite`, `erase_pattern`, `write_pattern`) → `move_animate_vector` → robot AI → Evil Otto → BCD scoring → game loop scheduler.
- **Per-subroutine exit criterion:** cosim of (snapshot → call native → snapshot) vs (snapshot → call emulator → snapshot) shows **0 register diffs and 0 memory diffs in the visible regions** (`$0400-$1FFF` for VRAM proper). Vblank scratch RAM `$0000-$03FF` is excluded — that's game variables, not pixels.
- **Exit criterion (whole phase):** all of the above subroutines pass cosim individually *and* a full multi-frame gameplay cosim (player input recorded) shows 0 mismatches for ≥ 600 frames (10 seconds at 60 Hz).
- **Artifacts:** `noweb/native.nw`, growing list of cosim-passing subroutines logged in `cdoc/implemented_so_far.md`.

---

## 3. Subtask schema (the unit of work)

Every concrete change must fit this template. **Open a subtask. Finish it. Verify it. Then start the next one.** Do not interleave subtasks.

```
SUBTASK: <one sentence, imperative>
PHASE: A | B | C | D | E | F | G | H
INPUTS: <files I will read>
OUTPUTS: <files I will write or modify>
PLAN (≤5 steps):
  1. ...
  2. ...
PRE-CHECK: <one bash command, must exit 0 before starting>
POST-CHECK: <one bash command, must exit 0 after finishing>
ROLLBACK: <git command that undoes the change if POST-CHECK fails>
```

A subtask is **completed** only when POST-CHECK passes. Marking a TODO as done without POST-CHECK passing is a violation.

---

## 4. Tool-use policies (the guardrails)

These are the rules an agent (especially a smaller one) must follow to avoid the failure modes observed in the OpenCode/Gemma-4 run on this same project.

### 4.1 Edit policy — STOP THE EDIT LOOP

**Rule E1 — Read before Edit, always.** Before any `Edit` call, `Read` the file region you intend to modify with at least 30 lines of context above and below the target. If `Read` shows the target string occurs more than once, **do not call Edit yet**.

**Rule E2 — Disambiguate, then edit.** If the target string is non-unique:
1. Use `Grep -n` to count occurrences and list line numbers.
2. Choose the *occurrence* you want.
3. Build a new `oldString` that includes ≥ 3 lines of unique surrounding context anchoring exactly that occurrence.

**Rule E3 — Two strikes and you stop.** If `Edit` returns "Found multiple matches" or "Could not find oldString" twice in a row on the same file, you **must**:
- Switch to a `Read` of the broader file region to understand the structure.
- Or replace the broken Edit with a `Write` of the entire file (last resort).
- Or stop and write a `BLOCKER:` line in `session_status.md` describing what failed.

**Rule E4 — No identical Edit retries.** If `Edit` returns "no changes to apply: oldString and newString are identical", the edit is already done. Move on. Do not retry.

> *Why:* In the previous run, this rule alone would have prevented 21 Edit failures and 3 user "stuck in a loop" interventions.

### 4.2 Bash policy

**Rule B1 — Pinned PWD.** Every shell command operates relative to the project root unless explicitly noted. Use absolute paths or `cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk && ...`. Never `cd ~`, `cd /home/user/` (the parent), or `cd /home/user/sudnya/checkout/gfx-challenge` (the reference repo) without an explicit reason that follows §1.5.

**Rule B2 — Use canonical commands.** When invoking `notangle`, `noweave`, `make`, `docker`, use the literal forms in §1 "Canonical command literals". Do not "simplify" them.

**Rule B3 — Long-running commands have timeouts.** Anything that may run > 30 s gets a `timeout` of 600 s and the output captured to a file. Don't open-loop on a frozen process.

**Rule B4 — Parallel make is forbidden against the same `build/`.** If two `make` invocations both write into `build/` or `src/`, run them sequentially. (See: race condition fixed in Claude Code S6 Turn 4.)

### 4.3 Write/file policy

**Rule W1 — One source-of-truth surface.** New algorithm code goes in `noweb/*.nw`. Tangled output is treated as build artifact: never edit `src/*.cpp` or `include/*.h` and skip updating the `.nw` source.

**Rule W2 — Append-only project log. HARD RULE; #1 cause of session drift.**
A turn is **not complete** until you have appended a 3–6 line entry to `session_status.md` describing what just happened. If your turn included **any** `bash`/`edit`/`write` that touched a project file, the **last** bash call before you yield control to the user **must** be the append below. Forgetting this rule is the single biggest predictor of drift, lost context, and "where were we?" requests — it pulls down `M3`, the SUBTASK template (§3), and phase tracking with it.

```
cat >> session_status.md <<'EOF'
## YYYY-MM-DD HH:MM — Phase X — <SUBTASK title>
RESULT: pass | fail | blocked
TOUCHED: <files>
NOTES: <one or two sentences, including any unexpected behavior>
EOF
```

If you find yourself about to write a long text reply summarizing what you did this turn, **stop** — append to `session_status.md` first, then reply.

This is what survives context compaction. Read the **last 30 lines of `session_status.md`** at the start of every new context (rule M1).

**Rule W3 — Never write outside the project root.** No files in `/tmp`, `/home/user/`, `~`, or any sibling directory. If you need scratch space, use `build/scratch/`.

### 4.4 Read / grounding policy

**Rule R1 — No claims without evidence.** Never write a sentence of the form "you said X" or "the file contains Y" unless you have a tool result open in the conversation that proves it. If you need a fact, `Read`, `Grep`, or `Bash` for it first.

**Rule R2 — No improvised paths.** Don't say "the ROM is at `/home/user/sudnya/checkout/orbits/games/arcade/berzerk/rom`" if you haven't `ls`-ed it. Run `ls rom/berzerk/` from the project root and quote the output. (This rule alone prevents the ROM-path confabulation observed in the OpenCode v1 run.)

**Rule R3 — Cite the blueprint.** When implementing MAME-derived behavior, your subtask notes must include the file:line in the MAME source you mirrored, e.g., `// mirrors mame/src/devices/cpu/z80/z80.cpp:1432-1448`.

**Rule R4 — Reference repo is read-only and ask-first.** The path `/home/user/sudnya/checkout/gfx-challenge/` is a *reference build*, not your workspace. You may `ls` and `git log` against it without asking, but you must ask the user before *reading* any source file there or *copying* any file out of it. Never write into it. See §1.5.1 for the full policy.

### 4.5 Verification policy

**Rule V1 — Every change ends in a green check.** No subtask is "done" until its POST-CHECK exits 0 *and* a relevant test/build target passes. Marking-done-without-verifying is forbidden.

**Rule V2 — Build before commit.** Before any `git commit`, run `make build` (or the closest target). If it fails, do not commit.

**Rule V3 — Cosim is the truth.** For Phase H, an algorithm is "implemented" only when its cosim test against the emulator returns 0 diffs in the visible region. Subjective claims of "looks right" do not count.

### 4.6 Failure-handling policy

**Rule F1 — Two-strike protocol.** Any tool error repeated twice on the same target → stop, do not call the tool a third time. Switch strategies (read more, ask for help, write a blocker note).

**Rule F2 — Blocker dump.** When stuck, append a `BLOCKER:` block to `session_status.md` with: what you tried (verbatim commands), what failed (verbatim error), what you suspect, what you need from the user.

**Rule F3 — Do not silently abandon premise.** If a critical tool (`noweb`/`notangle`, SDL2, `make`) is not working, do **not** pivot to an alternative without writing a blocker note and asking. Specifically: **never abandon literate programming** to "make progress" — ask first. Note: Docker is *not* a critical tool on this pod (§1.6); attempting to use it is itself a violation.

**Rule F4 — One retry, then escalate.** If a build fails, you may try one targeted fix. If the second build fails, stop and write a blocker entry. Do not "patch and pray" through five rounds of compile errors.

### 4.7 Memory / context policy

**Rule M1 — Phase header at the top of every new context.** When a session starts (or context is compacted), the first actions are these, **in this order**, before any other tool call:
```
1. Read /home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md   (this file — your contract)
2. ls /home/user/sudnya/checkout/orbits/policy/   then Read every *.md found there
3. Read tail -n 50 session_status.md   (or note "empty/missing" and assume Phase A)
4. Read cdoc/implemented_so_far.md   (or note "empty/missing")
```
Only after step 4 may you make any plan or call any other tool.

**Rule M2 — Update the TODO list after every subtask.** Mark `pending → in_progress → completed`. If a subtask spawns new work, add it as a new TODO with its phase.

**Rule M3 — No "where were we?" requests to the user.** The answer is always in `session_status.md` and `implemented_so_far.md`. Read them.

### 4.8 Communication policy

**Rule C1 — Honest assessments.** Use the format:
- **What I did:** verbatim command(s).
- **What I observed:** verbatim output (truncated).
- **My read:** one sentence.
- **What I'm not sure about:** explicit list.

**Rule C2 — Ask before destructive action.** Never run `git push`, `git reset --hard`, `rm -rf`, `docker system prune`, or anything that modifies global system state without an explicit "yes" in the immediately prior user message.

**Rule C3 — One question at a time.** If you need clarification, ask one specific question. Do not stack five.

**Rule C4 — No chain-of-thought leak; no stream-of-consciousness.** Your user-visible text is a *report*, not a thinking pad. Do not emit phrases like "Wait, I should check…", "Actually, let me…", "OK, let's go", "Hmm, on second thought…" in user-visible text. If you need to deliberate, do it silently and emit only the decision. If you find yourself writing the same phrase twice in one reply, **stop the reply** — that's a degenerate-loop warning sign; flush what you have, then make one decisive tool call.

**Rule C5 — Cap user-visible replies at ~500 words.** A turn that ends with a 2000+ word text reply almost always means you got stuck in C4 and produced filler. If you have that much to say, you should be making tool calls instead. The only exception is the deliberate end-of-session STATUS summary (rule W2 + a final report).

---

## 5. Anti-patterns (things that already failed in v1)

Reference table of mistakes the previous OpenCode/Gemma-4 run made on this exact project. Each one is a concrete instance of a rule above being violated.

| Anti-pattern | What happened | Rule violated |
|---|---|---|
| Used `noweb -t` instead of `notangle` | 9 attempts, then abandoned literate programming | §1 canonical commands, F3 |
| Confabulated ROM path | Claimed user said the ROM was at a specific path when they had not | R1, R2 |
| Edit loop on `case 0xBE` | 16 messages of "multiple matches" failures | E1, E2, E3 |
| Wrote into `/home/user/` | Had to manually move 30+ files at end | B1, W3 |
| Dropped literate programming under pressure | Pivoted to plain `.cpp/.hpp` after noweb errors | F3 |
| Patch-and-pray through compile errors | Repeatedly added headers + retried with no diagnosis | F4 |
| Lost project state across compaction | Repeated "what is the latest status?" requests | M1, M3, W2 |
| Race between parallel `make` jobs | Two Docker builds writing same `build/` directory | B4 |
| Tried `make docker-build` on a Docker-less pod | ~30 messages of "Cannot connect to the Docker daemon" before user manually said "skip Docker" | §1.6 |
| Ran `notangle` with no args to "verify it's installed" | Hung the terminal because notangle reads stdin and never EOFs from a TTY | B3 (timeouts), §1 canonical commands. Use `command -v notangle` to verify presence. |

If you find yourself doing any of these, stop and re-read the relevant rule.

---

## 6. Definition of done (the whole project)

The project is *done* when **all** of the following hold simultaneously:

- [ ] `bash scripts/host-bootstrap.sh` exits 0 (idempotent) on a fresh pod, and `command -v notangle noweave g++ pdflatex python3` prints five non-empty paths. (Do **not** verify with bare `notangle` — it reads stdin and will hang.)
- [ ] `make build` exits 0 from a clean tree (host mode, no Docker).
- [ ] `make test-z80` reports `1,604,000 / 1,604,000 PASS`.
- [ ] `make cosim-test` reports `0 mismatches` across all implemented subroutines.
- [ ] Headless visual check: `python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/` reports < 1% pixel delta across ≥ 600 frames of recorded input. (Interactive noVNC verification per §1.7 Option 2 is **optional** on this pod.)
- [ ] `make weave` produces PDFs in `doc/` for every `.nw` file with no LaTeX errors.
- [ ] `cdoc/phaseF_*.md` documents are present and complete (memory map, subroutines, data structures, algorithms).
- [ ] `session_status.md` has an entry tagged `PROJECT COMPLETE` summarizing total subtasks, total cosim-verified subroutines, and any open blockers.

Anything short of this is in-progress. Do not declare completion early.

---

## 7. Quick-reference card (paste this at the top of new contexts)

```
PROJECT_ROOT=/home/user/sudnya/checkout/orbits/games/arcade/berzerk
REFERENCE_REPO=/home/user/sudnya/checkout/gfx-challenge   # READ-ONLY, ASK FIRST (R4, §1.5.1)
POLICY_DIR=/home/user/sudnya/checkout/orbits/policy        # READ AT SESSION START (M1, §1.5.2)
TANGLE=notangle   WEAVE=noweave   BUILD=make build
LOG=session_status.md   STATE=cdoc/implemented_so_far.md
RULES: E1-E4 (Edit), B1-B4 (Bash), W1-W3 (Write), R1-R4 (Read),
       V1-V3 (Verify), F1-F4 (Fail), M1-M3 (Memory), C1-C3 (Comm)
TWO-STRIKE: any tool error twice on same target -> stop, change strategy
NEVER: edit tangled src/*.cpp without updating noweb/*.nw
NEVER: write outside PROJECT_ROOT
NEVER: write into REFERENCE_REPO
NEVER: read source files from REFERENCE_REPO without user permission
NEVER: claim a fact without a tool result that proves it
NEVER: use `noweb -t`; the tangle command is `notangle`
ALWAYS: end every subtask with a green POST-CHECK
ALWAYS: append to session_status.md after every subtask
ALWAYS: read POLICY_DIR/*.md at session start
```

---

## 8. Deployment guide (for the human running OpenCode + a small model)

This section is for **you, the human**. The rest of this file is for the agent. Pick one of the three deployment patterns below; pattern B is recommended for OpenCode + Gemma-4.

### 8.0 Where this file should live on the pod

After `ssh -A pod-6ba2a000c4b4`:
```bash
# One-time placement on the pod:
mkdir -p /home/user/sudnya/checkout/orbits/games/arcade/berzerk
cp /path/to/goals.md /home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md

# Verify:
ls /home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md
ls /home/user/sudnya/checkout/orbits/policy/        # confirm policy docs exist
ls /home/user/sudnya/checkout/gfx-challenge/        # confirm reference repo exists
```

### 8.1 Pattern A — Whole doc in the system prompt (only if your model can take it)

**Use when:** the model has a ≥ 32k context and follows long system prompts well (e.g., Opus, GPT-5, larger Llamas).
**Don't use** for Gemma-4-31B; the long system prompt steals from working context and the model forgets later sections.

In OpenCode, edit `~/.config/opencode/opencode.json` (or whatever your config path is) and set the agent's `system` field to the full contents of `goals.md`.

### 8.2 Pattern B — Short system prompt + on-demand `Read` (RECOMMENDED for Gemma-4)

**Use when:** the model is 7B–32B class. Keeps working context clean. The agent reads `goals.md` itself at session start (rule M1).

System prompt (paste this verbatim into OpenCode's agent config):

```text
You are a coding agent building the Stern Berzerk arcade emulator in literate
C++ on Ubuntu 24.04. The project is governed by a contract document.

PROJECT_ROOT:   /home/user/sudnya/checkout/orbits/games/arcade/berzerk
CONTRACT:       /home/user/sudnya/checkout/orbits/games/arcade/berzerk/goals.md
POLICY_DIR:     /home/user/sudnya/checkout/orbits/policy
LOG:            session_status.md (under PROJECT_ROOT, append-only)
REFERENCE_REPO: /home/user/sudnya/checkout/gfx-challenge   # READ-ONLY, ASK FIRST

YOUR FIRST FOUR ACTIONS in any new context, in order:
  1. Read CONTRACT in full.
  2. ls POLICY_DIR and Read every .md you find there.
  3. Read tail -n 50 of LOG (or note "missing" -> Phase A).
  4. Read cdoc/implemented_so_far.md (or note "missing").
Only after all four may you call any other tool or make any plan.

CORE RULES (full text in the contract — refer to it by label):
- E1-E4 Edit:   Read 30 lines of context first; on the 2nd identical Edit
                error, STOP and change strategy. Never retry the same Edit
                a third time.
- B1     Bash:  Stay inside PROJECT_ROOT. Never cd to /home/user/ (parent),
                ~, /tmp, or REFERENCE_REPO without an explicit reason.
- B2     Bash:  Tangle = `notangle -R"<chunk>" file.nw > out.cpp`. NOT
                `noweb -t`. The `noweb` binary is a meta-wrapper.
- W2     Write: Append to session_status.md after every subtask.
- W3     Write: Never write outside PROJECT_ROOT.
- R1-R2  Read:  No claims without tool evidence. Always run a command before
                stating a fact.
- R4     Read:  REFERENCE_REPO is read-only; ask before reading source files.
- F1     Fail:  Two-strike protocol. Any tool error twice on the same target
                -> stop, change strategy, write a BLOCKER entry.
- F3     Fail:  Never silently abandon literate programming or pivot tools.
                If something blocks you, write a BLOCKER and ask.
- M1     Mem:   Always do the four startup reads above at the start of every
                new context.

The phase plan is A -> H (see contract §2). Each subtask must end with a
green POST-CHECK before being marked done.
```

That system prompt is ~50 lines and fits comfortably even in small contexts.

For the **first user message** of a fresh session, send:

```text
Begin. Execute the four startup actions, then tell me which phase you are
starting and what your next subtask is. Do not start the subtask yet —
just propose it in the SUBTASK template from §3 of the contract and wait
for me to say "go".
```

This forces the model to (a) load the contract, (b) commit to a plan in writing, (c) pause for confirmation — three things Gemma-4 did *not* do in the v1 run.

### 8.3 Pattern C — Per-message reinforcement (last resort for very weak models)

**Use when:** the model is < 7B or has chronic instruction-forgetting, or you want to A/B-test rule adherence.

Paste the §7 quick-reference card at the top of *every* user message you send. Adds ~20 lines/turn but reduces forgetting. Combine with Pattern B's system prompt.

### 8.4 What the human should send vs. what the model should self-derive

| Action | Who does it |
|---|---|
| Initial deployment of `goals.md` to the pod | You (one-time) |
| Loading `goals.md` at session start | The agent (rule M1) |
| Reading `policy/*.md` at session start | The agent (rule M1) |
| Choosing the next phase / subtask | The agent (after startup reads) |
| Approving destructive commands (`git push`, `rm -rf`) | You (rule C2) |
| Approving reads from `REFERENCE_REPO` source files | You (rule R4 / §1.5.1) |
| Saying "go" to start a proposed subtask | You |
| Marking a subtask done | The agent, only after POST-CHECK passes (V1) |
| Appending to `session_status.md` | The agent (rule W2) |
| Calling out when the agent has violated a rule | You ("see rule E3", "see rule R2") |

If the model violates a rule, **cite the rule label** ("E3 — two strikes, stop") rather than re-explaining. Short citations are more effective than re-paraphrasing the policy; small models recognize labels they have already loaded into context.

### 8.5 Troubleshooting matrix

| Symptom | Most likely cause | Fix |
|---|---|---|
| Model writes into `/home/user/` outside the project root | System prompt didn't land | Re-send §7 quick-ref as a user message; cite W3 |
| Model gets stuck in `Edit` "multiple matches" loop | Model forgot E2/E3 | Send "stop. apply rule E3. read the file at the affected line numbers and propose a new oldString that includes 3 lines of unique context." |
| Model abandons literate programming after a tangle error | Forgot F3 | Send "F3. you must ask before changing the toolchain. what command did you run?" — almost always reveals `noweb -t` was used instead of `notangle`. |
| "What is the latest status?" is asked back to you | Model didn't run M1 | "Run M1 now. Read the log file. Tell me the latest entry." |
| Model copies code from `gfx-challenge/` without asking | Forgot R4 | Send "R4 violation. revert the copy. ask permission first." |
| Model marks a TODO done but build is broken | Forgot V1 | "V1 violation. POST-CHECK didn't pass. revert status to in_progress." |

### 8.6 Quick start checklist (do these the first time you launch the session)

1. SSH to the pod: `ssh -A pod-6ba2a000c4b4`.
2. Confirm three paths exist: project root (target), policy dir, reference repo.
3. Place `goals.md` at the project root.
4. Configure OpenCode with the Pattern B system prompt.
5. Start session, send the Pattern B first user message.
6. Watch for the four startup reads to actually happen. If they don't, abort and re-prompt.
7. Approve the proposed subtask, or send corrections in the SUBTASK template format.
8. Inspect the first POST-CHECK output yourself before trusting subsequent ones.
