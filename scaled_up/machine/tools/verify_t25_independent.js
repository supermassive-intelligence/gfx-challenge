// verify_t25_independent.js — human-gate verification for T2.5.
//
// PURPOSE: break the author-circularity of T2.5 (same session wrote spec §4,
// video.js, and video.test.js). This script contains an INDEPENDENT reference
// model built from only two sources the session did not write:
//   1. The TI 74181 datasheet function table (M=1, active-high) — public, 1970.
//   2. MAME berzerk.cpp magicram_w / magicram_control_w / intercept_v256_r,
//      pasted verbatim from the driver (L449-504) during the T2.5 unblock.
// It drives machine/src/video.js with the same inputs and diffs every result.
// It does NOT import the session's ALU, spec tables, or test expectations.
//
// Run:  cd machine && node tools/verify_t25_independent.js
// Exit 0 = all comparisons match. Any mismatch prints loudly and exits 1.

import { Video } from '../src/video.js';

// --- Source 1: TI 74181 datasheet, logic mode (M=1), active-high data -------
const DATASHEET = [
  { name: 'NOT A',      f: (a, b) => ~a },
  { name: 'NOT(A|B)',   f: (a, b) => ~(a | b) },
  { name: '(NOT A)&B',  f: (a, b) => ~a & b },
  { name: '0',          f: (a, b) => 0x00 },
  { name: 'NOT(A&B)',   f: (a, b) => ~(a & b) },
  { name: 'NOT B',      f: (a, b) => ~b },
  { name: 'A XOR B',    f: (a, b) => a ^ b },
  { name: 'A&(NOT B)',  f: (a, b) => a & ~b },
  { name: '(NOT A)|B',  f: (a, b) => ~a | b },
  { name: 'XNOR',       f: (a, b) => ~(a ^ b) },
  { name: 'B',          f: (a, b) => b },
  { name: 'A&B',        f: (a, b) => a & b },
  { name: '1 (all 1s)', f: (a, b) => 0xff },
  { name: 'A|(NOT B)',  f: (a, b) => a | ~b },
  { name: 'A|B',        f: (a, b) => a | b },
  { name: 'A',          f: (a, b) => a },
];

// --- Source 2: reference model transcribed from the pasted MAME C -----------
class RefMagicram {
  constructor() { this.control = 0; this.latch = 0; this.intercept = 1; this.vram = new Uint8Array(0x2000); }
  writeControl(d) { this.control = d & 0xff; this.latch = 0; this.intercept = 1; }       // L486-493
  write(off, data) {                                                                     // L449-483
    const cur = this.vram[off];
    let shifted = (((this.latch << 8) | data) >> (this.control & 0x07)) & 0xff;          // L459
    if (this.control & 0x08) {                                                           // L461-462 bitswap
      let r = 0; for (let i = 0; i < 8; i++) if (shifted & (1 << i)) r |= 1 << (7 - i);
      shifted = r;
    }
    if (shifted & cur) this.intercept = 0;                                               // L466-467
    const f = DATASHEET[this.control >> 4].f(shifted, cur) & 0xff;                       // L470-477
    this.vram[off] = (f ^ 0xff) & 0xff;                                                  // L479 inverted store
    this.latch = data & 0x7f;                                                            // L482 7-bit latch
  }
  readIntercept(v256 = 0) { return (((this.intercept ^ 1) << 7) | (v256 & 0x7f)) & 0xff; } // L496-504
}

