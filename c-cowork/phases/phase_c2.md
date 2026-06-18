# Phase C2 — Z80 16-bit loads + PUSH/POP

## TL;DR

15 opcodes covering every Z80 16-bit load and stack-transfer instruction (excluding ED-prefix and DD/FD-prefix variants — those land in C7 and C8). Reuses the SingleStepTests harness from C1; only `step()`'s switch grows. Gate: 100% pass across all 15 opcodes (~15k tests). Four subtasks.

| Group | Opcodes | Count |
|---|---|---|
| `LD rr, nn` | 0x01 (BC), 0x11 (DE), 0x21 (HL), 0x31 (SP) | 4 |
| `LD HL, (nn)` / `LD (nn), HL` | 0x2A, 0x22 | 2 |
| `LD SP, HL` | 0xF9 | 1 |
| `PUSH rr` | 0xC5 (BC), 0xD5 (DE), 0xE5 (HL), 0xF5 (AF) | 4 |
| `POP rr` | 0xC1 (BC), 0xD1 (DE), 0xE1 (HL), 0xF1 (AF) | 4 |

---

## How to use this file

Same two-terminal pattern. **Recommend a fresh OpenCode session for C2** — C1 likely accumulated several auto-compactions across its 6 subtasks. M1 on fresh context re-anchors from `session_status.md`.

---

## Before you start — entry criteria

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

grep -q "^## .* Phase C1 COMPLETE" session_status.md && echo "OK phase C1"
test -f noweb/z80.nw && [ "$(grep -c '^<<' noweb/z80.nw)" -eq 4 ] && echo "OK z80.nw (4 chunks)"
test -f third_party/json.hpp && echo "OK json.hpp"
ls third_party/SingleStepTests/z80/v1/01.json > /dev/null && echo "OK 01.json (LD BC,nn) present"
ls third_party/SingleStepTests/z80/v1/c5.json > /dev/null && echo "OK c5.json (PUSH BC) present"  # filenames are lowercase
make test-z80-c1 2>&1 | grep -q "ALL C1 OPCODE TESTS PASS" && echo "OK C1 still green"
```

If the last line fails, C1 regressed — fix that before extending `step()`.

---

## Session start (Terminal 1)

```text
Begin. Execute the three M1 startup reads (goals.md, MILESTONES.md, tail -n 30 session_status.md). Report back with:
  (a) the last entry in session_status.md (or "missing/empty"),
  (b) which phase you believe is active,
  (c) "ready" — and STOP. Do not propose a plan. I will paste the next subtask.
```

Expected: `Phase C1 COMPLETE` is the last entry. Phase C2 active. Ready.

---

## Subtasks

---

### C2.1 — Implement the LD-style 16-bit opcodes (7 opcodes)

**Why:** these are the straightforward 16-bit loads. `LD rr,nn` covers all four register pairs. `LD HL,(nn)` and `LD (nn),HL` are memory ↔ HL with **WZ-modifying** semantics — WZ gets set to `nn+1` (per MAME Z80 docs and the reference build's notes). `LD SP,HL` is a one-liner with no flag or WZ change.

**Paste this to Gemma:**

````text
Phase C2.1 — Implement 7 LD-style 16-bit opcodes.

Add these cases to step()'s switch in noweb/z80.nw. Write the whole noweb/z80.nw with the new cases inserted alphabetically by opcode hex value (so they intermix with existing 8-bit-load cases — that's fine).

All cases use `break` (NOT `return`) and set `instr_cycles`. None touch flags. All end with `p = 0; q = 0;` since none write F.

  case 0x01: bc.w = read_pc_word(); instr_cycles = 10; p = 0; q = 0; break; // LD BC,nn
  case 0x11: de.w = read_pc_word(); instr_cycles = 10; p = 0; q = 0; break; // LD DE,nn
  case 0x21: hl.w = read_pc_word(); instr_cycles = 10; p = 0; q = 0; break; // LD HL,nn
  case 0x31: sp.w = read_pc_word(); instr_cycles = 10; p = 0; q = 0; break; // LD SP,nn

  case 0x2A: { // LD HL,(nn)
      uint16_t addr = read_pc_word();
      hl.l = mem->read8(addr);
      hl.h = mem->read8(addr + 1);
      wz.w = addr + 1;
      instr_cycles = 16; p = 0; q = 0; break;
  }
  case 0x22: { // LD (nn),HL
      uint16_t addr = read_pc_word();
      mem->write8(addr,     hl.l);
      mem->write8(addr + 1, hl.h);
      wz.w = addr + 1;
      instr_cycles = 16; p = 0; q = 0; break;
  }

  case 0xF9: sp.w = hl.w; instr_cycles = 6; p = 0; q = 0; break; // LD SP,HL

Read noweb/z80.nw, then Write the whole file with these 7 cases added. Two-strike rule on Edits.

Build + spot-check each opcode:
  make clean && make tangle
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_singlestep_test.cpp \
    -o /tmp/test_z80_ss
  for op in 01 11 21 31 22 2a f9; do   # filenames are lowercase hex
    /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
  done

Each line should report "1000 pass, 0 fail" (or near).

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C2.1 done — pass — 7 16-bit LD opcodes
  EOF

Then STOP.
````

**What Gemma should report:** all 7 opcodes pass 1000/1000.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1
g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
  src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
  src/z80.cpp src/z80_singlestep_test.cpp \
  -o /tmp/test_z80_ss
for op in 01 11 21 31 22 2a f9; do   # lowercase filenames
  /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
done | grep -c '1000 pass, 0 fail'   # expect 7
```

