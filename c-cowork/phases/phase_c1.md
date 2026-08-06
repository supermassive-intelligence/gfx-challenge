# Phase C1 — Z80 8-bit loads (first opcodes + first SingleStepTests gate)

## TL;DR

Add `step()` opcode dispatch to the Z80 plus a JSON-driven SingleStepTests harness. Implement every 8-bit load opcode: `LD r,r'`, `LD r,n`, `LD r,(HL)`, `LD (HL),r`, `LD (HL),n`, `LD A,(BC)`, `LD A,(DE)`, `LD A,(nn)`, `LD (BC),A`, `LD (DE),A`, `LD (nn),A`. Run the corresponding subset of `SingleStepTests/z80/v1/*.json` (~63 opcodes × 1000 cases ≈ 63k tests). Gate: 100% pass.

6 subtasks. The reference build's full Z80 took multiple sessions; expect C1 to take 2–3× a typical Gemma session given the opcode volume.

---

## How to use this file

Same two-terminal pattern.

**Strong recommendation: start a fresh OpenCode session for C1.** Phase B saw two auto-compactions; C0 was clean because it was a fresh session. C1 is bigger than C0 (real opcodes + test harness) so the lean-context benefit is even larger. Exit OpenCode, re-launch with `opencode --agent berzerk`, paste M1.

---

## Before you start — entry criteria

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

grep -q "^## .* Phase C0 COMPLETE" session_status.md && echo "OK phase C0"
test -f noweb/z80.nw && [ "$(grep -c '^<<' noweb/z80.nw)" -eq 3 ] && echo "OK z80.nw (3 chunks from C0)"
test -f third_party/json.hpp || test -f third_party/nlohmann/json.hpp && echo "OK json.hpp"
[ "$(ls third_party/SingleStepTests/z80/v1/ | wc -l)" -gt 200 ] && echo "OK z80 tests corpus"
ls third_party/SingleStepTests/z80/v1/40.json > /dev/null && echo "OK 40.json (LD B,B) present"
make test-z80-state 2>&1 | grep -q "ALL Z80 STATE TESTS PASS" && echo "OK C0 state test still green"
```

If `json.hpp` is missing, fetch it once:

```bash
mkdir -p third_party
curl -fsSL https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp -o third_party/json.hpp
```

---

## Session start (Terminal 1)

```text
Begin. Execute the three M1 startup reads (goals.md, MILESTONES.md, tail -n 30 session_status.md). Report back with:
  (a) the last entry in session_status.md (or "missing/empty"),
  (b) which phase you believe is active,
  (c) "ready" — and STOP. Do not propose a plan. I will paste the next subtask.
