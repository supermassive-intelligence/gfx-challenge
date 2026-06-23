// @0x2b39 -- "set velocity only if direction changed". Masks the DURL direction
// bits, compares with the current direction in C; if unchanged, returns; otherwise
// FALLS THROUGH into SET_VELOCITY (0x2b3d) with the masked direction in A.
// Z80 (Tunstall):
//   and $0F; cp c; ret z; <falls into SET_VELOCITY>
// Final flags: `cp c` sets S,Z,P (preserved by SET_VELOCITY's 16-bit ADDs) and, on
// the ret-z path, all flags. Composed from the already-ported SET_VELOCITY.
import { cp8 } from './z80flags.js';
import { SET_VELOCITY } from './set_velocity.js';

export function MAYBE_SET_VELOCITY(ctx) {
  const { regs, flags } = ctx;
  const a = regs.a & 0x0f;
  regs.a = a;                                // and $0F
  cp8(flags, a, regs.c & 0xff);              // cp c
  if (a === (regs.c & 0xff)) {               // ret z: direction unchanged
    ctx.cycles = 7 + 4 + 11;                 // and + cp c + ret z = 22
    return;
  }
  SET_VELOCITY(ctx);                         // fall through (A = masked direction)
  ctx.cycles = 7 + 4 + 5 + 132;              // and + cp c + ret-z-not-taken + SET_VELOCITY = 148
}
