// BOLT_VS_ACTOR_COLLISION @0x15cb -- box-overlap test between a bolt and an actor.
//
// STATUS: REGISTERED under the T2.3 X/Y-flag tolerance (Sudnya 2026-06-19). The 8 of 22
// records that fail a STRICT compare are all the `bit 2,(ix+$00); ret z` opener path,
// differing ONLY in the undocumented X(bit3)/Y(bit5) flags: the MAME-captured record has
// X/Y=1,1 (f_out=0x7c) but the vendored live core z80_core.js produces X/Y=0,0 (n-based
// BIT rule), and so does this port (bitIdx8 -> 0,0 for ix-hi 0x41). T2.3 proved (decode
// oracle) that Berzerk never branches on X/Y, so the bench now MASKS those two bits in
// the F/F' comparison (tools/bench.js) -- under that tolerance this port is 22/22, and it
// is also byte-identical hooked==un-hooked on all 4 dispatching scripts (attract 106 /
// free-play 23 / maze-transition 23 / player-death 99). First user of the framesToDrop
// hook extension. See decisions.md 2026-06-19 (T2.3 tolerance extended to the bench).
//
// First user of the hook's framesToDrop extension. Control flow:
//   * Opens `bit 2,(ix+$00); ret z` -- if the actor's "active" bit is clear, a NORMAL
//     single ret (framesToDrop=0). The F at this ret carries the BIT undocumented X/Y;
//     bitIdx8 sources them from the (ix+0) high byte (documented-hardware rule).
//   * A chain of bound checks, each a NORMAL early `ret m` / `ret nc`.
//   * On a hit (all bounds pass): set the actor's bit7 at (ix+0) and bit0 at (ix-6),
//     then `pop hl; ret` -- a NON-LOCAL return that discards its own caller's frame and
//     returns to the GRANDPARENT (framesToDrop=1). The F at this ret is the last
//     `cp d` result (set/pop/ret do not touch flags).
//
// Leaf: no inner call and no entry push -> no VRAM-stack residue. The two success-path
// writes (set 7,(ix+0); set 0,(ix-6)) are read-modify-write on actor RAM.
//
// Disassembly (entry .. ret):
//   15cb bit 2,(ix+$00)   15dd inc e            15ef sla d
//   15cf ret z            15de ld a,(iy+$03)    15f1 sla d
//   15d0 ld h,(ix+$0b)    15e1 sub (ix+$09)     15f3 sla d
//   15d3 ld l,(ix+$0a)    15e4 inc a            15f5 inc d
//   15d6 ld d,(hl)        15e5 ret m            15f6 cp d
//   15d7 inc hl           15e6 cp e             15f7 ret nc
//   15d8 ld e,(hl)        15e7 ret nc           15f8 set 7,(ix+$00)
//   15d9 ex de,hl         15e8 ld a,(iy+$02)    15fc set 0,(ix-$06)
//   15da ld d,(hl)        15eb sub (ix+$07)     1600 pop hl
//   15db inc hl           15ee ret m            1601 ret
//   15dc ld e,(hl)

import { bitIdx8, sub8, inc8, cp8, sla8 } from './z80flags.js';

export function BOLT_VS_ACTOR_COLLISION(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const ix = g.ix & 0xffff;
  let cyc = 0;

  const v0 = r8(ix);                                  // (ix+0)
  bitIdx8(fl, 2, v0, (ix >> 8) & 0xff); cyc += 20;    // bit 2,(ix+$00)  (DD CB 00 56 = 20T)
  if (fl.Z) { cyc += 11; ctx.cycles = cyc; return; }  // ret z (taken) -- normal single ret
  cyc += 5;                                           // ret z not taken

  g.h = r8(ix + 0x0b); cyc += 19;                     // ld h,(ix+$0b)
  g.l = r8(ix + 0x0a); cyc += 19;                     // ld l,(ix+$0a)  HL = ptr1
  let hl = (g.h << 8) | g.l;
  g.d = r8(hl); cyc += 7;                             // ld d,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl -> ptr1+1
  g.e = r8(hl); cyc += 7;                             // ld e,(hl)
  g.h = (hl >> 8) & 0xff; g.l = hl & 0xff;            // HL register = ptr1+1
  { const td = g.d, te = g.e; g.d = g.h; g.e = g.l; g.h = td; g.l = te; } cyc += 4;  // ex de,hl -> HL=W
  hl = (g.h << 8) | g.l;
  g.d = r8(hl); cyc += 7;                             // ld d,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl -> W+1
  g.e = r8(hl); cyc += 7;                             // ld e,(hl)
  g.h = (hl >> 8) & 0xff; g.l = hl & 0xff;            // HL register = W+1 (held through early exits)
  g.e = inc8(fl, g.e); cyc += 4;                      // inc e

  g.a = r8((g.iy + 0x03) & 0xffff); cyc += 19;        // ld a,(iy+$03)
  g.a = sub8(fl, g.a, r8(ix + 0x09)); cyc += 19;      // sub (ix+$09)
  g.a = inc8(fl, g.a); cyc += 4;                      // inc a
  if (fl.S) { cyc += 11; ctx.cycles = cyc; return; }  // ret m (taken)
  cyc += 5;                                           // ret m not taken
  cp8(fl, g.a, g.e); cyc += 4;                        // cp e
  if (!fl.C) { cyc += 11; ctx.cycles = cyc; return; } // ret nc (taken)
  cyc += 5;                                           // ret nc not taken

  g.a = r8((g.iy + 0x02) & 0xffff); cyc += 19;        // ld a,(iy+$02)
  g.a = sub8(fl, g.a, r8(ix + 0x07)); cyc += 19;      // sub (ix+$07)
  if (fl.S) { cyc += 11; ctx.cycles = cyc; return; }  // ret m (taken)
  cyc += 5;                                           // ret m not taken
  g.d = sla8(fl, g.d); cyc += 8;                      // sla d
  g.d = sla8(fl, g.d); cyc += 8;                      // sla d
  g.d = sla8(fl, g.d); cyc += 8;                      // sla d
  g.d = inc8(fl, g.d); cyc += 4;                      // inc d
  cp8(fl, g.a, g.d); cyc += 4;                        // cp d
  if (!fl.C) { cyc += 11; ctx.cycles = cyc; return; } // ret nc (taken)
  cyc += 5;                                           // ret nc not taken

  // Hit: set 7,(ix+0); set 0,(ix-6); pop hl; ret -> non-local return (framesToDrop=1).
  ctx.mem.w8(ix, v0 | 0x80); cyc += 23;               // set 7,(ix+$00)
  const vm6 = r8((ix - 0x06) & 0xffff);
  ctx.mem.w8((ix - 0x06) & 0xffff, vm6 | 0x01); cyc += 23; // set 0,(ix-$06)
  // pop hl loads HL with the word at the top of stack = the CALL return address that
  // this routine then discards (the non-local return jumps over it to the grandparent).
  // ctx.retAddr is exactly that word; HL register out must reflect it.
  g.h = (ctx.retAddr >> 8) & 0xff; g.l = ctx.retAddr & 0xff;
  cyc += 10 + 10;                                     // pop hl ; ret
  ctx.framesToDrop = 1;
  ctx.cycles = cyc;
}
