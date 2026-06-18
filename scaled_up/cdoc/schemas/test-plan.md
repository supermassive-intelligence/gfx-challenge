# Test-plan schema — Phase 7 (FROZEN)

Status: FROZEN (2026-06-18, T7.1). Generated from heavyweight traces
(`heavy-trace.md`) by `machine/tools/generate_test_plan.js`; exercised by
`machine/tests/test-plan.test.js`. Changing this schema now requires a new
`cdoc/decisions.md` entry + human sign-off (per scaled_up/CLAUDE.md).

One JSONL file per trace; one record per KEPT subroutine invocation. A record is
kept only if it **self-validates**: replaying it on a fresh Z80 core against a
mock memory reproduces `regs_out` + `writes` exactly (see "Selection", below).

```jsonl
{"routine":"GET_CREDITS_AS_BCD","entry_pc":"0x18e0",
 "regs_in":{"a":148,"f":68,"b":148,...,"l_p":252},
 "reads":[[addr,val,"mem"|"io"], ...],
 "regs_out":{"a":...,...},
 "writes":[[addr,val,"mem"|"io"], ...],
 "cycles":29,"path_id":"3af1c20b"}
```

## Fields

| Field | Type | Meaning |
|-------|------|---------|
| `routine` | string | Human-readable name (canonical label from `disassembler/oracle/labels.json` if known, else `entry_pc` hex). **Cosmetic** — never used by the bench for validation. |
| `entry_pc` | string | `"0x"`-prefixed hex of the routine's entry PC (the CALL/RST target). |
| `regs_in` | object | Register snapshot at entry, BEFORE the first instruction. Keys (all ints): `a,f,b,c,d,e,h,l,ix,iy,sp,i,r` + shadow set `a_p,f_p,b_p,c_p,d_p,e_p,h_p,l_p`. `f`/`f_p` composed as `S<<7|Z<<6|Y<<5|H<<4|X<<3|P<<2|N<<1|C` (same as heavy-trace.md). |
| `reads` | array | ORDERED `[addr,val,type]`, `type` = `"mem"` or `"io"`. **Data reads only** — reads from ROM (0x0000-0x07FF, 0x1000-0x37FF: code + constant tables) are EXCLUDED (the bench loads the game ROM, which serves them). `io` addrs are the **device port (low byte)**, not the 16-bit bus address. Repeated/live-port reads preserved in order. |
| `regs_out` | object | Register snapshot after the invocation returns (same key set as `regs_in`). Includes the effects of any callees. |
| `writes` | array | ORDERED `[addr,val,type]`. `mem` = the CPU-written byte (for the magic window 0x6000-0x7FFF this is the pre-ALU byte — heavy-trace.md note #3). `io` addr is the device port (low byte). |
| `cycles` | int | Informational only (heavy-trace.md). Bench must not gate on it. |
| `path_id` | string | 8-hex FNV-1a hash of the executed PC sequence (entry→return) observed during the self-check replay. Discriminates distinct control-flow paths; the dedup key within a routine. |

## How the bench replays a record (the hermetic contract)

1. Mock memory = a flat 64 KB array: game ROM at 0x0000-0x37FF, 0x3800-0x3FFF =
   0xFF (empty ROM6 socket), everything else 0x00.
2. Seed each `reads` entry of type `mem` at its first occurrence (initial value);
   `io` entries become a per-port FIFO queue.
3. `setState(regs_in)` (decompose `f`; interrupt-mode fields default — see below),
   set PC = `entry_pc`.
4. Single-step the core. A `mem` read returns the mock byte (the routine's own
   writes update it, so a written-then-read address self-serves). An `io` read
   dispenses the next queued value for that port.
5. Stop when SP rises above the entry SP (the routine returned — covers
   RET/RETcc/RETI/RETN; the return address itself is in `reads` as a stack read).
6. Assert: `regs_out` matches (EXCEPT `r`, see below) and the recorded `writes`
   match in order.

## Selection / validation policy (FROZEN decisions)

- **Self-validating selection.** Every candidate invocation is replayed during
  generation; only those that reproduce `regs_out` + `writes` are emitted. The
  generated plan therefore contains ONLY records proven hermetically replayable.
- **Leaf-first.** The heavy-trace `read_set`/`write_set` of an invocation EXCLUDE
  its callees' accesses (heavy-trace.md note #4), but a standalone replay EXECUTES
  the callees inline. So a record only self-validates when the invocation made no
  effectful sub-calls (a leaf, or a routine that took an early-return path). This
  is the intended Phase-9 bottom-up order: leaves first. Non-leaf invocations fail
  the self-check and are excluded (reported in the generator stats, not emitted).
  Interrupted invocations are likewise excluded (the interrupt's return-address
  push pollutes the write_set — heavy-trace.md note #2).
- **`r` excluded from the regs comparison.** The refresh register is perturbed by
  any interrupt that fired during the captured invocation and is never load-bearing
  in Berzerk (entropy = port 0x4E/V256, not `ld a,r`; T5.1). It is still STORED in
  `regs_in`/`regs_out` for completeness; the bench MUST NOT assert on it.
- **Entropy reads are inputs (heavy-trace.md rule #1).** Port 0x4E (V256) and the
  0x089F counter / 0x435C seed appear in `reads` with their captured values and are
  replayed, never recomputed.
- **Dedup + cap.** Within a routine, keep one record per distinct `path_id`; cap at
  N distinct paths per routine (default N=8, CLI-configurable). The cap is reported.
- **Interrupt-mode state.** `regs_in` omits imode/iff/halted; replay sets imode=2,
  iff=0, halted=false (a routine's arithmetic does not depend on them and no
  interrupts are delivered during hermetic replay).
