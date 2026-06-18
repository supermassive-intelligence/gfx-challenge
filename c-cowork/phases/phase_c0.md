# Phase C0 — Z80 state scaffolding (no opcodes yet)

## TL;DR

Set up the Z80 emulator's *state*: register file (main + shadow), the WZ/MEMPTR and Q internal registers, decomposed flags, the 256-entry SZP lookup table, init/reset, F-byte compose/decompose. **Zero opcodes.** This is the foundation every later C sub-phase builds on. Five subtasks.

C0 exists as a separate phase because the state struct is where cosim correctness lives or dies. Drop WZ/MEMPTR or Q here and Phase G cosim will silently fail thousands of opcodes later. Better to bake them in once, verify with a round-trip test, and never wonder again.

---

## Why this Phase C is sub-phased

The reference build's `noweb/z80.nw` is ~2700 lines covering all 256 unprefixed opcodes plus CB/ED/DD/FD/DDCB/FDCB prefix tables (1,604,000 SingleStepTests at the gate). That's too much surface for one Gemma session — the auto-compactions in Phase B already showed context pressure. So Phase C is split:

| Sub-phase | What | Subtasks |
|---|---|---|
| **C0** | State struct, flags, SZP table, init/reset, fetch skeleton | 5 (this file) |
| C1 | 8-bit loads (LD r,r / LD r,n / LD r,(HL) / LD (HL),r) | ~6 |
| C2 | 16-bit loads (LD rr,nn / LD (nn),HL / LD HL,(nn) / PUSH / POP) | ~6 |
| C3 | ALU (ADD / ADC / SUB / SBC / AND / OR / XOR / CP) | ~8 |
| C4 | CB prefix (RLC/RRC/RL/RR/SLA/SRA/SLL/SRL + BIT/RES/SET) | ~6 |
| C5 | Jumps + calls (JP / JR / CALL / RET / RST + conditional) | ~6 |
| C6 | IO + control (IN / OUT / EI / DI / HALT / NOP / EX / EXX / NEG) | ~6 |
| C7 | ED prefix (block ops LDIR/CPIR/INI/OUTD, 16-bit ALU, IM 0/1/2) | ~8 |
| C8 | DD/FD prefix (IX/IY variants + IXH/IXL/IYH/IYL undocumented) | ~6 |
| C9 | DDCB/FDCB prefix (indexed bit ops + undocumented copy) | ~4 |

**Each sub-phase gets its own OpenCode session.** Start fresh (`opencode --agent berzerk`), run M1, drive the sub-phase's subtasks, mark `Phase C<n> COMPLETE`, exit OpenCode. This keeps context lean. Phase C ends when the full 1.6M SingleStepTests pass.

---

## How to use this file

Same two-terminal pattern. If you're continuing from Phase B's session, you can keep it; or restart OpenCode to drop B's chatter.

---

## Before you start — entry criteria

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

grep -q "^## .* Phase B COMPLETE" session_status.md && echo "OK phase B"
command -v g++ notangle noweave > /dev/null && echo "OK toolchain"
test -f Makefile && grep -qE '^(tangle|build|clean):' Makefile && echo "OK makefile"
test -f noweb/memory.nw && echo "OK memory subsystem present"

# SingleStepTests corpus is needed in C1+, but presence-check now:
[ "$(ls third_party/SingleStepTests/z80/v1/ 2>/dev/null | wc -l)" -gt 100 ] && echo "OK z80 tests"
```

---

## Session start (Terminal 1)

```text
Begin. Execute the three M1 startup reads (goals.md, MILESTONES.md, tail -n 30 session_status.md). Report back with:
  (a) the last entry in session_status.md (or "missing/empty"),
  (b) which phase you believe is active,
  (c) "ready" — and STOP. Do not propose a plan. I will paste the next subtask.
