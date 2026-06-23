// UPDATE_OBJECT_MOTION @0x27a9 -- advance one moving object's position/velocity.
//
// REGISTERED under the T2.3 X/Y-flag tolerance (its `bit 2,(hl); ret z` opener's X/Y are
// MAME-vs-core divergent). 22/22 bench + live-transparent. The original "E off by 4" on
// path 33bbfd2f was an ELIDED REGISTER LOAD: the route exits at `ret nz` right after
// `ld de,$000c; add hl,de; dec (hl)`, and `ld de,$000c` makes DE observable (E=0x0c) at
// that early ret -- the port had folded the load into a bare `hl += 0x0c`. Found in one
// shot with `node tools/generate_test_plan.js --explain 0x27a9 33bbfd2f` (the literal
// instruction trace makes register-only ops visible that the data-only read list hides).
//
// Portable under the T2.3 X/Y-flag tolerance (decisions.md 2026-06-19): it does
// `bit 2,(hl); ret z` whose undocumented X/Y are WZ-sourced and unreproducible, but the
// bench now masks X/Y and Berzerk never branches on them. Its other bit test is
// `bit 5,(iy+$00); ret z` -- X/Y from the iy high byte (bitIdx8, reproducible). All rets
// are normal single returns (the one push is `push hl; pop iy`, balanced).
//
// Faithful transcription: lots of read-modify-write on the object record at (hl); the
// bench compares the write SEQUENCE exactly, so order matters. add hl,de flags are dead
// (always overwritten before any ret) and are not modeled.
//
// Disassembly (entry .. ret):
//   27a9 ld ($0870),hl   27c0 ld a,(hl)        27d5 inc hl
//   27ac bit 2,(hl)      27c1 inc hl           27d6 ld a,(hl)
//   27ae ret z           27c2 add a,(hl)       27d7 inc hl
//   27af push hl         27c3 ld (hl),a        27d8 ld h,(hl)
//   27b0 pop iy          27c4 inc hl           27d9 ld l,a
//   27b2 ld de,$000c     27c5 ld a,(hl)        27da ex de,hl
//   27b5 add hl,de       27c6 inc hl           27db ld (hl),d
//   27b6 dec (hl)        27c7 add a,(hl)       27dc dec hl
//   27b7 ret nz          27c8 ld (hl),a        27dd ld (hl),e
//   27b8 inc hl          27c9 inc hl           27de ld a,$1b
//   27b9 ld a,(hl)       27ca ld e,(hl)        27e0 or (iy+$00)
//   27ba dec hl          27cb inc hl           27e3 ld (iy+$00),a
//   27bb ld (hl),a       27cc ld d,(hl)        27e6 bit 5,(iy+$00)
//   27bc ld de,$fffa     27cd inc de           27ea ret z
//   27bf add hl,de       27ce inc de           27eb ld a,($4378)
//                        27cf ex de,hl         27ee rlca
//                        27d0 ld a,(hl)        27ef xor $11
//                        27d1 or a             27f1 ld ($4378),a
//                        27d2 jp nz,$27da      27f4 ret

import { bitHL8, bitIdx8, dec8, add8, or8, rlca8, xor8 } from './z80flags.js';

