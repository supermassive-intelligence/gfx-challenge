# Per-phase expectations — Berzerk emulator

> **Audience:** you, the human, supervising a Gemma-class agent.
> **Source of truth:** the Claude Code (Opus 4.7) reference build that completed Phases A–G and started Phase H. Pulled from `SESSION_SUMMARY.md`, `cdoc/implemented_so_far.md`, and the actual artifacts in `cdoc/`, `noweb/`, `src/`, `include/` of the reference repo at `/home/user/sudnya/checkout/gfx-challenge/`.
> **How to use:** when the agent claims a phase is complete, scan this doc for the corresponding section, run the verification commands, check the artifacts list, and watch for the red-flag patterns. If something doesn't match, the agent is silently wrong.
>
> **Effort framing:** estimates are from the *Claude Code* run (a much stronger model). A Gemma-class agent will likely take 3–5× longer per phase. Use these as a "this is hard, don't expect speed" baseline, not a hard target.

---

## Phase A — Bootstrap (host toolchain)

**Goal:** Get the noweb + g++ + SDL2 + LaTeX toolchain installed and validated on the pod, with a working tangle→compile→run loop on a stub.

**Expected artifacts on the pod:**
- `scripts/host-bootstrap.sh` — idempotent, apt-installs `g++`, `make`, `noweb`, `texlive-latex-base`, `libsdl2-dev`, `gdb`, `python3`
- `Makefile` with host-mode targets: `tangle`, `weave`, `build`, `clean`, `test-z80`, `cosim-test`
- A minimal `noweb/main.nw` that tangles to a working stub
- `cdoc/architecture.md` (the reference build started this in Phase A; Gemma may defer it — that's OK if it lands by Phase D)

**Verification commands:**
```bash
bash scripts/host-bootstrap.sh                                        # exit 0, idempotent
command -v notangle noweave g++ pdflatex python3                      # 5 paths
notangle -R'main' noweb/main.nw > /tmp/main.cpp && wc -l /tmp/main.cpp  # non-zero
```

**Hard-won gotchas from the reference build:**
- noweb chunk syntax is `<<chunk-name>>=` followed by content. Not `@start{chunk}` / `@end{chunk}`. (The v2 Gemma run wasted 5 retries discovering this.)
- `notangle` with no args reads stdin and **hangs the shell**. Always verify presence with `command -v notangle`, never by running it bare.
- Use `notangle`, not `noweb -t`. The `noweb` binary is a meta-wrapper and does not tangle.

**Reference-build effort:** Claude Code completed Phase A in one focused session (~1 hour).

**Red flags — the agent is going wrong if you see:**
- Agent proposes writing a Dockerfile or running `docker build` → ENV violation §1.6.
- Agent uses `@start{chunk}` / `@end{chunk}` noweb syntax → wrong; needs `<<chunk>>=`.
- Agent says Phase A is done but no `Makefile` exists, or `make tangle` errors with "No rule to make target". (v2 didn't write a Makefile until message 247.)
- POST-CHECK is just `ls goals.md` or some other shallow check rather than running the toolchain.

---

## Phase B — Memory subsystem

**Goal:** Define `AddressSpace` with read/write callbacks; encode the full Berzerk memory map; load and CRC-verify the 8 ROM files.

**Expected artifacts:**
- `noweb/memory.nw` containing:
  - `AddressSpace` class with `read8(uint16_t)`, `write8(uint16_t, uint8_t)`, `install_read(handler, start, end)`, `install_write(handler, start, end)`
  - Read/write handler callbacks typed as `std::function<uint8_t(uint16_t)>` / `std::function<void(uint16_t, uint8_t)>`
  - Program space (16-bit) and I/O space (8-bit) handled separately
  - Unmapped access returns `0xFF` (Z80 floating-bus behavior)
  - Per-address-space read/write counters (instrumentation)
- ROM loader with CRC32 verification (reflected polynomial `0xEDB88320`); fails fast on size or CRC mismatch
- `src/berzerk_map.cpp` (tangled) wiring the Berzerk memory map

**Expected Berzerk memory map (this is a checklist of regions the agent must implement):**

| Region | Address range | Notes |
|---|---|---|
| ROM0 | `0x0000–0x07FF` | 2 KB boot ROM |
| ROM1–ROM5 | `0x1000–0x37FF` | 2 KB each, 5 banks |
| ROM6 | `0x3800–0x3FFF` | unpopulated, reads `0xFF` |
| Work RAM | `0x0800–0x0BFF` | 1 KB, mirrored at `0x0C00–0x0FFF` |
| VRAM | `0x4000–0x5FFF` | 8 KB bitmap framebuffer |
| Magic RAM | `0x6000–0x7FFF` | reads from VRAM, writes go through 74181 ALU |
| Color RAM | `0x8400–0x87FF` | 2 KB (mirrored) |
| CMOS RAM | `0x8800–0x8FFF` | battery-backed |

**Expected ROM files in `rom/berzerk/`:**
```
berzerk_rc31_1c.rom0.1c  -> 0x0000 (2 KB)
berzerk_rc31_1d.rom1.1d  -> 0x1000 (2 KB)
berzerk_rc31_3d.rom2.3d  -> 0x1800 (2 KB)
berzerk_rc31_5d.rom3.5d  -> 0x2000 (2 KB)
berzerk_rc31_6d.rom4.6d  -> 0x2800 (2 KB)
berzerk_rc31a_5c.rom5.5c -> 0x3000 (2 KB)
berzerk_r_vo_1c.1c       -> voice ROM, 2 KB
berzerk_r_vo_2c.2c       -> voice ROM, 2 KB
```

**Verification commands:**
```bash
make build && ./build/test_memory     # CRC-verifies all 8 ROMs; exits 0
```

**Hard-won gotchas:**
- VRAM is `$4000-$5FFF`. **Not** `$6000`. The reference build initially had this wrong and spent debugging time on it.
- Magic RAM at `$6000-$7FFF` mirrors VRAM through the 74181 ALU — reads come from VRAM, writes go through the ALU pipeline.
- The `0x8400-0x87FF` Color RAM has mirrors; use the address mask carefully.
- Unmapped reads MUST return `0xFF`, not `0x00`. Some Berzerk code paths depend on this.

**Reference-build effort:** ~1–2 hours.

**Red flags:**
- ROM loader doesn't verify CRC32 → silent wrong-ROM bug later; insist on `CRC32 verified` log line.
- Memory access goes through raw arrays instead of callbacks → R1 invariant violation (memory access must go through callbacks for observability).
- Agent invents a memory map that doesn't match MAME — ask it to cite `mame/src/mame/stern/berzerk.cpp` line numbers.

---

## Phase C — Z80 CPU core

**Goal:** Port MAME's Z80 core into `noweb/z80.nw`; pass 100% of the SingleStepTests Z80 corpus (~1.6 million tests).

**Expected artifacts:**
- `noweb/z80.nw` — ~2700 lines total when complete
- All 256 unprefixed opcodes + CB / ED / DD / FD / DDCB / FDCB prefix tables
- `noweb/z80_test.nw` — test runner that loads `third_party/SingleStepTests/z80/v1/*.json` and runs each
- `tests/z80/` runner outputs

**Expected implementation details (these MUST be present or cosim fails later):**
- `union PAIR16 { uint16_t w; struct { uint8_t l, h; }; };` for all register pairs — matches MAME's pattern
- 256-entry lookup table for the `SZP` (sign/zero/parity) flag composition
- `WZ` / `MEMPTR` tracked — many opcodes write to it; cosim correctness depends on it
- `Q` register tracked — needed for CCF/SCF flag-undocumented behavior
- `EI` delays interrupts by one instruction — bake this in from the start
- Full interrupt handling: NMI + IM 0/1/2
- `HALT` instruction

**Verification command:**
```bash
make test-z80 2>&1 | tail -3        # expect: 1,604,000 / 1,604,000 PASS
```

**Hard-won gotchas:**
- **Q register tracking is essential.** The reference build needed several rounds of fixes before reaching 100% pass. Without Q, CCF and SCF emit slightly wrong F-register bits that the cosim test catches.
- WZ / MEMPTR is **always** required, not optional — some opcodes' undocumented behavior depends on it.
- EI delay is a 1-instruction defer, not "ignore the next IRQ". Implementing as "ignore IRQ" passes some tests but fails interrupt-edge tests.
- Implement one opcode group at a time (8-bit loads → 16-bit loads → ALU → rotates/shifts → bit ops → jumps/calls → IO → CB → ED → DD/FD → DDCB/FDCB) and run the corresponding test subset after each. Big-bang implementations are very hard to debug.

**Reference-build effort:** This is the largest phase. Claude Code spent multiple sessions on it. Expect Gemma to need significantly more — this is where Tier 2/3 scope reduction will likely be necessary (sub-phase by opcode group, one chunk per subtask).

**Red flags:**
- Agent claims Phase C done with `n < 1,604,000` tests passing → not done. 100% required.
- Agent skipped WZ/MEMPTR or Q register → will silently fail Phase G cosim later; catch now.
- Test corpus at `tests/z80/` instead of `third_party/SingleStepTests/z80/` → wrong path; v2 Gemma made this mistake.
- Agent reports "build successful" but emulator just prints `Step 0: PC=0x1` over and over → stub Z80, not a real port. (Happened in v2.)

---

## Phase D — Video + 74181 ALU + sound stubs + interrupts

**Goal:** Implement enough of the video / sound / interrupt subsystems for the emulator to boot the ROM, pass the Magic RAM self-test, and reach attract mode.

**Expected artifacts:**
- `noweb/video.nw` — `VideoState` (8 KB VRAM + 2 KB Color RAM + RGBA framebuffer), `render_frame()` mirroring MAME `screen_update`, full 74181 ALU pipeline, collision detection (intercept flip-flop), `bitswap8` helper
- `noweb/sound.nw` — S14001A speech and Exidy 6840 timer **stubs**. Register behavior must be correct (so polling loops don't hang) but audio output can be silent. 8-byte 6840 register file; SFX latch at port `0x46`; voice ROM (4 KB across two 2 KB files) loaded but unused
- `noweb/interrupts.nw` — 2 IRQs + 8 NMIs per frame at scanline-accurate offsets; `run_frame()` that chunks Z80 execution between events

**Expected interrupt timing constants:**
- 160 T-states per scanline, 262 scanlines per frame, 41,920 T-states per frame
- IRQ vector `0xFC` (placed on data bus during interrupt acknowledge)
- 10 events per frame total: 8 NMI at V-counter positions `0x30, 0x50, 0x70, 0x90, 0xB0, 0xD0, 0xF0 (V256=0), 0xF0 (V256=1)`; 2 IRQ at `0x80 (V256=0)` and `0xDA (V256=1)`

**Verification command (headless on this k8s pod):**
```bash
make build && SDL_VIDEODRIVER=dummy ./build/berzerk &
sleep 5 && kill %1
ls build/frames/   # PNG snapshots; visually compare title screen to reference
```

**The single most important gotcha — 74181 ALU bug:**

The per-bit output equation is `1 ^ ((!p) & g)`. **Not** `(!p) & g`. Without the XOR, the ALU computes wrong values in logic mode and the game stalls at `PC=0x0458` during the Magic RAM self-test forever.

Quoting the reference build's bug note:

> The 74181 per-bit output equation was initially coded as `fi = (!p) & g`, missing the XOR with the carry input term. The correct equation is `fi = 1 ^ ((!p) & g)`. In logic mode (M=1), the carry propagation term `!(Cn & mp)` evaluates to 1 (since `mp=0` when M=1), so each bit's output must be XORed with 1. This caused the game to hang at PC=0x0458 during the Magic RAM self-test.

If you see the emulator looping at `PC=0x0458`, this is the bug. Cite the gotcha by name and the agent will know exactly what to fix.

**Other gotchas:**
- Sound stubs must let polling loops terminate, even if they produce no audio. A silent-but-correct register stub is fine; an actually-hung register read is fatal.
- Voice ROM loading should be **non-fatal** — the game runs without speech if the voice ROMs are missing.
- Interrupt events must be sorted by cycle offset before being run.

**Reference-build effort:** ~1 day.

**Red flags:**
- Game stuck at `PC=0x0458` after Phase D → 74181 ALU bug. Send the agent the equation correction.
- Game stuck at any other PC during boot → likely a memory-map or interrupt-timing issue; have the agent dump and compare against the table above.
- No frame snapshots in `build/frames/` → SDL initialization failed; check `SDL_VIDEODRIVER=dummy` is set.

---

## Phase E — SDL platform + headless visual verification

**Goal:** Wire up SDL2 for window/renderer/input and produce visual confirmation that the emulator runs gameplay. On this Docker-less pod, this means headless framebuffer + PNG diff against goldens.

**Expected artifacts:**
- `noweb/platform.nw` — SDL2 window (256×224 visible, scaled 3× to 768×672), hardware-accelerated renderer with vsync, 256×256 streaming RGBA8888 texture
- `InputState` with three bytes: `port_48` (P1 joystick + fire), `port_49` (system buttons), `port_4a` (P2 + DIPs, with bit 7 = upright cabinet)
- Keyboard mapping (all active-low — *clear* bit when key pressed):
  - Arrows → P1 directions (port `0x48` bits 0–3)
  - Left Ctrl / Space → P1 fire (port `0x48` bit 4)
  - 1 → 1P start (port `0x49` bit 0)
  - 2 → 2P start (port `0x49` bit 1)
  - 5 → Coin 1 (port `0x49` bit 7)
  - Escape → quit
- `EmulatorContext` struct + `frame_callback()` running one frame per loop iter
- Per-frame VRAM dump to `build/frames/frame_NNNNNN.png` (the host-mode substitute for noVNC)
- `scripts/compare_frames.py` comparing dumped frames against `cdoc/screenshots/golden/`

**Verification:**
```bash
SDL_VIDEODRIVER=dummy ./build/berzerk &      # run with recorded coin/start input
sleep 30 && kill %1
python3 scripts/compare_frames.py build/frames/ cdoc/screenshots/golden/  # < 1% pixel delta
```

**Hard-won gotchas:**
- Input is **active-low**. Pressing a key *clears* the corresponding bit, doesn't set it. Getting this backward means the game never sees input.
- Bit 7 of port `0x4A` should be high (`| 0x80`) — that's the cabinet-type DIP saying "upright".
- For headless on the pod, set `SDL_VIDEODRIVER=dummy` at build or runtime. Without it, SDL tries to open an X display and exits.

**Reference-build effort:** ~half a day.

**Red flags:**
- Game runs but key presses don't register → active-low logic inverted.
- Agent invokes `make docker-play` → ENV violation §1.6.
- PNG dump succeeds but every frame is identical → emulator advanced zero frames; check `frame_callback()` actually runs the CPU.

---

## Phase F — Disassembly documentation + static analysis

**Goal:** Document every subroutine, data structure, and algorithm in the original ROM in enough detail to support Phase H's independent C++ reimplementation. **Pure documentation phase — no emulator code changes.**

**Expected artifacts:**
- `scripts/z80_disasm.py` — independent Z80 disassembler / verifier
- `cdoc/disassembly.md` — master reference, opcode-verified against the ROM binary
- `cdoc/disassembly_analysis.md` — 47 RAM variables, struct layouts, 60+ subroutines, 10 algorithms with pseudocode, complete I/O port map
- `cdoc/phase6_structs_rendering.md` — VECTOR (14 bytes), BOLT (8 bytes), LINKED_LIST_ITEM (6 bytes including negative-offset prev/next pointers), sprite/pattern double-indirection format, 11-step bottom-of-screen rendering pipeline
- `cdoc/phase6_maze_robots_difficulty.md` — maze generation (`$2540`), robot spawning (`$2117`, 11-slot 4-3-4 grid), difficulty tables (`$3794`), 74181 ALU truth table
- `cdoc/phase6_jobs_otto_rooms.md` — cooperative job scheduler (stack-based coroutines), Evil Otto AI, room transitions, demo mode
- `noweb/disassembly.nw` (~9797 lines in the reference) — literate version of Tunstall's disassembly, 36 functional sections, tangles bit-identical to the original

**Verification (from the reference build):**
- Byte coverage: **5432 / 5432 (100%)** — the disassembler must decode every byte of the ROM
- Instruction decode: **5286 / 5293 (99.87%)** matches Tunstall's mnemonics; the 7-instruction gap is formatting differences (negative-decimal notation) not real disagreement
- Static analysis: **119 verified subroutine entry points, 877 branch targets, 139 data regions**

**Hard-won gotcha — the RNG correction:**
The original Tunstall disassembly's comments said the RNG was `seed * 5 + $3153`. The reference build traced the opcodes at `$267E–$2681` and discovered it's actually `seed * 7 + $3153`. **If the agent's Phase F write-up says `* 5`, push back and have it trace the opcodes itself.** Wrong RNG breaks Phase H maze generation cosim.

**Other gotchas:**
- The disassembler **must verify against the ROM binary**, not trust the Tunstall text. Tunstall's labels/comments contain occasional errors.
- `LINKED_LIST_ITEM` has *negative-offset* prev/next pointers (item header is at +0 to +5, but next-item points at item+0 not item+2). This trips up naive reimplementations.

**Reference-build effort:** ~1–2 days. Documentation-heavy; sequential, hard to parallelize.

**Red flags:**
- Agent writes any `.cpp` or modifies any `.nw` other than `noweb/disassembly.nw` during Phase F → scope creep, should be doc-only.
- Disassembler byte coverage < 100% → incomplete; insist on 5432/5432.
- Agent reports `seed * 5` for the RNG → caught it; this was wrong in the original docs.
- Phase F docs missing any of the four `phase6_*.md` files → incomplete.

---

## Phase G — Cosim infrastructure

**Goal:** Build the framework that will compare a *second* implementation against the emulator at subroutine return boundaries. Phase G writes the harness, not the second implementation.

**Expected artifacts:**
- `noweb/cosim.nw`:
  - `BerzerkMachine` abstract base class with `init / reset / step_frame / snapshot / restore / set_input / take_frame_log`
  - `MachineSnapshot` struct: full Z80 register state + RAM + VRAM + Color RAM + Magic state
  - `EventRecord` tagged by region (memory write, IO write, IRQ, collision, etc.)
- `noweb/emulator.nw` — `BerzerkEmulator : BerzerkMachine` wrapping the existing engine. `EventLogger` is **flag-gated** so cost is zero when disabled. Tags ISR-entered routines as `INTERRUPT` vs `CONVENTIONAL`.
- `noweb/cosim_harness.nw`:
  - `CosimRunner`
  - **Set-equality** for unordered events within a frame
  - **Sequence-equality** when two events target the same address (ordering matters there)
  - Binary input recording format

**Verification:**
```bash
make cosim-test 2>&1 | tail -10        # self-cosim sanity check; expect "0 mismatches"
```

The Phase G exit criterion is the **emulator cosim'd against itself** — that's a sanity check that the framework is correct. Cosim of two implementations against each other is Phase H.

**Hard-won gotchas:**
- Comparison is at **subroutine call/return boundaries**, *not* at cycle boundaries. The reference build calls this the "correctness model" — frame-level pixel/sound equality, intra-frame side effects compared as sets unless writes target the same address.
- Magic RAM and sound are treated as memory-mapped IO that may be replaced later by higher-level abstractions; don't bake them into the snapshot diff strictly.
- Cross-platform Makefile fix: replace Linux-only `grep -oP` with `grep -oE` + `sed` (the reference build hit this when running on macOS too).

**Reference-build effort:** ~1 day.

**Red flags:**
- `make cosim-test` returns nonzero diffs on self-cosim → bug in the harness; the framework should always agree with itself.
- Cosim compares at cycle boundaries instead of subroutine boundaries → architecturally wrong; will produce false mismatches in Phase H.
- `EventLogger` is always on (not flag-gated) → emulator pays the cost every frame; ask the agent to gate it.

---

## Phase H — Native C++ reimplementation

**Goal:** Write a *second* `BerzerkMachine` implementation, working only from Phase F docs (not from the disassembly tangle), and verify each subroutine against the emulator via the Phase G harness.

**Expected artifacts:**
- `noweb/native.nw` — growing as subroutines are implemented
- `cdoc/implemented_so_far.md` — append a row per cosim-verified subroutine

**Implementation order (the reference build's working order):**

1. RNG (`seed * 7 + $3153`)
2. Maze generation (`$2540`) — border + interior walls, doorway gaps
3. `CALCULATE_MAGIC_IMAGE_RAM_ADDRESS` (`$29A3`)
4. Text rendering: `PRINT_CHAR`, `PRINT_DIGITS`, `SHOW_SCORE`, `draw_lives`, `colour_fill`, post-maze rendering (`$2597-$25C9`)
5. Sprite pipeline: `draw_sprite` (1- and 2-byte modes), `erase_pattern`, `write_pattern` (XOR mode + collision via port `$4E`), `move_animate_vector` (TIME/TPRIME, velocity, frame cycling)
6. Robot AI (`SEEK` / `SETPAT` / `SET_VELOCITY`) — *the reference build did not finish this*
7. Robot explosion (`BLAM`), robot shooting, player bolts (`FIRE` / `MOVE_AND_DRAW_BOLT`)
8. Collision detection hookup, Evil Otto, BCD scoring, color attributes (`COLOUR_MAN` / `UNCOLOUR_MAN`, wall colors)
9. Full game-loop scheduler
10. Multi-frame cosim with moving sprites

**Per-subroutine exit criterion:**

Cosim of `snapshot → native → snapshot` vs `snapshot → emulator → snapshot` shows **0 register diffs and 0 memory diffs in the visible region** (VRAM `$0400-$1FFF` only). Vblank scratch RAM `$0000-$03FF` is excluded — that's game variables, not pixels.

**Hard-won gotchas — bugs the reference build found during cosim (and you'll likely find again):**

1. **Coordinate base address `$6000` vs `$6400`.** The 32-line vblank offset means the visible region starts at `$6400`, not `$6000`. Phase H reimplementations consistently get this wrong on first try.
2. **VRAM / coord write ordering.** Clear VRAM *before* writing coordinates, not after. Wrong order produces stale pixels.
3. **Visible-region comparison must be `$0400-$1FFF` only.** Don't compare scratch RAM at `$0000-$03FF`; that holds `ROOM_X`, `RNG_SEED`, maze config — internal state, not display.
4. **`$2540` continues past its label.** The ROM function at `$2540` continues into color setup, lives, and score routines. Cosim verification of `$2540` must cover all of it.
5. **Memory-map discovery:** VRAM is `$4000-$5FFF` (not `$6000`), Magic RAM at `$6000-$7FFF` mirrors VRAM through 74181 ALU.

**Reference-build final state for Phase H:**
- RNG, maze generation, `CALCULATE_MAGIC_IMAGE_RAM_ADDRESS`, text rendering, sprite pipeline, `move_animate_vector` — all **cosim-verified, 0 VRAM mismatches, 843 non-zero bytes match exactly, no ROM patches needed**
- Robot AI, robot explosion, robot shooting, player bolts, collision hookup, Evil Otto, BCD scoring, color attributes, game-loop scheduler, multi-frame moving cosim — **not yet implemented**. Phase H was still in progress when the reference build paused.

**Reference-build effort:** Open-ended. Each subroutine is a separate cosim-verified subtask. The reference build completed ~30 subroutines in this phase and stopped mid-way.

**Red flags:**
- Agent transplants code from `$REFREPO/noweb/native.nw` without permission → R4 violation; halt and revert.
- Agent reports cosim "mostly passing" or "few diffs" → V3 violation; must be exactly 0 diffs in the visible region or the subroutine isn't done.
- Agent compares scratch RAM `$0000-$03FF` and reports diffs → comparing wrong region; fix to `$0400-$1FFF` only.
- RNG cosim fails → check that the agent used `seed * 7`, not `seed * 5`.

---

## Cross-phase verification (run any time)

Useful one-liners that work across phases:

```bash
# (a) Has the agent been logging? rule W2 enforcement.
tail -n 30 session_status.md

# (b) Have any `.nw` files been tangled to inconsistent `.cpp`?
make tangle && git diff --stat src/ include/   # changes here ⇒ stale tangles

# (c) Are ROMs still verifiable?
ls rom/berzerk/ | wc -l    # 8

# (d) Test corpus reachable at the correct path?
ls third_party/SingleStepTests/z80/v1/ | wc -l  # ~1812

# (e) Z80 sanity (Phase C onward)
make test-z80 2>&1 | grep -E "passed|failed" | tail -3

# (f) Cosim sanity (Phase G onward)
make cosim-test 2>&1 | tail -5
```

---

## When the agent claims a phase is complete

Don't take its word for it. The verification is *your* job. Standard checklist:

1. Open a second SSH terminal on the pod.
2. From that terminal, run the phase's verification command(s) from this doc.
3. `ls` each expected artifact for the phase.
4. `tail -n 30 session_status.md` and confirm clean `pass` entries — no open `BLOCKER:`.
5. Spot-check one of the hard-won gotchas listed under the phase. Often the easiest test of whether the agent really did the work is whether it hit the same bug the reference build hit, *and fixed it*.

Only then send `Phase X confirmed complete. Proceed to Phase Y.` (See `PROMPTING_GUIDE.md` §9 for the canonical wording.)