```

Expected: "Phase B COMPLETE" is the last entry. Phase C0 active. Ready.

---

## Subtasks

---

### C0.1 — Write `noweb/z80.nw` with the full state struct + init/reset + flag round-trip

**Why:** the Z80 state struct is the cosim foundation. The reference build's hard-won lessons (`cdoc/implemented_so_far.md` Phase 3): PAIR16 unions matter (matches MAME), flags must be decomposed (perf + clarity), WZ/MEMPTR is required (many undocumented behaviors depend on it), Q register is required (CCF/SCF use it). All of these must land in C0 so we never have to revisit the state struct.

**Paste this to Gemma:**

````text
Phase C0.1 — Write noweb/z80.nw with Z80 state struct.

Write the file using a heredoc — DO NOT Edit (this is a new file). Use the canonical noweb chunk syntax <<chunk-name>>= ; do NOT use @start{}/@end{}. Three chunks: z80.h, z80.cpp, z80_state_test.cpp.

  cat > noweb/z80.nw <<'NW_EOF'
  % z80.nw — Zilog Z80 CPU emulator
  %
  % This file defines the Z80 state, init/reset, flag compose/decompose, and
  % the SZP lookup table. Opcode dispatch lands in sub-phases C1-C9. The state
  % struct includes WZ/MEMPTR and the Q register from day one — both are
  % required for cosim correctness (per cdoc/implemented_so_far.md Phase 3
  % and the reference build's hard-won notes). Flags are decomposed into
  % bool fields and re-composed only when F is read.

  <<z80.h>>=
  #pragma once
  #include <cstdint>
  #include "memory.h"

  namespace berzerk {

  // 16-bit register pair with byte access (matches MAME's Z80 PAIR convention).
  // Little-endian: l is the low byte, h is the high byte.
  union PAIR16 {
      uint16_t w;
      struct { uint8_t l, h; };
  };

  class Z80 {
  public:
      // === Main register set ===
      PAIR16 af, bc, de, hl;
      PAIR16 ix, iy;
      PAIR16 sp, pc;

      // === Shadow register set (EX AF,AF' and EXX) ===
      PAIR16 af_, bc_, de_, hl_;

      // === Internal registers ===
      PAIR16 wz;        // WZ / MEMPTR — undocumented, required for cosim
      uint8_t i = 0;    // Interrupt vector base (used in IM 2)
      uint8_t r = 0;    // Memory refresh counter (bit 7 preserved separately)
      bool iff1 = false; // Interrupt flip-flop 1
      bool iff2 = false; // Interrupt flip-flop 2
      uint8_t im = 0;   // Interrupt mode (0, 1, or 2)
      bool halted = false;

      // === Q register ===
      // Captures the F register after each instruction. Used by CCF/SCF to
      // implement the undocumented Y/X flag behavior on the FOLLOWING
      // instruction. Without Q, CCF/SCF emit slightly wrong F bits which
      // SingleStepTests catches. Reference build's Phase 3 notes flag this.
      uint8_t q = 0;

      // === EI delay ===
      // Setting iff1=true via EI is delayed by exactly one instruction.
      bool ei_pending = false;

      // === Decomposed flags ===
      // Re-composed to F via flag_byte() when the F register is read.
      bool flag_s  = false;  // 0x80 Sign
      bool flag_z  = false;  // 0x40 Zero
      bool flag_y  = false;  // 0x20 Undoc — bit 5 of result
      bool flag_h  = false;  // 0x10 Half-carry
      bool flag_x  = false;  // 0x08 Undoc — bit 3 of result
      bool flag_pv = false;  // 0x04 Parity/Overflow
      bool flag_n  = false;  // 0x02 Subtract
      bool flag_c  = false;  // 0x01 Carry

      // === Cycle accounting ===
      uint64_t cycles = 0;

      // === Memory + IO ===
      AddressSpace* mem = nullptr;
      AddressSpace* io  = nullptr;

      // === Setup ===
      void attach(AddressSpace& mem_space, AddressSpace& io_space);
      void reset();

      // === F-byte compose / decompose ===
      uint8_t flag_byte() const;
      void    set_flag_byte(uint8_t f);

      // === Lookup table init ===
      // 256-entry table with S, Z, and P (parity) bits precomputed for each
      // byte value. Index by the byte; OR in H/N/C/Y/X separately when
      // computing per-instruction flag results.
      static uint8_t sz_p_table[256];
      static void init_tables();
  };

  } // namespace berzerk
  @

  <<z80.cpp>>=
  #include "z80.h"

  namespace berzerk {

  uint8_t Z80::sz_p_table[256];

  void Z80::init_tables() {
      for (int i = 0; i < 256; ++i) {
          bool s = (i & 0x80) != 0;
          bool z = (i == 0);
          // Parity: even number of 1-bits => parity flag set.
          int popcount = 0;
          for (int b = 0; b < 8; ++b) if (i & (1 << b)) ++popcount;
          bool p = (popcount & 1) == 0;
          uint8_t v = 0;
          if (s) v |= 0x80;
          if (z) v |= 0x40;
          if (p) v |= 0x04;
          sz_p_table[i] = v;
      }
  }

  void Z80::attach(AddressSpace& mem_space, AddressSpace& io_space) {
      mem = &mem_space;
      io  = &io_space;
  }

  void Z80::reset() {
      // Per Z80 manual: after reset, PC=0, I=0, R=0, AF=0xFFFF, SP=0xFFFF,
      // IFF1=IFF2=0, IM=0, HALT=cleared. Other registers undefined; we zero
      // them for determinism (matches MAME).
      pc.w = 0;
      i = 0;
      r = 0;
      af.w = 0xFFFF;
      sp.w = 0xFFFF;
      bc.w = 0; de.w = 0; hl.w = 0;
      ix.w = 0; iy.w = 0;
      af_.w = 0; bc_.w = 0; de_.w = 0; hl_.w = 0;
      wz.w = 0;
      iff1 = false; iff2 = false;
      im = 0;
      halted = false;
      q = 0;
      ei_pending = false;
      cycles = 0;
      // Re-derive decomposed flags from AF=0xFFFF -> F=0xFF -> all flags set.
      set_flag_byte(0xFF);
  }

  uint8_t Z80::flag_byte() const {
      uint8_t f = 0;
      if (flag_s)  f |= 0x80;
      if (flag_z)  f |= 0x40;
      if (flag_y)  f |= 0x20;
      if (flag_h)  f |= 0x10;
      if (flag_x)  f |= 0x08;
      if (flag_pv) f |= 0x04;
      if (flag_n)  f |= 0x02;
      if (flag_c)  f |= 0x01;
      return f;
  }

  void Z80::set_flag_byte(uint8_t f) {
      flag_s  = (f & 0x80) != 0;
      flag_z  = (f & 0x40) != 0;
      flag_y  = (f & 0x20) != 0;
      flag_h  = (f & 0x10) != 0;
      flag_x  = (f & 0x08) != 0;
      flag_pv = (f & 0x04) != 0;
      flag_n  = (f & 0x02) != 0;
      flag_c  = (f & 0x01) != 0;
  }

  } // namespace berzerk
  @

  <<z80_state_test.cpp>>=
  // Z80 state smoke test. Exercises register defaults after reset,
  // flag compose/decompose round-trip, and SZP lookup table values.
  #include "z80.h"
  #include "memory.h"
  #include <cstdio>

  using namespace berzerk;

  static int failures = 0;
  #define EXPECT_EQ(a, b) do { auto _a = (a); auto _b = (b); \
      if (_a != _b) { std::printf("FAIL %s:%d: %s != %s (got %u vs %u)\n", \
          __FILE__, __LINE__, #a, #b, (unsigned)_a, (unsigned)_b); ++failures; } } while (0)

  int main() {
      Z80::init_tables();

      // 1. Reset puts the CPU in the documented post-reset state.
      AddressSpace mem, io;
      Z80 cpu;
      cpu.attach(mem, io);
      cpu.reset();
      EXPECT_EQ(cpu.pc.w, 0u);
      EXPECT_EQ(cpu.i, 0u);
      EXPECT_EQ(cpu.r, 0u);
      EXPECT_EQ(cpu.af.w, 0xFFFFu);
      EXPECT_EQ(cpu.sp.w, 0xFFFFu);
      EXPECT_EQ(cpu.iff1, false);
      EXPECT_EQ(cpu.iff2, false);
      EXPECT_EQ(cpu.im, 0u);
      EXPECT_EQ(cpu.halted, false);
      EXPECT_EQ(cpu.q, 0u);
      EXPECT_EQ(cpu.ei_pending, false);

      // 2. Flag round-trip: set every flag combination, compose, decompose, verify.
      for (int v = 0; v < 256; ++v) {
          uint8_t f = (uint8_t)v;
          cpu.set_flag_byte(f);
          uint8_t round = cpu.flag_byte();
          EXPECT_EQ(round, f);
      }

      // 3. SZP lookup table sanity:
      //    sz_p_table[0x00] => Z=set, P=set (0 has even parity), S=clear => 0x44
      EXPECT_EQ(Z80::sz_p_table[0x00], 0x44u);
      //    sz_p_table[0x01] => no S/Z, parity is odd (1 one-bit) => 0
      EXPECT_EQ(Z80::sz_p_table[0x01], 0x00u);
      //    sz_p_table[0x03] => parity even (two one-bits) => P set => 0x04
      EXPECT_EQ(Z80::sz_p_table[0x03], 0x04u);
      //    sz_p_table[0x80] => S set, parity odd (one one-bit) => 0x80
      EXPECT_EQ(Z80::sz_p_table[0x80], 0x80u);
      //    sz_p_table[0xFF] => S set, parity even (8 ones) => P set => 0x84
      EXPECT_EQ(Z80::sz_p_table[0xFF], 0x84u);

      // 4. PAIR16 byte access (little-endian: l is low byte).
      cpu.bc.w = 0x1234;
      EXPECT_EQ((unsigned)cpu.bc.l, 0x34u);
      EXPECT_EQ((unsigned)cpu.bc.h, 0x12u);

      // 5. Q register starts at 0 and is independent of F.
      EXPECT_EQ(cpu.q, 0u);
      cpu.set_flag_byte(0xFF);
      EXPECT_EQ(cpu.q, 0u);  // set_flag_byte does NOT touch Q.

      if (failures == 0) {
          std::printf("ALL Z80 STATE TESTS PASS\n");
          return 0;
      }
      std::printf("FAILED: %d assertions\n", failures);
      return 1;
  }
  @
  NW_EOF

Verify and report:
  test -f noweb/z80.nw && echo "FILE OK"
  grep -c '^<<' noweb/z80.nw           # expect 3
  ! grep -q '@start{' noweb/z80.nw && echo "no wrong syntax"

  make clean && make tangle
  test -f include/z80.h && echo "OK z80.h tangled"
  test -f src/z80.cpp && echo "OK z80.cpp tangled"
  test -f src/z80_state_test.cpp && echo "OK z80_state_test.cpp tangled"

Compile smoke-check:
  g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp src/z80.cpp src/z80_state_test.cpp && \
    echo "OK compile"

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C0.1 done — pass — Z80 state struct + flags + SZP table
  EOF

Then STOP.
````

**What Gemma should report:**

- `FILE OK`
- `3` (chunk count)
- `no wrong syntax`
- `OK z80.h tangled`, `OK z80.cpp tangled`, `OK z80_state_test.cpp tangled`
- `OK compile`
- Log line.

**Independent verify (Terminal 2):**

```bash
test -f noweb/z80.nw && \
  [ "$(grep -c '^<<' noweb/z80.nw)" -eq 3 ] && \
  grep -q 'PAIR16' noweb/z80.nw && \
  grep -q 'WZ / MEMPTR' noweb/z80.nw && \
  grep -q 'Q register' noweb/z80.nw && \
  grep -q 'sz_p_table' noweb/z80.nw && \
  make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  test -f include/z80.h && \
  test -f src/z80.cpp && \
  test -f src/z80_state_test.cpp && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp src/z80.cpp src/z80_state_test.cpp && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- File uses `@start{}` / `@end{}` → cite: "noweb chunk syntax is `<<name>>=`. Rewrite using the heredoc verbatim — don't paraphrase."
