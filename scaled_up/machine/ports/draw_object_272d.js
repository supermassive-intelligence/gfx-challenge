// DRAW_OBJECT @0x272d -- render one actor: up to two sprite blits + collision flag.
// Non-leaf composite: composes DRAW_SPRITE (0x2817, ported) up to twice and
// CALCULATE_MAGIC_IMAGE_RAM_ADDRESS (0x29a3, ported) once.
//
// FLOW (faithful instruction sim -- register flow tracked, NOT re-derived from intent):
//   * IY := object ptr (push hl; pop iy). bit0 of (objptr) gates the FIRST blit:
//     if set, latch ctrl (out $4B), read coords+image addr from the object record,
//     call DRAW_SPRITE, clear bit0.
//   * bit1 of (objptr) gates the SECOND blit (ret z if clear): read a coord block,
//     call 0x29a3 (computes magic addr + latches ctrl), follow two pointer indirections
//     to the sprite header, optionally apply a FLIP-signed coordinate offset (bit7 of
//     the header byte), store sprite ptr + coords into (iy+2..5), call DRAW_SPRITE.
//   * Read the collision flop (in $4E); if bit7 set, set bit7 of (objptr) and bit0 of
//     (iy-6) -- the "object was hit" flags.
//
// HAZARD NOTES (all settled-policy):
//   * `bit 1,(hl); ret z` (0x274d) exposes the WZ-sourced X/Y at the ret -> bitHL8 sets
//     X/Y=0; the bench masks X/Y (T2.3 tolerance) and Berzerk never branches on X/Y, so
//     this is the same X/Y-tolerance treatment as 0x3719/0x27a9. Documented S/Z exact.
//   * `in a,($4E)` reads the collision flop: bit7 = collision (V256-INDEPENDENT), low 7
//     bits = V256 but they are discarded (only `bit 7,a` is taken), so no entropy flows.
//     The final `bit 7,a; ret z` F-byte X/Y come from A's V256 bits -> masked by the
//     bench, never branched on live.
//   * `sbc hl,bc` (0x2781, FLIP path) runs with C=0 (cleared by the preceding `or a`).
//     FLIP!=0 is cocktail-only (bench-unexercised); implemented from the disassembly.
//
// COST: path-dependent (port sets exact ctx.cycles = own T-states + each inner call's
// reported cost). Measured 86..3152 T over the 5 scripts (13865 invocations); 3152 <
// the inter-interrupt gap (~4000 T) -> genuinely FAST-PATHS. SP is in work RAM (0x082e)
// on every invocation, so push/inner-call residue lands outside the rendered window ->
// PORT_META declares no pushes (invisible by stack placement, like 0x15a0).
import { bitHL8, and8, or8, addHL16, sbcHL16 } from './z80flags.js';
import { DRAW_SPRITE } from './draw_sprite.js';
import { CALCULATE_MAGIC_IMAGE_RAM_ADDRESS } from './magic_image_addr.js';