```

Expected: `Phase C0 COMPLETE` is the last entry. Phase C1 active. Ready.

---

## Subtasks

---

### C1.1 — Add `step()` dispatcher, fetch helpers, `p` field, and SingleStepTests harness

**Why:** before any opcode lands, we need the dispatcher loop, the fetch helpers (`fetch_opcode` increments R, `read_pc_byte`/`read_pc_word` do not), one extra state field `p` that SingleStepTests verifies, and a JSON-driven test harness. The harness loads `third_party/SingleStepTests/z80/v1/<hex>.json`, sets initial state, calls `step()`, compares final state. We build it once here; C2–C9 reuse it.

The SingleStepTests JSON format (verified by inspecting `40.json`):

```json
{
  "name": "40 0000",
  "initial": {
    "pc": 42615, "sp": 8311,
    "a": 71, "b": 107, "c": 40, "d": 144, "e": 78, "f": 28, "h": 232, "l": 9,
    "i": 151, "r": 124, "ei": 1, "wz": 8882,
    "ix": 55210, "iy": 26214,
    "af_": 41625, "bc_": 16830, "de_": 17373, "hl_": 28441,
    "im": 2, "p": 1, "q": 28,
    "iff1": 0, "iff2": 1,
    "ram": [[42615, 64]]
  },
  "final": { /* same shape, post-execute */ },
  "cycles": [ /* bus access pattern — we ignore this; functional correctness only */ ]
}
```

`p` is a state field we haven't tracked yet — it appears to be a 1-bit flag marking "did the previous instruction write F". For LD opcodes (no F write), `p=0` and `q=0` after execution.

**Paste this to Gemma:**

````text
Phase C1.1 — Add step() dispatcher, fetch helpers, p field, and SingleStepTests harness to noweb/z80.nw.

This is a Write of the whole file (4 chunks total now: z80.h, z80.cpp, z80_state_test.cpp from C0, plus a new z80_singlestep_test.cpp). Read noweb/z80.nw first to confirm current content, then Write the full updated version.

Key changes to z80.h:
  - Add `uint8_t p = 0;` field below the Q register (track "did previous instruction write F").
  - Add method declarations: `int step()`, `uint8_t fetch_opcode()`, `uint8_t read_pc_byte()`, `uint16_t read_pc_word()`.

Key changes to z80.cpp:
  - Implement fetch_opcode (read mem[pc], pc++, R-register increment preserving bit 7).
  - Implement read_pc_byte (read mem[pc], pc++; does NOT touch R).
  - Implement read_pc_word (low byte then high byte; pc += 2).
  - Implement step() as a switch on opcode. For C1.1, ONLY case 0x00 (NOP) is implemented — every other case falls into a `default` that throws std::runtime_error("opcode not implemented: 0x..").

Add new <<z80_singlestep_test.cpp>>= chunk. The runner:
  - argv[1] = path to a JSON test file (e.g., third_party/SingleStepTests/z80/v1/40.json)
  - Loads, iterates each test, sets Z80 + memory state, runs step(), compares final state.
  - Prints PASS/FAIL count.
  - Returns 0 if all pass, 1 otherwise.

Read current state:
  cat noweb/z80.nw

Then Write the full updated file with 4 chunks. Use a heredoc.

  cat > noweb/z80.nw <<'NW_EOF'
  % z80.nw — Zilog Z80 CPU emulator

  <<z80.h>>=
  #pragma once
  #include <cstdint>
  #include "memory.h"

  namespace berzerk {

  union PAIR16 {
      uint16_t w;
      struct { uint8_t l, h; };
  };

  class Z80 {
  public:
      PAIR16 af, bc, de, hl;
      PAIR16 ix, iy;
      PAIR16 sp, pc;
      PAIR16 af_, bc_, de_, hl_;
      PAIR16 wz;        // WZ / MEMPTR
      uint8_t i = 0;
      uint8_t r = 0;
      bool iff1 = false;
      bool iff2 = false;
      uint8_t im = 0;
      bool halted = false;
      uint8_t q = 0;    // Q register (set to F after F-writing instructions, else 0)
      uint8_t p = 0;    // "did previous instruction write F" (SingleStepTests flag)
      bool ei_pending = false;

      bool flag_s  = false;
      bool flag_z  = false;
      bool flag_y  = false;
      bool flag_h  = false;
      bool flag_x  = false;
      bool flag_pv = false;
      bool flag_n  = false;
      bool flag_c  = false;

      uint64_t cycles = 0;

      AddressSpace* mem = nullptr;
      AddressSpace* io  = nullptr;

      void attach(AddressSpace& mem_space, AddressSpace& io_space);
      void reset();

      uint8_t flag_byte() const;
      void    set_flag_byte(uint8_t f);

      // Fetch helpers
      uint8_t  fetch_opcode();   // reads mem[PC], PC++, increments R (bit 7 preserved)
      uint8_t  read_pc_byte();   // reads mem[PC], PC++; does NOT touch R
      uint16_t read_pc_word();   // little-endian: low byte, then high; PC += 2

      // Execute one instruction. Returns the cycle count for this instruction.
      // Throws std::runtime_error on an unimplemented opcode.
      int step();

      static uint8_t sz_p_table[256];
      static void init_tables();
  };

  } // namespace berzerk
  @

  <<z80.cpp>>=
  #include "z80.h"
  #include <stdexcept>
  #include <cstdio>

  namespace berzerk {

  uint8_t Z80::sz_p_table[256];

  void Z80::init_tables() {
      for (int i = 0; i < 256; ++i) {
          bool s = (i & 0x80) != 0;
          bool z = (i == 0);
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
      p = 0;
      ei_pending = false;
      cycles = 0;
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

  uint8_t Z80::fetch_opcode() {
      uint8_t op = mem->read8(pc.w);
      pc.w++;
      // R-register increment: bit 7 preserved, bits 0-6 increment.
      r = (r & 0x80) | ((r + 1) & 0x7F);
      return op;
  }

  uint8_t Z80::read_pc_byte() {
      uint8_t b = mem->read8(pc.w);
      pc.w++;
      return b;
  }

  uint16_t Z80::read_pc_word() {
      uint16_t lo = read_pc_byte();
      uint16_t hi = read_pc_byte();
      return (hi << 8) | lo;
  }

  int Z80::step() {
      uint8_t op = fetch_opcode();
      // Capture ei_pending state BEFORE the opcode executes. The Z80's
      // EI-delay semantics mean: when the previous instruction was EI,
      // ei_pending is true at the start of this instruction; at the end
      // of THIS instruction, ei_pending is cleared. SingleStepTests
      // verifies this directly.
      bool ei_was_pending = ei_pending;
      int instr_cycles = 0;

      switch (op) {
          case 0x00: { // NOP
              p = 0; q = 0;
              instr_cycles = 4;
              break;
          }
          // C1.2 will add 0x40-0x7F (LD r,r' minus 0x76 HALT).
          // C1.3 will add LD r,n (0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x3E, 0x36).
          // C1.4 will add LD A,(rr) and LD (rr),A (0x0A, 0x1A, 0x3A, 0x02, 0x12, 0x32).
          default: {
              char buf[64];
              std::snprintf(buf, sizeof(buf), "opcode not implemented: 0x%02x", op);
              throw std::runtime_error(buf);
          }
      }

      cycles += instr_cycles;

      // EI delay: clear ei_pending after any non-EI instruction completes.
      // EI itself (opcode 0xFB, lands in C6) will re-set ei_pending=true
      // after this block runs, so EI->next->next sees ei_pending false again.
      if (ei_was_pending) {
          ei_pending = false;
      }

      return instr_cycles;
  }

  } // namespace berzerk
  @

  <<z80_state_test.cpp>>=
  // (C0 test - unchanged. Kept here so make test-z80-state still works.)
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
      AddressSpace mem, io;
      Z80 cpu;
      cpu.attach(mem, io);
      cpu.reset();
      EXPECT_EQ(cpu.pc.w, 0u);
      EXPECT_EQ(cpu.af.w, 0xFFFFu);
      EXPECT_EQ(cpu.sp.w, 0xFFFFu);
      EXPECT_EQ(cpu.iff1, false);
      EXPECT_EQ(cpu.iff2, false);
      EXPECT_EQ(cpu.im, 0u);
      EXPECT_EQ(cpu.q, 0u);
      EXPECT_EQ(cpu.p, 0u);
      EXPECT_EQ(cpu.ei_pending, false);
      for (int v = 0; v < 256; ++v) {
          uint8_t f = (uint8_t)v;
          cpu.set_flag_byte(f);
          EXPECT_EQ(cpu.flag_byte(), f);
      }
      EXPECT_EQ(Z80::sz_p_table[0x00], 0x44u);
      EXPECT_EQ(Z80::sz_p_table[0x01], 0x00u);
      EXPECT_EQ(Z80::sz_p_table[0xFF], 0x84u);
      cpu.bc.w = 0x1234;
      EXPECT_EQ((unsigned)cpu.bc.l, 0x34u);
      EXPECT_EQ((unsigned)cpu.bc.h, 0x12u);

      if (failures == 0) { std::printf("ALL Z80 STATE TESTS PASS\n"); return 0; }
      std::printf("FAILED: %d assertions\n", failures); return 1;
  }
  @

  <<z80_singlestep_test.cpp>>=
  // SingleStepTests JSON-driven runner. Argv[1] = path to a v1/*.json file.
  // Reads each test, sets initial Z80 + memory state, runs step(), compares
  // final state. Reports pass/fail count. Returns 0 if all pass.
  #include "z80.h"
  #include "memory.h"
  #include "../third_party/json.hpp"
  #include <fstream>
  #include <iostream>
  #include <unordered_map>
  #include <vector>

  using namespace berzerk;
  using json = nlohmann::json;

  // Helper: install a flat 64 KB RAM-only address space for testing.
  // Every opcode test runs against unrestricted RAM (no ROM, no IO mapping).
  // Memory contents are set per-test from the JSON's `ram` array.
  struct FlatMemory {
      std::vector<uint8_t> ram = std::vector<uint8_t>(0x10000, 0);
      void install(AddressSpace& space) {
          uint8_t* p = ram.data();
          space.install_read (0x0000, 0xFFFF, [p](uint16_t a){ return p[a]; }, "ram");
          space.install_write(0x0000, 0xFFFF, [p](uint16_t a, uint8_t d){ p[a] = d; }, "ram");
      }
  };

  static void set_state(Z80& cpu, FlatMemory& flat, const json& s) {
      cpu.pc.w  = (uint16_t)s.at("pc").get<int>();
      cpu.sp.w  = (uint16_t)s.at("sp").get<int>();
      cpu.af.h  = (uint8_t) s.at("a").get<int>();
      cpu.bc.h  = (uint8_t) s.at("b").get<int>();
      cpu.bc.l  = (uint8_t) s.at("c").get<int>();
      cpu.de.h  = (uint8_t) s.at("d").get<int>();
      cpu.de.l  = (uint8_t) s.at("e").get<int>();
      cpu.set_flag_byte((uint8_t)s.at("f").get<int>());
      cpu.hl.h  = (uint8_t) s.at("h").get<int>();
      cpu.hl.l  = (uint8_t) s.at("l").get<int>();
      cpu.i     = (uint8_t) s.at("i").get<int>();
      cpu.r     = (uint8_t) s.at("r").get<int>();
      cpu.ei_pending = s.at("ei").get<int>() != 0;
      cpu.wz.w  = (uint16_t)s.at("wz").get<int>();
      cpu.ix.w  = (uint16_t)s.at("ix").get<int>();
      cpu.iy.w  = (uint16_t)s.at("iy").get<int>();
      cpu.af_.w = (uint16_t)s.at("af_").get<int>();
      cpu.bc_.w = (uint16_t)s.at("bc_").get<int>();
      cpu.de_.w = (uint16_t)s.at("de_").get<int>();
      cpu.hl_.w = (uint16_t)s.at("hl_").get<int>();
      cpu.im    = (uint8_t) s.at("im").get<int>();
      cpu.p     = (uint8_t) s.at("p").get<int>();
      cpu.q     = (uint8_t) s.at("q").get<int>();
      cpu.iff1  = s.at("iff1").get<int>() != 0;
      cpu.iff2  = s.at("iff2").get<int>() != 0;
      for (auto& kv : s.at("ram")) {
          flat.ram[kv.at(0).get<int>()] = (uint8_t)kv.at(1).get<int>();
      }
  }

  static int diff_state(const Z80& cpu, const FlatMemory& flat, const json& exp, const std::string& tname) {
      int diffs = 0;
      auto check = [&](const char* field, unsigned got, int want) {
          if ((unsigned)want != got) {
              if (diffs < 5) std::cerr << "  " << tname << ": " << field
                                       << " got " << got << " want " << want << "\n";
              ++diffs;
          }
      };
      check("pc",  cpu.pc.w,  exp.at("pc").get<int>());
      check("sp",  cpu.sp.w,  exp.at("sp").get<int>());
      check("a",   cpu.af.h,  exp.at("a").get<int>());
      check("b",   cpu.bc.h,  exp.at("b").get<int>());
      check("c",   cpu.bc.l,  exp.at("c").get<int>());
      check("d",   cpu.de.h,  exp.at("d").get<int>());
      check("e",   cpu.de.l,  exp.at("e").get<int>());
      check("f",   cpu.flag_byte(), exp.at("f").get<int>());
      check("h",   cpu.hl.h,  exp.at("h").get<int>());
      check("l",   cpu.hl.l,  exp.at("l").get<int>());
      check("i",   cpu.i,     exp.at("i").get<int>());
      check("r",   cpu.r,     exp.at("r").get<int>());
      check("ei",  cpu.ei_pending ? 1u : 0u, exp.at("ei").get<int>());
      check("wz",  cpu.wz.w,  exp.at("wz").get<int>());
      check("ix",  cpu.ix.w,  exp.at("ix").get<int>());
      check("iy",  cpu.iy.w,  exp.at("iy").get<int>());
      check("af_", cpu.af_.w, exp.at("af_").get<int>());
      check("bc_", cpu.bc_.w, exp.at("bc_").get<int>());
      check("de_", cpu.de_.w, exp.at("de_").get<int>());
      check("hl_", cpu.hl_.w, exp.at("hl_").get<int>());
      check("im",  cpu.im,    exp.at("im").get<int>());
      check("p",   cpu.p,     exp.at("p").get<int>());
      check("q",   cpu.q,     exp.at("q").get<int>());
      check("iff1", cpu.iff1 ? 1u : 0u, exp.at("iff1").get<int>());
      check("iff2", cpu.iff2 ? 1u : 0u, exp.at("iff2").get<int>());
      for (auto& kv : exp.at("ram")) {
          uint16_t addr = (uint16_t)kv.at(0).get<int>();
          uint8_t  want = (uint8_t) kv.at(1).get<int>();
          if (flat.ram[addr] != want) {
              if (diffs < 5) std::cerr << "  " << tname << ": ram[" << addr
                                       << "] got " << (unsigned)flat.ram[addr]
                                       << " want " << (unsigned)want << "\n";
              ++diffs;
          }
      }
      return diffs;
  }

  int main(int argc, char** argv) {
      if (argc < 2) {
          std::cerr << "usage: " << argv[0] << " <path-to-singlestep-json>\n";
          return 1;
      }
      Z80::init_tables();
      std::ifstream f(argv[1]);
      if (!f) { std::cerr << "cannot open " << argv[1] << "\n"; return 1; }
      json tests;
      f >> tests;

      int passed = 0, failed = 0;
      for (auto& t : tests) {
          AddressSpace mem, io;
          FlatMemory flat;
          flat.install(mem);
          Z80 cpu;
          cpu.attach(mem, io);
          set_state(cpu, flat, t.at("initial"));
          try {
              cpu.step();
          } catch (const std::exception& e) {
              std::cerr << "  " << t.at("name").get<std::string>()
                        << ": step() threw: " << e.what() << "\n";
              ++failed;
              if (failed >= 5) break;
              continue;
          }
          int d = diff_state(cpu, flat, t.at("final"), t.at("name").get<std::string>());
          if (d == 0) ++passed; else ++failed;
          if (failed >= 5) { std::cerr << "  ... (stopping after 5 failures)\n"; break; }
      }
      std::cout << argv[1] << ": " << passed << " pass, " << failed << " fail\n";
      return failed == 0 ? 0 : 1;
  }
  @
  NW_EOF

Verify and report:
  test -f noweb/z80.nw && echo "FILE OK"
  grep -c '^<<' noweb/z80.nw           # expect 4
  grep -q 'uint8_t p = 0' noweb/z80.nw && echo "p field OK"
  grep -q 'fetch_opcode' noweb/z80.nw && echo "fetch_opcode OK"
  grep -q 'class FlatMemory' noweb/z80.nw && echo "harness OK"

  make clean && make tangle
  test -f include/z80.h && test -f src/z80.cpp && \
    test -f src/z80_state_test.cpp && test -f src/z80_singlestep_test.cpp && \
    echo "OK tangle"

Compile smoke (-fsyntax-only since multiple files):
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party -fsyntax-only \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_state_test.cpp src/z80_singlestep_test.cpp && \
    echo "OK compile"

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.1 done — pass — step()+fetch helpers+p field+SingleStepTests harness
  EOF

Then STOP.
````

**What Gemma should report:**

- `FILE OK`, chunk count `4`, `p field OK`, `fetch_opcode OK`, `harness OK`.
- `OK tangle`, `OK compile`.

**Independent verify (Terminal 2):**

```bash
test -f noweb/z80.nw && \
  [ "$(grep -c '^<<' noweb/z80.nw)" -eq 4 ] && \
  grep -q 'uint8_t p = 0' noweb/z80.nw && \
  grep -q 'fetch_opcode' noweb/z80.nw && \
  grep -q 'FlatMemory' noweb/z80.nw && \
  make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1 && \
  test -f src/z80_singlestep_test.cpp && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party -fsyntax-only \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_state_test.cpp src/z80_singlestep_test.cpp && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- `json.hpp not found` → confirm it's at `third_party/json.hpp` and the `#include "../third_party/json.hpp"` path in the test chunk is right. Adjust the include path if your `json.hpp` is at `third_party/nlohmann/json.hpp` instead.
