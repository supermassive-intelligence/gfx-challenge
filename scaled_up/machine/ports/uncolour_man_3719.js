// UNCOLOUR_MAN @0x3719 -- erase (or restore) the player sprite's pixels in VRAM.
//
// Portable under the T2.3 X/Y-flag tolerance (decisions.md 2026-06-19): its
// `bit 4,(hl); ret z` exit exposes WZ-sourced undocumented X/Y, now masked in the bench.
// Its other bit test, `bit 3,(hl); jp z`, is a mid-routine branch (flags overwritten
// before any ret) so bitHL8 is safe there too.
//
// Two mirror image 5-row x 2-byte loops, both juggling the colour byte against the loop
// counter through `ex af,af'`:
//   * bit3 SET -> RESTORE: copy 5x2 bytes from the save buffer ($0942) back to VRAM at
//     ($0940); the outer counter lives in A (saved in the shadow bank each pass).
//   * main path -> BLANK: recompute the VRAM address from the object coords (the srl/rr
//     chain), store it to ($0940), then for 5 rows x 2 bytes save the VRAM pixel into the
//     buffer ($0942..) and overwrite VRAM with the background colour ($4378); here the
//     outer counter is C and A holds the colour (swapped to the shadow bank during the
//     pixel read). a_p/f_p therefore end as the LAST pixel read + its swap-carried flags.
// All rets are normal single returns (both `push hl` are balanced by `pop hl`). No inner
// call; the pushes land at the entry SP (low-RAM stack in the captured records, outside
// the VRAM hash window) -- declared pushes:[] (revisit if live transparency disagrees).
//
// The FLIP/cocktail branch (3750-3759, 0x4379 != 0) is implemented from the disassembly
// but is NOT bench-exercised (every captured record has 0x4379 == 0); only the live
// hooked==un-hooked regression guards it.

import { bitHL8, dec8, srl8, rr8, sub8, add8, or8, addHL16 } from './z80flags.js';

