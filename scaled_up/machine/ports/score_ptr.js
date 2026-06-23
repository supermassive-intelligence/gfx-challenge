// GET_PLAYER_SCORE_PTR @0x2334 -- leaf, no writes. Returns HL = pointer to the
// active player's score (P2_SCORE 0x4341 if player 2 is up, else P1_SCORE 0x433E).
// Z80 (Tunstall):
//   ld a,($4344)   ; CURRENT_PLAYER
//   cp $02
//   ld hl,$4341    ; P2_SCORE
//   ret z
//   ld hl,$433E    ; P1_SCORE
//   ret
// Final flag op is `cp $02` (the `ld hl` does not touch flags) -> F = CP flags in
// both paths. A is unchanged.
import { cp8 } from './z80flags.js';

export function GET_PLAYER_SCORE_PTR(ctx) {
  const { regs, flags, mem } = ctx;
  const a = mem.r8(0x4344);
  regs.a = a;
  cp8(flags, a, 0x02);
  const p2 = a === 0x02;
  const hl = p2 ? 0x4341 : 0x433e;
  regs.h = (hl >> 8) & 0xff;
  regs.l = hl & 0xff;
  // T-states: ld a,(nn)13 + cp n 7 + ld hl,nn 10 + ret z. Taken (p2): +11 = 41.
  // Not taken: +5 + ld hl,nn 10 + ret 10 = 55.
  ctx.cycles = p2 ? 41 : 55;
}
