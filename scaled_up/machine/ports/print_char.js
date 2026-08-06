// PRINT_CHAR @0x29db -- draw one character glyph column into screen RAM.
//
// A TRUE LEAF (no CALL): it computes a glyph bitmap source address from BC, then
// blits 9 rows, one byte per row, masking bit7 off each source byte and writing a
// 0x00 spacer byte after it; `out ($4b),a` selects the magic-image write mode for
// each row. The glyph source pointer walks ROM font data at $2F1E + offset.
//
// Why this is transcribed instruction-by-instruction (not "by intent"): the routine
//   - mutates F through an ADD HL chain, then `push af`; the saved F (NOT the entry
//     F) is what `pop af` restores at the end -- so f_out is the ADD HL chain result,
//     S/Z/P preserved from entry, H/N/C/Y/X from the final `add hl,bc`.
//   - uses `ex af,af'` as the row-loop counter carrier: the 9-count lives in the
//     SHADOW AF across the loop body while the live AF holds the glyph byte. The
//     captured record compares a_p AND f_p, so the shadow bank must be exact.
//     a_p_out = the last masked glyph byte; f_p_out = the last `add hl,bc` flags.
// Reproducing those by hand is error-prone, so we simulate the real opcodes with the
// z80flags helpers and let the flags fall out. ctx has no WZ/internal state this
// routine needs (no `bit n,(hl)`; the only ret-visible flags come from ALU ops).
//
// FLIP ($4379 != 0, cocktail/mirrored) path is implemented from the disassembly but
// is BENCH-UNEXERCISED: every captured record has $4379 == 0 (upright). Only the
// live hooked==un-hooked regression guards it, and only if a script flips the screen.
//
// Cost is path-dependent (sign branch + flip branch); the loop count is fixed at 9.
// The port accumulates exact T-states into ctx.cycles; PORT_META.maxCycles is the
// worst case (flip + negative-sign = 1302) for the interrupt-decline gate.
//
// LIVE-RESIDUE NOTE: the routine `push af` AFTER the ADD HL chain modifies F, so its
// VRAM-stack residue F-byte is f_out, not f_in. The T9.1 hook captures `af` push
// residue from the OUTPUT register bank (post-port), which for a balanced push/pop
// equals the value at push time -- so pushes:['hl','de','af'] reproduces it. See
// decisions.md 2026-06-18 (post-port push capture).
import { and8, or8, dec8, addHL16 } from './z80flags.js';