export function UPDATE_OBJECT_MOTION(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  let cyc = 0;

  let hl = ((g.h << 8) | g.l) & 0xffff;
  ctx.mem.w16(0x0870, hl); cyc += 16;                 // ld ($0870),hl
  bitHL8(fl, 2, r8(hl)); cyc += 12;                   // bit 2,(hl)
  if (fl.Z) { cyc += 11; g.h = (hl >> 8) & 0xff; g.l = hl & 0xff; ctx.cycles = cyc; return; } // ret z
  cyc += 5;

  g.iy = hl; cyc += 11 + 14;                          // push hl ; pop iy
  // de is observable at the ret nz below
  g.d = 0x00; g.e = 0x0c; cyc += 10;                  // ld de,$000c
  hl = (hl + 0x000c) & 0xffff; cyc += 11;             // add hl,de (flags dead)
  { const v = dec8(fl, r8(hl)); w8(hl, v); } cyc += 11; // dec (hl)
  if (!fl.Z) {
    cyc += 11;
    g.h = (hl >> 8) & 0xff;
    g.l = hl & 0xff;
    g.iy &= 0xffff;
    ctx.cycles = cyc;
    return;
  } // ret nz
  cyc += 5;

  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.a = r8(hl); cyc += 7;                             // ld a,(hl)
  hl = (hl - 1) & 0xffff; cyc += 6;                   // dec hl
  w8(hl, g.a); cyc += 7;                              // ld (hl),a
  g.d = 0xff; g.e = 0xfa; cyc += 10;                  // ld de,$fffa
  hl = (hl + 0xfffa) & 0xffff; cyc += 11;             // add hl,de (DE reloaded below; flags dead)
  g.a = r8(hl); cyc += 7;                             // ld a,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.a = add8(fl, g.a, r8(hl)); cyc += 7;              // add a,(hl)
  w8(hl, g.a); cyc += 7;                              // ld (hl),a
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.a = r8(hl); cyc += 7;                             // ld a,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.a = add8(fl, g.a, r8(hl)); cyc += 7;              // add a,(hl)
  w8(hl, g.a); cyc += 7;                              // ld (hl),a
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.e = r8(hl); cyc += 7;                             // ld e,(hl)
  hl = (hl + 1) & 0xffff; cyc += 6;                   // inc hl
  g.d = r8(hl); cyc += 7;                             // ld d,(hl)
  let de = (((g.d << 8) | g.e) + 2) & 0xffff; cyc += 6 + 6;  // inc de ; inc de
  // ex de,hl: hl <- de, de <- (old hl)
  { const oldHl = hl; hl = de; de = oldHl; } cyc += 4;
  g.a = r8(hl); cyc += 7;                             // ld a,(hl)
  or8(fl, g.a, g.a); cyc += 4;                        // or a
  if (fl.Z) {                                         // jp nz,$27da NOT taken -> follow ptr
    cyc += 10;
    hl = (hl + 1) & 0xffff; cyc += 6;                 // inc hl
    g.a = r8(hl); cyc += 7;                           // ld a,(hl)
    hl = (hl + 1) & 0xffff; cyc += 6;                 // inc hl
    g.h = r8(hl); cyc += 7;                           // ld h,(hl)
    g.l = g.a; cyc += 4;                              // ld l,a
    hl = ((g.h << 8) | g.l) & 0xffff;
  } else { cyc += 10; }                               // jp nz taken
  // ex de,hl: hl <- de (=old object ptr), de <- current hl
  { const oldHl = hl; hl = de; de = oldHl; } cyc += 4;
  g.d = (de >> 8) & 0xff; g.e = de & 0xff;            // de now holds the value to store
  w8(hl, g.d); cyc += 7;                              // ld (hl),d
  hl = (hl - 1) & 0xffff; cyc += 6;                   // dec hl
  w8(hl, g.e); cyc += 7;                              // ld (hl),e
  g.h = (hl >> 8) & 0xff; g.l = hl & 0xff;            // HL register settled

  const iy0 = (g.iy + 0) & 0xffff;
  g.a = or8(fl, 0x1b, r8(iy0)); cyc += 7 + 19;        // ld a,$1b ; or (iy+$00)
  w8(iy0, g.a); cyc += 19;                            // ld (iy+$00),a
  bitIdx8(fl, 5, g.a, (g.iy >> 8) & 0xff); cyc += 20; // bit 5,(iy+$00)
  if (fl.Z) { cyc += 11; ctx.cycles = cyc; return; }  // ret z
  cyc += 5;

  g.a = r8(0x4378); cyc += 13;                        // ld a,($4378)
  g.a = rlca8(fl, g.a); cyc += 4;                     // rlca
  g.a = xor8(fl, g.a, 0x11); cyc += 7;                // xor $11
  w8(0x4378, g.a); cyc += 13;                         // ld ($4378),a
  cyc += 10;                                          // ret
  ctx.cycles = cyc;
}
