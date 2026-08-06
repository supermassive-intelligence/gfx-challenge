// MAGIC_ADDR_TO_DE @0x25e4 -- compute the magic-image-RAM address for the position in
// HL (control nibble base $10) via CALCULATE_MAGIC_IMAGE_RAM_ADDRESS (0x29a3, ported)
// and return it in DE. Tiny non-leaf composite:
//   25e4 ld b,$10 ; call $29a3 ; ex de,hl ; ret
//
// COST: straight-line -> fixed OWN cost 167 T (FLIP==0) / 196 T (FLIP!=0, cocktail,
// bench-unexercised). The measured max (5085) is ISR-inflated from interrupted runs,
// which DECLINE; the own cost is well under the inter-interrupt gap, so this FAST-PATHS.
// maxCycles = 196 (the cocktail worst case) so the gate never under-counts.
//
// RESIDUE: SP is in VRAM (0x42xx), so the `call $29a3` return-address residue 0x25E9 at
// entry_sp-2 is visible -> PORT_META pushes:[0x25e9]. (0x29a3 is a leaf: out $4B, no
// pushes of its own.)
import { CALCULATE_MAGIC_IMAGE_RAM_ADDRESS } from './magic_image_addr.js';

export function MAGIC_ADDR_TO_DE(ctx) {
  const g = ctx.regs;
  let cyc = 0;
  g.b = 0x10; cyc += 7;                              // 25e4 ld b,$10
  cyc += 17; ctx.cycles = 0; CALCULATE_MAGIC_IMAGE_RAM_ADDRESS(ctx); cyc += ctx.cycles; // 25e6 call $29a3
  const d = g.d, e = g.e; g.d = g.h; g.e = g.l; g.h = d; g.l = e; cyc += 4; // 25e9 ex de,hl
  ctx.cycles = cyc + 10;                             // 25ea ret
}
