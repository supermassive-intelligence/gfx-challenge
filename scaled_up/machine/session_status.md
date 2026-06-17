
## 2026-06-16: Cosim sync-point experiment at 0x26D9 (BOTTOM_OF_SCREEN_INTERRUPT)
- Adopted Sudnya's sync-point method: cold reset, no input, compare full Z80
  register state at the Nth entry to PC=0x26D9 (the once-per-frame end-of-frame
  IRQ handler), replacing the unsynchronized 0x039C check.
- Built the infrastructure:
    * scheduler.js: added an optional `onStep` hook (fires before each cpu.step,
      so a tool sees the PC about to execute, incl. a just-serviced IRQ entry).
      npm test still 70/70.
    * tools/cosim_capture_js.js: JS-side capture of af/bc/de/hl/ix/iy/sp + shadow
      set + i/r + the foreground return word at (SP), at every 0x26D9 hit.
    * tools/mame/sync_capture.lua + tools/mame/run_sync.sh: MAME-side capture via
      a read-tap on program 0x26D9 (debugger-free, matches the speechlog tap
      pattern; MAME 0.288 local). Same JSONL schema as the JS side.
    * tools/cosim_diff.js: aligns the steady once-per-frame run and reports the
      first real divergence (R and undocumented X/Y flag bits flagged noisy).
- Result (1200 frames, 625 hits each):
    * Gross timing matches: first steady hit at JS frame 573 / MAME frame 574;
      POST takes ~573 frames on BOTH (the earlier "~240" was a VRAM-hash-change
      observation, not POST completion).
    * 0x26D9 is DUAL-ENTRY: also reached via `jr c,$26d9` -- MAME logged one
      stray hit at frame 34. The diff aligns on the steady run to compensate.
    * Register state diverges from the very first steady sync point (bc/hl off by
      2) and amplifies; foreground interrupt point matches on only 66/624 hits.
- INTERPRETATION (see decisions.md 2026-06-16): the divergence is dominated by
  cycle-timing PHASE DRIFT, not a data-computation bug. The IRQ fires at a fixed
  scanline, so the captured registers are a free-running foreground sampled at a
  timing-dependent position. A tiny per-instruction T-state / IRQ-delivery
  difference between DrGoldfire's Z80 and MAME accumulates over POST into a
  ~2-iteration skew, then amplifies. The method is a good DRIFT DETECTOR but not
  a clean architectural-equivalence gate until cycle-timing parity exists or the
  comparison point is made timing-robust.
- OPEN / next decision (for Sudnya): pursue cycle-timing parity (per-instruction
  T-states + IRQ delivery), OR switch to a timing-robust equivalence method
  (instruction-count-indexed, or compare at a provably-at-rest foreground PC).

## 2026-06-16: T3.4 golden-frame gate -- attract exact-match breaks at frame 242
- Per Sudnya: zero-tolerance exact VRAM+colorRAM match, frame-0 aligned, trace
  any divergence (no tolerance). Equivalence gate = golden frames (the co-sim
  0x26D9 register check is only a non-blocking drift detector).
- Generated both per-frame hash streams for attract-only.jsonl (3085 frames,
  cold boot, no input): JS via tools/replay_hash.js, MAME via tools/mame/replay.lua.
- Frame-0 alignment: first fully-drawn (non-blank) frame is 173 on BOTH sides ->
  alignment offset is 0. The co-sim's ~1-frame IRQ offset does not propagate to
  the VRAM stream, so the existing same-index diff_hashes.js is the right gate.
- Result: matches frame-for-frame through 241, then DIVERGES at frame 242 by
  exactly ONE BYTE -- VRAM 0x5DE3, JS=0x00 vs MAME=0xFF -- re-agreeing at 243.
  Byte trace of 0x5DE3 (frames 238-246): both 0xFF at 239-241; JS clears to 0x00
  at frame 242, MAME clears at frame 243. One-frame phase shift on an erase-write.
- Root cause: accumulated core cycle-timing drift (same effect the 0x26D9 co-sim
  measured: JS reaches first steady IRQ at frame 573 vs MAME 574, i.e. JS runs
  slightly ahead). Confirmed NOT a capture-convention artifact. Over the full run
  only 569/3085 frames match; after 242 the attract demo desyncs broadly.
- Per the T3.4 escalation rule, this triggers the deferred cycle-timing-parity
  work. T3.4 NOT met; awaiting Sudnya's go/no-go on opening the timing effort.
- New tools: tools/dump_frame_js.js, tools/mame/dump_frame.lua, tools/mame/trace_byte.lua.

## 2026-06-16 — T5.1 confirm gameplay entropy source (awaiting-human)

- Goal: confirm frame-242 JS-vs-MAME divergence is a timing-sensitive
  deterministic entropy read (RNG), not a data/machine bug.
- Method: grepped frozen decode oracle (disassembler/oracle/decode_oracle.jsonl).
  Note: oracle stores bytes in DECIMAL, so the task's literal `ED 5F|DB 4E` grep
  matches nothing; used decimal equivalents [237,95] / [219,78].
- Findings:
  * `ld a,r` (ED 5F): 0 occurrences. R-register RNG hypothesis ELIMINATED.
  * `in a,($4e)` (DB 4E): 10 occurrences. Load-bearing site 0x26B4 = IRQ
    dispatcher reading V256 to branch; mid-screen path bumps a 2-byte
    interrupt-phase counter at 0x089F/0x08A0 (mixes port 0x49).
  * RNG = LCG RANDOM @0x2678 (seed@0x435C, seed=7*seed+0x3153). COLLISION_
    DETECTION @0x15CF clears 0x089F and rewrites seed 0x435C, then calls RANDOM.
    So interrupt timing -> seed -> robot/shot placement + speech.
  * MAN_INIT/CREATE_JOB/LTABLE (named in task) are job/dispatch scaffolding;
    none calls RANDOM directly. Reported as found, not forced.
- Conclusion: source = port 0x4E (V256/beam), not R. Same root cause as the
  T3.4 timing drift. Does NOT by itself prove the specific 0x5DE3 byte goes via
  RNG vs a direct IRQ-timing draw artifact -- that's the HUMAN-GATE.
- Artifacts: cdoc/entropy-berzerk.md (stub), decisions.md (2026-06-16 entry),
  T5.1 Result filled, STATUS.md updated. T5.1 -> awaiting-human.
- Did NOT touch: T3.4 (stays in-progress), T4.1/downstream, no timing/T-state
  work, no git. Per instructions.
