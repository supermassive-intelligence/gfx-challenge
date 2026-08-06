// COORD_TO_MAZECELL @0x1ce7 -- map an (H,L) screen coordinate to a maze-cell value.
//
// A clean leaf (ends in a single `ret`, no push/call -> no VRAM-stack residue). It
// derives a table index from L (3 coarse bands) plus H (up to 5 fine steps), looks
// the byte up in the table at 0x435e, and returns it in A; HL is preserved (via the
// two `ex de,hl`).
//
// Why FAITHFUL TRANSCRIPTION (simulate the opcodes) rather than deriving outputs by
// hand: this routine's RETURN flags are exit-path dependent and it uses the SHADOW
// AF bank as scratch, both of which the bench compares (f, a_p, f_p):
//   * The H-loop increments E once per crossed threshold (C = 0x3a, +0x30 each step),
//     computing the running threshold inside `ex af,af'`. So a_p_out / f_p_out are the
//     LAST `add a,$30` result -- NOT the entry shadow (unless zero thresholds crossed,
//     in which case the shadow is untouched).
//   * Main F at ret: the loop sets main F to the `cp c` result when it exits via
//     `jr c`, but to the `inc e` result (restored through `ex af,af'`) when it exits
//     via djnz expiry; then `add hl,bc` overwrites H/N/C/Y/X and PRESERVES S/Z/P.
// Transcribing each instruction with the z80flags helpers makes all of this fall out
// exact; the 32 captured records (test-plan) verify it.
//
// Disassembly (entry .. ret):
//   1ce7 ld a,l        1cf6 ld a,h        1d00 inc e         1d08 ex de,hl
//   1ce8 ld e,$00      1cf7 ld b,$05      1d01 ex af,af'     1d09 ld bc,$435e
//   1cea cp $46        1cf9 ld c,$3a      1d02 ld a,c        1d0c ld h,$00
//   1cec jr c,$1cf6    1cfb ld d,$30      1d03 add a,d       1d0e add hl,bc
//   1cee ld e,$05      1cfd cp c          1d04 ld c,a        1d0f ld a,(hl)
//   1cf0 cp $8a        1cfe jr c,$1d08    1d05 ex af,af'     1d10 ex de,hl
//   1cf2 jr c,$1cf6    (loop body)        1d06 djnz $1cfd    1d11 ret

import { cp8, add8, inc8, addHL16 } from './z80flags.js';

export function COORD_TO_MAZECELL(ctx) {
  const g = ctx.regs, fl = ctx.flags, fp = ctx.flags_p;
  let cyc = 0;
  const exAf = () => {                          // ex af,af'
    const ta = g.a; g.a = g.a_p; g.a_p = ta;
    for (const k of ['S','Z','Y','H','X','P','N','C']) { const t = fl[k]; fl[k] = fp[k]; fp[k] = t; }
  };

  g.a = g.l & 0xff;        cyc += 4;            // ld a,l
  g.e = 0x00;              cyc += 7;            // ld e,$00
  cp8(fl, g.a, 0x46);      cyc += 7;            // cp $46
  if (!fl.C) {                                  // jr c,$1cf6
    cyc += 7;                                   // (not taken)
    g.e = 0x05;            cyc += 7;            // ld e,$05
    cp8(fl, g.a, 0x8a);    cyc += 7;            // cp $8a
    if (!fl.C) {                                // jr c,$1cf6
      cyc += 7;                                 // (not taken)
      g.e = 0x0a;          cyc += 7;            // ld e,$0a
    } else { cyc += 12; }                       // jr taken
  } else { cyc += 12; }                         // jr taken

  g.a = g.h & 0xff;        cyc += 4;            // ld a,h
  g.b = 0x05;              cyc += 7;            // ld b,$05
  g.c = 0x3a;              cyc += 7;            // ld c,$3a
  g.d = 0x30;              cyc += 7;            // ld d,$30
  // H-loop: while (A >= C) and B>0 -> inc E, C += 0x30 (in shadow AF), djnz.
  for (;;) {
    cp8(fl, g.a, g.c);     cyc += 4;            // cp c
    if (fl.C) { cyc += 12; break; }             // jr c,$1d08 (exit)
    cyc += 7;                                   // jr not taken
    g.e = inc8(fl, g.e);   cyc += 4;            // inc e
    exAf();                cyc += 4;            // ex af,af'
    g.a = g.c;             cyc += 4;            // ld a,c
    g.a = add8(fl, g.a, g.d); cyc += 4;         // add a,d
    g.c = g.a;             cyc += 4;            // ld c,a
    exAf();                cyc += 4;            // ex af,af'
    g.b = (g.b - 1) & 0xff;                     // djnz
    if (g.b !== 0) { cyc += 13; } else { cyc += 8; break; }
  }
  // ex de,hl: (d,e) <-> (h,l)
  { const td = g.d, te = g.e; g.d = g.h; g.e = g.l; g.h = td; g.l = te; } cyc += 4;
  g.b = 0x43; g.c = 0x5e;  cyc += 10;           // ld bc,$435e
  g.h = 0x00;              cyc += 7;            // ld h,$00
  { const hl = addHL16(fl, (g.h << 8) | g.l, (g.b << 8) | g.c); g.h = (hl >> 8) & 0xff; g.l = hl & 0xff; }
  cyc += 11;                                    // add hl,bc
  g.a = ctx.mem.r8((g.h << 8) | g.l); cyc += 7; // ld a,(hl)
  { const td = g.d, te = g.e; g.d = g.h; g.e = g.l; g.h = td; g.l = te; } cyc += 4; // ex de,hl
  cyc += 10;                                    // ret
  ctx.cycles = cyc;
}