export function PRINT_CHAR(ctx) {
  const { regs, mem, io } = ctx;

  // Working 8-bit registers (16-bit pairs via helpers below).
  let a = regs.a & 0xff, ap = regs.a_p & 0xff;
  let b = regs.b & 0xff, c = regs.c & 0xff;
  let d = regs.d & 0xff, e = regs.e & 0xff;
  let h = regs.h & 0xff, l = regs.l & 0xff;
  // Live and shadow flag banks; ex af,af' swaps which is "main" (fM).
  let fM = { ...ctx.flags }, fS = { ...ctx.flags_p };

  const HL = () => ((h << 8) | l) & 0xffff;
  const DE = () => ((d << 8) | e) & 0xffff;
  const BC = () => ((b << 8) | c) & 0xffff;
  const setHL = (v) => { h = (v >> 8) & 0xff; l = v & 0xff; };
  const setDE = (v) => { d = (v >> 8) & 0xff; e = v & 0xff; };
  const setBC = (v) => { b = (v >> 8) & 0xff; c = v & 0xff; };
  const swapAF = () => { const t = fM; fM = fS; fS = t; const x = a; a = ap; ap = x; };

  let cyc = 0;

  // Stack frame: push hl / push de / push af ... pop af / pop de / pop hl ; ret.
  // pop hl/de restore the ENTRY hl/de (captured here); pop af restores the saved AF.
  const pushedHL = HL();                              // 29db push hl
  cyc += 11;
  setHL(0x0000); cyc += 10;                           // 29dc ld hl,$0000
  b = 0x00; cyc += 7;                                 // 29df ld b,$00
  setHL(addHL16(fM, HL(), BC())); cyc += 11;          // 29e1 add hl,bc
  setHL(addHL16(fM, HL(), HL())); cyc += 11;          // 29e2 add hl,hl
  setHL(addHL16(fM, HL(), HL())); cyc += 11;          // 29e3 add hl,hl
  setHL(addHL16(fM, HL(), HL())); cyc += 11;          // 29e4 add hl,hl
  setHL(addHL16(fM, HL(), BC())); cyc += 11;          // 29e5 add hl,bc
  setBC(0x2f1e); cyc += 10;                           // 29e6 ld bc,$2f1e
  setHL(addHL16(fM, HL(), BC())); cyc += 11;          // 29e9 add hl,bc
  const pushedDE = DE();                              // 29ea push de
  cyc += 11;
  const savedA = a, savedF = { ...fM };               // 29eb push af (saved AF -> end)
  cyc += 11;
  { const t = HL(); setHL(DE()); setDE(t); } cyc += 4; // 29ec ex de,hl
  a = mem.r8(0x4379) & 0xff; cyc += 13;               // 29ed ld a,($4379)  flip flag
  a = or8(fM, a, a); cyc += 4;                        // 29f0 or a
  a = mem.r8(DE()) & 0xff; cyc += 7;                  // 29f1 ld a,(de)  first glyph byte
  const flip = fM.Z === 0;                            // 29f2 jr nz,$2a1a (flip path)

  if (!flip) {
    cyc += 7;                                         // jr nz not taken
    a = or8(fM, a, a); cyc += 4;                      // 29f4 or a  (test glyph sign)
    cyc += 10;                                        // 29f5 jp p,$29fc
    if (fM.S) {                                       // sign negative: shift origin down
      setBC(0x0060); cyc += 10;                       // 29f8 ld bc,$0060
      setHL(addHL16(fM, HL(), BC())); cyc += 11;      // 29fb add hl,bc
    }
    a = 0x09; cyc += 7;                               // 29fc ld a,$09  (row count)
    setBC(0x001f); cyc += 10;                         // 29fe ld bc,$001f (row stride)
    for (;;) {
      swapAF(); cyc += 4;                             // 2a01 ex af,af'  counter->shadow
      a = savedA; fM = { ...savedF }; cyc += 10;      // 2a02 pop af   (peek saved AF)
      cyc += 11;                                      // 2a03 push af
      cyc += 4;                                       // 2a04 di
      io.out(0x4b, a); cyc += 11;                     // 2a05 out ($4b),a
      a = mem.r8(DE()) & 0xff; cyc += 7;              // 2a07 ld a,(de)
      a = and8(fM, a, 0x7f); cyc += 7;                // 2a08 and $7f
      setDE((DE() + 1) & 0xffff); cyc += 6;           // 2a0a inc de
      mem.w8(HL(), a); cyc += 7;                      // 2a0b ld (hl),a
      setHL((HL() + 1) & 0xffff); cyc += 6;           // 2a0c inc hl
      mem.w8(HL(), 0x00); cyc += 10;                  // 2a0d ld (hl),$00
      cyc += 4;                                       // 2a0f ei
      setHL(addHL16(fM, HL(), BC())); cyc += 11;      // 2a10 add hl,bc
      swapAF(); cyc += 4;                             // 2a11 ex af,af'  counter back
      a = dec8(fM, a); cyc += 4;                      // 2a12 dec a
      cyc += 10;                                      // 2a13 jp nz,$2a01
      if (fM.Z) break;
    }
  } else {
    cyc += 12;                                        // 29f2 jr nz taken
    a = or8(fM, a, a); cyc += 4;                      // 2a1a or a
    cyc += 10;                                        // 2a1b jp p,$2a22
    if (fM.S) {
      setBC(0xffa0); cyc += 10;                       // 2a1e ld bc,$ffa0
      setHL(addHL16(fM, HL(), BC())); cyc += 11;      // 2a21 add hl,bc
    }
    a = 0x09; cyc += 7;                               // 2a22 ld a,$09
    setBC(0xffe1); cyc += 10;                         // 2a24 ld bc,$ffe1
    for (;;) {
      swapAF(); cyc += 4;                             // 2a27 ex af,af'
      a = savedA; fM = { ...savedF }; cyc += 10;      // 2a28 pop af
      cyc += 11;                                      // 2a29 push af
      cyc += 4;                                       // 2a2a di
      io.out(0x4b, a); cyc += 11;                     // 2a2b out ($4b),a
      a = mem.r8(DE()) & 0xff; cyc += 7;              // 2a2d ld a,(de)
      a = and8(fM, a, 0x7f); cyc += 7;                // 2a2e and $7f
      setDE((DE() + 1) & 0xffff); cyc += 6;           // 2a30 inc de
      mem.w8(HL(), a); cyc += 7;                      // 2a31 ld (hl),a
      setHL((HL() - 1) & 0xffff); cyc += 6;           // 2a32 dec hl
      mem.w8(HL(), 0x00); cyc += 10;                  // 2a33 ld (hl),$00
      cyc += 4;                                       // 2a35 ei
      setHL(addHL16(fM, HL(), BC())); cyc += 11;      // 2a36 add hl,bc
      swapAF(); cyc += 4;                             // 2a37 ex af,af'
      a = dec8(fM, a); cyc += 4;                      // 2a38 dec a
      cyc += 10;                                      // 2a39 jp nz,$2a27
      if (fM.Z) break;
    }
  }

  a = savedA; fM = { ...savedF }; cyc += 10;          // 2a16/2a3c pop af
  setDE(pushedDE); cyc += 10;                         // 2a17/2a3d pop de
  setHL(pushedHL); cyc += 10;                         // 2a18/2a3e pop hl
  cyc += 10;                                          // 2a19/2a3f ret

  regs.a = a & 0xff; regs.a_p = ap & 0xff;
  regs.b = b & 0xff; regs.c = c & 0xff;
  regs.d = d & 0xff; regs.e = e & 0xff;
  regs.h = h & 0xff; regs.l = l & 0xff;
  const cf = (dst, src) => { dst.S = src.S; dst.Z = src.Z; dst.Y = src.Y; dst.H = src.H;
                             dst.X = src.X; dst.P = src.P; dst.N = src.N; dst.C = src.C; };
  cf(ctx.flags, fM); cf(ctx.flags_p, fS);
  ctx.cycles = cyc;
}
