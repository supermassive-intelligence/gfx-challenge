// z80flags.js -- exact Z80 8-bit ALU flag semantics for the JS ports (Phase 9).
//
// Ported routines must reproduce the captured F byte EXACTLY (the bench compares
// `f` in CMP_KEYS). The undocumented X (bit3) and Y (bit5) flags are load-bearing
// because the records were captured from a real Z80 via MAME. The subtle rule:
//   - For most ops X/Y come from the RESULT byte.
//   - For CP, X/Y come from the OPERAND n (NOT the result) -- the documented Z80
//     quirk; CP is the one comparison Berzerk uses heavily.
//
// flags object shape: { S,Z,Y,H,X,P,N,C } each 0/1 (matches bench/port-hook ctx).

export function parity8(x) {
  x &= 0xff;
  x ^= x >> 4; x ^= x >> 2; x ^= x >> 1;
  return (x & 1) ? 0 : 1;            // even parity -> P=1
}

// Set S,Z,Y,X from a result byte (P/H/N/C are op-specific, set by callers).
function setSZYX(fl, res) {
  res &= 0xff;
  fl.S = (res >> 7) & 1;
  fl.Z = res === 0 ? 1 : 0;
  fl.Y = (res >> 5) & 1;
  fl.X = (res >> 3) & 1;
}

// SUB A,n  -> returns result; sets all flags. (Used by SUB; CP shares the math.)
export function sub8(fl, a, n) {
  a &= 0xff; n &= 0xff;
  const res = (a - n) & 0xff;
  setSZYX(fl, res);
  fl.H = ((a & 0x0f) - (n & 0x0f)) < 0 ? 1 : 0;
  fl.C = a < n ? 1 : 0;
  fl.N = 1;
  fl.P = (((a ^ n) & (a ^ res) & 0x80) !== 0) ? 1 : 0;   // signed overflow
  return res;
}

// CP n: identical to SUB A,n for S,Z,H,P,N,C, but X/Y come from the OPERAND n.
export function cp8(fl, a, n) {
  sub8(fl, a, n);
  n &= 0xff;
  fl.Y = (n >> 5) & 1;
  fl.X = (n >> 3) & 1;
}

export function add8(fl, a, n) {
  a &= 0xff; n &= 0xff;
  const sum = a + n;
  const res = sum & 0xff;
  setSZYX(fl, res);
  fl.H = ((a & 0x0f) + (n & 0x0f)) > 0x0f ? 1 : 0;
  fl.C = sum > 0xff ? 1 : 0;
  fl.N = 0;
  fl.P = ((~(a ^ n) & (a ^ res) & 0x80) !== 0) ? 1 : 0;
  return res;
}

export function and8(fl, a, n) {
  const res = (a & n) & 0xff;
  setSZYX(fl, res);
  fl.H = 1; fl.N = 0; fl.C = 0; fl.P = parity8(res);
  return res;
}

export function or8(fl, a, n) {
  const res = (a | n) & 0xff;
  setSZYX(fl, res);
  fl.H = 0; fl.N = 0; fl.C = 0; fl.P = parity8(res);
  return res;
}

export function xor8(fl, a, n) {
  const res = (a ^ n) & 0xff;
  setSZYX(fl, res);
  fl.H = 0; fl.N = 0; fl.C = 0; fl.P = parity8(res);
  return res;
}

// INC r / DEC r: C is PRESERVED; H/P/V/N/S/Z/X/Y from the result.
export function inc8(fl, r) {
  r &= 0xff;
  const res = (r + 1) & 0xff;
  setSZYX(fl, res);
  fl.H = (r & 0x0f) === 0x0f ? 1 : 0;
  fl.P = r === 0x7f ? 1 : 0;
  fl.N = 0;
  return res;
}

export function dec8(fl, r) {
  r &= 0xff;
  const res = (r - 1) & 0xff;
  setSZYX(fl, res);
  fl.H = (r & 0x0f) === 0x00 ? 1 : 0;
  fl.P = r === 0x80 ? 1 : 0;
  fl.N = 1;
  return res;
}

// SRL r: logical shift right. bit0 -> C, 0 -> bit7. S/Z/Y/X from result, P=parity,
// H=0, N=0. Returns the shifted byte.
export function srl8(fl, r) {
  r &= 0xff;
  const c = r & 1;
  const res = r >> 1;
  setSZYX(fl, res);
  fl.H = 0; fl.N = 0; fl.C = c; fl.P = parity8(res);
  return res;
}

// RR r: rotate right through carry. bit0 -> C, old C (cin) -> bit7. Flags like SRL.
export function rr8(fl, r, cin) {
  r &= 0xff;
  const c = r & 1;
  const res = ((r >> 1) | ((cin & 1) << 7)) & 0xff;
  setSZYX(fl, res);
  fl.H = 0; fl.N = 0; fl.C = c; fl.P = parity8(res);
  return res;
}

// SBC HL,rr (16-bit subtract with borrow). Sets ALL flags; N=1, P=signed overflow,
// Y/X from result high byte. Returns the 16-bit result.
export function sbcHL16(fl, hl, rr, cin) {
  hl &= 0xffff; rr &= 0xffff; cin &= 1;
  const full = hl - rr - cin;
  const res = full & 0xffff;
  fl.S = (res >> 15) & 1;
  fl.Z = res === 0 ? 1 : 0;
  fl.H = (((hl & 0x0fff) - (rr & 0x0fff) - cin) < 0) ? 1 : 0;
  fl.C = full < 0 ? 1 : 0;
  fl.N = 1;
  fl.P = (((hl ^ rr) & (hl ^ res) & 0x8000) !== 0) ? 1 : 0;
  fl.Y = (res >> 13) & 1;            // bit 5 of high byte
  fl.X = (res >> 11) & 1;            // bit 3 of high byte
  return res;
}

