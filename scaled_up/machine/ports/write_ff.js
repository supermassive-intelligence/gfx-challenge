// WRITE_FF_64_TIMES_HL @0x1a45 -- fill 64 bytes starting at HL with 0xFF.
// Z80 (Tunstall):
//   ld a,$FF; ld b,$40; loop: ld (hl),a; inc hl; djnz loop; ret
// No flag-affecting ops -> F unchanged. regs_out: A=0xFF, B=0, HL=HL+64.
export function WRITE_FF_64_TIMES_HL(ctx) {
  const { regs, mem } = ctx;
  let hl = ((regs.h << 8) | regs.l) & 0xffff;
  for (let i = 0; i < 64; i++) { mem.w8(hl, 0xff); hl = (hl + 1) & 0xffff; }
  regs.a = 0xff;
  regs.b = 0x00;
  regs.h = (hl >> 8) & 0xff;
  regs.l = hl & 0xff;
}
