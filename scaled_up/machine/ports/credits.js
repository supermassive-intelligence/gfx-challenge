// GET_CREDITS_AS_BCD @0x18e0 -- straight-line leaf (no branches, no writes).
// Z80 (Tunstall):
//   ld a,($08A5); rrca;rrca;rrca;rrca; and $0F; ld c,a
//   ld a,($08A4); and $F0; or c; ret
// Returns the two-digit BCD credit count in A: high nibble of CMOS_CREDITS in the
// high nibble, the (swapped-down) value from CMOS_CREDITS+1 in the low nibble.
// Final flag-affecting op is `or c`, so F = OR flags of the result.
import { or8 } from './z80flags.js';

export function GET_CREDITS_AS_BCD(ctx) {
  const { regs, flags, mem } = ctx;
  const hi = mem.r8(0x08a5);
  const c = (hi >> 4) & 0x0f;           // rrca x4 (swap nibbles) then and $0F
  regs.c = c;                           // ld c,a
  const lo = mem.r8(0x08a4) & 0xf0;     // and $F0
  regs.a = or8(flags, lo, c);           // or c -> A, flags
}
