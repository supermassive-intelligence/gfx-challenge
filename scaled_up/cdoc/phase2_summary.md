# Phase 2 Summary — JS Machine (Berzerk), boot-to-playable

Companion: `phase1_summary.md`. Plan: `cdoc/z80-port-plan.md` (Phase 2).
Decisions: `cdoc/decisions.md`. Tracker: `tasks/STATUS.md`.

**Milestone:** a from-scratch, test-driven JS emulation of the full Berzerk
arcade machine, assembled around a borrowed Z80 core, that boots the real RC31
ROM through its power-on self-test into attract/game code and is playable in the
browser. Phase 2's exit ability per the plan: *"play Berzerk in the browser under
full emulation -- necessary but not sufficient; fidelity is unproven until
Phase 3."*

**Status at write time:** all Phase-2 code complete; `npm test` 54/54 green.
T2.3-T2.7 verified by Sudnya and flipped to done; T2.9 verified via browser play.
T2.8 (sound decoder) code complete, audio capture split to the deferred
non-blocking T2.8b.

## 1. Working method (the loop and the rules)

Work proceeded one task at a time from `tasks/STATUS.md`, each ending at
`awaiting-human` for Sudnya to verify and flip. A set of standing rules accreted
from real incidents and shaped everything below:

1. **`cdoc/hardware-berzerk.md` is the authoritative spec.** Tests cite its
   section numbers.
2. **Verify, don't assume.** Where the spec doesn't pin a behavior (fill values,
   flag semantics, reset states, timing), stop and get ground truth (MAME debugger
   one-liner, or the driver source pasted in) rather than guess.
3. **Every decision/deviation -> `cdoc/decisions.md`.** `tasks/STATUS.md` is the
   only tracker.
4. **Paste real verification output** into each task's Result -- summaries count
   as unverified.
5. **End at `awaiting-human`; never run git.** Only the human flips a task to done.

These weren't bureaucracy -- each traces to a near-miss (see Roadblocks).

## 2. Steps implemented (T2.1 -> T2.9)

- **T2.1 -- Scaffold.** `machine/` with vanilla ES modules, Node >= 20 built-in
  `node:test`, no bundler/build step. Smoke test + runner.
- **T2.2 -- Hardware contract.** Extracted Berzerk's CPU-visible contract from the
  MAME driver into `cdoc/hardware-berzerk.md` (memory map, I/O ports, video,
  interrupts, sound interface). MAME is read as documentation, never patched -- it
  stays a black-box oracle.
- **T2.3 -- Z80 core.** Vendored **DrGoldfire/Z80.js** (MIT, commit `2207d7c`)
  behind a thin callback adapter; built two gates: `tools/run_sst.js`
  (SingleStepTests, **1.6M per-opcode cases**) and `tools/run_zex.js` (CP/M shim
  for zexdoc/zexall). Found and patched a real core bug; tolerated the rest with
  bit-precise rules. (Details in Roadblocks/Decisions.)
- **T2.4 -- Memory.** `memory.js`: canonical address `MAP` (single source of
  truth), read/write with mirror-folding, ROM load + ignored writes, two distinct
  "nothing there" fill values, device-handler hooks, and read/write taps (the
  future Phase-4 trace hook, designed in now). Corrected real errors in the
  contract along the way.
- **T2.5 -- Video / Magic RAM.** `video.js`: VRAM, the Magic RAM write pipeline
  (barrel shifter -> flip -> collision -> **74181 ALU** -> inverted store), color
  RAM (4x4 attribute blocks), the collision/intercept flop, and `renderToRGBA`.
- **T2.6 -- Scheduler.** `scheduler.js`: deterministic, cycle-counted (never
  wall-clock) frame loop; **41,920 cycles/frame**; the 2 IRQ + 8 NMI raised at
  their exact resolved scanlines; held-IRQ vs pulse-NMI semantics; readable
  V256/scanline counter.
- **T2.7 -- Input / DIPs.** `input.js`: per-bit-polarity port composition keyed by
  canonical MAME field names; DIPs default to factory settings, configurable;
  `setField` with a typo-guard that throws (load-bearing for cross-platform
  input-script replay in Phase 3).
- **T2.8 -- Sound.** `sound.js`: decodes audio-port writes per spec into named
  events on a pluggable backend (silent/recording default; WebAudio in the shell).
  Samples, not chip emulation. Audio file capture split to the deferred **T2.8b**.
- **T2.9 -- Boot to playable.** `machine.js` composes everything (memory windows
  routed to Video; I/O dispatch per spec); `roms.js` assembles the RC31 set;
  `shell/` is a no-build browser page (canvas blit, 59.64 Hz wall-clock pacing of
  the wall-clock-free scheduler, keyboard -> `setField`, sample-optional audio);
  headless boot test boots the real ROM.

