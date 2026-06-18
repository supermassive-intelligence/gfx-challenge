- 2026-06-16 — T3.4 DISCRIMINATOR + CHARACTERIZATION (attract divergence is
  demo entropy, NOT a CPU/rendering bug). Per Sudnya's discriminator:
  * MAME determinism: two cold-boot attract runs (3085 frames each) are
    BIT-IDENTICAL (0/3085 frames differ). MAME attract has no true entropy --
    it is fully determined by cold-boot state + CPU execution.
  * Frame-242 first divergence is OFF-SCREEN: 0x5DE3 -> VRAM row 239, but only
    rows 0-223 are visible (video.js: y=offset>>5, 224 visible lines). The
    single differing byte is in non-rendered scratch VRAM (rows 224-255) -- it
    never reaches the screen.
  * Divergence is LOCALIZED to moving-object regions, not global. Sampled
    diverging frames: frame 259 = 1 visible byte (row 53); frame 1285 = 117
    visible-VRAM bytes in ~50 small clusters (1-12 bytes) scattered across
    play-field rows 7-199 + 9 colorRAM bytes; frame 1999 = 104 bytes across
    rows 7-186. Small scattered clusters that GROW over time (1 byte at 242 ->
    ~50 object fragments by 1285) = sprite/AI trajectory divergence amplifying,
    not a uniform/systematic rendering or CPU-wide fault.
  CONCLUSION: boot+self-test+initial render are bit-exact for 242 frames, which
  argues CPU/interrupt timing is VISIBLY harmless through the deterministic
  phase. The break coincides exactly with the attract DEMO starting and is
  confined to moving-object regions -> the demo's RNG/entropy source (sampled at
  a timing-dependent moment; MAME itself is deterministic) diverges between the
  two emulators. This is a determinism/entropy concern, NOT the deferred
  cycle-timing-parity work. Do NOT open cycle-timing parity now.
  RESOLUTION (proposed, pending Sudnya): scope the exact-match golden gate to
  (a) the deterministic window boot->frame 241 for attract, and (b) the scripted
  scenarios (coin-start, maze-transition, player-death) which are input-driven;
  treat free-running attract-demo trajectory matching as a Phase 5
  (determinism/entropy audit) dependency. Also consider hashing only visible
  VRAM rows 0-223 so off-screen scratch (e.g. 0x5DE3) cannot fail a visible-
  output gate. Tools: tools/mame/dump_frames.lua, tools/mame/trace_byte.lua.
  — session; Sudnya to rule.
- 2026-06-16 — T3.4 SCRIPTED SCENARIOS DO NOT EXERCISE GAMEPLAY; two blockers
  found. Ran all 4 committed scenarios (coin-start-first-maze, maze-transition,
  player-death, free-play) through JS-vs-MAME exact match:
  * Every scenario is BYTE-IDENTICAL to no-input attract on BOTH emulators
    (569 match / first diverge frame 242, same off-screen 0x5DE3 boot byte).
  * BLOCKER 1 (scenario scripts mis-timed): the recorded inputs fire during
    boot/POST -- coin-start has COIN1 at frame 49 and START1 at 276, but the
    first VRAM draw is frame 173 and the game is not accepting coins yet, so
    both emulators drop them. The scripts are no-ops; they need re-recording
    with inputs timed after the game accepts them (a T3.1 artifact defect).
  * JS input path WORKS: a coin pulsed at frame 650 (post-boot) makes the JS
    machine leave attract (diverges from attract at frame 651).
  * BLOCKER 2 (MAME input injection non-functional): the SAME coin at 650, and
    even repeated coin pulses across attract (frames 400/600/750), produce ZERO
    change in MAME output vs MAME-attract. replay.lua applies inputs via
    ioport field:set_value inside the frame notifier; this does not reach
    Berzerk's coin logic. T3.2 only ever validated replay.lua on attract-only
    (no inputs), so MAME input injection was never actually exercised.
  CONSEQUENCE: the input-driven golden gate cannot validate gameplay until
  (1) MAME input injection is fixed (likely needs proper coin pulsing through
  MAME's input system / correct hold duration / edge, not a bare frame-notifier
  set_value), and (2) scenarios are re-recorded with post-boot input timing.
  Until then only the deterministic boot->241 window is validated, where
  JS==MAME is bit-exact. — session; Sudnya to rule.
- 2026-06-16 — T3.4 SCOPE CARVE-OUT (the golden gate, defined). The exact-match
  golden-frame gate is the DETERMINISTIC WINDOW, VISIBLE ROWS ONLY:
  * Hash visible VRAM rows 0-223 (0x4000-0x5BFF) + colorRAM (0x8000-0x87FF),
    excluding off-screen scratch rows 224-255 (0x5C00-0x5FFF).
  * Require bit-exact JS-vs-MAME from the first fully-drawn frame (frame 173,
    alignment offset 0) up to the first divergence. Measured first divergence:
    full region = frame 242 (off-screen byte 0x5DE3); visible-only = frame 259.
    So the gated bit-exact visible window is frames 0-258.
  WHY scoped, not "match every frame": the frame-242/259 divergence is
  INPUT-INDEPENDENT timing/RNG drift, not a CPU/rendering bug. MAME's attract is
  itself fully deterministic run-to-run (0/3085 frames differ across two cold
  boots), and the break coincides exactly with the attract DEMO starting and is
  confined to moving-object regions. The demo seeds its motion from a timing-
  dependent entropy source (e.g. the free-running R register / V counter sampled
  by the RNG at 0x2678), which differs between the two cores because we DEFERRED
  cycle-exactness when we vendored the DrGoldfire Z80 (behavioral-fidelity bar,
  not cycle-exact). Bit-exact free-running gameplay is therefore OUT OF SCOPE for
  golden frames. Gameplay correctness is validated BEHAVIORALLY in Phase 5+
  (does it look/play right), not by bit-identical golden frames.
  DEFERRED to Phase 5+ (NOT now):
    (a) Scenario input scripts (coin-start-first-maze, maze-transition,
        player-death, free-play) were recorded before input timing was
        understood and are KNOWN-BAD: their inputs fire during boot/POST
        (coin@49, start@276) and are no-ops on both emulators, so each scenario
        is byte-identical to attract. They must be re-recorded with post-boot
        input timing (after the game accepts coins, ~frame 242+).
    (b) MAME input injection via tools/mame/replay.lua is NON-FUNCTIONAL: bare
        ioport field:set_value in the frame notifier does not reach Berzerk's
        coin logic (repeated coin pulses across attract produce zero change vs
        MAME-attract). It needs a proper coin-pulse fix (correct hold duration /
        edge through MAME's input system). The JS input path itself works (a
        post-boot coin makes the JS machine leave attract).
  T3.4 left in-progress; Sudnya signs off on this scope before it flips to done.
  — session; Sudnya to rule.