- Chunk count ≠ 3 → Gemma merged or split chunks. Re-Write from the heredoc.
- `g++` errors about `PAIR16` redefinition → ensure only one definition (in z80.h). Berzerk_map.cpp doesn't need PAIR16.
- `g++` errors about `init_tables` not declared → check static member declaration in the class body.
- `g++` errors about `AddressSpace` → confirm `#include "memory.h"` is in z80.h.

---

### C0.2 — Wire `make test-z80-state` into the Makefile

**Why:** the state test needs to actually run. We add a `test-z80-state` target (not `test-z80` — that's the SingleStepTests gate which lands in C1+).

**Paste this to Gemma:**

````text
Phase C0.2 — Add test-z80-state Makefile target.

DO NOT Edit (Edit on the Makefile has been finicky). Instead, Write the whole Makefile using a heredoc that preserves all existing targets plus the new test-z80-state. Read the current Makefile first to see the existing content, then write back the full file with the addition.

The new target should be inserted ABOVE the existing test-z80 stub. Use TAB indentation. Compile signature is the same as test-memory but with z80.cpp + z80_state_test.cpp instead of test_memory.cpp:

  test-z80-state: tangle
  	@mkdir -p $(BUILD)
  	g++ -std=c++17 -Wall -Wextra -I$(INC_DIR) \
  	  $(SRC_DIR)/memory.cpp $(SRC_DIR)/rom_loader.cpp \
  	  $(SRC_DIR)/berzerk_map.cpp $(SRC_DIR)/z80.cpp \
  	  $(SRC_DIR)/z80_state_test.cpp \
  	  -o $(BUILD)/test_z80_state
  	$(BUILD)/test_z80_state

Step 1. Read Makefile:
  cat Makefile

Step 2. Write the full Makefile back, preserving every existing target (tangle, build, clean, test-memory, test-z80, cosim-test, weave) AND inserting test-z80-state above test-z80. Use:
  cat > Makefile <<'MK_EOF'
  ... full content here, with literal TABs in recipe lines ...
  MK_EOF

Step 3. Verify shape:
  grep -q '^test-z80-state:' Makefile && echo "target present"
  grep -q '^test-memory:' Makefile && echo "test-memory preserved"
  grep -q '^test-z80:' Makefile && echo "test-z80 preserved"
  grep -q '^tangle:' Makefile && grep -q '^clean:' Makefile && echo "old targets preserved"
  awk '/^test-z80-state:/,/^$/' Makefile | grep -q '^\t' && echo "TAB OK"

Step 4. Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C0.2 done — pass — Makefile test-z80-state target added
  EOF

Then STOP.
````

**What Gemma should report:**

- The full Makefile content from Step 1 (so you can verify nothing was lost).
- Step 3: `target present`, `test-memory preserved`, `test-z80 preserved`, `old targets preserved`, `TAB OK`.

**Independent verify (Terminal 2):**

```bash
grep -q '^test-z80-state:' Makefile && \
  grep -q '^test-memory:' Makefile && \
  grep -q '^test-z80:' Makefile && \
  grep -q '^tangle:' Makefile && \
  grep -q '^clean:' Makefile && \
  awk '/^test-z80-state:/,/^$/' Makefile | grep -q '^\t' && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- A pre-existing target is missing → Gemma's Write dropped a target. Have it re-read the original (in git history or via the c-cowork bundle) and Write again preserving everything.
- TAB check fails → spaces used instead of TABs in the new recipe. Re-Write with literal tabs.

---

### C0.3 — Build and run the state test

**Why:** the gate. The test exercises register defaults, flag round-trip across all 256 F values, SZP lookup correctness, PAIR16 byte ordering, and Q-independence-from-F.

**Paste this to Gemma:**

````text
Phase C0.3 — Build and run the Z80 state test.

Run in order:

Step 1. Clean tangle:
  make clean
  make tangle

Step 2. Build and run:
  make test-z80-state

Step 3. Confirm the test PASSED. The expected last line of stdout is:
  ALL Z80 STATE TESTS PASS
Report the full output, especially:
  - Did "ALL Z80 STATE TESTS PASS" print?
  - Any FAIL lines?

Step 4. Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C0.3 done — pass — Z80 state smoke test green
  EOF

Then STOP.
````

**What Gemma should report:**

- `ALL Z80 STATE TESTS PASS` in the output.
- Zero `FAIL` lines.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1 && \
  make test-z80-state 2>&1 | tee /tmp/test_z80_state.log | tail -3
grep -q "ALL Z80 STATE TESTS PASS" /tmp/test_z80_state.log && echo OK
```

Expected: the test output ending with `ALL Z80 STATE TESTS PASS`, then `OK`.

**If it fails:**

- Flag round-trip FAILs → `flag_byte()` or `set_flag_byte()` has a bug. Most likely a missing `!= 0` (the `& 0x80` returns 0 or 0x80, which converts to true/false implicitly; modern compilers warn). Look at the line in `set_flag_byte` and ensure the boolean conversion is explicit.
- SZP lookup FAIL on a specific byte → parity computation is off. Inspect the popcount loop; bit indices 0..7 only.
- PAIR16 FAIL (`bc.l != 0x34`) → endianness. PAIR16 must order `l, h` in the struct so `l` is the low byte. If Gemma reversed them, the test catches it.
- Q-independence FAIL → `set_flag_byte` accidentally writes Q. Remove that line.

---

### C0.4 — Mark Phase C0 complete

**Why:** the marker that says "Z80 state is sound; safe to start adding opcodes in C1."

**Paste this to Gemma:**

````text
Phase C0.4 — Mark Phase C0 complete.

Step 1. Confirm C0.1-C0.3 are logged:
  grep -E "^## .* — C0\.[1-3] done" session_status.md | wc -l
The output must be at least 3.

Step 2. Append the Phase C0 COMPLETE block:
  cat >> session_status.md <<EOF

  ## $(date +'%Y-%m-%d %H:%M') — Phase C0 COMPLETE — Z80 state scaffolding
  RESULT: pass
  TOUCHED: noweb/z80.nw (3 chunks: z80.h, z80.cpp, z80_state_test.cpp),
           Makefile (test-z80-state target),
           src/z80.cpp, src/z80_state_test.cpp, include/z80.h,
           build/test_z80_state (regenerable)
  NOTES: C0.1-C0.3 all green. PAIR16 register unions, main + shadow registers,
         WZ/MEMPTR, Q register, decomposed flags, 256-entry SZP lookup table,
         init/reset, flag compose/decompose. No opcodes yet — that's C1+.
         State round-trip test passes across all 256 F values.
         Ready for Phase C1 (8-bit loads).
  EOF

Step 3. Verify:
  grep -q "Phase C0 COMPLETE" session_status.md && echo OK

Report Step 1's count, Step 3's OK, then STOP.
````

**Independent verify (Terminal 2):**

```bash
grep -q "^## .* Phase C0 COMPLETE" session_status.md && echo OK
```

---

## Exit criterion (whole sub-phase)

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

# Prior phases intact
grep -q "^## .* Phase B COMPLETE" session_status.md && echo "OK phase B"

# Three chunks in noweb/z80.nw
[ "$(grep -c '^<<' noweb/z80.nw)" -eq 3 ] && echo "OK 3 chunks"

# Required state fields present (the hard-won ones)
grep -q 'PAIR16' noweb/z80.nw && \
  grep -q 'wz.*MEMPTR\|WZ.*MEMPTR' noweb/z80.nw && \
  grep -q 'q.*=.*0\|uint8_t q' noweb/z80.nw && \
  grep -q 'ei_pending' noweb/z80.nw && \
  grep -q 'sz_p_table' noweb/z80.nw && \
  echo "OK required fields"

# Tangle + compile
make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1 && \
  test -f include/z80.h && test -f src/z80.cpp && test -f src/z80_state_test.cpp && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp src/z80.cpp src/z80_state_test.cpp && \
  echo "OK compile"

# Test passes
make test-z80-state 2>&1 | grep -q "ALL Z80 STATE TESTS PASS" && echo "OK state test"

# Phase C0 COMPLETE marker
grep -q "^## .* Phase C0 COMPLETE" session_status.md && echo "OK marker"
```

All six `OK`s → Phase C0 is done. Open `phases/phase_c1.md` (will be authored next) and start there.

---

## Known gotchas / quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `PAIR16 bc.l != 0x34` after `bc.w = 0x1234` | Reversed `l,h` order in union struct | Order is `l, h` — little-endian. |
| Flag round-trip FAIL on `set_flag_byte(0x80)` (S only) | `flag_s = f & 0x80` without `!= 0` | Add `!= 0` for boolean conversion. |
| SZP lookup FAIL at byte 0xFF | Parity computed only over low 4 bits | Loop must run b=0..7. |
| Q-independence FAIL | `set_flag_byte` mutates `q` | `q` is updated by opcode logic only, not by F-writes. |
| Compile error "PAIR16 redefined" | Header included twice without guards, or PAIR16 defined in z80.cpp too | Definition only in z80.h. cpp includes z80.h. |
| Compile error "AddressSpace not declared" | Missing `#include "memory.h"` in z80.h | Add it. |
| `init_tables` not called → SZP test fails on all entries | Tests forgot `Z80::init_tables()` at start | First line of `main()` in z80_state_test.cpp. |

## Reference pointers (rule R4 — agent must ask before reading)

- `$REFERENCE_REPO/cdoc/implemented_so_far.md` Phase 3 — describes PAIR16, decomposed flags, SZP table, WZ/MEMPTR, Q.
- `$REFERENCE_REPO/cdoc/architecture.md` — Z80 register set + flags layout.
- `$REFERENCE_REPO/noweb/memory.nw` (which in the reference build also contains Z80) — has the state struct around lines 200-400.
- MAME upstream: `src/devices/cpu/z80/z80.h` and `z80.cpp`. The PAIR16 union and flag conventions match ours.
