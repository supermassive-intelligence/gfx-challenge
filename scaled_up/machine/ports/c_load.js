// C_LOAD @0x1776 -- load the Exidy 6840 PTM / sound-control registers from the
// $0878 RAM parameter block. A TRUE LEAF (no CALL): reads a 13-byte block at
// $0878 and streams it to I/O ports $40-$47 (the 6840 timer latches + control).
//
// `out (c),r` addresses the port held in C (Berzerk decodes only the low 8 bits;
// the bench masks the port to 0xFF, matching the captured io writes). `res`/`set`
// on a register do NOT touch flags, and `djnz` does not touch flags, so the only
// ret-visible flags come from the second loop's `add a,$40`; we model the three
// flag-affecting ops (or/and/add) with the z80flags helpers and leave F otherwise
// untouched. The routine never touches the shadow bank.
//
// Cost is FIXED: both djnz counts are immediates (3 then 4) and no branch depends
// on data, so the path is constant at 642 T-states (hand-summed, matches the bench
// record `cycles`). No push/call -> no VRAM-overlapping-stack residue (pushes:[]).
// Single captured path = acb5adb0 (all 5 records identical).
import { add8, and8, or8 } from './z80flags.js';

export function C_LOAD(ctx) {
  const { regs, mem, io } = ctx;
  let a = regs.a & 0xff, b = regs.b & 0xff, c = regs.c & 0xff;
  let d = regs.d & 0xff, e = regs.e & 0xff;
  let h = regs.h & 0xff, l = regs.l & 0xff;
  const f = ctx.flags;
  const HL = () => ((h << 8) | l) & 0xffff;
  const setHL = (v) => { h = (v >> 8) & 0xff; l = v & 0xff; };

  setHL(0x0878);                         // 1776 ld hl,$0878
  b = mem.r8(HL());                      // 1779 ld b,(hl)
  setHL(HL() + 1);                       // 177a inc hl
  d = mem.r8(HL());                      // 177b ld d,(hl)
  setHL(HL() + 1);                       // 177c inc hl
  e = mem.r8(HL());                      // 177d ld e,(hl)
  setHL(HL() + 1);                       // 177e inc hl
  c = 0x41;                              // 177f ld c,$41
  b &= 0xfe;                             // 1781 res 0,b   (no flags)
  d |= 0x01;                             // 1783 set 0,d   (no flags)
  io.out(c, d);                          // 1785 out (c),d
  c = (c - 1) & 0xff;                    // 1787 dec c
  io.out(c, b);                          // 1788 out (c),b
  c = (c + 1) & 0xff;                    // 178a inc c
  d &= 0xfe;                             // 178b res 0,d
  io.out(c, d);                          // 178d out (c),d
  c = (c - 1) & 0xff;                    // 178f dec c
  io.out(c, e);                          // 1790 out (c),e
  c = (c + 1) & 0xff;                    // 1792 inc c
  c = (c + 1) & 0xff;                    // 1793 inc c
  b = 0x03;                              // 1794 ld b,$03
  a = c;                                 // 1796 ld a,c
  c = (c + 1) & 0xff;                    // 1797 inc c
  d = c;                                 // 1798 ld d,c
  do {                                   // 1799..17a6 djnz loop (3x)
    e = mem.r8(HL());                    // 1799 ld e,(hl)
    setHL(HL() + 1);                     // 179a inc hl
    c = a;                               // 179b ld c,a
    a = mem.r8(HL());                    // 179c ld a,(hl)
    setHL(HL() + 1);                     // 179d inc hl
    io.out(c, a);                        // 179e out (c),a
    a = c;                               // 17a0 ld a,c
    c = d;                               // 17a1 ld c,d
    io.out(c, e);                        // 17a2 out (c),e
    d = (d + 1) & 0xff;                  // 17a4 inc d
    d = (d + 1) & 0xff;                  // 17a5 inc d
    b = (b - 1) & 0xff;                  // 17a6 djnz $1799
  } while (b !== 0);
  c = (c - 1) & 0xff;                    // 17a8 dec c
  a = 0x00;                              // 17a9 ld a,$00
  b = 0x04;                              // 17ab ld b,$04
  do {                                   // 17ad..17b5 djnz loop (4x)
    a = or8(f, a, mem.r8(HL()));         // 17ad or (hl)
    setHL(HL() + 1);                     // 17ae inc hl
    io.out(c, a);                        // 17af out (c),a
    a = and8(f, a, 0xc0);                // 17b1 and $c0
    a = add8(f, a, 0x40);                // 17b3 add a,$40
    b = (b - 1) & 0xff;                  // 17b5 djnz $17ad
  } while (b !== 0);
  // 17b7 ret

  regs.a = a & 0xff; regs.b = b & 0xff; regs.c = c & 0xff;
  regs.d = d & 0xff; regs.e = e & 0xff; regs.h = h & 0xff; regs.l = l & 0xff;
  ctx.cycles = 642;
}
