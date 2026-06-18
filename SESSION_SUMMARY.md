# Session Summary

Condensed arc of the work in this repo. Source of truth is `session_status.md`
(append-only log, ~1200 lines). This file is a high-level export covering
2026-02-24 through 2026-03-05.

The project began as an LLM-driven HTML5 game generator (Asteroids), then
pivoted on 2026-02-26 into a literate C++ emulator for the Stern Berzerk
arcade machine (1980), with MAME as the authoritative blueprint.

---

## Part 1 -- LLM Game Generator (2026-02-24, archived)

Single-day workstream that produced a working CLI generator and was then
mothballed when the project pivoted.

- Phase 1-5 in one day: config/LLM client, Docker sandbox, orchestrator
  pipeline, web UI (later removed), build scripts, 15 passing tests
- Iterated through three LLM API shapes: OpenAI chat completions ->
  ScalarLM `/v1/generate` -> back to chat completions -> finally the
  `scalarlm` Python package with Qwen chat-template prompts
- Stub mode (`--stub`) added to serve a bundled jsocol/asteroids without
  any LLM call
- Fixed a Docker port-mapping race in `sandbox/manager.py` (retry loop
  around `container.reload()`)
- Hygiene: `.gitignore`, `black` pre-commit, README, docstrings

Surviving artifacts: `llm/`, `orchestrator/`, `sandbox/` directories.

---

## Part 2 -- Berzerk Emulator (2026-02-26 onward)

Literate C++ (noweb) emulator. 8 phases planned; phases 0-7 complete,
phase 8 in progress.

### Phase 0+1 -- Infrastructure and MAME Analysis (2026-02-26)
- Studied MAME `berzerk.cpp` driver and Z80 CPU core
- Wrote `cdoc/architecture.md` -- comprehensive hardware reference
- Created `Dockerfile` (Ubuntu 24.04, g++, noweb, texlive, SDL2, gdb)
- Created `Makefile` (tangle/weave/build/clean/docker-* targets)
- Validated tangle -> compile -> run and weave -> PDF pipelines

### Phase 2 -- Memory Subsystem
- `noweb/memory.nw` -- AddressSpace with read/write callbacks
- Berzerk memory map: ROM/CMOS RAM/scratch RAM/VRAM/Magic RAM/Color RAM
- ROM loader for 8 RC31A revision files (CRC verified)

### Phase 3 -- Z80 CPU (2026-02-26)
- `noweb/z80.nw` -- ~2700 lines, all 256 unprefixed + CB/ED/DD/FD/DDCB/FDCB
- PAIR16 register unions (MAME pattern), composed flag byte with lookup tables
- Full interrupt handling (NMI + IM 0/1/2), HALT, EI delay, WZ/MEMPTR
- Integrated `SingleStepTests/z80` JSON suite (1604 files, ~1.6M tests)
- After Q-register tracking + several rounds of fixes:
  **1,604,000 / 1,604,000 tests passing (100%)**

### Phase 4 -- Video, Magic RAM, Sound, Interrupts (2026-02-27)
- `video.nw`: VideoState (8KB VRAM + 2KB color RAM + framebuffer),
  `render_frame()` matching MAME's `screen_update`, full 74181 ALU
  pipeline, collision detection (intercept flip-flop), `bitswap8`
