// DRAW_SPRITE @0x2817 -- sprite blitter (true leaf: no inner CALL, no push/pop).
//
// Reads a sprite header from (HL): byte0 = width selector (==1 -> 1-byte-wide,
// else 2-byte-wide), byte1 = row count N. DE points at the VRAM destination. The
// body copies N rows from the ROM sprite data (the ORIGINAL HL, after the 2 header
// reads) into VRAM, one zero-pad byte per row, advancing the destination by a fixed
// stride. There are four straight paths selected by width and the FLIP flag (0x4379):
//
//   2-byte normal (0x2828): stride +0x1e, per row: src,src,0   (dest ascending)
//   2-byte flip   (0x283d): stride +0xffe2 (-30), per row: src,src,0 (dest descending)
//   1-byte normal (0x285c): stride +0x1f, per row: src,0
//   1-byte flip   (0x286d): stride +0xffe1 (-31), per row: src,0
//
// The row counter is parked in the SHADOW accumulator (ex af,af') across the inner
// byte loads, so on exit A' (a_p) holds the LAST source byte loaded -- NOT the entry
// shadow. We reproduce that by simulating the ex af,af' dance faithfully rather than
// deriving it. Final main flags come from the terminating `dec a` -> 0 (F=0x42).
//
// FLIP paths (0x4379 != 0, cocktail) are bench-UNEXERCISED (every captured record has
// 0x4379==0); implemented from the disassembly and guarded only by the live
// hooked==un-hooked regression if a script ever flips the screen.
//
// Cost is row-count dependent: accumulated per-instruction into ctx.cycles (the live
// hook charges it). T-states match the captured `cycles` exactly (record 1: 1-byte
// N=4 = prologue 88 + 4*66 + ret 10 = 362).

import { dec8 } from './z80flags.js';

export function DRAW_SPRITE(ctx) {
  const g = ctx.regs;
  let hl = ((g.h << 8) | g.l) & 0xffff;
  let de = ((g.d << 8) | g.e) & 0xffff;
  let a = g.a & 0xff;
  let ap = g.a_p & 0xff;                 // shadow accumulator
  let cyc = 0;
  const r8 = (x) => ctx.mem.r8(x & 0xffff) & 0xff;
  const w8 = (x, v) => ctx.mem.w8(x & 0xffff, v & 0xff);

  // Prologue 0x2817-0x281c: ld b,0; ld a,(hl); inc hl; dec a; jp z (always 10).
  g.b = 0;
  a = r8(hl); hl = (hl + 1) & 0xffff;
  const firstByte = a;
  a = (a - 1) & 0xff;
  cyc += 7 + 7 + 6 + 4 + 10;             // = 34
  const oneWide = (firstByte === 1);     // dec a == 0 -> jp z taken

  // Shared selector tail (0x281f or 0x2853): ld a,(0x4379); or a; ld a,(hl); inc hl;
  // jp nz. The two sites are identical in shape and cost (40 T).
  const flip = r8(0x4379);
  a = r8(hl); hl = (hl + 1) & 0xffff;    // A = row count N
  cyc += 13 + 4 + 7 + 6 + 10;            // = 40
  const N = a;                           // row counter (the byte just read)

  // Choose stride + per-row layout. ld bc,nn (10) + ex de,hl (4) = 14 before loop.
  let stride, twoSrc, ascending;
  if (!oneWide) {
    if (flip === 0) { stride = 0x001e; twoSrc = true;  ascending = true;  }
    else            { stride = 0xffe2; twoSrc = true;  ascending = false; }
  } else {
    if (flip === 0) { stride = 0x001f; twoSrc = false; ascending = true;  }
    else            { stride = 0xffe1; twoSrc = false; ascending = false; }
  }
  cyc += 14;
  g.b = (stride >> 8) & 0xff;            // ld bc,nn  (B==0 on normal, 0xff on flip)
  g.c = stride & 0xff;

  // After ex de,hl: HL = destination (entry DE), DE = source (entry HL post-header).
  let dst = de;                          // HL in the loop
  let src = hl;                          // DE in the loop
  const step = ascending ? 1 : 0xffff;   // inc hl / dec hl within a row
  // Zero-pad store cost: ld (hl),b (7T) on normal paths, ld (hl),$00 (10T) on flip.
  const zeroCost = (flip === 0) ? 7 : 10;

  // Counter lives in main A, exactly as the Z80 does (parked in A' across the loads).
  a = N;
  do {
    let t = a; a = ap; ap = t;           // ex af,af' : A<->A' (A := old shadow, A' := counter)
    a = r8(src); src = (src + 1) & 0xffff;          // ld a,(de) ; inc de
    w8(dst, a); dst = (dst + step) & 0xffff;        // ld (hl),a ; inc/dec hl
    cyc += 4 + 7 + 6 + 7 + 6;
    if (twoSrc) {
      a = r8(src); src = (src + 1) & 0xffff;        // ld a,(de) ; inc de
      w8(dst, a); dst = (dst + step) & 0xffff;      // ld (hl),a ; inc/dec hl
      cyc += 7 + 6 + 7 + 6;
    }
    w8(dst, 0);                          // ld (hl),b | ld (hl),$00  (no pointer advance)
    cyc += zeroCost;
    t = a; a = ap; ap = t;               // ex af,af' : A<->A' (A := counter, A' := last src byte)
    a = dec8(ctx.flags, a);              // dec a  -> flags + counter--
    dst = (dst + stride) & 0xffff;       // add hl,bc
    cyc += 4 + 4 + 11 + 10;              // ex af,af' ; dec a ; add hl,bc ; jp nz
  } while (a !== 0);
  cyc += 10;                             // ret

  // Write back. HL/DE final values are the post-loop dst/src; the routine does not
  // return them load-bearing (bench compares them anyway -- they match by simulation).
  g.h = (dst >> 8) & 0xff; g.l = dst & 0xff;
  g.d = (src >> 8) & 0xff; g.e = src & 0xff;
  g.a = a & 0xff;
  g.a_p = ap & 0xff;
  ctx.cycles = cyc;
}