Expected: `7`.

**If it fails:**

- `wz` mismatch on 0x22 or 0x2A → WZ must be `addr + 1`, where `addr` is the 16-bit operand. If WZ stays at its prior value, the case didn't update it.
- `LD HL,(nn)` reads bytes in wrong order → low byte at `addr`, high byte at `addr+1`. Z80 is little-endian.
- `cycles` field — we don't compare cycles against the JSON's `cycles` array (the harness only diffs register/RAM state). So this can't be the failure source.

---

### C2.2 — Implement PUSH and POP (8 opcodes)

**Why:** stack operations. Push: `SP--; mem[SP]=hi; SP--; mem[SP]=lo`. Pop: `lo=mem[SP]; SP++; hi=mem[SP]; SP++`. `POP AF` is special: low byte goes to F (replacing all 8 flag bits including undocumented Y/X), high byte goes to A. None touch WZ.

**Paste this to Gemma:**

````text
Phase C2.2 — Implement PUSH and POP for all 4 register pairs.

Add these cases to step()'s switch. Each PUSH/POP is a self-contained block. None modify flags or WZ. `p = 0; q = 0;` after each.

PUSH order: high byte first (at SP-1), then low byte (at SP-2). Final SP = SP - 2.
POP  order: low byte first (at SP), then high byte (at SP+1). Final SP = SP + 2.

  case 0xC5: { // PUSH BC
      sp.w--; mem->write8(sp.w, bc.h);
      sp.w--; mem->write8(sp.w, bc.l);
      instr_cycles = 11; p = 0; q = 0; break;
  }
  case 0xD5: { // PUSH DE
      sp.w--; mem->write8(sp.w, de.h);
      sp.w--; mem->write8(sp.w, de.l);
      instr_cycles = 11; p = 0; q = 0; break;
  }
  case 0xE5: { // PUSH HL
      sp.w--; mem->write8(sp.w, hl.h);
      sp.w--; mem->write8(sp.w, hl.l);
      instr_cycles = 11; p = 0; q = 0; break;
  }
  case 0xF5: { // PUSH AF — push A (high) then F (low)
      sp.w--; mem->write8(sp.w, af.h);
      sp.w--; mem->write8(sp.w, flag_byte());
      instr_cycles = 11; p = 0; q = 0; break;
  }

  case 0xC1: { // POP BC
      bc.l = mem->read8(sp.w); sp.w++;
      bc.h = mem->read8(sp.w); sp.w++;
      instr_cycles = 10; p = 0; q = 0; break;
  }
  case 0xD1: { // POP DE
      de.l = mem->read8(sp.w); sp.w++;
      de.h = mem->read8(sp.w); sp.w++;
      instr_cycles = 10; p = 0; q = 0; break;
  }
  case 0xE1: { // POP HL
      hl.l = mem->read8(sp.w); sp.w++;
      hl.h = mem->read8(sp.w); sp.w++;
      instr_cycles = 10; p = 0; q = 0; break;
  }
  case 0xF1: { // POP AF — pop F (low) into all 8 flag bits, then A (high)
      set_flag_byte(mem->read8(sp.w)); sp.w++;
      af.h = mem->read8(sp.w); sp.w++;
      instr_cycles = 10; p = 0; q = 0; break;
  }

Read noweb/z80.nw, then Write the full file with these 8 cases added.

Build + spot-check each opcode:
  make clean && make tangle
  g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
    src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
    src/z80.cpp src/z80_singlestep_test.cpp \
    -o /tmp/test_z80_ss
  for op in c1 c5 d1 d5 e1 e5 f1 f5; do   # filenames are lowercase
    /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
  done

Each line should report "1000 pass, 0 fail" (or near).

Append log:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C2.2 done — pass — PUSH/POP family (8 opcodes)
  EOF

Then STOP.
````

**What Gemma should report:** all 8 opcodes pass 1000/1000.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1 && make tangle > /dev/null 2>&1
g++ -std=c++17 -Wall -Wextra -Iinclude -Ithird_party \
  src/memory.cpp src/rom_loader.cpp src/berzerk_map.cpp \
  src/z80.cpp src/z80_singlestep_test.cpp \
  -o /tmp/test_z80_ss
