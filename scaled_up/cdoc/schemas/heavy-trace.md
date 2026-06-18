# Heavyweight trace schema — Phase 4 (FROZEN)

Status: FROZEN (2026-06-17, Sudnya sign-off after reviewing the T4.2 MAME
routine-level fidelity spot-check). Matches the real records emitted by
`machine/tools/heavy_trace_capture.js`; exercised by
`machine/tests/heavy-trace.test.js` (determinism + read-set order) and
`machine/tests/jr-displacement.test.js` (consumption note #6). The T4.2
spot-check confirmed routine-level I/O fidelity vs MAME (see decisions.md
2026-06-17 T4.2 entry): 3 of 4 routines byte-exact on read_set/regs_out/
write_set, the 4th (0x1ce7) outputs-exact with the explained note-#6 fetch
artifact. Changing this schema now requires a new decisions.md entry + human
sign-off (per scaled_up/CLAUDE.md).

One JSON-L record per invocation. Field order as emitted:

```jsonl
{"entryPC":1289,"callerPC":1303,"is_isr":true,
 "regs_in":{"a":171,"f":168,"b":254,"c":0,"d":130,"e":71,"h":96,"l":0,
            "ix":5634,"iy":0,"sp":17405,"i":7,"r":68,
            "a_p":0,"f_p":0,"b_p":0,"c_p":0,"d_p":0,"e_p":0,"h_p":0,"l_p":0},
 "read_set":[{"addr":1289,"val":49,"type":"mem"}, ...],
 "regs_out":{...same key set as regs_in...},
 "write_set":[{"addr":...,"val":...,"type":"mem"|"io"}, ...],
 "cycle_count":29}
```

## Fields

| Field | Type | Meaning |
|-------|------|---------|
| `entryPC` | int (PC) | First PC executed in the invocation (CALL/RST target, or the interrupt handler entry for an ISR). |
| `callerPC` | int (PC) | PC of the CALL/RST that opened the invocation. For an ISR this is the PC that was interrupted (the return address pushed by the interrupt). |
| `is_isr` | bool | True iff the invocation was opened by an interrupt delivery (NMI/IRQ), not a CALL/RST. |
| `regs_in` | object | Register snapshot taken at the boundary BEFORE the first instruction of the invocation runs. Keys (all integers): `a,f,b,c,d,e,h,l,ix,iy,sp,i,r` and the shadow set `a_p,f_p,b_p,c_p,d_p,e_p,h_p,l_p`. `f`/`f_p` are composed from the core's flag struct as `S<<7|Z<<6|Y<<5|H<<4|X<<3|P<<2|N<<1|C`. |
| `read_set` | array | ORDERED `{addr,val,type}` for every memory/IO read the invocation performs, in execution order. `type` is `"mem"` or `"io"`. Repeated/live-port reads are preserved (NOT deduped): e.g. polling port 0x65 yields one entry per read. |
| `regs_out` | object | Register snapshot at the boundary AFTER the invocation returns (same key set as `regs_in`). |
| `write_set` | array | ORDERED `{addr,val,type}` for every memory/IO write the invocation performs. |
| `cycle_count` | int | Sum of per-instruction Z80 cycles executed while this invocation (and its callees) were on the stack. INFORMATIONAL ONLY — porting uses explicit waits, not cycle-matching. Excludes interrupt-acknowledge overhead. |

## Fidelity rules (decided here)

1. **Entropy reads are inputs, never recomputed.** Reads of port 0x4E
   (beam/V256) and of the interrupt-phase counter 0x089F appear in `read_set`
   with their observed values. A port consumer replays these captured values; it
   does not recompute them. (Confirmed present in capture: the IM2 dispatcher
   `entryPC=0x26ab` reads port 0x4E/0x49; the early self-test ISR `entryPC=0x0509`
   reads port 0x4E.)
2. **Cycle counts are informational** (see `cycle_count` above).
3. **Interrupt handling — ISR is its own invocation (decided/frozen rule).**
   An interrupt delivery (NMI or maskable IRQ) opens a NEW invocation with
   `is_isr:true`, `callerPC` = the interrupted PC, `entryPC` = the handler entry.
   It is NOT merged into the invocation it interrupts; the interrupted
   invocation's `read_set`/`write_set` contain only its own accesses, and the
   ISR's accesses belong to the ISR record. Observed ISR entry vectors in the
   attract capture: `0x0066` (NMI), `0x26ab` (IM2 IRQ dispatcher), `0x0509`
   (early POST frame-IRQ self-test handler).

## Invocation pairing (how entry/exit are detected)

- **Entry:** a CALL nn / CALL cc,nn / RST that actually pushed (opcode in the
  CALL/RST set AND SP decreased by 2 at the next instruction boundary). Untaken
  conditional CALLs do not open an invocation.
- **Exit:** by SP depth, not by decoding RET. An invocation closes when SP rises
  above the SP it had at entry. This uniformly covers RET, RET cc (taken), RETI,
  and RETN.

### Known limitation: stack-discipline-defeating routines

Routines that deliberately break CALL/RET nesting are captured best-effort and
are NOT guaranteed to nest correctly:

- **`pop`-the-return-then-`jp` dispatchers** (e.g. MAN_INIT 0x1FD4 `pop iy`,
  LTABLE 0x1AED `pop hl; ... jp (hl)`): popping the return address raises SP
  above entry, so the invocation closes there and the dispatched target is
  recorded as a sibling, not a child.
- **CREATE_JOB (0x1E22) coroutine stack-swaps:** swapping SP between coroutine
  stacks moves SP arbitrarily, so SP-depth pairing may close or mis-pair frames
  across the swap. These coroutine bodies surface as a single oversized
  invocation (observed: `entryPC=0x188b` accumulating >170k reads incl. a
  ~7k-iteration port-0x65 poll) rather than clean per-call records.

These are acceptable for Phase-9 bottom-up porting (leaf/arithmetic routines such
as RANDOM 0x2678 use ordinary CALL/RET and trace cleanly); the coroutine
scaffolding is flagged for explicit handling when those routines are ported.

## Consumption notes for T7/T8 (known characteristics — read before freeze)

These are deliberate properties of the capture, not bugs. The test-plan
generator (T7) and bench (T8) MUST account for them. Numbered to match the
2026-06-17 review.

1. **`read_set` includes instruction-fetch bytes, not just data reads.** The set
   is the core's true memory access sequence, so it contains opcode and operand
   fetches as well as data loads (e.g. the first entries of every record are the
   bytes at `entryPC`). T7 must decide whether to filter code fetches when
   generating per-routine cases (a bench that replays by EXECUTING the routine in
   a mock memory needs them; a bench that replays by scripting reads does not).

2. **Return-address stack push/pop appears as stack noise.** Because a frame is
   opened/closed at the instruction boundary AFTER the CALL/RET executes, a
   caller's `write_set` contains the callee's pushed return address, and a
   routine's `read_set` ends with its own return-address pop (plus any
   PUSH/POP of saved registers, which ARE the routine's own behavior). Harmless
   for replay-by-execution; T7 should strip the return-address stack op for
   replay-by-scripted-reads.

3. **Magic-RAM writes record the CPU-written byte, not the post-ALU stored
   byte.** Writes through the 0x6000-0x7FFF magic window are captured as the value
   the CPU wrote (`type:"mem"`). The byte actually stored in VRAM is the 74181
   ALU result (T2.5), which differs. A bench replaying a magic-window routine
   needs the T2.5 magicram model to reproduce the resulting VRAM; the raw
   `write_set` value alone will not match a plain memory image.

4. **Nested sub-calls are not position-marked in the parent record.** Each
   routine's own `read_set`/`write_set` correctly EXCLUDE its callees' interior
   accesses (the callee is a separate record), but the parent record does not mark
   WHERE in its access stream a sub-call occurred. The call graph is
   reconstructable across records via `callerPC`, but intra-routine call ordering
   is not. Leaf-first porting (T9) sidesteps this; T7/T8 must be designed around
   it (don't assume a routine's effect is self-contained if it calls out).

5. **Stack-discipline-defeating routines** (coroutine/dispatch: CREATE_JOB,
   MAN_INIT, LTABLE) trace unreliably — see "Known limitation" above. The MAME
   fidelity spot-check and early porting must use ordinary-CALL/RET leaf routines.

6. **`read_set` omits the displacement-operand fetch of a NOT-TAKEN conditional
   relative branch** (`JR cc,e` and `DJNZ e` when the branch falls through). The
   vendored DrGoldfire core's `do_conditional_relative_jump`
   (`machine/src/cpu/z80_core.js`) issues `core.mem_read(pc+1)` for the
   displacement ONLY when the branch is taken; when not taken it advances PC
   without a memory-read callback, so that operand fetch never enters `read_set`.
   This is the core's TRUE access sequence, but it differs from real Z80/MAME,
   which always fetch the displacement byte. Discovered by the T4.2 spot-check:
   routine 0x1ce7 matched MAME exactly on `regs_out` and `write_set`, and its
   `read_set` differed ONLY by these missing not-taken displacement bytes (e.g.
   the not-taken `jr c,$1cf6` at 0x1cec: MAME has `mem[0x1ced]=0x08`, JS does
   not). The byte is unused when the branch is not taken, so it cannot affect
   computed state — which is why outputs still matched. CONSEQUENCE for T7/T8:
   any cross-platform `read_set` comparison MUST be **data-only** (strip
   instruction fetches) or otherwise account for this; a fetch-inclusive
   `read_set` diff against a hardware/MAME trace will show spurious mismatches at
   every not-taken `JR cc`/`DJNZ`. The only behavioral failure this artifact
   could mask — JS and MAME taking *different* branches — is caught by the
   `regs_out`/`write_set` comparison, not by `read_set`. Pinned by
   `machine/tests/jr-displacement.test.js`.
