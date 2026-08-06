# Phase B — Memory subsystem (AddressSpace, ROM loader, Berzerk memory map)

## TL;DR

Build a callback-based `AddressSpace` so every emulated memory read/write is observable (the cosim foundation). Encode the seven Berzerk memory regions per `cdoc/architecture.md`. Write a ROM loader that CRC32-verifies all 8 RC31A + voice ROMs. Land a smoke test that exercises every region. Seven subtasks. The reference build did this in ~1–2 hours; expect Gemma to take 2–4×.

This is where the implementation starts being *Berzerk-shaped* rather than just plumbing. Real C++ (~200 lines across `noweb/memory.nw`'s chunks).

---

## How to use this file

Same two-terminal pattern as Phase A. See `MILESTONES.md` if you need the refresher.

- **Terminal 1** — OpenCode session (already running from Phase A, or `opencode --agent berzerk` if you restarted).
- **Terminal 2** — plain shell at the project root for independent-verify.

Per subtask: paste prompt → Gemma runs → compare against "What Gemma should report" → Terminal 2 verify → `next`.

---

## Before you start — entry criteria

Run these in Terminal 2. Every line should print `OK`.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

# Phase A is complete
grep -q "^## .* Phase A COMPLETE" session_status.md && echo "OK phase A done"

# Toolchain + Makefile still work
command -v g++ notangle noweave pdflatex python3 > /dev/null && echo "OK toolchain"
test -f Makefile && grep -qE '^(tangle|build|clean):' Makefile && echo "OK makefile"

# ROMs are present (8 files) at the canonical pod path
[ "$(ls rom/berzerk/ | wc -l)" -eq 8 ] && echo "OK 8 roms"

# The reference repo is reachable (for R4 reads if needed)
test -d /home/user/sudnya/checkout/gfx-challenge/cdoc && echo "OK reference repo"

# session_status.md has writable trail
test -f session_status.md && echo "OK log"
```

If any line fails, fix it before launching B.1. If Phase A's COMPLETE marker is missing, you're not actually done with A — back-fill before continuing.

---

## Session start (Terminal 1 — OpenCode)

If OpenCode is still running from Phase A, no need to restart. If you've reconnected to the pod, re-run the M1 ritual:

```text
Begin. Execute the three M1 startup reads (goals.md, MILESTONES.md, tail -n 30 session_status.md). Report back with:
  (a) the last entry in session_status.md (or "missing/empty"),
  (b) which phase you believe is active,
  (c) "ready" — and STOP. Do not propose a plan. I will paste the next subtask.
```

Gemma's last log entry should be `Phase A COMPLETE`, so it should report `Phase B (Memory subsystem)` is active. If it claims something else, course-correct: `Wrong. Phase A COMPLETE is in the log. Phase B is next.`

---

## Subtasks

---

### B.1 — Write `noweb/memory.nw` with the `AddressSpace` class

**Why:** the foundation of the emulator. Every memory access goes through `AddressSpace::read8` / `write8`, which dispatch to per-region callbacks. This makes memory observable (the cosim premise from `goals.md` §0) and decouples the Z80 from the Berzerk-specific map. Subsequent subtasks (ROM loader, memory map, tests) extend this same file.

**Paste this to Gemma:**

````text
Phase B.1 — Write noweb/memory.nw with AddressSpace.

Write the file using a heredoc. Do NOT use @start{} / @end{} — noweb chunk syntax is <<chunk-name>>= followed by the body. Include three chunks: memory.h, memory.cpp, and a placeholder berzerk_map.cpp (we'll fill it in B.3).

  cat > noweb/memory.nw <<'NW_EOF'
  % memory.nw — AddressSpace, callbacks, ROM loader, Berzerk memory map

  This file defines [[AddressSpace]], the callback-based memory abstraction used
  by every emulated chip. All reads and writes route through it so they are
  observable (the cosimulation foundation per goals.md §0). Unmapped reads
  return 0xFF (Z80 floating-bus behavior). Read/write counters are kept for
  instrumentation.

  <<memory.h>>=
  #pragma once
  #include <cstdint>
  #include <functional>
  #include <vector>
  #include <string>

  namespace berzerk {

  using ReadHandler  = std::function<uint8_t(uint16_t)>;
  using WriteHandler = std::function<void(uint16_t, uint8_t)>;

  struct Region {
      uint16_t start;
      uint16_t end;       // inclusive
      ReadHandler  read;  // may be null -> returns 0xFF
      WriteHandler write; // may be null -> no-op
      std::string name;
  };

  class AddressSpace {
  public:
      AddressSpace();

      // Install a read handler for [start, end] (inclusive). end >= start.
      void install_read (uint16_t start, uint16_t end, ReadHandler  h, const std::string& name);
      // Install a write handler for [start, end] (inclusive).
      void install_write(uint16_t start, uint16_t end, WriteHandler h, const std::string& name);

      uint8_t read8 (uint16_t addr);
      void    write8(uint16_t addr, uint8_t data);

      uint64_t read_count()  const { return read_count_;  }
      uint64_t write_count() const { return write_count_; }

  private:
      std::vector<Region> regions_;
      uint64_t read_count_  = 0;
      uint64_t write_count_ = 0;
  };

  } // namespace berzerk
  @

  <<memory.cpp>>=
  #include "memory.h"

  namespace berzerk {

  AddressSpace::AddressSpace() {}

  void AddressSpace::install_read(uint16_t start, uint16_t end, ReadHandler h, const std::string& name) {
      regions_.push_back({start, end, h, nullptr, name});
  }

  void AddressSpace::install_write(uint16_t start, uint16_t end, WriteHandler h, const std::string& name) {
      regions_.push_back({start, end, nullptr, h, name});
  }

  uint8_t AddressSpace::read8(uint16_t addr) {
      ++read_count_;
      for (const auto& r : regions_) {
          if (addr >= r.start && addr <= r.end && r.read) return r.read(addr);
      }
      return 0xFF; // unmapped -> Z80 floating bus
  }

  void AddressSpace::write8(uint16_t addr, uint8_t data) {
      ++write_count_;
      for (const auto& r : regions_) {
          if (addr >= r.start && addr <= r.end && r.write) { r.write(addr, data); return; }
      }
      // unmapped -> drop
  }

  } // namespace berzerk
  @

  <<berzerk_map.cpp>>=
  // Berzerk memory map. Filled in subtask B.3.
  #include "memory.h"

  namespace berzerk {
  // (intentionally empty - B.3 adds install_berzerk_map())
  }
  @
  NW_EOF

Then verify and report:
  test -f noweb/memory.nw && echo "FILE OK"
  grep -c '^<<' noweb/memory.nw           # expect 3 (memory.h, memory.cpp, berzerk_map.cpp)
  ! grep -q '@start{' noweb/memory.nw && echo "no wrong syntax"

Tangle smoke-test:
  make clean && make tangle
  test -f include/memory.h && echo "OK memory.h"
  test -f src/memory.cpp && echo "OK memory.cpp"
  test -f src/berzerk_map.cpp && echo "OK berzerk_map.cpp"

Compile smoke-test (does the AddressSpace class compile?):
  g++ -std=c++17 -Wall -Wextra -Iinclude -c src/memory.cpp -o /tmp/memory.o && echo "OK compile"

Append log line:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — B.1 done — pass — AddressSpace + memory.nw scaffolding
  EOF

Then STOP.
````

**What Gemma should report:**

- `FILE OK`
- `3` (chunk count from grep)
- `no wrong syntax`
- `OK memory.h`, `OK memory.cpp`, `OK berzerk_map.cpp`
- `OK compile`
- Log line appended.

**Independent verify (Terminal 2):**

```bash
test -f noweb/memory.nw && \
  [ "$(grep -c '^<<' noweb/memory.nw)" -eq 3 ] && \
  make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  test -f include/memory.h && \
  test -f src/memory.cpp && \
  test -f src/berzerk_map.cpp && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -c src/memory.cpp -o /tmp/memory.o && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- `noweb/memory.nw` uses `@start{}` → cite: "noweb syntax is `<<chunk-name>>=` followed by body. Rewrite using `<<...>>=` blocks."
- Chunk count ≠ 3 → Gemma split or merged chunks. Cite: "Expected 3 chunks (memory.h, memory.cpp, berzerk_map.cpp). Re-write exactly per the heredoc."
- Tangle produces no files under `src/`/`include/` → Makefile's chunk routing didn't match. Inspect Phase A.4's case statement; specifically the `*.h)` / `*.cpp)` branches.
- `g++` errors about `std::function` → missing `<functional>`. Cite the line in the header that should `#include <functional>`.
- `g++` errors about `namespace berzerk` → check both chunks open and close the namespace identically.

---

### B.2 — Add the ROM loader with CRC32 verification

**Why:** ROMs are the game. CRC32 verification ensures we're emulating the correct RC31A revision — silent wrong-ROM bugs are extremely hard to debug after the fact. The reference build hard-fails on any mismatch. We mirror that.

**Paste this to Gemma:**

````text
Phase B.2 — Add ROM loader to noweb/memory.nw.

Edit noweb/memory.nw to add two new chunks BEFORE the <<berzerk_map.cpp>>= chunk (so the order in the file becomes: memory.h, memory.cpp, rom_loader chunks, berzerk_map.cpp).

ALSO extend <<memory.h>>= to declare the new functions and the RomImage struct. Use a `Read` of noweb/memory.nw first to see current content, then Edit to add what's below. Two-strike rule on Edits: if "multiple matches" hits twice, switch to a Write of the whole file.

Add to <<memory.h>>= (inside namespace berzerk, after the AddressSpace class):

  struct RomImage {
      std::string filename;
      uint16_t    load_addr;     // 0xFFFF for voice ROMs (not mapped in CPU space)
      uint32_t    expected_crc32;
      size_t      expected_size; // bytes
      std::vector<uint8_t> data;
  };

  // CRC32 with reflected polynomial 0xEDB88320 (standard).
  uint32_t crc32(const uint8_t* data, size_t len);

  // Load all 8 Berzerk RC31A ROMs from <rom_dir>/rom/berzerk/. Hard-fails on
  // missing file, size mismatch, or CRC mismatch. Returns the 6 CPU ROMs
  // (load_addr != 0xFFFF) and the 2 voice ROMs (load_addr == 0xFFFF).
  std::vector<RomImage> load_berzerk_roms(const std::string& project_root);

Add a new chunk <<rom_loader.cpp>>= AFTER memory.cpp (which tangles to src/rom_loader.cpp):

  <<rom_loader.cpp>>=
  #include "memory.h"
  #include <fstream>
  #include <stdexcept>

  namespace berzerk {

  uint32_t crc32(const uint8_t* data, size_t len) {
      static uint32_t table[256];
      static bool inited = false;
      if (!inited) {
          for (uint32_t i = 0; i < 256; ++i) {
              uint32_t c = i;
              for (int j = 0; j < 8; ++j)
                  c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
              table[i] = c;
          }
          inited = true;
      }
      uint32_t c = 0xFFFFFFFFu;
      for (size_t i = 0; i < len; ++i) c = table[(c ^ data[i]) & 0xFFu] ^ (c >> 8);
      return c ^ 0xFFFFFFFFu;
  }

  // 8 ROM files. Addresses and CRCs are from cdoc/architecture.md (verified
  // against MAME's berzerk.cpp ROM definitions).
  static const RomImage BERZERK_ROMS[] = {
      // CPU ROMs (load into program space):
      {"berzerk_rc31_1c.rom0.1c",  0x0000, 0xca566dbc, 2048, {}},
      {"berzerk_rc31_1d.rom1.1d",  0x1000, 0x7ba69fde, 2048, {}},
      {"berzerk_rc31_3d.rom2.3d",  0x1800, 0xa1d5248b, 2048, {}},
      {"berzerk_rc31_5d.rom3.5d",  0x2000, 0xfcaefa95, 2048, {}},
      {"berzerk_rc31_6d.rom4.6d",  0x2800, 0x1e35b9a0, 2048, {}},
      {"berzerk_rc31a_5c.rom5.5c", 0x3000, 0xe0fab8f5, 2048, {}},
      // Voice ROMs (separate address space; load_addr=0xFFFF marks them):
      {"berzerk_r_vo_1c.1c",       0xFFFF, 0x2cfe825d, 2048, {}},
      {"berzerk_r_vo_2c.2c",       0xFFFF, 0xd2b6324e, 2048, {}},
  };

  std::vector<RomImage> load_berzerk_roms(const std::string& project_root) {
      std::vector<RomImage> out;
      for (const auto& tmpl : BERZERK_ROMS) {
          std::string path = project_root + "/rom/berzerk/" + tmpl.filename;
          std::ifstream f(path, std::ios::binary);
          if (!f) throw std::runtime_error("ROM not found: " + path);
          RomImage img = tmpl;
          img.data.assign(std::istreambuf_iterator<char>(f), {});
          if (img.data.size() != img.expected_size)
              throw std::runtime_error("ROM size mismatch: " + tmpl.filename);
          uint32_t crc = crc32(img.data.data(), img.data.size());
          if (crc != img.expected_crc32) {
              char buf[256];
              std::snprintf(buf, sizeof(buf),
                  "ROM CRC mismatch: %s expected %08x got %08x",
                  tmpl.filename.c_str(), img.expected_crc32, crc);
              throw std::runtime_error(buf);
          }
          out.push_back(std::move(img));
      }
      return out;
  }

  } // namespace berzerk
  @

Verify and report:
  grep -c '^<<' noweb/memory.nw           # expect 4 now (memory.h, memory.cpp, rom_loader.cpp, berzerk_map.cpp)
  grep -q '0xEDB88320' noweb/memory.nw && echo "CRC poly OK"
  grep -q 'berzerk_rc31_1c' noweb/memory.nw && echo "ROM table OK"

  make clean && make tangle
  test -f src/rom_loader.cpp && echo "OK rom_loader.cpp tangled"

Compile (use -fsyntax-only — it works with multiple source files, unlike -c with -o):
  g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only src/memory.cpp src/rom_loader.cpp && echo "OK compile"

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — B.2 done — pass — ROM loader + CRC32 + 8-ROM table
  EOF

Then STOP.
````

**What Gemma should report:**

- Updated `<<memory.h>>=` includes `RomImage`, `crc32`, `load_berzerk_roms` declarations.
- New `<<rom_loader.cpp>>=` chunk added between `memory.cpp` and `berzerk_map.cpp`.
- `grep -c` returns `4`.
- `CRC poly OK`, `ROM table OK`.
- `OK rom_loader.cpp tangled`, `OK compile`.

**Independent verify (Terminal 2):**

```bash
[ "$(grep -c '^<<' noweb/memory.nw)" -eq 4 ] && \
  grep -q '0xEDB88320' noweb/memory.nw && \
  grep -q 'berzerk_rc31_1c' noweb/memory.nw && \
  grep -q 'load_berzerk_roms' include/memory.h && \
  make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1 && \
  test -f src/rom_loader.cpp && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only src/memory.cpp src/rom_loader.cpp && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- Gemma's Edit hit "multiple matches" twice → cite E3, have it Write the whole file instead.
- ROM table has wrong CRC32 → look up `cdoc/architecture.md` line `0x0000     berzerk_rc31_1c.rom0.1c      2 KB   0xca566dbc` and cite. Insist on exact CRCs.
- `g++` errors on `std::snprintf` → missing `<cstdio>`. Cite the missing include.
- Compile passes but B.4 later says "ROM not found" → Gemma assumed `<rom_dir>` is the project root vs. `<project_root>/rom/berzerk/`. Re-read `load_berzerk_roms` signature.

---

### B.3 — Wire up the Berzerk memory map (7 regions)

**Why:** the seven memory regions per `cdoc/architecture.md`. Each region gets an `install_read` and `install_write` (or both, or neither for ROM6). This is where the CPU's view of memory takes shape. Magic RAM is stubbed for now — full 74181 ALU lands in Phase D.

**Paste this to Gemma:**

````text
Phase B.3 — Implement the Berzerk memory map.

Edit noweb/memory.nw and replace the placeholder <<berzerk_map.cpp>>= chunk with the real implementation. ALSO add the install_berzerk_map declaration to <<memory.h>>=.

Add to <<memory.h>>= (after load_berzerk_roms declaration):

  // Install all seven Berzerk memory regions into `space`. Pass loaded CPU
  // ROMs (6 entries, load_addr != 0xFFFF). Allocates and owns the backing
  // buffers for work RAM, VRAM, and Color RAM via the returned struct.
  struct BerzerkMemory {
      std::vector<uint8_t> work_ram;   // 1 KB, mirrored at 0x0800-0x0FFF
      std::vector<uint8_t> vram;       // 8 KB at 0x4000-0x5FFF
      std::vector<uint8_t> color_ram;  // 2 KB at 0x8000-0x87FF
      std::vector<RomImage> roms;      // owns ROM data
  };
  BerzerkMemory install_berzerk_map(AddressSpace& space, std::vector<RomImage> roms);

Replace <<berzerk_map.cpp>>= with:

  <<berzerk_map.cpp>>=
  #include "memory.h"
  #include <cstring>

  namespace berzerk {

  BerzerkMemory install_berzerk_map(AddressSpace& space, std::vector<RomImage> roms) {
      BerzerkMemory mem;
      mem.work_ram.resize(0x0400, 0);     // 1 KB
      mem.vram.resize(0x2000, 0);          // 8 KB
      mem.color_ram.resize(0x0800, 0);     // 2 KB
      mem.roms = std::move(roms);

      // --- ROMs -----------------------------------------------------------
      // 6 CPU ROMs from B.2's table: ROM0 at 0x0000, ROM1-5 at 0x1000-0x37FF.
      for (auto& r : mem.roms) {
          if (r.load_addr == 0xFFFF) continue; // skip voice ROMs
          uint16_t start = r.load_addr;
          uint16_t end   = start + static_cast<uint16_t>(r.expected_size) - 1;
          const uint8_t* data = r.data.data();
          space.install_read(start, end,
              [data, start](uint16_t a) { return data[a - start]; },
              "ROM@" + std::to_string(start));
          // ROMs are read-only — no install_write.
      }

      // ROM6 at 0x3800-0x3FFF is unpopulated; reads 0xFF (Z80 floating bus).
      // We don't install a handler; AddressSpace::read8 returns 0xFF by default.

      // --- Work RAM at 0x0800-0x0BFF, mirrored at 0x0C00-0x0FFF ----------
      uint8_t* wram = mem.work_ram.data();
      auto wram_read  = [wram](uint16_t a) { return wram[(a - 0x0800) & 0x03FF]; };
      auto wram_write = [wram](uint16_t a, uint8_t d) { wram[(a - 0x0800) & 0x03FF] = d; };
      space.install_read (0x0800, 0x0FFF, wram_read,  "WorkRAM");
      space.install_write(0x0800, 0x0FFF, wram_write, "WorkRAM");

      // --- VRAM at 0x4000-0x5FFF (8 KB) ----------------------------------
      uint8_t* vram = mem.vram.data();
      space.install_read (0x4000, 0x5FFF, [vram](uint16_t a)            { return vram[a - 0x4000]; }, "VRAM");
      space.install_write(0x4000, 0x5FFF, [vram](uint16_t a, uint8_t d) { vram[a - 0x4000] = d; },     "VRAM");

      // --- Magic RAM at 0x6000-0x7FFF: writes go through 74181 ALU to VRAM,
      //     reads come from VRAM at (addr - 0x2000). Phase B stubs this:
      //     reads = passthrough to VRAM, writes = identity (no ALU yet).
      //     Phase D wires the real 74181 pipeline here.
      space.install_read (0x6000, 0x7FFF,
          [vram](uint16_t a) { return vram[a - 0x6000]; }, "MagicRAM(stub-read)");
      space.install_write(0x6000, 0x7FFF,
          [vram](uint16_t a, uint8_t d) { vram[a - 0x6000] = d; }, "MagicRAM(stub-write)");

      // --- Color RAM at 0x8000-0x87FF (2 KB). MAME mirrors this up through
      //     0xBFFF; for Phase B we install only the canonical window. Mirrors
      //     can be added later if a game path touches them.
      uint8_t* cram = mem.color_ram.data();
      space.install_read (0x8000, 0x87FF, [cram](uint16_t a)            { return cram[a - 0x8000]; }, "ColorRAM");
      space.install_write(0x8000, 0x87FF, [cram](uint16_t a, uint8_t d) { cram[a - 0x8000] = d; },     "ColorRAM");

      return mem;
  }

  } // namespace berzerk
  @

Verify and report:
  grep -q 'install_berzerk_map' include/memory.h && echo "decl OK"
  grep -q 'WorkRAM' noweb/memory.nw && echo "WorkRAM OK"
  grep -q 'VRAM' noweb/memory.nw && echo "VRAM OK"
  grep -q 'MagicRAM' noweb/memory.nw && echo "MagicRAM stub OK"
  grep -q 'ColorRAM' noweb/memory.nw && echo "ColorRAM OK"

  make clean && make tangle && \
    g++ -std=c++17 -Wall -Wextra -Iinclude -fsyntax-only \
      src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp && \
    echo "OK compile"

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — B.3 done — pass — Berzerk memory map (7 regions, Magic RAM stubbed)
  EOF

Then STOP.
````

**What Gemma should report:**

- 5 region-name `OK` lines.
- `decl OK` (header has `install_berzerk_map`).
- `OK compile`.

**Independent verify (Terminal 2):**

```bash
grep -q 'install_berzerk_map' include/memory.h && \
  grep -qE 'install_read.* 0x0800.* 0x0FFF' src/berzerk_map.cpp && \
  grep -qE 'install_read.* 0x4000.* 0x5FFF' src/berzerk_map.cpp && \
  grep -qE 'install_read.* 0x6000.* 0x7FFF' src/berzerk_map.cpp && \
  grep -qE 'install_read.* 0x8000.* 0x87FF' src/berzerk_map.cpp && \
  make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  g++ -std=c++17 -Wall -Wextra -Iinclude -c src/berzerk_map.cpp -o /dev/null && \
  echo OK
```

Expected: `OK`.

**If it fails:**

- Memory map uses wrong address (e.g., VRAM at `$6000`) → cite: "Reference: cdoc/architecture.md memory map. VRAM is $4000-$5FFF. Magic RAM is $6000-$7FFF and mirrors VRAM through the 74181."
- ROM6 ($3800-$3FFF) handler installed → not needed; cite: "ROM6 is unpopulated; unmapped read returns 0xFF by default. Remove the handler."
- Lambda capture issues (e.g., `wram` captured by value into a runtime callback that gets invoked after the vector reallocates) → check vectors are sized BEFORE the lambda captures the pointer. The reference does this correctly because `resize(N, 0)` happens first.

---

### B.4 — Write the memory self-test (`tests/test_memory.cpp`)

**Why:** smoke-tests every region. CRC-verified ROM load is the gate. Without this, downstream phases have no way to know the memory subsystem actually works.

**Paste this to Gemma:**

````text
Phase B.4 — Write the memory self-test.

Add a new chunk <<test_memory.cpp>>= to noweb/memory.nw, AFTER <<berzerk_map.cpp>>=. The chunk should tangle to tests/test_memory.cpp.

Also extend the Makefile to add a test-memory target. We'll do the Makefile in B.5 — for now just write the noweb chunk.

Append to noweb/memory.nw (use heredoc append with cat >>, not Edit):

  cat >> noweb/memory.nw <<'NW_EOF'

  <<test_memory.cpp>>=
  // Memory subsystem smoke test. Loads all 8 ROMs (CRC-verified), exercises
  // every region of the Berzerk memory map.
  #include "memory.h"
  #include <cassert>
  #include <cstdio>
  #include <cstdlib>

  using namespace berzerk;

  static int failures = 0;
  #define EXPECT_EQ(a, b) do { auto _a = (a); auto _b = (b); \
      if (_a != _b) { std::printf("FAIL %s:%d: %s != %s (got %u vs %u)\n", \
          __FILE__, __LINE__, #a, #b, (unsigned)_a, (unsigned)_b); ++failures; } } while (0)

  int main(int argc, char** argv) {
      const std::string project_root = (argc > 1) ? argv[1] : ".";

      // 1. ROM load + CRC32 verification (hard-fails on mismatch).
      std::vector<RomImage> roms;
      try {
          roms = load_berzerk_roms(project_root);
      } catch (const std::exception& e) {
          std::printf("FAIL ROM load: %s\n", e.what());
          return 1;
      }
      std::printf("OK: 8 ROMs loaded, CRC32 verified\n");
      EXPECT_EQ(roms.size(), 8u);

      // 2. Install map.
      AddressSpace space;
      BerzerkMemory mem = install_berzerk_map(space, std::move(roms));

      // 3. ROM0 first byte (0x0000) should match the loaded ROM data.
      uint8_t rom0_first = space.read8(0x0000);
      uint8_t rom0_expected = mem.roms[0].data[0];
      EXPECT_EQ(rom0_first, rom0_expected);

      // 4. ROM6 at 0x3800 should read 0xFF (unmapped -> floating bus).
      EXPECT_EQ(space.read8(0x3800), 0xFFu);
      EXPECT_EQ(space.read8(0x3FFF), 0xFFu);

      // 5. Work RAM read/write at 0x0800.
      space.write8(0x0800, 0x55);
      EXPECT_EQ(space.read8(0x0800), 0x55u);

      // 6. Work RAM mirror: write at 0x0800, read at 0x0C00 should match.
      EXPECT_EQ(space.read8(0x0C00), 0x55u);
      // And vice versa: write at 0x0C00, read at 0x0800.
      space.write8(0x0C00, 0xAA);
      EXPECT_EQ(space.read8(0x0800), 0xAAu);

      // 7. VRAM read/write at 0x4000 and 0x5FFF.
      space.write8(0x4000, 0x12);
      space.write8(0x5FFF, 0x34);
      EXPECT_EQ(space.read8(0x4000), 0x12u);
      EXPECT_EQ(space.read8(0x5FFF), 0x34u);

      // 8. Magic RAM (stubbed) read returns underlying VRAM at addr-0x2000.
      // We wrote 0x12 at VRAM 0x4000, so MagicRAM 0x6000 should read 0x12.
      EXPECT_EQ(space.read8(0x6000), 0x12u);

      // 9. Color RAM at 0x8000.
      space.write8(0x8000, 0x77);
      EXPECT_EQ(space.read8(0x8000), 0x77u);
      EXPECT_EQ(space.read8(0x87FF), 0x00u); // untouched

      // 10. Unmapped high memory at 0xC000 returns 0xFF.
      EXPECT_EQ(space.read8(0xC000), 0xFFu);
      EXPECT_EQ(space.read8(0xFFFF), 0xFFu);

      if (failures == 0) {
          std::printf("ALL MEMORY TESTS PASS\n");
          return 0;
      }
      std::printf("FAILED: %d assertions\n", failures);
      return 1;
  }
  @
  NW_EOF

Verify and report:
  grep -c '^<<' noweb/memory.nw    # expect 5 (memory.h, memory.cpp, rom_loader.cpp, berzerk_map.cpp, test_memory.cpp)
  make clean && make tangle
  ls src/test_memory.cpp || ls tests/test_memory.cpp
Report which path the test tangled to and whether the file exists.

Then STOP.
````

**What Gemma should report:**

- 5 chunks total.
- `src/test_memory.cpp` exists (the Phase A Makefile's case statement routes `*.cpp` chunks to `src/`).

**Independent verify (Terminal 2):**

```bash
[ "$(grep -c '^<<' noweb/memory.nw)" -eq 5 ] && \
  make clean > /dev/null 2>&1 && \
  make tangle > /dev/null 2>&1 && \
  test -f src/test_memory.cpp && echo OK
```

Expected: `OK`.

**Note about the test's location:** the Phase A Makefile routes any `*.cpp` chunk to `src/`. So `src/test_memory.cpp` is correct. We'll handle linking it as a separate binary in B.5.

**If it fails:**

- Append used Edit instead of `cat >>` → wrong tool. Cite: "Use `cat >> noweb/memory.nw <<'NW_EOF' ... NW_EOF` to append. Do not Edit (B.4's chunk is new content at the end of the file)."
- Test file tangles to `include/` because chunk name lacks the `.cpp` suffix → check the chunk header is `<<test_memory.cpp>>=`, not `<<test_memory>>=`.

---

### B.5 — Wire `make test-memory` into the Makefile

**Why:** the Makefile needs a target that compiles `src/memory.cpp + src/rom_loader.cpp + src/berzerk_map.cpp + src/test_memory.cpp` into a `build/test_memory` binary and runs it. Without this, the test exists but no one can invoke it cleanly.

**Paste this to Gemma:**

````text
Phase B.5 — Add `make test-memory` target to the Makefile.

Read the current Makefile, then replace the `test-z80:` stub block with a real `test-memory:` target above it. Use Edit (not Write) so the existing tangle/build/clean/weave targets stay intact. Two-strike rule: if Edit hits "multiple matches" twice, switch to Write of the whole Makefile and preserve all other targets verbatim.

The new target should:
  - Depend on tangle (so src/*.cpp are up to date).
  - Compile src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp src/test_memory.cpp into build/test_memory.
  - Run build/test_memory with the project root as argv[1].

Add this target above the existing test-z80 stub. Use TAB indentation for recipe lines (the Phase A Makefile uses tabs; preserve that):

  test-memory: tangle
  	@mkdir -p $(BUILD)
  	g++ -std=c++17 -Wall -Wextra -I$(INC_DIR) \
  	  $(SRC_DIR)/memory.cpp $(SRC_DIR)/rom_loader.cpp \
  	  $(SRC_DIR)/berzerk_map.cpp $(SRC_DIR)/test_memory.cpp \
  	  -o $(BUILD)/test_memory
  	$(BUILD)/test_memory .

Verify and report:
  grep -q '^test-memory:' Makefile && echo "target present"
  grep -q 'test_memory' Makefile && echo "binary path OK"
  awk '/^test-memory:/,/^[a-z]/' Makefile | head -10
This last awk should print the recipe lines starting with TAB. Report the awk output.

Note: the Makefile references the binary as `$(BUILD)/test_memory` (the Makefile variable, unexpanded). Do NOT grep for the literal `build/test_memory` — that's the post-expansion path and won't match the file content. Grep for `test_memory` is sufficient.

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — B.5 done — pass — Makefile test-memory target added
  EOF

Then STOP.
````

**What Gemma should report:**

- `target present`, `binary path OK`.
- The awk output shows recipe lines starting with TAB (visible as indented lines beginning with backslash-t or just leading whitespace; check via `awk '/^\t/'` separately if uncertain).

**Independent verify (Terminal 2):**

```bash
grep -q '^test-memory:' Makefile && \
  grep -q 'test_memory' Makefile && \
  awk '/^test-memory:/,/^$/' Makefile | grep -q '^\t' && \
  echo OK
```

Note: the Makefile references the binary as `$(BUILD)/test_memory` (Makefile variable, unexpanded in the file). Don't grep for `build/test_memory` — that's the post-expansion path and won't match the literal file content.

Expected: `OK`.

**If it fails:**

- Recipe uses spaces → cite the tab rule from Phase A.4. Have Gemma rewrite the target with literal tabs.
- The test-memory target redefined `tangle` or removed other targets → Edit went too broad. Have Gemma Read the Makefile, then Write the corrected version preserving all original targets.

---

### B.6 — Build and run the memory test end-to-end

**Why:** the actual gate. Tangle, build, run, expect `ALL MEMORY TESTS PASS`. CRC32 mismatches surface here.

**Paste this to Gemma:**

````text
Phase B.6 — Build and run the memory test.

Run in order:

Step 1. Clean tangle:
  make clean
  make tangle

Step 2. Build and run the test:
  make test-memory

Step 3. Confirm the test PASSED. The expected last line of stdout is:
  ALL MEMORY TESTS PASS
Report the full output of make test-memory, especially:
  - Did "8 ROMs loaded, CRC32 verified" print?
  - Did "ALL MEMORY TESTS PASS" print?
  - Any FAIL lines?

Step 4. Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — B.6 done — pass — memory subsystem smoke test green
  EOF

Then STOP.
````

**What Gemma should report:**

- `OK: 8 ROMs loaded, CRC32 verified`
- `ALL MEMORY TESTS PASS`
- Zero `FAIL` lines.
- Log appended.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1 && \
  make test-memory 2>&1 | tee /tmp/test_memory.log | tail -5
grep -q "ALL MEMORY TESTS PASS" /tmp/test_memory.log && echo OK
```

Expected: the last few lines of test output, ending with `ALL MEMORY TESTS PASS`, then `OK`.

**If it fails:**

- "ROM not found" → check the ROM directory path. The test passes `.` as `project_root`; `load_berzerk_roms` expects `<root>/rom/berzerk/<file>`. Run `ls rom/berzerk/` and confirm the 8 files are present with exact names.
- "ROM CRC mismatch" → one of two things. Either Gemma typo'd a CRC in B.2's table (compare against `cdoc/architecture.md`), or the ROMs on disk are a different revision than RC31A. Run `crc32 rom/berzerk/berzerk_rc31_1c.rom0.1c` (or `python3 -c "import zlib, sys; print(hex(zlib.crc32(open(sys.argv[1],'rb').read()) & 0xffffffff))" rom/berzerk/...`) to get the actual CRC and compare.
- Mirror test fails (write at $0800, read at $0C00 != 0x55) → the `(a - 0x0800) & 0x03FF` mask isn't being applied. Recheck the work-RAM lambda.
- Compile fails on `std::printf` → missing `<cstdio>`. Add it.
- Voice ROM CRCs wrong → recheck against architecture.md's speech ROM table.

---

### B.7 — Mark Phase B complete

**Why:** Phase-boundary marker. Future sessions grep for `Phase B COMPLETE` to know Phase C is next.

**Paste this to Gemma:**

````text
Phase B.7 — Mark Phase B complete.

Step 1. Confirm B.1-B.6 are all logged:
  grep -E "^## .* — B\.[1-6] done" session_status.md | wc -l
The output must be at least 6.

Step 2. Append the Phase B COMPLETE block:
  cat >> session_status.md <<EOF

  ## $(date +'%Y-%m-%d %H:%M') — Phase B COMPLETE — Memory subsystem
  RESULT: pass
  TOUCHED: noweb/memory.nw (5 chunks), Makefile (test-memory target),
           src/memory.cpp, src/rom_loader.cpp, src/berzerk_map.cpp, src/test_memory.cpp,
           include/memory.h, build/test_memory (regenerable)
  NOTES: B.1-B.6 all green. AddressSpace callback-routed memory access.
         7-region Berzerk map (ROM 0x0000-0x37FF, work RAM 0x0800 mirrored,
         VRAM 0x4000-0x5FFF, Magic RAM 0x6000-0x7FFF stubbed for Phase D,
         Color RAM 0x8000-0x87FF, ROM6/unmapped return 0xFF).
         8 ROMs CRC32-verified at load (RC31A revision + 2 voice ROMs).
         Memory self-test exercises every region. Ready for Phase C (Z80 CPU).
  EOF

Step 3. Verify:
  grep -q "^## .* Phase B COMPLETE" session_status.md && echo OK

Report Step 1's count, Step 3's OK, then STOP.
````

**What Gemma should report:**

- Step 1: ≥ 6.
- Step 3: `OK`.

**Independent verify (Terminal 2):**

```bash
grep -q "^## .* Phase B COMPLETE" session_status.md && echo OK
```

Expected: `OK`.

---

## Exit criterion (whole phase)

Run in Terminal 2. Every line must print `OK` or the expected value.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

# Phase A still intact
grep -q "^## .* Phase A COMPLETE" session_status.md && echo "OK phase A"

# Five chunks in noweb/memory.nw
[ "$(grep -c '^<<' noweb/memory.nw)" -eq 5 ] && echo "OK 5 chunks"

# Tangle produces all expected files
make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1 && \
  test -f include/memory.h && \
  test -f src/memory.cpp && \
  test -f src/rom_loader.cpp && \
  test -f src/berzerk_map.cpp && \
  test -f src/test_memory.cpp && \
  echo "OK tangle"

# Compile clean
g++ -std=c++17 -Wall -Wextra -Iinclude \
  src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp src/test_memory.cpp \
  -o /tmp/test_memory_check && echo "OK compile"

# Memory test passes
make test-memory 2>&1 | grep -q "ALL MEMORY TESTS PASS" && echo "OK memtest"

# CRC32 reflected polynomial present
grep -q "0xEDB88320" noweb/memory.nw && echo "OK crc poly"

# Phase B COMPLETE marker
grep -q "^## .* Phase B COMPLETE" session_status.md && echo "OK marker"
```

All seven `OK`s → Phase B is done. Open `phases/phase_c.md` and start there.

---

## Known gotchas / quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `ROM not found` at runtime | Wrong project_root passed to `load_berzerk_roms` | `make test-memory` recipe should run with `.` as argv[1] from the project root. |
| `ROM CRC mismatch: berzerk_rc31_1c expected ca566dbc got <other>` | Wrong ROM revision or one of B.2's hex literals typo'd | Verify ROM file against `cdoc/architecture.md`. Re-CRC the file with python3 zlib.crc32. |
| Mirror test fails ($0800 ≠ $0C00 read) | Missing `& 0x03FF` mask on work-RAM lambda | Add the mask. The mirror is hardware-level — every 0x0400 bytes wraps. |
| Magic RAM read returns 0 instead of VRAM byte | Magic RAM read handler doesn't passthrough to VRAM | Phase B stub is `vram[a - 0x6000]`, not VRAM at `a - 0x2000`. Check the offset. (Phase D wires the real ALU; the stub is just a passthrough for Phase B's smoke test.) |
| Unmapped read returns 0x00 | `AddressSpace::read8` falls through without returning 0xFF | Fix the loop to `return 0xFF` after the for-loop. The Z80 floating bus is 0xFF, not 0x00. |
| `g++` errors on lambda capture | Vector reallocates after lambda captures pointer | Resize `work_ram`/`vram`/`color_ram` BEFORE creating lambdas. The reference build does this; ours should too. |
| ROM6 ($3800-$3FFF) installed and returns 0x00 | Installed a handler that defaults to 0 | Don't install a handler at all. Unmapped → 0xFF by AddressSpace default. |
| Color RAM reads 0xFF instead of stored value | Color RAM handler not installed correctly | Check the install_read range is $8000-$87FF and the offset is `a - 0x8000`. |

## Reference pointers (rule R4 — agent must ask before reading)

- `$REFERENCE_REPO/cdoc/architecture.md` — full memory map, I/O port map, ROM CRCs (lines ~118-138 for ROM table).
- `$REFERENCE_REPO/cdoc/implemented_so_far.md` Phase 2 section — describes the reference build's AddressSpace, ROM loader, memory map design.
- `$REFERENCE_REPO/noweb/memory.nw` — the reference noweb implementation. Don't copy without asking (R4); use as reference if Gemma gets stuck on a specific chunk.
- MAME upstream: `src/mame/stern/berzerk.cpp` (online at https://github.com/mamedev/mame). The `berzerk_map` function there is the source of truth for the memory map.