- `s.at("p")` throws (json access exception) → the test corpus may not have a `p` field on some opcodes. Treat missing as 0. We'll fix in C1.5 if it surfaces.
- Gemma Edit-loops trying to modify the existing 3-chunk file in place → cite E3, force Write of the whole file (the paste prompt already says Write, but reinforce).

---

### C1.2 — Implement `LD r,r'` family (opcodes 0x40–0x7F minus 0x76 HALT)

**Why:** 48 opcodes (49 in the 0x40–0x7F block minus HALT at 0x76). The pattern: `01 ddd sss` (binary) where the 3-bit register codes are 000=B, 001=C, 010=D, 011=E, 100=H, 101=L, 110=(HL), 111=A. When `sss=110` it's `LD r,(HL)`; when `ddd=110` it's `LD (HL),r`; when both, that's HALT (handled separately in C6). Cycles: `LD r,r'` = 4; `LD r,(HL)` and `LD (HL),r` = 7. None write F, so `p=0, q=0` at end.

**Paste this to Gemma:**

````text
Phase C1.2 — Implement LD r,r' family (0x40-0x7F minus 0x76).

Edit z80.cpp's step() switch to add cases 0x40-0x7F (minus 0x76). Use a single combined case block with a register lookup helper. Two-strike rule on Edits.

Read noweb/z80.nw, locate the step() function in the <<z80.cpp>>= chunk, and Write the whole noweb/z80.nw back with the step() switch extended.

Insert the following BLOCK into step()'s switch, AFTER `case 0x00` and BEFORE the `default` case. (Note: 0x76 is intentionally excluded — it's HALT, lands in C6.)

  // LD r,r' family: 0x40-0x7F (minus 0x76 HALT).
  // Pattern: 01 ddd sss -> dst = src.
  // Register codes: 0=B, 1=C, 2=D, 3=E, 4=H, 5=L, 6=(HL), 7=A.
  // Use `break` (NOT `return`) so the post-dispatch ei_pending and cycles
  // accumulator blocks run.
  case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
  case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E: case 0x4F:
  case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57:
  case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
  case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66: case 0x67:
  case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F:
  case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75:           case 0x77:
  case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7E: case 0x7F: {
      int dst = (op >> 3) & 7;
      int src = op & 7;
      uint8_t* regs[] = { &bc.h, &bc.l, &de.h, &de.l, &hl.h, &hl.l, nullptr, &af.h };
      uint8_t val;
      if (src == 6) {
          val = mem->read8(hl.w);
          instr_cycles = 7;
      } else {
          val = *regs[src];
          instr_cycles = (dst == 6) ? 7 : 4;
      }
      if (dst == 6) {
          mem->write8(hl.w, val);
      } else {
          *regs[dst] = val;
      }
      p = 0; q = 0;
      break;
  }

Verify:
  grep -q 'case 0x77' src/z80.cpp || (make tangle && grep -q 'case 0x77' src/z80.cpp)
  echo "0x77 present"
  ! grep -q 'case 0x76' src/z80.cpp && echo "0x76 correctly excluded (HALT lands in C6)"

  make clean && make tangle && \
    g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party -fsyntax-only \
      src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
      src/z80.cpp src/z80_state_test.cpp src/z80_singlestep_test.cpp && \
    echo "OK compile"

Quick functional spot-check: build the harness, run against 0x40 (LD B,B) for first 10 tests.
  make test-z80-c1 2>/dev/null || true   # may not exist yet; that's fine

Instead, build directly and run:
  mkdir -p build
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_singlestep_test.cpp \
    -o build/test_z80_ss
  build/test_z80_ss third_party/SingleStepTests/z80/v1/40.json
Report the output of the last command (e.g., "third_party/.../40.json: 1000 pass, 0 fail").

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.2 done — pass — LD r,r' family (0x40-0x7F minus 0x76)
  EOF

Then STOP.
````

**What Gemma should report:**

- All case 0x40-0x7F lines present in `src/z80.cpp` except 0x76.
- `OK compile`.
- The spot-check against `40.json` (LD B,B) prints `1000 pass, 0 fail` (or close — `~5 fail` is a soft signal something needs tuning, mostly likely the `p` field semantics).

**Independent verify (Terminal 2):**

```bash
make tangle > /dev/null 2>&1
grep -c "case 0x4[0-9A-F]\|case 0x5[0-9A-F]\|case 0x6[0-9A-F]\|case 0x7[0-57-9A-F]" src/z80.cpp   # expect at least 48
! grep -q "case 0x76" src/z80.cpp && echo "OK 0x76 excluded"
g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
  src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
  src/z80.cpp src/z80_singlestep_test.cpp \
  -o /tmp/test_z80_ss && \
  /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/40.json | tail -1