Code footprint: ~4.4k lines of `src/` (3.4k of which is the vendored core), ~865
lines of tests (54 cases), plus the SST/zex gates and two independent
verification harnesses.

## 3. Roadblocks hit

1. **The hand-written-core breach (T2.3).** A prior attempt hand-translated the
   Z80 core; it implemented only ~26/256 base opcodes and crashed immediately
   (`Unknown opcode 0xf9`), while claiming "passes ZEXALL" (that pass belonged to
   the C original, not the port). This is the origin of rules #2 and #4 and the
   decision to **vendor, never hand-write, a CPU core**.
2. **A real bug in the vendored core.** DrGoldfire's `ADD IX/IY,rr` stored the
   result unmasked, leaving a 17-bit index register that corrupted the *next*
   add's carry. Caught by SST (474-530/1000 failing on those opcodes), fixed with
   a one-line `& 0xffff` mask. Berzerk uses `add ix`/`add iy`, so this mattered.
3. **Recurring spec gaps (T2.5, T2.6, T2.7).** Three times the authoritative
   contract named a subsystem but didn't pin its core behavior (the 74181 truth
   table; the vsync-counter->scanline mapping; the exact input bits/polarity/DIP
   defaults). Each time the correct move was to **stop and request the driver
   source**, pin it into the spec with citations, cross-check, then implement --
   not guess.
4. **Two "verify, don't assume" catches that would have been silent bugs.**
   - Unmapped-read fill: assumed `0xFF` everywhere; MAME showed `0x3800 -> 0xFF`
     (unloaded ROM) but `0xC000 -> 0x00` (truly unmapped). Collapsing them would
     diverge from the oracle on any stray high read.
   - NMI timing: the original project's analysis put NMI7 at "~line 256"; the
     verbatim vsync conversion puts it at **line 16**. Trusting the prior analysis
     would have baked in a wrong interrupt position.
5. **The sound capture contradicted the model.** The MAME log showed the "8
   distinct SFX + 1 speech" assumption was wrong -- it was **one** SFX effect fired
   8x (a multi-write burst, so a `port+data` key can't identify it), a **4-word**
   speech phrase, plus continuous ambient tone that sample-triggering can't
   reproduce. This (plus "audio is cosmetic -- golden frames hash video, not
   audio") drove the decision to **defer audio to T2.8b** rather than block Phase 2.

## 4. Decisions and the trade-offs weighed

- **Vendor the Z80 core vs hand-write it.** Hand-writing lost decisively (the
  breach). Borrowing a ZEX-validated core costs an external dependency and a couple
  of tolerated undocumented-flag quirks; it buys correctness we'd never hand-match.
  **Vendored.**
- **Patch the core's `ADD IX` bug vs switch to the WASM fallback.** A one-line,
  in-file-documented mask mirroring existing code, vs a much heavier emscripten/
  WASM path for one bug. **Patched**, with before/after evidence and a
  decisions.md entry.
- **Rule-based SST tolerances vs a blanket opcode allowlist.** Blanket allowlists
  hide future regressions in the same opcodes. **Bit-precise rules** (X/Y flags,
  NONI prefix, block-I/O flags, 16-bit ADC/SBC H) -- each cross-checked against
  actual Berzerk ROM usage so the tolerated deviations are *provably* irrelevant,
  not just assumed.
- **Samples vs S14001A/6840 chip emulation.** At the project's fidelity bar (feel)
  samples are indistinguishable, and the golden-frame gate hashes video, not
  audio. **Samples**, with chip emulation a later opt-in if feel fails.
- **Address-keyed sound events + a manifest vs a vocabulary table in the decoder.**
  Keeping the decoder spec-pure (option a) puts the audition-derived semantic
  mapping in a manifest where the human knowledge lives. **Decoder stays
  address-keyed.**
- **Defer audio (T2.8b) vs block Phase 2 on it.** Audio is cosmetic for the gate.
  **Deferred, non-blocking.**
- **Architecture:** Video owns the single VRAM/color backing store (memory windows
  route to it); the scheduler is strictly wall-clock-free (the shell paces it) so
  Phase 3/4 reproducibility holds.

## 5. What Phase 2 proves -- and what it doesn't

It proves the machine **runs**: the real ROM boots through its own power-on
self-test (including the Magic RAM ALU test that wedged the earlier port at PC
`0x0458`), reaches game code, and draws. It does **not** prove fidelity --
"playable" is necessary, not sufficient. Bit-faithfulness to MAME is the job of
**Phase 3** (golden-frame validation), the trust gate for everything downstream.
Known display approximations to confirm by eye (RGBI pen levels, within-byte pixel
order) and the deferred audio (T2.8b) are explicitly carried forward.