for op in c1 c5 d1 d5 e1 e5 f1 f5; do   # lowercase
  /tmp/test_z80_ss third_party/SingleStepTests/z80/v1/$op.json | tail -1
done | grep -c '1000 pass, 0 fail'   # expect 8
```

Expected: `8`.

**If it fails:**

- `pop af` fails on `f` field — `set_flag_byte` must decompose ALL 8 bits including Y (0x20) and X (0x08). If those got dropped, the F round-trip from C0 already catches it.
- All POPs fail with `sp` mismatch → SP increment timing. POP reads `mem[SP]` THEN increments. If you increment first, addresses are off by one.
- All PUSHes fail with `sp` mismatch → PUSH decrements THEN writes. Same logic reversed.
- `pop af` fails on `a` field but `f` is right → byte order. F is at the lower address (where SP points after pop), A is at SP+1.
- PUSH AF stores the wrong F value → `flag_byte()` not called fresh. Call `flag_byte()` inside the `mem->write8` argument so it composes the current flag state.

---

### C2.3 — Wire `make test-z80-c2` and run the full C2 opcode subset

**Why:** the gate. 15 opcodes × ~1000 tests ≈ 15k cases. 100% required.

**Paste this to Gemma:**

````text
Phase C2.3 — Wire make test-z80-c2, run the full C2 opcode subset.

Step 1. Write scripts/run-z80-c2-tests.sh. Same shape as the C1 script but with C2's opcode list:
  cat > scripts/run-z80-c2-tests.sh <<'SH_EOF'
  #!/usr/bin/env bash
  set -euo pipefail
  RUNNER=${1:-build/test_z80_ss}
  CORPUS=${2:-third_party/SingleStepTests/z80/v1}

  # SingleStepTests/z80 v1/ filenames are LOWERCASE hex.
  C2_OPS=(
    01 11 21 31           # LD rr,nn
    22 2a                  # LD (nn),HL / LD HL,(nn)
    f9                     # LD SP,HL
    c5 d5 e5 f5            # PUSH rr
    c1 d1 e1 f1            # POP rr
  )

  total_pass=0; total_fail=0; fail_ops=()
  for op in "${C2_OPS[@]}"; do
    # Hard-fail on missing test file (catches case-sensitivity / typo errors).
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
  echo "ALL C2 OPCODE TESTS PASS"
  SH_EOF
  chmod +x scripts/run-z80-c2-tests.sh

Step 2. Add a Makefile target test-z80-c2. Write the whole Makefile (preserving all existing targets) with the new target inserted ABOVE test-z80 and BELOW test-z80-c1:
  test-z80-c2: tangle
  	@mkdir -p $(BUILD)
  	g++ -std=c++17 -Wall -Wextra -I$(INC_DIR) -Ithird_party \
  	  $(SRC_DIR)/memory.cpp $(SRC_DIR)/rom_loader.cpp \
  	  $(SRC_DIR)/berzerk_map.cpp $(SRC_DIR)/z80.cpp \
  	  $(SRC_DIR)/z80_singlestep_test.cpp \
  	  -o $(BUILD)/test_z80_ss
  	bash scripts/run-z80-c2-tests.sh $(BUILD)/test_z80_ss third_party/SingleStepTests/z80/v1

Step 3. Run it:
  make clean
  make test-z80-c2

Report the LAST 10 lines. Expected final line: "ALL C2 OPCODE TESTS PASS".

Also run C1 again to confirm no regression:
  make test-z80-c1 2>&1 | tail -3

Append log only on success of BOTH:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C2.3 done — pass — full C2 opcode subset 100%; C1 no regression
  EOF

If anything fails, append a BLOCKER instead:
  cat >> session_status.md <<EOF
  ## $(date +'%Y-%m-%d %H:%M') — C2.3 BLOCKER — failing opcodes: <list>
  EOF

Then STOP.
````

**What Gemma should report:**

- `Total: ~15000 pass, 0 fail` and `ALL C2 OPCODE TESTS PASS`.
- C1 still ends with `ALL C1 OPCODE TESTS PASS`.

**Independent verify (Terminal 2):**

```bash
make clean > /dev/null 2>&1
make test-z80-c2 2>&1 | tee /tmp/c2.log | tail -3
grep -q "ALL C2 OPCODE TESTS PASS" /tmp/c2.log && echo "OK c2"
make test-z80-c1 2>&1 | tail -1 | grep -q "ALL C1 OPCODE TESTS PASS" && echo "OK c1 no regression"
```

Expected: `OK c2`, `OK c1 no regression`.

**If it fails:**

- A specific opcode failing across all 1000 cases → look at the per-opcode error message; usually a typo in the case body. Inspect `src/z80.cpp` for that opcode.
- C1 regressed → Gemma's C2 Write overwrote part of the C1 work. Re-Write `noweb/z80.nw` with both C1 and C2 cases preserved. Use Read to confirm structure first.

---

### C2.4 — Mark Phase C2 complete

**Paste this to Gemma:**

````text
Phase C2.4 — Mark Phase C2 complete.

Step 1. Confirm C2.1-C2.3 are logged:
  grep -E "^## .* — C2\.[1-3] done" session_status.md | wc -l
The output must be at least 3.

Step 2. Append:
  cat >> session_status.md <<EOF

  ## $(date +'%Y-%m-%d %H:%M') — Phase C2 COMPLETE — Z80 16-bit loads + PUSH/POP
  RESULT: pass
  TOUCHED: noweb/z80.nw (step() extended), Makefile (test-z80-c2 target),
           scripts/run-z80-c2-tests.sh, src/z80.cpp (regenerable)
  NOTES: 15 opcodes implemented: LD rr,nn (0x01,0x11,0x21,0x31), LD HL,(nn)
         (0x2A), LD (nn),HL (0x22), LD SP,HL (0xF9), PUSH rr (0xC5,0xD5,0xE5,
         0xF5), POP rr (0xC1,0xD1,0xE1,0xF1). All ~15000 SingleStepTests
         cases pass 100%. C1 (~63k tests) still green (no regression).
         Ready for Phase C3 (ALU: ADD/ADC/SUB/SBC/AND/OR/XOR/CP).
  EOF

Step 3. Verify:
  grep -q "^## .* Phase C2 COMPLETE" session_status.md && echo OK

Report Step 1's count, Step 3's OK, then STOP.
````

---

## Exit criterion (whole sub-phase)

**Run only AFTER C2.3 has landed** — `test-z80-c2` is created by C2.3.

```bash
cd /home/user/sudnya/checkout/orbits/games/arcade/berzerk