export function DRAW_OBJECT(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  let cyc = 0;
  const HL = () => ((g.h << 8) | g.l) & 0xffff;
  const setHL = (v) => { g.h = (v >> 8) & 0xff; g.l = v & 0xff; };
  const DE = () => ((g.d << 8) | g.e) & 0xffff;
  const setDE = (v) => { g.d = (v >> 8) & 0xff; g.e = v & 0xff; };
  // bit 7,r (register): Z/P from bit clear, S from bit7, X/Y from r, H=1,N=0,C kept.
  const bit7r = (r) => {
    const b = (r >> 7) & 1;
    fl.Z = b ? 0 : 1; fl.P = fl.Z; fl.S = b; fl.H = 1; fl.N = 0;
    fl.Y = (r >> 5) & 1; fl.X = (r >> 3) & 1;
  };

  const objptr = HL();                                  // call arg
  w8(0x0870, g.l); w8(0x0871, g.h); cyc += 16;          // 272d ld ($0870),hl
  g.iy = objptr; cyc += 11 + 14;                        // 2730 push hl ; 2731 pop iy

  bitHL8(fl, 0, r8(objptr)); cyc += 12;                 // 2733 bit 0,(hl)
  if (fl.Z) { cyc += 10; }                              // 2735 jp z,$274d (taken)
  else {
    cyc += 10;                                          // 2735 jp z not taken
    w8(objptr, r8(objptr) & ~0x01); cyc += 15;          // 2738 res 0,(hl)
    let p = (objptr + 1) & 0xffff;
    g.a = r8(p); cyc += 6 + 7;                          // 273a inc hl ; 273b ld a,(hl)
    ctx.io.out(0x4b, g.a); cyc += 11;                   // 273c out ($4b),a
    g.e = r8((p + 1) & 0xffff); cyc += 6 + 7;           // 273e inc hl ; 273f ld e,(hl)
    g.d = r8((p + 2) & 0xffff); cyc += 6 + 7;           // 2740 inc hl ; 2741 ld d,(hl)
    g.a = r8((p + 3) & 0xffff); cyc += 6 + 7;           // 2742 inc hl ; 2743 ld a,(hl)
    g.h = r8((p + 4) & 0xffff); g.l = g.a; cyc += 6 + 7 + 4; // 2744 inc hl ; 2745 ld h,(hl) ; 2746 ld l,a
    cyc += 17; ctx.cycles = 0; DRAW_SPRITE(ctx); cyc += ctx.cycles; // 2747 call $2817
    setHL(r8(0x0870) | (r8(0x0871) << 8)); cyc += 16;   // 274a ld hl,($0870)
  }

  bitHL8(fl, 1, r8(HL())); cyc += 12;                   // 274d bit 1,(hl)
  if (fl.Z) { ctx.cycles = cyc + 11; return; }          // 274f ret z (taken) -- F = bit1 flags
  cyc += 5;                                             // 274f ret z not taken
  w8(HL(), r8(HL()) & ~0x02); cyc += 15;                // 2751 res 1,(hl)
  setHL(addHL16(fl, HL(), 0x0007)); g.d = 0; g.e = 7; cyc += 10 + 11; // 2752 ld de,$0007 ; 2755 add hl,de
  // (the add hl,de flags are transient -- overwritten before any ret)
  g.e = r8(HL()); cyc += 7;                             // 2756 ld e,(hl)
  setHL((HL() + 2) & 0xffff); cyc += 6 + 6;             // 2757 inc hl ; 2758 inc hl
  g.d = r8(HL()); cyc += 7;                             // 2759 ld d,(hl)
  setHL((HL() + 1) & 0xffff); cyc += 6;                 // 275a inc hl
  g.b = 0x90; cyc += 7;                                 // 275b ld b,$90
  { const t = DE(); setDE(HL()); setHL(t); } cyc += 4;  // 275d ex de,hl
  cyc += 17; ctx.cycles = 0; CALCULATE_MAGIC_IMAGE_RAM_ADDRESS(ctx); cyc += ctx.cycles; // 275e call $29a3
  w8((g.iy + 1) & 0xffff, g.a); cyc += 19;              // 2761 ld (iy+$01),a
  { const t = DE(); setDE(HL()); setHL(t); } cyc += 4;  // 2764 ex de,hl  (DE=magicaddr, HL=objptr+10)
  g.a = r8(HL()); cyc += 7;                             // 2765 ld a,(hl)
  g.h = r8((HL() + 1) & 0xffff); g.l = g.a; cyc += 6 + 7 + 4; // 2766 inc hl ; 2767 ld h,(hl) ; 2768 ld l,a
  g.a = r8(HL()); cyc += 7;                             // 2769 ld a,(hl)
  g.l = r8((HL() + 1) & 0xffff); g.h = g.a; cyc += 6 + 7 + 4; // 276a inc hl ; 276b ld l,(hl) ; 276c ld h,a
  g.a = r8(HL()); cyc += 7;                             // 276d ld a,(hl)
  bit7r(g.a); cyc += 8;                                 // 276e bit 7,a
  if (fl.Z) { cyc += 12; }                              // 2770 jr z,$278b (taken: no coord adjust)
  else {
    cyc += 7;                                           // 2770 jr z not taken
    setHL((HL() + 1) & 0xffff); cyc += 6;               // 2772 inc hl
    g.a = and8(fl, g.a, 0x7f); cyc += 7;                // 2773 and $7f
    g.b = g.a; cyc += 4;                                // 2775 ld b,a
    g.a = r8(HL()); cyc += 7;                           // 2776 ld a,(hl)
    setHL((HL() + 1) & 0xffff); cyc += 6;               // 2777 inc hl
    g.c = g.a; cyc += 4;                                // 2778 ld c,a
    { const t = DE(); setDE(HL()); setHL(t); } cyc += 4; // 2779 ex de,hl (HL=magicaddr, DE=ptr2+2)
    g.a = r8(0x4379); cyc += 13;                        // 277a ld a,($4379)
    g.a = or8(fl, g.a, g.a); cyc += 4;                  // 277d or a (C=0)
    const bc = (g.b << 8) | g.c;
    if (fl.Z) { cyc += 10; setHL(addHL16(fl, HL(), bc)); cyc += 11 + 10; } // 277e jp z ; 2786 add hl,bc ; 2787 jp
    else { cyc += 10; setHL(sbcHL16(fl, HL(), bc, 0)); cyc += 15 + 10; }   // 2781 sbc hl,bc ; 2783 jp
    { const t = DE(); setDE(HL()); setHL(t); } cyc += 4; // 278a ex de,hl (HL=ptr2+2, DE=adjusted)
  }
  w8((g.iy + 4) & 0xffff, g.l); cyc += 19;              // 278b ld (iy+$04),l
  w8((g.iy + 5) & 0xffff, g.h); cyc += 19;              // 278e ld (iy+$05),h
  w8((g.iy + 2) & 0xffff, g.e); cyc += 19;              // 2791 ld (iy+$02),e
  w8((g.iy + 3) & 0xffff, g.d); cyc += 19;              // 2794 ld (iy+$03),d
  cyc += 17; ctx.cycles = 0; DRAW_SPRITE(ctx); cyc += ctx.cycles; // 2797 call $2817
  setHL(r8(0x0870) | (r8(0x0871) << 8)); cyc += 16;     // 279a ld hl,($0870)
  g.a = ctx.io.in(0x4e) & 0xff; cyc += 11;              // 279d in a,($4e)
  bit7r(g.a); cyc += 8;                                 // 279f bit 7,a  -- F at ret comes from here
  if (fl.Z) { ctx.cycles = cyc + 11; return; }          // 27a1 ret z (no collision)
  cyc += 5;                                             // 27a1 ret z not taken
  w8(HL(), r8(HL()) | 0x80); cyc += 15;                 // 27a2 set 7,(hl)
  w8((g.iy - 6) & 0xffff, r8((g.iy - 6) & 0xffff) | 0x01); cyc += 23; // 27a4 set 0,(iy-$06)
  ctx.cycles = cyc + 10;                                // 27a8 ret
}
