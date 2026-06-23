// SET_OBJECT_IMAGE @0x1f91 / @0x1f94 -- set an entity's velocity (via SET_VELOCITY,
// 0x2b3d ported) then look up its image pointer from table 0x2053 and store it at
// (ix+0a),(ix+0b). 0x1f91 masks the direction to the low nibble and FALLS INTO 0x1f94;
// 0x1f94 is the bare entry (direction already in range).
//
//   1f91 ld c,a ; and $0f            (0x1f91 prologue; ld c,a is dead -- SET_VELOCITY
//                                     re-does it, the `and $0f` masks the dir index)
//   1f94 call $2b3d                  SET_VELOCITY(A=dir, IX=entity) -> DE = (0,off)
//   1f97 ld hl,$2053 ; add hl,de     HL = 0x2053 + off
//   1f9b ld a,(hl) ; inc hl ; ld h,(hl)   A = lo byte, H = hi byte of the image ptr
//   1f9e di ; ld (ix+0a),a ; ld (ix+0b),h ; ei ; ret   store ptr (di/ei = critical
//                                     section around the 2 stores; NOT a coroutine -- the
//                                     atomic JS port is inherently uninterrupted, and di..ei
//                                     nets IFF back to enabled, which the hook does not alter)
//
// COST: straight-line, so the OWN cost is fixed: 0x1f94 = 246 T, 0x1f91 = 257 T (verified
// against the measured minima; the measured maxima 1295/246 include ISR cycles from
// interrupted runs, which DECLINE). maxCycles = the own cost, so the gate fast-paths
// whenever no interrupt splits the (246/257)-cycle window.
//
// RESIDUE: SP is in VRAM (0x40f0/0x4154 etc.) so residue IS visible. The only persistent
// write is the `call $2b3d` return address 0x1F97 at entry_sp-2 (SET_VELOCITY is a leaf,
// no pushes of its own) -> PORT_META pushes:[0x1f97].
import { addHL16, and8 } from './z80flags.js';
import { SET_VELOCITY } from './set_velocity.js';

// Shared 0x1f94 body. Returns the cycle cost of the 0x1f94 portion (incl. its ret).
function body1f94(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  let cyc = 0;
  cyc += 17; SET_VELOCITY(ctx); cyc += 132;          // 1f94 call $2b3d (fixed 132)
  const de = ((g.d << 8) | g.e) & 0xffff;
  let hl = addHL16(fl, 0x2053, de); cyc += 10 + 11;  // 1f97 ld hl,$2053 ; 1f9a add hl,de
  g.a = ctx.mem.r8(hl) & 0xff; cyc += 7;             // 1f9b ld a,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                  // 1f9c inc hl
  g.h = ctx.mem.r8(hl) & 0xff; g.l = hl & 0xff; cyc += 7; // 1f9d ld h,(hl)
  cyc += 4;                                          // 1f9e di
  ctx.mem.w8((g.ix + 0x0a) & 0xffff, g.a); cyc += 19; // 1f9f ld (ix+$0a),a
  ctx.mem.w8((g.ix + 0x0b) & 0xffff, g.h); cyc += 19; // 1fa2 ld (ix+$0b),h
  cyc += 4;                                          // 1fa5 ei
  return cyc + 10;                                   // 1fa6 ret
}

export function SET_OBJECT_IMAGE_1f94(ctx) {
  ctx.cycles = body1f94(ctx);
}

export function SET_OBJECT_IMAGE_1f91(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  let cyc = 0;
  g.c = g.a; cyc += 4;                               // 1f91 ld c,a (dead; SET_VELOCITY redoes it)
  g.a = and8(fl, g.a, 0x0f); cyc += 7;               // 1f92 and $0f
  ctx.cycles = cyc + body1f94(ctx);                  // 1f94 fall-through
}
