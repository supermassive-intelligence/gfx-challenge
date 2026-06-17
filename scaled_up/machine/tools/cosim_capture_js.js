// cosim_capture_js.js -- JS-side register-state capture at the per-frame IRQ sync point.
//
// Method (per Sudnya's sync-point decision): cold reset, no input, capture the
// full Z80 register state at every entry to PC=0x26D9 (BOTTOM_OF_SCREEN_INTERRUPT,
// the once-per-frame end-of-frame IRQ handler). The Nth hit corresponds to frame N,
// so the snapshot there is directly comparable to MAME's snapshot at the same hit.
//
// The capture fires BEFORE executing the instruction at 0x26D9, so registers are
// the foreground state at IRQ entry.
//
// Usage:  node tools/cosim_capture_js.js [frames] [out.jsonl]
//   frames  number of video frames to run (default 300)
//   out     output path (default /tmp/cosim_js.jsonl); "-" writes to stdout
//
// Output: one JSONL record per 0x26D9 hit, fields identical to sync_capture.lua.

import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';

const SYNC_PC = 0x26d9;

const ROM_DIR = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';

function u16(hi, lo) { return ((hi << 8) | lo) & 0xffff; }

// F byte from the core's flag object (Z80 bit layout S Z Y H X P N C).
function fByte(f) {
  return ((f.S & 1) << 7) | ((f.Z & 1) << 6) | ((f.Y & 1) << 5) | ((f.H & 1) << 4)
       | ((f.X & 1) << 3) | ((f.P & 1) << 2) | ((f.N & 1) << 1) | (f.C & 1);
}

function snapshot(s) {
  return {
    af: u16(s.a, fByte(s.flags)),
    bc: u16(s.b, s.c),
    de: u16(s.d, s.e),
    hl: u16(s.h, s.l),
    ix: s.ix & 0xffff,
    iy: s.iy & 0xffff,
    sp: s.sp & 0xffff,
    af_: u16(s.a_prime, fByte(s.flags_prime)),
    bc_: u16(s.b_prime, s.c_prime),
    de_: u16(s.d_prime, s.e_prime),
    hl_: u16(s.h_prime, s.l_prime),
    i: s.i & 0xff,
    r: s.r & 0xff,
  };
}

function main() {
  const frames = parseInt(process.argv[2] || '300', 10);
  const outPath = process.argv[3] || '/tmp/cosim_js.jsonl';

  const romData = {};
  for (const f of ROM_FILES) {
    romData[f] = new Uint8Array(fs.readFileSync(path.join(ROM_DIR, f)));
  }

  const machine = new Machine();
  machine.loadRoms(assembleRoms((name) => romData[name]));
  machine.reset();

  const lines = [];
  let n = 0;
  machine.scheduler.onStep = (sch) => {
    const st = sch.cpu.getState();
    if (st.pc !== SYNC_PC) return;
    const snap = snapshot(st);
    snap.ret = machine.memory.read16(st.sp & 0xffff); // foreground PC pushed by the IRQ ack
    snap.n = n++;
    snap.frame = sch.frameCount;
    lines.push(JSON.stringify(snap));
  };

  for (let f = 0; f < frames; f++) machine.runFrame();

  const out = lines.join('\n') + '\n';
  if (outPath === '-') process.stdout.write(out);
  else { fs.writeFileSync(outPath, out); console.error(`wrote ${n} hits over ${frames} frames -> ${outPath}`); }
}

main();