- `sound.nw`: S14001A speech and Exidy 6840 timer stubs (correct
  register behavior so polling loops don't hang)
- `interrupts.nw`: 2 IRQs + 8 NMIs per frame at scanline-accurate cycle
  offsets, `run_frame()` chunked execution between events

### Phase 5 -- SDL Platform + noVNC Browser (2026-02-27)
- `platform.nw`: SDL2 window/renderer/texture, input mapping
  (arrows/ctrl/space/1/2/5/esc -> port 0x48/0x49/0x4A bits)
- `Dockerfile.novnc` + `scripts/start-novnc.sh`: Xvfb -> x11vnc ->
  noVNC at `localhost:6080/vnc.html`
- `make docker-play` end-to-end target

#### 74181 ALU bug (memorable fix)
Game stuck at PC=0x0458 in Magic RAM self-test. The per-bit output was
`(!p) & g`; correct equation is `1 ^ ((!p) & g)`. Without the XOR,
S=0000 produced F=A (identity) instead of F=~A (complement), so every
ALU configuration produced wrong VRAM. After fix: game boots, passes
self-tests, reaches attract mode, user-confirmed in browser.

### Phase 6 -- Disassembly Documentation + Static Analysis (2026-03-05)
Two-track effort: machine-verified disassembly + opcode-level deep
traces of every major subsystem.

- `scripts/z80_disasm.py` -- independent Z80 disassembler/verifier
  - Byte verification: 5432/5432 (100%)
  - Instruction decode: 5286/5293 (99.87%, remainder are formatting
    differences vs Tunstall's negative-decimal notation)
  - Static analysis: 119 verified subroutine entry points, 877 branch
    targets, 139 data regions
- `cdoc/disassembly.md` -- master reference (opcode-verified)
- `cdoc/disassembly_analysis.md` -- 47 RAM variables, struct layouts,
  60+ subroutines, 10 algorithms with pseudocode, complete I/O port map
- `cdoc/phase6_structs_rendering.md` -- VECTOR (14 bytes), BOLT
  (8 bytes), LINKED_LIST_ITEM (6 bytes incl. negative-offset next-ptrs),
  sprite/pattern double-indirection format, 11-step bottom-of-screen
  rendering pipeline
- `cdoc/phase6_maze_robots_difficulty.md` -- maze gen ($2540), robot
  spawning ($2117, 11-slot 4-3-4 grid), difficulty tables ($3794),
  74181 ALU truth table
- `cdoc/phase6_jobs_otto_rooms.md` -- cooperative job scheduler
  (stack-based coroutines), Evil Otto AI, room transitions, demo mode
- `noweb/disassembly.nw` (9797 lines) -- literate version of Tunstall's
  disassembly, 36 functional sections, tangles bit-identical to original
- RNG correction: traced opcodes at $267E-$2681 and confirmed
  `seed * 7 + $3153` (prior memory said *5*)

### Phase 7 -- Cosimulation Infrastructure (2026-03-05)
Verifies a second implementation by running it side-by-side with the
emulator and comparing per-frame logs.

- `noweb/cosim.nw` -- `BerzerkMachine` abstract interface
  (init/reset/step_frame/snapshot/restore/set_input/take_frame_log),
  `MachineSnapshot` (full Z80 + RAM + VRAM + color RAM + magic state),
  `EventRecord` (memory/io/collision events tagged by region)
- `noweb/emulator.nw` -- `BerzerkEmulator : BerzerkMachine` wrapping
  the existing engine. `EventLogger` is flag-gated (zero overhead when
  disabled), tags ISR-entered routines as INTERRUPT vs CONVENTIONAL
- `noweb/cosim_harness.nw` -- `CosimRunner`, set-based event comparison
  (intra-frame ordering may differ between implementations), ordered
  invocation-sequence comparison, binary input-recording format
- Correctness model: comparison at subroutine boundaries, not cycle
  boundaries. Frame-level pixel/sound equality, but intra-frame side
  effects compared as sets unless writes target the same address
- Cross-platform Makefile fix: replaced Linux-only `grep -oP` with
  `grep -oE` + `sed`

### Phase 8 -- Native C++ Reimplementation (in progress)
Second `BerzerkMachine` implementation written from Phase 6 docs, not
disassembly tangle. Verified bit-accurate against the emulator via
Phase 7 cosim harness.

#### Implemented and cosim-verified
- RNG, maze generation (border + interior walls, doorway gaps)
- `CALCULATE_MAGIC_IMAGE_RAM_ADDRESS` ($29A3) -- with corrected
  $6400 base address (32-line vblank offset)
- `PRINT_CHAR` / `PRINT_DIGITS` / `SHOW_SCORE` / draw_lives /
  `colour_fill` / post-maze rendering ($2597-$25C9)
- Sprite pipeline: `draw_sprite` (1- and 2-byte modes),
  `erase_pattern`, `write_pattern` (XOR mode + collision via port $4E),
  `move_animate_vector` (TIME/TPRIME, velocity, frame cycling)
- Cosim test (`noweb/cosim_test.nw`): RNG determinism, maze determinism,
  full $2540 maze+colour+lives+score against Z80 emulator -- **0 VRAM
  mismatches, 843 non-zero bytes match exactly, no ROM patches needed**

#### Bugs found and fixed during cosim
1. Coordinate base address $6000 vs $6400 (vblank offset)
2. VRAM/coord write ordering (clear VRAM before writing coords)
3. Visible-region comparison ($0400-$1FFF only -- the vblank scanlines
   $0000-$03FF are scratch RAM for game variables: ROOM_X, RNG_SEED,
   maze config)
4. ROM function scope ($2540 continues into colour setup, lives, score)
5. Memory-map discovery: VRAM is $4000-$5FFF (not $6000), Magic RAM at
   $6000-$7FFF mirrors VRAM through 74181 ALU

#### Still TODO
Robot AI (SEEK / SETPAT / SET_VELOCITY), robot explosion (BLAM), robot
shooting, player bolts (FIRE / MOVE_AND_DRAW_BOLT), collision detection
hookup, Evil Otto, BCD scoring, colour attributes (COLOUR_MAN /
UNCOLOUR_MAN, wall colours), full game-loop scheduler, multi-frame
cosim with moving sprites.

---

## Verification at end of session window

- Z80 instruction tests: 1,604,000 / 1,604,000 passing
- Memory self-test: passing
- Native build: clean (g++ -std=c++17 -Wall -Wextra, zero warnings)
- `make docker-play`: game boots, attract mode visible in browser,
  user-confirmed playable
- Maze generation cosim: 0 VRAM mismatches against emulator

## Project layout

```
noweb/          literate sources (.nw)
src/, include/  tangled C++ (gitignored)
doc/            woven PDFs (gitignored)
cdoc/           hand-written design docs and disassembly analysis
scripts/        z80_disasm.py, gen_disasm_nw.py, start-novnc.sh
rom/berzerk/    8 ROM files (RC31A + voice ROMs)
third_party/    nlohmann/json.hpp, SingleStepTests/z80
```

## Key build commands

- `make build` -- tangle + compile inside Docker
- `make docker-play` -- noVNC browser session at localhost:6080/vnc.html
- `make docker-test-z80` -- run the 1.6M-test Z80 suite
- `make docker-cosim-test` -- run native vs emulator cosim
- `make weave` -- generate PDF documentation