```

Expected: `OK 0x76 excluded`, then `third_party/.../40.json: 1000 pass, 0 fail`.

**If it fails:**

- `0x76` is present in cases → Gemma included HALT. Remove that case; it lands in C6.
- 1000-pass-0-fail comes back as `~1000 fail, 0 pass` → register lookup table indexes might be wrong. Reorder: 000=B (bc.h), 001=C (bc.l), 010=D (de.h), 011=E (de.l), 100=H (hl.h), 101=L (hl.l), 110=(HL), 111=A (af.h).
- Some specific opcodes fail (e.g., `0x6E LD L,(HL)`) → cycle count or fetch sequence off. The cycles are 4 for reg-reg and 7 for any (HL) involvement.
- A handful of failures on `p` or `q` field → SingleStepTests' `p` field semantics may not match our "0 after LD" assumption. Inspect one failing test's expected `p` value; we may need to set `p = ?` instead of 0.

---

### C1.3 — Implement `LD r,n` (immediate-byte loads) and `LD (HL),n`

**Why:** 8 opcodes: `LD B,n` (0x06), `LD C,n` (0x0E), `LD D,n` (0x16), `LD E,n` (0x1E), `LD H,n` (0x26), `LD L,n` (0x2E), `LD A,n` (0x3E), `LD (HL),n` (0x36). Pattern: `00 rrr 110`. Cycles: 7 for register form, 10 for `LD (HL),n`.

**Paste this to Gemma:**

````text
Phase C1.3 — Implement LD r,n and LD (HL),n.

Write the whole noweb/z80.nw with the step() switch extended. Add these cases BEFORE the LD r,r' block (since they're in 0x00-0x3F range):

  // All LD r,n / LD (HL),n cases use `break` so the post-dispatch block runs.
  case 0x06: bc.h = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD B,n
  case 0x0E: bc.l = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD C,n
  case 0x16: de.h = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD D,n
  case 0x1E: de.l = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD E,n
  case 0x26: hl.h = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD H,n
  case 0x2E: hl.l = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD L,n
  case 0x3E: af.h = read_pc_byte(); instr_cycles = 7; p = 0; q = 0; break; // LD A,n
  case 0x36: { // LD (HL),n
      uint8_t n = read_pc_byte();
      mem->write8(hl.w, n);
      instr_cycles = 10; p = 0; q = 0; break;
  }

Verify:
  make clean && make tangle
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_singlestep_test.cpp \
    -o /tmp/test_z80_ss

Run each of the 8 opcode tests:
  for op in 06 0E 16 1E 26 2E 36 3E; do
    /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
  done
Each line should report "1000 pass, 0 fail" (or near).

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.3 done — pass — LD r,n + LD (HL),n (8 opcodes)
  EOF

Then STOP.
````

**What Gemma should report:**

- Each of the 8 opcode JSON files passes 1000/1000 (or very close).

**Independent verify (Terminal 2):** same loop. All should report `1000 pass, 0 fail`.

**If it fails:** see C1.2's "if it fails" — register index mismatch or `p`/`q` semantics.

---

### C1.4 — Implement `LD A,(BC)`, `LD A,(DE)`, `LD A,(nn)`, `LD (BC),A`, `LD (DE),A`, `LD (nn),A`

**Why:** 6 opcodes for A-vs-address transfers. WZ behavior matters: per the reference Z80 docs, these instructions set WZ to specific values (see comments in code). Cycles: 7 for `(BC)`/`(DE)` form, 13 for `(nn)` form.

**Paste this to Gemma:**

````text
Phase C1.4 — Implement LD A,(rr) and LD (rr),A family.

Add these cases to step()'s switch:

  // All LD A,(rr) / LD (rr),A cases use `break` so the post-dispatch block runs.
  case 0x0A: { // LD A,(BC)
      af.h = mem->read8(bc.w);
      wz.w = bc.w + 1;
      instr_cycles = 7; p = 0; q = 0; break;
  }
  case 0x1A: { // LD A,(DE)
      af.h = mem->read8(de.w);
      wz.w = de.w + 1;
      instr_cycles = 7; p = 0; q = 0; break;
  }
  case 0x3A: { // LD A,(nn)
      uint16_t addr = read_pc_word();
      af.h = mem->read8(addr);
      wz.w = addr + 1;
      instr_cycles = 13; p = 0; q = 0; break;
  }
  case 0x02: { // LD (BC),A
      mem->write8(bc.w, af.h);
      wz.h = af.h; wz.l = (bc.l + 1) & 0xFF;
      instr_cycles = 7; p = 0; q = 0; break;
  }
  case 0x12: { // LD (DE),A
      mem->write8(de.w, af.h);
      wz.h = af.h; wz.l = (de.l + 1) & 0xFF;
      instr_cycles = 7; p = 0; q = 0; break;
  }
  case 0x32: { // LD (nn),A
      uint16_t addr = read_pc_word();
      mem->write8(addr, af.h);
      wz.h = af.h; wz.l = (addr + 1) & 0xFF;
      instr_cycles = 13; p = 0; q = 0; break;
  }

Compile + run all 6 opcode tests:
  make clean && make tangle
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_singlestep_test.cpp \
    -o /tmp/test_z80_ss
  for op in 02 0A 12 1A 32 3A; do
    /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
  done

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.4 done — pass — LD A,(rr) + LD (rr),A (6 opcodes)
  EOF

Then STOP.
````

**What Gemma should report:** all 6 opcodes pass 1000/1000.

**If it fails:**

- Failures on `wz` field → the WZ values above are per the MAME Z80 docs. The `LD A,(BC/DE/nn)` form sets WZ to `addr+1`. The `LD (BC/DE/nn),A` form sets WZ.h = A and WZ.l = (low_byte_of_addr + 1) & 0xFF. If Gemma omitted WZ, add it.
- `read_pc_word()` reads low-then-high → if Gemma reversed it, swap. Z80 is little-endian.

---

### C1.5 — Wire `make test-z80-c1` and run the full C1 opcode subset

**Why:** the gate. Run SingleStepTests for every C1 opcode (~63 opcodes × 1000 cases ≈ 63k tests). Expect 100% pass.

**Paste this to Gemma:**

````text
Phase C1.5 — Wire make test-z80-c1, run the full C1 opcode subset.

Step 1. Write a small helper script scripts/run-z80-c1-tests.sh that iterates the C1 opcode set:
  cat > scripts/run-z80-c1-tests.sh <<'SH_EOF'
  #!/usr/bin/env bash
  set -euo pipefail
  RUNNER=${1:-build/test_z80_ss}
  CORPUS=${2:-third_party/SingleStepTests/z80/v1}

  # C1 opcode list. SingleStepTests/z80 v1/ filenames are LOWERCASE hex.
  C1_OPS=(
    00
    02 0a 12 1a 32 3a
    06 0e 16 1e 26 2e 36 3e
    40 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f
    50 51 52 53 54 55 56 57 58 59 5a 5b 5c 5d 5e 5f
    60 61 62 63 64 65 66 67 68 69 6a 6b 6c 6d 6e 6f
    70 71 72 73 74 75    77 78 79 7a 7b 7c 7d 7e 7f
  )

  total_pass=0; total_fail=0; fail_ops=()
  for op in "${C1_OPS[@]}"; do
    # Hard-fail on missing file. The previous version silently counted missing
    # tests as 0 pass / 0 fail, which produced false-positive "ALL PASS"
    # reports when the filename casing was wrong. NEVER let a missing test
    # silently succeed.
    if [ ! -f "$CORPUS/$op.json" ]; then
      echo "FAIL $op: test file missing: $CORPUS/$op.json"
      fail_ops+=("$op(missing)")
      continue
    fi
    line=$($RUNNER $CORPUS/$op.json 2>&1 | tail -1) || true
    pass=$(echo "$line" | grep -oE '[0-9]+ pass' | head -1 | awk '{print $1}')
    fail=$(echo "$line" | grep -oE '[0-9]+ fail' | head -1 | awk '{print $1}')
    pass=${pass:-0}; fail=${fail:-0}
    total_pass=$((total_pass + pass))
    total_fail=$((total_fail + fail))
    if [ "$fail" -gt 0 ] || [ "$pass" -eq 0 ]; then
      fail_ops+=("$op($fail fail / $pass pass)")
      echo "FAIL $op: $line"
    fi
  done
  echo "---"
  echo "Total: $total_pass pass, $total_fail fail"
  if [ ${#fail_ops[@]} -gt 0 ]; then
    echo "Failing opcodes: ${fail_ops[*]}"
    exit 1
  fi
  echo "ALL C1 OPCODE TESTS PASS"
  SH_EOF
  chmod +x scripts/run-z80-c1-tests.sh

Step 2. Add a Makefile target test-z80-c1 that builds the runner and invokes the script. Write the whole Makefile (preserving all existing targets) with this new target inserted ABOVE test-z80:
  test-z80-c1: tangle
  	@mkdir -p $(BUILD)
  	g++ -std=c++17 -Wall -Wextra -I$(INC_DIR) -Ithird_party \
  	  $(SRC_DIR)/memory.cpp $(SRC_DIR)/rom_loader.cpp \
  	  $(SRC_DIR)/berzerk_map.cpp $(SRC_DIR)/z80.cpp \
  	  $(SRC_DIR)/z80_singlestep_test.cpp \
  	  -o $(BUILD)/test_z80_ss
  	bash scripts/run-z80-c1-tests.sh $(BUILD)/test_z80_ss third_party/SingleStepTests/z80/v1

Step 3. Run it:
  make clean
  make test-z80-c1

Report the LAST 10 lines of output. The expected final line is "ALL C1 OPCODE TESTS PASS". If any opcodes fail, list them.

Append log only on success:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.5 done — pass — full C1 opcode subset 100% on SingleStepTests
  EOF

If anything fails, append a BLOCKER instead and STOP:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C1.5 BLOCKER — failing opcodes: <list>
  EOF

Then STOP.
````

**What Gemma should report:**

- The last line `ALL C1 OPCODE TESTS PASS`.
- A "Total: 63000 pass, 0 fail" line (or close — exact total = 63 opcodes × 1000 = 63000).

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1
make test-z80-c1 2>&1 | tee /tmp/c1.log | tail -3
grep -q "ALL C1 OPCODE TESTS PASS" /tmp/c1.log && echo OK
```

