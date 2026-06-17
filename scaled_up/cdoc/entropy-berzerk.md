# Berzerk gameplay entropy (T5.1 stub)

Source of run-to-run variation in Berzerk's RC31A ROM, derived from the frozen
decode oracle (`disassembler/oracle/decode_oracle.jsonl`) + labels
(`oracle/labels.json`). No emulation timing work here; this only identifies the
source and its flow to object placement.

## Entropy source

- `ld a,r` (`ED 5F`): **0 occurrences** in the ROM. The Z80 R-register is never
  read by the game. The "R-register-seeded RNG" hypothesis is ruled out.
- `in a,($4e)` (`DB 4E`): **10 occurrences** (addrs 0x023B, 0x0246, 0x0281,
  0x04A9, 0x050C, 0x0522, 0x0608, 0x157A, 0x26B4, 0x279D). Port 0x4E reads the
  intercept/collision flop (bit 7) OR'd with the V256/vblank beam bit. This is
  the only timing-sensitive deterministic entropy read present.

The architecturally load-bearing site is **0x26B4**, inside the interrupt
service dispatcher (entry ~0x26B0: `di; ld sp,$0840; push af; in a,($4e); rra;
jr c,$26d9`). The `in a,($4e)` here selects which interrupt fired: carry set
(V256) branches to `BOTTOM_OF_SCREEN_INTERRUPT` (0x26D9); the fall-through
(non-vblank) path (0x26B9+) reads a 2-byte counter at **0x089F/0x08A0**, XORs in
port 0x49 (system inputs), and writes it back -- a free-running, interrupt-phase
-dependent entropy accumulator.

## Flow to object placement

The gameplay RNG proper is the LCG **`RANDOM` at 0x2678**: `seed = (0x435C);
seed = 7*seed + 0x3153; (0x435C) = seed; return high byte`. It is purely
deterministic in its seed and is called from movement/placement/speech routines
(13 call sites: V.LOOP robot movement, SR.TAB, ROBOT_ANIMATION_TABLES,
COLLISION_DETECTION, GENERATE_ROBOT_SPEECH, ...). The timing-sensitive part is
the **seed**: `COLLISION_DETECTION` (0x15CF) zeroes the 0x089F/0x08A0 counter at
game start (0x1645), and on each game/round transition reads and rewrites the
LCG seed 0x435C (0x169A / 0x16B9) and calls `RANDOM` (0x16BC). The interrupt
dispatcher increments 0x089F every non-vblank IRQ, so the value `COLLISION_
DETECTION` mixes into the RNG state depends on how many interrupts (and at what
phase) elapsed -- i.e. on CPU/interrupt timing. Therefore interrupt-delivery
timing perturbs the seed, which perturbs placement via the LCG.

Note: the named routines MAN_INIT (0x1FD4), CREATE_JOB (0x1E22), LTABLE
(0x1AED) are the job/coroutine/dispatch scaffolding around these consumers; none
calls `RANDOM` directly. The direct RNG consumers are the movement/collision/
speech routines listed above.

## Relation to the frame-242 divergence (open, for human ruling)

This confirms the entropy *mechanism* is V256/beam timing, not the R register.
What it does NOT prove on its own: that the specific T3.4 frame-242 single-byte
VRAM shift (0x5DE3, one-frame phase shift on an erase-write, attract demo, no
input) flows through this RNG path rather than being a direct artifact of IRQ
delivery timing on a deterministic draw routine. Both share the same root cause
(accumulated core cycle-timing / interrupt-phase drift). HUMAN-GATE: Sudnya to
rule whether this entropy source adequately explains frame-242 before T3.4 is
scoped/closed.