grep -q "^## .* Phase C1 COMPLETE" session_status.md && echo "OK phase C1"
grep -q "^## .* Phase C2 COMPLETE" session_status.md && echo "OK marker"

# C2 passes
make clean > /dev/null 2>&1 && make test-z80-c2 2>&1 | grep -q "ALL C2 OPCODE TESTS PASS" && echo "OK c2 opcodes"

# C1 didn't regress
make test-z80-c1 2>&1 | grep -q "ALL C1 OPCODE TESTS PASS" && echo "OK c1 no regression"

# State test still passes
make test-z80-state 2>&1 | grep -q "ALL Z80 STATE TESTS PASS" && echo "OK c0 no regression"
```

All five `OK`s → Phase C2 done.

---

## Known gotchas / quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `LD HL,(nn)` returns wrong HL | Wrong byte order on read | Low byte from `mem[addr]`, high byte from `mem[addr+1]`. |
| `LD HL,(nn)` `wz` mismatch | WZ not updated | WZ = addr + 1. Same for `LD (nn),HL`. |
| `PUSH rr` all fail with `sp` wrong by 1 or 2 | Pre-decrement vs post-decrement order | Pre-decrement: `--sp; mem[sp] = hi; --sp; mem[sp] = lo`. Two decrements, two writes. |
| `POP rr` all fail with `sp` wrong | Pre/post-increment order | Read at SP, then increment. Read at SP, then increment. (Two reads, two increments.) |
| `PUSH AF` stores wrong F value | Used cached F instead of fresh compose | Call `flag_byte()` inside `write8(...)` — never cache. |
| `POP AF` doesn't restore Y/X flags | `set_flag_byte` not handling all 8 bits | All 8 flag fields (s/z/y/h/x/pv/n/c) get set from the popped byte. C0's round-trip test should already have caught this. |
| `POP AF` `f` correct but `q` wrong | We're setting q=0 after POP AF; if test expects something else, p/q semantics differ for stack ops | Inspect the failing test; rarely an issue. |
| C1 regressed after C2 Write | Gemma's Write dropped some C1 cases | Re-Read `noweb/z80.nw` after C2 Write, confirm all 0x40-0x7F cases plus 0x06-0x3E cases plus 0x0A/0x1A/0x3A/0x02/0x12/0x32 are still there. |
| `LD SP,nn` ends up at wrong value | `read_pc_word` reverses bytes | Little-endian: low byte first, then high. |

## Reference pointers (rule R4 — agent must ask before reading)

- `$REFERENCE_REPO/noweb/memory.nw` — reference Z80 has identical PUSH/POP byte-order semantics; cross-check if a test fails.
- MAME upstream: `src/devices/cpu/z80/z80.cpp` — authoritative WZ behavior for `LD (nn),HL` / `LD HL,(nn)`.