Expected: `OK`.

**If it fails:**

- Some opcodes fail with `f` field mismatch → flag computation bug, unlikely for LD (LD doesn't touch flags). Spot-check one: print expected vs got for a single test.
- `p` or `q` mismatches → SingleStepTests' p/q semantics. For ALL LD opcodes, both should be 0 at end. If many tests show `q` mismatch with specific non-zero values, the harness might be loading initial q wrong, or our reset of q is happening at the wrong time.
- `r` mismatch by exactly 1 → fetch_opcode incrementing R correctly? Bit 7 preserved? Check: `r = (r & 0x80) | ((r + 1) & 0x7F)`.
- `r` mismatch in `LD (HL),n` form → LD r,n only fetches the opcode (1 R increment) and reads n via `read_pc_byte` (no R increment). If R increments twice, `read_pc_byte` is wrong.
- `wz` mismatches on `LD A,(BC/DE/nn)` and `LD (BC/DE/nn),A` → WZ semantics in C1.4 are subtle. Recheck against the comments.

---

### C1.6 — Mark Phase C1 complete

**Paste this to Gemma:**

````text
Phase C1.6 — Mark Phase C1 complete.

Step 1. Confirm C1.1-C1.5 are logged:
  grep -E "^## .* — C1\.[1-5] done" session_status.md | wc -l
The output must be at least 5.

Step 2. Append:
  cat >> session_status.md <<EOF

  ## $(date +'%Y-%m-%d %H:%M') — Phase C1 COMPLETE — Z80 8-bit loads
  RESULT: pass
  TOUCHED: noweb/z80.nw (4 chunks), Makefile (test-z80-c1 target),
           scripts/run-z80-c1-tests.sh, src/z80.cpp, src/z80_singlestep_test.cpp,
           build/test_z80_ss (regenerable)
  NOTES: step() dispatcher + fetch helpers + p field added. 63 opcodes
         implemented: LD r,r' (0x40-0x7F minus 0x76), LD r,n (0x06,0x0E,0x16,
         0x1E,0x26,0x2E,0x3E), LD (HL),n (0x36), LD A,(BC)/(DE)/(nn) (0x0A,
         0x1A,0x3A), LD (BC)/(DE)/(nn),A (0x02,0x12,0x32). All ~63000
         SingleStepTests cases pass 100%. JSON test harness reusable for
         C2-C9. Ready for Phase C2 (16-bit loads).
  EOF

