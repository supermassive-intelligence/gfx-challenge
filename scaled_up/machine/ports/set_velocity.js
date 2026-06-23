// SET_VELOCITY @0x2b3d -- map a direction index (A) through two ROM tables into an
// (X,Y) velocity delta and store it in the entity's VECTOR (ix+6, ix+8).
// Z80 (Tunstall):
//   ld c,a; ld b,$00; ld d,b; ld hl,$2042(D.TAB); add hl,bc; ld e,(hl)
//   ld hl,$2519(M.TAB); add hl,de; ld a,(hl); inc hl; ld (ix+$06),a
//   ld a,(hl); ld (ix+$08),a; ret
// D.TAB / M.TAB live in ROM (the bench provides the ROM image; reads excluded from
// the record). Last flag-affecting op is `add hl,de` -> H,N,C,X,Y from it; S,Z,P
// preserved from entry (16-bit ADD does not touch them).
import { addHL16 } from './z80flags.js';

export function SET_VELOCITY(ctx) {
  const { regs, flags, mem } = ctx;
  const a0 = regs.a & 0xff;
  regs.c = a0;                              // ld c,a
  regs.b = 0x00;                            // ld b,0  (BC = A)
  regs.d = 0x00;                            // ld d,b  (D = 0)
  const off = mem.r8((0x2042 + a0) & 0xffff);   // add hl,bc; ld e,(hl)
  regs.e = off;
  const hl = addHL16(flags, 0x2519, off);  // add hl,de (D=0 so DE=off)
  const xd = mem.r8(hl);                    // X delta
  const hl2 = (hl + 1) & 0xffff;            // inc hl
  const yd = mem.r8(hl2);                   // Y delta
  regs.a = yd;
  regs.h = (hl2 >> 8) & 0xff;
  regs.l = hl2 & 0xff;
  const ix = regs.ix & 0xffff;
  mem.w8((ix + 6) & 0xffff, xd);            // ld (ix+6),a  (VECTOR.X)
  mem.w8((ix + 8) & 0xffff, yd);            // ld (ix+8),a  (VECTOR.Y)
}
