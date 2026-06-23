// CHECK_IF_ZERO_OR_E @0x1597 -- leaf, no writes. If A is 0 OR A == E, set B = 0;
// otherwise leave B unchanged. A is unchanged either way.
// Z80 (Tunstall):
//   cp $00
//   jr z,$159D     ; A == 0 -> set B
//   cp e
//   ret nz         ; A != E -> leave B
//   159D: ld b,$00
//   ret
// F = flags of the LAST compare executed: `cp $00` if A==0, else `cp e`.
import { cp8 } from './z80flags.js';

export function CHECK_IF_ZERO_OR_E(ctx) {
  const { regs, flags } = ctx;
  const a = regs.a & 0xff;
  // T-states: cp $00 7 + jr z 7/12.
  if (a === 0) {
    cp8(flags, a, 0x00);
    regs.b = 0;
    ctx.cycles = 7 + 12 + 7 + 10;            // jr z taken + ld b,0 + ret = 36
    return;
  }
  const e = regs.e & 0xff;
  cp8(flags, a, e);
  if (a === e) { regs.b = 0; ctx.cycles = 7 + 7 + 4 + 5 + 7 + 10; }  // ret nz not taken = 40
  else ctx.cycles = 7 + 7 + 4 + 11;          // ret nz taken = 29
}
