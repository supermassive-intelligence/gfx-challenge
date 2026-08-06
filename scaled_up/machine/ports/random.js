// Ported routine: RANDOM @0x2678 (the LCG; T6.1/T6.2 = canonical RANDOM, verified).
//   seed = (0x435C);  seed = (7*seed + 0x3153) & 0xFFFF;  (0x435C) = seed;  A = high(seed)
// Z80 source (Tunstall berzerk.asm):
//   push hl; ld hl,($435C); ld d,h; ld e,l; add hl,hl; add hl,de; add hl,hl; add hl,de;
//   ld de,$3153; add hl,de; ld ($435C),hl; ld a,h; pop hl; ret
// The push/pop of HL is stack scaffolding (stripped by the bench); HL is preserved.
// Flags at exit are those of the final `add hl,de`: ADD HL,rr affects H,N,C and the
// undocumented Y,X (from the result high byte) but PRESERVES S,Z,P/V.
export function RANDOM(ctx) {
  const { regs, flags, mem } = ctx;
  const seed = mem.r16(0x435c);
  const hl = (7 * seed) & 0xffff;          // 7*seed via the add chain (mod 0x10000)
  const de = 0x3153;
  const res = (hl + de) & 0xffff;
  mem.w16(0x435c, res);
  regs.a = (res >> 8) & 0xff;              // ld a,h
  regs.d = (de >> 8) & 0xff;               // ld de,$3153 clobbers DE (E too)
  regs.e = de & 0xff;
  // ADD HL,DE flags (last flag-affecting op):
  flags.C = (hl + de) > 0xffff ? 1 : 0;
  flags.H = ((hl & 0x0fff) + (de & 0x0fff)) > 0x0fff ? 1 : 0;
  flags.N = 0;
  flags.Y = (res >> 8 >> 5) & 1;           // bit 5 of result high byte
  flags.X = (res >> 8 >> 3) & 1;           // bit 3 of result high byte
  // S, Z, P/V preserved (16-bit ADD does not touch them) -- flags object already
  // holds the entry values, so leave flags.S/Z/P untouched.
}