export function UNCOLOUR_MAN(ctx) {
  const g = ctx.regs, fl = ctx.flags, fp = ctx.flags_p;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  let cyc = 0;
  const FLAG_KEYS = ['S','Z','Y','H','X','P','N','C'];
  const exAf = () => {                                 // ex af,af'  (swaps A and F)
    const ta = g.a; g.a = g.a_p; g.a_p = ta;
    for (const k of FLAG_KEYS) { const t = fl[k]; fl[k] = fp[k]; fp[k] = t; }
  };
  let hl = ((g.h << 8) | g.l) & 0xffff;

  const v0 = r8(hl);
  bitHL8(fl, 3, v0); cyc += 12;                        // bit 3,(hl)
  if (!fl.Z) {                                         // jp z not taken -> bit3 SET -> RESTORE
    cyc += 10;
    w8(hl, v0 & ~0x08); cyc += 15;                     // res 3,(hl)
    const savedHl = hl;                                // push hl (balanced by pop below)
    hl = ctx.mem.r16(0x0940); cyc += 11 + 16;          // ld hl,($0940)
    let de = 0x0942; cyc += 10;                        // ld de,$0942
    g.a = 0x05; cyc += 7;                              // ld a,$05
    do {
      exAf(); cyc += 4;                                // ex af,af' (counter -> shadow)
      g.b = 0x02; cyc += 7;                            // ld b,$02
      do {
        g.a = r8(de); cyc += 7;                        // ld a,(de)
        de = (de + 1) & 0xffff; cyc += 6;              // inc de
        w8(hl, g.a); cyc += 7;                         // ld (hl),a
        hl = (hl + 1) & 0xffff; cyc += 6;              // inc hl
        g.b = (g.b - 1) & 0xff;                        // djnz
        cyc += g.b !== 0 ? 13 : 8;
      } while (g.b !== 0);
      g.b = 0x00; g.c = 0x1e; cyc += 10;               // ld bc,$001e
      hl = addHL16(fl, hl, 0x001e); cyc += 11;         // add hl,bc (its C rides ex af,af' -> f_p)
      exAf(); cyc += 4;                                // ex af,af' (counter -> main)
      g.a = dec8(fl, g.a); cyc += 4;                   // dec a
      cyc += g.a !== 0 ? 10 : 10;                      // jp nz (jp is 10T taken or not)
    } while (g.a !== 0);
    hl = savedHl; cyc += 10;                           // pop hl
  } else { cyc += 10; }                                // jp z taken (bit3 clear)

  const v1 = r8(hl);
  bitHL8(fl, 4, v1); cyc += 12;                        // bit 4,(hl)
  if (fl.Z) { cyc += 11; g.h = (hl >> 8) & 0xff; g.l = hl & 0xff; ctx.cycles = cyc; return; } // ret z
  cyc += 5;

  w8(hl, v1 | 0x08); cyc += 15;                        // set 3,(hl)
  const savedHl2 = hl; cyc += 11;                      // push hl
  g.d = 0x00; g.e = 0x07; cyc += 10;                   // ld de,$0007
  hl = (hl + 0x0007) & 0xffff; cyc += 11;              // add hl,de
  g.e = r8(hl); cyc += 7;                              // ld e,(hl)
  hl = (hl + 2) & 0xffff; cyc += 6 + 6;                // inc hl ; inc hl
  g.a = r8(0x4379); cyc += 13;                         // ld a,($4379)
  or8(fl, g.a, g.a); cyc += 4;                         // or a
  g.a = r8(hl); cyc += 7;                              // ld a,(hl)
  if (!fl.Z) {                                         // jr z not taken -> FLIP path (unexercised)
    cyc += 7;
    g.a = sub8(fl, 0, g.a); cyc += 8;                  // neg
    g.a = add8(fl, g.a, 0xd0); cyc += 7;               // add a,$d0
    exAf(); cyc += 4;                                  // ex af,af'
    g.a = 0xf7; cyc += 7;                              // ld a,$f7
    g.a = sub8(fl, g.a, g.e); cyc += 4;                // sub e
    g.e = g.a; cyc += 4;                               // ld e,a
    exAf(); cyc += 4;                                  // ex af,af'
  } else { cyc += 12; }                               // jr z taken

  g.a = srl8(fl, g.a); cyc += 8;                       // srl a
  g.a = srl8(fl, g.a); cyc += 8;                       // srl a
  g.h = g.a; cyc += 4;                                 // ld h,a
  g.l = g.e; cyc += 4;                                 // ld l,e
  for (let i = 0; i < 3; i++) {                        // (srl h ; rr l) x3
    g.h = srl8(fl, g.h); cyc += 8;                     // srl h
    g.l = rr8(fl, g.l, fl.C); cyc += 8;                // rr l
  }
  g.b = 0x81; g.c = 0x00; cyc += 10;                   // ld bc,$8100
  hl = (((g.h << 8) | g.l) + 0x8100) & 0xffff; cyc += 11;  // add hl,bc
  ctx.mem.w16(0x0940, hl); cyc += 16;                  // ld ($0940),hl
  g.a = r8(0x4378); cyc += 13;                         // ld a,($4378)  (background colour)
  const de = 0x001e; g.d = 0x00; g.e = 0x1e; cyc += 10; // ld de,$001e (D/E are output regs)
  g.iy = 0x0942; cyc += 14;                            // ld iy,$0942
  g.c = 0x05; cyc += 7;                                // ld c,$05
  do {
    g.b = 0x02; cyc += 7;                              // ld b,$02
    do {
      exAf(); cyc += 4;                                // ex af,af'  (colour -> shadow)
      g.a = r8(hl); cyc += 7;                          // ld a,(hl)  (read VRAM pixel)
      w8((g.iy + 0) & 0xffff, g.a); cyc += 19;         // ld (iy+$00),a  (save pixel)
      g.iy = (g.iy + 1) & 0xffff; cyc += 10;           // inc iy
      exAf(); cyc += 4;                                // ex af,af'  (colour -> main)
      w8(hl, g.a); cyc += 7;                           // ld (hl),a  (blank VRAM with colour)
      hl = (hl + 1) & 0xffff; cyc += 6;                // inc hl
      g.b = (g.b - 1) & 0xff;                          // djnz
      cyc += g.b !== 0 ? 13 : 8;
    } while (g.b !== 0);
    hl = addHL16(fl, hl, de); cyc += 11;               // add hl,de (its C survives dec c -> fout)
    g.c = dec8(fl, g.c); cyc += 4;                     // dec c
    cyc += 10;                                         // jp nz
  } while (g.c !== 0);
  hl = savedHl2; cyc += 10;                            // pop hl
  g.h = (hl >> 8) & 0xff; g.l = hl & 0xff;
  cyc += 10;                                           // ret
  ctx.cycles = cyc;
}
