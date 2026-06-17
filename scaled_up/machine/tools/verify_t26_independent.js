// verify_t26_independent.js — human-gate verification for T2.6.
//
// Breaks the author-circularity: scheduler.js + its tests share one author.
// This recomputes the interrupt schedule from the berzerk.cpp constants
// (pasted during the T2.6 unblock) by an INDEPENDENT path, then diffs against
// scheduler.js's exports. It does NOT import scheduler's vsync functions for
// its own derivation — it hardcodes the expected targets worked out by hand —
// and only imports scheduler to compare.
//
// Run:  cd machine && node tools/verify_t26_independent.js
// Exit 0 = match. Mismatch prints loudly and exits 1.

import {
  CYCLES_PER_FRAME, CYCLES_PER_SCANLINE, FRAME_EVENTS,
  vsyncToVpos, vposToVsync, HTOTAL, VTOTAL,
} from '../src/scheduler.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}${ok ? '' : '  <-- MISMATCH'}`);
};

// === 1. Frame budget, derived independently from clocks ======================
// MASTER 10MHz; CPU = /4 = 2.5MHz; PIXEL = /2 = 5MHz -> 2 px per CPU T-state.
// HTOTAL=320 px/line -> 160 T-states/line. VTOTAL=262 lines.
console.log('\n=== 1. Frame budget (independent from clocks) ===');
const cyclesPerLine = 320 / 2;          // 160
const cyclesPerFrame = cyclesPerLine * 262;  // 41920
eq('cycles/scanline', CYCLES_PER_SCANLINE, cyclesPerLine);
eq('cycles/frame', CYCLES_PER_FRAME, cyclesPerFrame);
eq('HTOTAL', HTOTAL, 0x140);
eq('VTOTAL', VTOTAL, 0x106);

// === 2. Hand-worked expected interrupt schedule ==============================
// From berzerk.cpp: irq counts {0x80,0xda} v256 {0,0x01};
//   nmi counts {0x30..0xf0,0xf0} v256 {0..0,0x01}.
// vsync_chain_counter_to_vpos: v256==0 -> vpos=counter;
//   v256==1 -> vpos = counter-0xda+0x100, minus 0x106 if >= VTOTAL.
// Worked out by hand (NOT by calling scheduler):
//   NMI: 0x30->48 0x50->80 0x70->112 0x90->144 0xb0->176 0xd0->208
//        0xf0(v0)->240  0xf0(v1)->0xf0-0xda+0x100=0x116>=262 ->0x116-0x106=16
//   IRQ: 0x80(v0)->128  0xda(v1)->0xda-0xda+0x100=0x100=256
const expectNmiVpos = [16, 48, 80, 112, 144, 176, 208, 240];
const expectIrqVpos = [128, 256];
const cyc = (v) => v * 160;

console.log('\n=== 2. Interrupt positions (hand-derived from source) ===');
// Confirm scheduler's conversion matches the hand math at each trigger point.
const checkConv = (counter, v256, wantVpos) =>
  eq(`vsyncToVpos(0x${counter.toString(16)},${v256})`, vsyncToVpos(counter, v256), wantVpos);
checkConv(0x30, 0, 48); checkConv(0xf0, 0, 240); checkConv(0xf0, 1, 16);
checkConv(0x80, 0, 128); checkConv(0xda, 1, 256);

// round-trip sanity on the two tricky v256=1 cases
eq('roundtrip vpos16',  vposToVsync(16),  { counter: 0xf0, v256: 1 });
eq('roundtrip vpos256', vposToVsync(256), { counter: 0xda, v256: 1 });

// === 3. Diff the full sorted event table against scheduler.FRAME_EVENTS ======
console.log('\n=== 3. Full per-frame event table ===');
const expected = [
  ...expectNmiVpos.map(v => ({ type: 'nmi', vpos: v, cycle: cyc(v) })),
  ...expectIrqVpos.map(v => ({ type: 'irq', vpos: v, cycle: cyc(v) })),
].sort((a, b) => a.cycle - b.cycle || a.type.localeCompare(b.type));

const actual = FRAME_EVENTS.map(e => ({ type: e.type, vpos: e.vpos, cycle: e.cycle }))
  .sort((a, b) => a.cycle - b.cycle || a.type.localeCompare(b.type));

console.log('expected:', expected.map(e => `${e.type}@${e.vpos}`).join(' '));
console.log('actual:  ', actual.map(e => `${e.type}@${e.vpos}`).join(' '));
eq('event count', actual.length, 10);
eq('full event table', actual, expected);

// cross-check against the user's live MAME beam reading
console.log('\n(NMI vpos set matches the live MAME beam check: 16,48,80,112,... observed)');

console.log('\n==============================================================');
if (fail === 0) {
  console.log('PASS: scheduler schedule matches the independent re-derivation.');
  process.exit(0);
} else {
  console.log(`FAIL: ${fail} mismatch(es). Do NOT flip T2.6.`);
  process.exit(1);
}
