// CALCULATE_MAGIC_IMAGE_RAM_ADDRESS @0x29a3 and RTOAX @0x29a1.
//
// 0x29a1 (RTOAX) is `ld b,$90` and then falls straight through into 0x29a3 --
// identical body, only B differs on entry. Both are leaves (no calls, no pushes).
//
// The routine maps a pixel/object position in HL into the magic image RAM window:
//   a = (7 & L) | B            ; magic-RAM control nibble + caller's B
//   out ($4B), a               ; latch it to the magic-image control port
//   HL = HL >> 3   (logical, 16-bit: srl h ; rr l, three times)
//   if FLIP (0x4379) == 0:  HL = HL + 0x6400      ; unflipped screen
//   else:                   a |= 0x08 (set 3,a) before the out;
//                           HL = 0x7FFF - (HL>>3) ; flipped (cocktail) screen
// Final flags: the unflipped path ends on `add hl,bc` (preserves S,Z,P from the
// last `rr l`, sets C/H/N/Y/X); the flipped path ends on `sbc hl,bc` (sets all,
// carry-in cleared by the preceding `or a`).
//
// NOTE: the captured records all have FLIP==0, so the bench exercises only the
// unflipped path. The flipped path is implemented from the disassembly but is
// bench-unexercised (it would only run on a cocktail/flipped cabinet); the live
// hooked==un-hooked regression is what guards it if a script ever flips.
import { and8, or8, srl8, rr8, addHL16, sbcHL16 } from './z80flags.js';

const FLIP_FLAG = 0x4379;

// 16-bit logical shift right by 1 (srl h ; rr l). Leaves fl carrying the flags of
// the final `rr l`; the add/sbc that follows preserves (add) or overwrites (sbc)
// S/Z/P accordingly.
function shr16(fl, hl) {
  const h = srl8(fl, (hl >> 8) & 0xff);
  const l = rr8(fl, hl & 0xff, fl.C);
  return ((h << 8) | l) & 0xffff;
}

function body(ctx) {
  const { regs, flags, mem, io } = ctx;
  const flip = mem.r8(FLIP_FLAG) & 0xff;
  let a = and8(flags, 0x07, regs.l);          // ld a,$07 ; and l
  a = or8(flags, a, regs.b);                   // or b
  let hl = ((regs.h << 8) | regs.l) & 0xffff;
  let cyc;
  if (flip === 0) {                            // jr nz not taken -> unflipped
    io.out(0x4b, a);
    hl = shr16(flags, hl);
    hl = shr16(flags, hl);
    hl = shr16(flags, hl);
    regs.b = 0x64; regs.c = 0x00;               // ld bc,$6400
    hl = addHL16(flags, hl, 0x6400);           // S,Z,P from last rr l; C/H/N/Y/X set
    cyc = 129;
  } else {                                     // flipped (cocktail)
    a = (a | 0x08) & 0xff;                      // set 3,a (no flags)
    io.out(0x4b, a);
    hl = shr16(flags, hl);
    hl = shr16(flags, hl);
    hl = shr16(flags, hl);
    regs.b = (hl >> 8) & 0xff; regs.c = hl & 0xff;   // ld b,h ; ld c,l
    or8(flags, a, a);                          // or a (clears C; flags overwritten by sbc)
    hl = sbcHL16(flags, 0x7fff, (regs.b << 8) | regs.c, 0);   // 0x7FFF - (HL>>3)
    cyc = 158;
  }
  regs.a = a & 0xff;
  regs.h = (hl >> 8) & 0xff;
  regs.l = hl & 0xff;
  ctx.cycles = cyc;
}

export function CALCULATE_MAGIC_IMAGE_RAM_ADDRESS(ctx) {   // 0x29a3
  body(ctx);
}

export function RTOAX(ctx) {                                // 0x29a1
  ctx.regs.b = 0x90;                           // ld b,$90, then falls into 0x29a3
  body(ctx);
  ctx.cycles += 7;                             // + the extra ld b,$90
}
