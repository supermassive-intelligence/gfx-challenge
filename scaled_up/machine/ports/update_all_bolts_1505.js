// UPDATE_ALL_BOLT_SLOTS @0x1505 -- iterate B bolt slots (stride 8 from 0x437B), calling
// UPDATE_BOLT_SLOT (0x151a, ported) on each. Non-leaf composite; the loop saves/restores
// IY and BC around each inner call (0x151a bumps IY by 4 and rewrites BC, so 0x1505
// push/pop-protects the slot pointer and the djnz counter).
//
// DECODE NOTE: `ld iy,$437b` at 0x1505 is FD 21 7B 43 -- a 4-byte instruction, so the
// loop body starts at 0x1509 (push bc). The loop count B is an INPUT register (the
// caller passes it); there is NO `ld a,e`/`ld b,e`. (An earlier z80 disassembler reported
// FD 21 as length 2 and produced phantom `ld a,e; ld b,e` from the operand bytes 7B 43 --
// a mis-decode; the records confirm out.iy = 0x437B + 8*B_in. Verified via skoolkit +
// raw ROM bytes.)
//
// COST: 124..2845 T over the 5 scripts (13852 invocations); 2845 < the inter-interrupt
// gap (~4000) -> FAST-PATHS. SP in work RAM (0x082c) on every invocation -> push + inner
// residue outside the rendered window, no pushes.
//
// Disasm (entry .. ret):
//   1505 ld iy,$437b    150c call $151a     1512 ld de,$0008
//   1509 push bc         150f pop iy          1515 add iy,de
//   150a push iy         1511 pop bc          1517 djnz $1509
//                                             1519 ret
import { addHL16 } from './z80flags.js';
import { UPDATE_BOLT_SLOT } from './update_bolt_slot_151a.js';

export function UPDATE_ALL_BOLT_SLOTS(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  let cyc = 0;

  g.iy = 0x437b; cyc += 14;                       // 1505 ld iy,$437b (FD 21 7B 43, 4 bytes)
  do {
    const savB = g.b, savC = g.c; cyc += 11;      // 1509 push bc
    const savIY = g.iy & 0xffff; cyc += 15;       // 150a push iy
    cyc += 17; ctx.cycles = 0; UPDATE_BOLT_SLOT(ctx); cyc += ctx.cycles; // 150c call $151a
    g.iy = savIY; cyc += 14;                       // 150f pop iy
    g.b = savB; g.c = savC; cyc += 10;             // 1511 pop bc
    g.d = 0x00; g.e = 0x08; cyc += 10;             // 1512 ld de,$0008
    g.iy = addHL16(fl, g.iy & 0xffff, 0x0008); cyc += 15; // 1515 add iy,de
    g.b = (g.b - 1) & 0xff;                        // 1517 djnz (dec b)
    cyc += (g.b !== 0) ? 13 : 8;
  } while (g.b !== 0);
  ctx.cycles = cyc + 10;                          // 1519 ret
}