// ADD HL,rr (16-bit): affects H,N,C and the undocumented Y,X (from result high
// byte); PRESERVES S,Z,P. Returns the 16-bit result.
export function addHL16(fl, hl, rr) {
  hl &= 0xffff; rr &= 0xffff;
  const sum = hl + rr;
  const res = sum & 0xffff;
  fl.C = sum > 0xffff ? 1 : 0;
  fl.H = ((hl & 0x0fff) + (rr & 0x0fff)) > 0x0fff ? 1 : 0;
  fl.N = 0;
  fl.Y = (res >> 13) & 1;            // bit 5 of high byte
  fl.X = (res >> 11) & 1;            // bit 3 of high byte
  return res;
}

// DAA: decimal-adjust A after add/sub of BCD operands. The correction depends on
// the CURRENT H,N,C flags and A; output C/H are recomputed, N is preserved, and
// S/Z/Y/X/P come from the adjusted result. Validated exhaustively vs z80_core.js
// (all 256 A x {N,H,C} = 2048 cases) -- see tools/validate_flags.js.
export function daa8(fl, a) {
  a &= 0xff;
  let corr = 0;
  let carry = fl.C;
  if (fl.H || (a & 0x0f) > 9) corr |= 0x06;
  if (fl.C || a > 0x99) { corr |= 0x60; carry = 1; }
  const res = (fl.N ? (a - corr) : (a + corr)) & 0xff;
  // H: half-borrow (N) or half-carry (add) produced by the correction.
  fl.H = fl.N ? ((fl.H && (a & 0x0f) < 6) ? 1 : 0)
              : (((a & 0x0f) > 9) ? 1 : 0);
  setSZYX(fl, res);
  fl.P = parity8(res);
  fl.C = carry;
  // N preserved.
  return res;
}

// SLA r: shift-left arithmetic. bit7 -> C, 0 -> bit0. S/Z/Y/X from result, P=parity,
// H=0, N=0. Returns the shifted byte.
export function sla8(fl, r) {
  r &= 0xff;
  const c = (r >> 7) & 1;
  const res = (r << 1) & 0xff;
  setSZYX(fl, res);
  fl.H = 0; fl.N = 0; fl.C = c; fl.P = parity8(res);
  return res;
}

// RLA: rotate A left through carry (non-prefixed accumulator op). Only C,H,N and the
// undocumented Y,X are affected; S,Z,P are PRESERVED. cin = old carry. Returns A.
export function rla8(fl, a, cin) {
  a &= 0xff;
  const c = (a >> 7) & 1;
  const res = ((a << 1) | (cin & 1)) & 0xff;
  fl.C = c; fl.H = 0; fl.N = 0;
  fl.Y = (res >> 5) & 1; fl.X = (res >> 3) & 1;
  return res;
}

// RLCA: rotate A left circular (non-prefixed). Only C,H,N,Y,X affected; S,Z,P
// PRESERVED. Returns A.
export function rlca8(fl, a) {
  a &= 0xff;
  const c = (a >> 7) & 1;
  const res = ((a << 1) | c) & 0xff;
  fl.C = c; fl.H = 0; fl.N = 0;
  fl.Y = (res >> 5) & 1; fl.X = (res >> 3) & 1;
  return res;
}

// BIT n,(ix+d) / (iy+d): test bit n of the addressed byte. Z/P = (bit clear); H=1,
// N=0; S = bit7-set only when n==7; C PRESERVED. The undocumented X/Y come from the
// HIGH BYTE of the computed address (ix+d), which the port ctx HAS -- so unlike
// bit n,(hl) (WZ-sourced, unportable) this IS reproducible (documented-hardware rule).
// NOTE: z80_core.js uses a SIMPLIFIED bit-number rule for BIT undoc flags (X/Y keyed
// off n, not the address), so validate_flags can only cross-check the documented bits;
// the X/Y rule here is the hardware one, exercised against MAME records via 0x15cb.
export function bitIdx8(fl, n, val, addrHi) {
  val &= 0xff; addrHi &= 0xff;
  const bit = (val >> n) & 1;
  fl.Z = bit ? 0 : 1;
  fl.P = fl.Z;
  fl.H = 1; fl.N = 0;
  fl.S = (n === 7 && bit) ? 1 : 0;
  fl.Y = (addrHi >> 5) & 1;
  fl.X = (addrHi >> 3) & 1;
  // C preserved.
}

// BIT n,(hl): test bit n of (hl). Z/P=(bit clear); H=1; N=0; S=(bit7 set, n==7);
// C PRESERVED. The undocumented X/Y come from the Z80 internal WZ register, which
// the port ctx CANNOT see -- so this helper sets X/Y to 0 and is ONLY safe where the
// F byte is NOT observed at a `ret` (i.e. `bit n,(hl)` used as a MID-routine branch
// whose flags are overwritten before any return). A routine that does `bit n,(hl)`
// then `ret z/nz` exposes the WZ-sourced X/Y and is NOT portable with this helper
// (the WZ hazard: 0x3719/0x27a9 -- see decisions.md 2026-06-18). Callers must
// confirm no observed return reads these flags.
export function bitHL8(fl, n, val) {
  val &= 0xff;
  const bit = (val >> n) & 1;
  fl.Z = bit ? 0 : 1;
  fl.P = fl.Z;
  fl.H = 1; fl.N = 0;
  fl.S = (n === 7 && bit) ? 1 : 0;
  fl.Y = 0; fl.X = 0;                 // WZ-sourced on real hw; unreproducible here
  // C preserved.
}