const bin = (x) => x.toString(2).padStart(8, '0');
const hex = (x) => '0x' + x.toString(16).padStart(2, '0');
let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: video.js=${hex(got)} reference=${hex(want)}${ok ? '' : '  <-- MISMATCH'}`);
  return ok;
}

// === Part 1: all 16 ALU selects, two input pairs, full work shown ============
console.log('\n=== Part 1: 16 ALU selects (shift 0, no flip), datasheet-derived ===');
for (const [A, B] of [[0xaa, 0xcc], [0x3c, 0x0f]]) {
  console.log(`\nInputs: A(written)=${hex(A)} ${bin(A)}   B(vram)=${hex(B)} ${bin(B)}`);
  for (let s = 0; s < 16; s++) {
    const f = DATASHEET[s].f(A, B) & 0xff;
    const want = (f ^ 0xff) & 0xff;
    const v = new Video();
    v.writeVram(0x100, B);
    v.writeControl(s << 4);
    v.writeMagic(0x100, A);
    const got = v.readVram(0x100);
    console.log(`  S=${s.toString(16)} F=${DATASHEET[s].name.padEnd(11)} F(A,B)=${hex(f)} ${bin(f)}  stored=F^FF=${hex(want)} ${bin(want)}`);
    check(`    select ${s.toString(16)}`, got, want);
  }
}

// === Part 2: shift / flip / latch differential fuzz ==========================
console.log('\n=== Part 2: fuzz — random control/data/vram, 2-write sequences (latch) ===');
let seed = 0xbe22e21c;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) & 0xff; };
const FUZZ = 2000;
let fuzzFail = 0;
for (let i = 0; i < FUZZ; i++) {
  const ctrl = rnd(), v1 = rnd(), v2 = rnd(), d1 = rnd(), d2 = rnd();
  const ref = new RefMagicram();
  const vid = new Video();
  ref.vram[0] = v1; ref.vram[1] = v2;
  vid.writeVram(0, v1); vid.writeVram(1, v2);
  ref.writeControl(ctrl); vid.writeControl(ctrl);
  ref.write(0, d1); vid.writeMagic(0, d1);   // first write primes the latch
  ref.write(1, d2); vid.writeMagic(1, d2);   // second write consumes it
  const okA = vid.readVram(0) === ref.vram[0];
  const okB = vid.readVram(1) === ref.vram[1];
  const okI = (vid.readIntercept() & 0x80) === (ref.readIntercept() & 0x80);
  if (!(okA && okB && okI)) {
    fuzzFail++; failures++;
    console.log(`FAIL case ${i}: ctrl=${hex(ctrl)} vram=[${hex(v1)},${hex(v2)}] data=[${hex(d1)},${hex(d2)}]`);
    console.log(`  byte0: video.js=${hex(vid.readVram(0))} ref=${hex(ref.vram[0])}`);
    console.log(`  byte1: video.js=${hex(vid.readVram(1))} ref=${hex(ref.vram[1])}`);
    console.log(`  intercept bit7: video.js=${vid.readIntercept() & 0x80} ref=${ref.readIntercept() & 0x80}`);
  }
}
console.log(`fuzz: ${FUZZ} randomized 2-write sequences, ${fuzzFail} mismatches`);
console.log('(covers shift amounts 0-7, flip bit, 7-bit latch carry, all 16 selects, collision flop)');

// === Part 3: intercept semantics from the C, explicitly ======================
console.log('\n=== Part 3: intercept flop semantics (L466-467, L486-493, L496-504) ===');
{
  const v = new Video();
  v.writeControl(0x00);
  check('after control write (flop SET, read bit7 inverted -> 0)', v.readIntercept() & 0x80, 0x00);
  v.writeVram(5, 0x00); v.writeMagic(5, 0xff);
  check('non-colliding write leaves flop set (bit7 0)', v.readIntercept() & 0x80, 0x00);
  v.writeVram(6, 0xf0); v.writeMagic(6, 0x10);
  check('colliding write RESETS flop (bit7 reads 1)', v.readIntercept() & 0x80, 0x80);
  check('read does not clear (bit7 still 1)', v.readIntercept() & 0x80, 0x80);
  v.writeControl(0x00);
  check('control write re-sets (bit7 back to 0)', v.readIntercept() & 0x80, 0x00);
}

// === Verdict =================================================================
console.log('\n==============================================================');
if (failures === 0) {
  console.log('PASS: video.js matches the datasheet+MAME reference on every case.');
  process.exit(0);
} else {
  console.log(`FAIL: ${failures} mismatch(es). Do NOT flip T2.5. Bring the log to review.`);
  process.exit(1);
}
