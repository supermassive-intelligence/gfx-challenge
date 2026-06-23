// STEP_BOLT_GROUPS @0x14f3 -- update three groups of bolt slots by composing
// UPDATE_ALL_BOLT_SLOTS (0x1505, ported) three times: B=2, then B=($437A)+2&7, then
// B=7 via FALL-THROUGH (0x1503 `ld b,$07` falls straight into 0x1505 at 0x1505, so the
// third 0x1505's `ret` IS 0x14f3's ret -- a tail call, no extra return frame).
//
// COST: 174..4095 T over the 5 scripts (6929 invocations). The 4095 worst case is >= the
// inter-interrupt gap (~4000), so this routine ALWAYS-DECLINES -> bench-only live
// validation (the Z80 core runs it). Registered for bench coverage + native readiness;
// tagged ALWAYS-DECLINE-BENCH-ONLY (Phase-10-readiness flag). SP in work RAM (0x082e) ->
// no residue.
//
// Disasm (entry .. fall-through ret):
//   14f3 ld b,$02       14fd and $07
//   14f5 call $1505     14ff ld b,a
//   14f8 ld a,($437a)   1500 call $1505
//   14fb add a,$02      1503 ld b,$07 ; (falls into 0x1505 -> tail)
import { add8, and8 } from './z80flags.js';
import { UPDATE_ALL_BOLT_SLOTS } from './update_all_bolts_1505.js';

export function STEP_BOLT_GROUPS(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  let cyc = 0;
  const inner = () => { ctx.cycles = 0; UPDATE_ALL_BOLT_SLOTS(ctx); cyc += ctx.cycles; };

  g.b = 0x02; cyc += 7;                              // 14f3 ld b,$02
  cyc += 17; inner();                                // 14f5 call $1505
  g.a = ctx.mem.r8(0x437a) & 0xff; cyc += 13;        // 14f8 ld a,($437a)
  g.a = add8(fl, g.a, 0x02); cyc += 7;               // 14fb add a,$02
  g.a = and8(fl, g.a, 0x07); cyc += 7;               // 14fd and $07
  g.b = g.a; cyc += 4;                               // 14ff ld b,a
  cyc += 17; inner();                                // 1500 call $1505
  g.b = 0x07; cyc += 7;                              // 1503 ld b,$07
  inner();                                           // fall into 0x1505 (tail; its ret = our ret)
  ctx.cycles = cyc;
}