Step 3. Verify:
  grep -q "^## .* Phase C1 COMPLETE" session_status.md && echo OK

Report Step 1's count, Step 3's OK, then STOP.
````

---

## Exit criterion (whole sub-phase)

**Run this only AFTER C1.5 has landed** — the `test-z80-c1` target it checks for is created by C1.5. Running it earlier will fail with `make: *** No rule to make target 'test-z80-c1'` (that's normal; just paste C1.5 to OpenCode first).

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

# Prior phase intact
grep -q "^## .* Phase C0 COMPLETE" session_status.md && echo "OK phase C0"

# Four chunks now in z80.nw
[ "$(grep -c '^<<' noweb/z80.nw)" -eq 4 ] && echo "OK 4 chunks"

# step() and fetch helpers present
grep -q 'int step' noweb/z80.nw && grep -q 'fetch_opcode' noweb/z80.nw && echo "OK dispatcher"

# C1 opcode set passes
make clean > /dev/null 2>&1 && \
  make test-z80-c1 2>&1 | grep -q "ALL C1 OPCODE TESTS PASS" && echo "OK c1 opcodes"

# C0 state test still passes (no regression)
make test-z80-state 2>&1 | grep -q "ALL Z80 STATE TESTS PASS" && echo "OK no regression"

# Phase C1 COMPLETE marker
grep -q "^## .* Phase C1 COMPLETE" session_status.md && echo "OK marker"
```

All five `OK`s → Phase C1 done. Open `phases/phase_c2.md` (will be authored next) and start there.

---

## Known gotchas / quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `r` mismatches by 1 across the board | R-register bit 7 not preserved on increment | `r = (r & 0x80) \| ((r + 1) & 0x7F)`. Always. |
| `r` mismatches by 2+ on `LD r,n` | `read_pc_byte` increments R (it shouldn't) | Only `fetch_opcode` increments R. Operand fetches don't. |
| All tests fail with `pc` wrong by 1 | `fetch_opcode` doesn't increment PC | Both `fetch_opcode` and `read_pc_byte` MUST `pc.w++`. |
| Register mappings shifted | Reg lookup table wrong order | Order: 000=B (bc.h), 001=C (bc.l), 010=D (de.h), 011=E (de.l), 100=H (hl.h), 101=L (hl.l), 110=(HL), 111=A (af.h). |
| `LD r,r'` works but `LD r,(HL)` fails | Reading from `regs[6]` which is nullptr | Special-case src=6 to call `mem->read8(hl.w)` BEFORE indexing regs. |
| `wz` mismatch on `LD A,(BC)` | WZ not set | `LD A,(BC)` sets WZ to `BC+1`. Per MAME Z80 docs. |
| `wz` mismatch on `LD (nn),A` | WZ not set, or set wrong | `LD (nn),A`: WZ.h = A, WZ.l = (low(nn) + 1) & 0xFF. |
| `p` and `q` mismatches across most LD opcodes | Not zeroing both after each LD | Every LD case ends with `p = 0; q = 0;`. |
| `ei got 1 want 0` mismatch on every test | Missing EI-delay post-dispatch handler in `step()` | Restructure: every case `break`s (not `return`s); post-switch block runs `if (ei_was_pending) ei_pending = false;`. Captured `ei_was_pending = ei_pending;` BEFORE the switch. |
| `f` mismatches on LD opcodes | LD shouldn't touch F | LD opcodes do NOT modify the F register. Don't write to it. |
| Compile error: `nlohmann/json.hpp not found` | Include path mismatch | Confirm `third_party/json.hpp` exists; include path in test harness is `"../third_party/json.hpp"` relative to `src/`. |
| Single opcode (e.g., 0x76) fails 1000 times | HALT got into the LD case range | Confirm `case 0x76` is NOT in the LD block. HALT lands in C6. |

## Reference pointers (rule R4 — agent must ask before reading)

- `$REFERENCE_REPO/noweb/memory.nw` — the reference build's Z80 lives there (Phase 3); `step()` is around line ~500 if you need a structure reference.
- MAME upstream: `src/devices/cpu/z80/z80.cpp` — authoritative for WZ semantics, R-register handling, all opcode cycle counts.
- `third_party/SingleStepTests/z80/README.md` (if it has one) — JSON format reference. The `p` field semantics if you can find a clear write-up there.
- `cdoc/architecture.md` — Z80 register layout (already cited in C0).
