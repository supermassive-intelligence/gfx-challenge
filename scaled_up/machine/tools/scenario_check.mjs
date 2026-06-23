// scenario_check.mjs -- prove a credited-gameplay scenario happened via RAM state + report
// the NEW routine entryPCs it reaches vs the attract-reachable baseline. Capture/analysis
// only; no engine changes. Work order: cdoc/credited-gameplay-capture-workorder.md.
//
// Usage: node tools/scenario_check.mjs <script.jsonl> [--baseline=traces/segmented/attract-only.entrypcs.json]
//                                      [--find] [--watch=0xADDR,...]
//   --find : scan work RAM for bytes that INCREMENT (score candidates) or DECREMENT
//            (lives candidates) after the game starts (post-frame 660), to locate indicators
//            the attract-derived RAM map lacks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { assembleRoms } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';
import { captureTrace } from './heavy_trace_capture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROM_DIR = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const romRead = (n) => new Uint8Array(fs.readFileSync(path.join(ROM_DIR, n)));

const args = process.argv.slice(2);
const scriptPath = args[0];
const baselineArg = args.find((a) => a.startsWith('--baseline='));
const baseline = baselineArg
  ? new Set(JSON.parse(fs.readFileSync(path.resolve(ROOT, baselineArg.split('=')[1]), 'utf8')))
  : null;
const doFind = args.includes('--find');
const watchArg = args.find((a) => a.startsWith('--watch='));
const watch = watchArg ? watchArg.split('=')[1].split(',').map((s) => parseInt(s, 16)) : [];
const abs = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(ROOT, scriptPath);
const scriptText = fs.readFileSync(abs, 'utf8');

const GAME_START = 660;   // ~POST(573) + start-button settle; scan for game state after this

// ---- run 1: entryPCs ----
const entryPCs = new Set();
let invCount = 0;
const { frames } = captureTrace({ romRead, scriptText, onInvocation: (inv) => { invCount++; entryPCs.add(inv.entryPC); } });

// ---- run 2: per-frame RAM + port sampling ----
const { header, records } = parseScript(scriptText);
const m = new Machine(); m.loadRoms(assembleRoms(romRead)); m.reset();
const player = new ScriptPlayer(m.input, header, records);
const portReads = new Map();
const origRP = m.cpu.callbacks.readPort;
m.cpu.callbacks.readPort = (p) => { p &= 0xff; portReads.set(p, (portReads.get(p) || 0) + 1); return origRP(p); };
const rd = (a) => m.memory.read8(a) & 0xff;

const lo = 0x0800, hi = 0x094c;
const prevByte = new Array(0x10000).fill(0);
const incCount = new Map(), decCount = new Map();         // post-game-start monotonic moves
const incLog = new Map(), decLog = new Map();             // value sequence
const wtl = new Map(watch.map((a) => [a, []]));
const ind = {};
const sample = (a) => rd(a);

const total = Math.min(header.frames || 0, frames || (header.frames || 0));
for (let f = 0; f < total; f++) {
  player.applyFrame(f);
  m.runFrame();
  for (const a of watch) wtl.get(a).push(rd(a));
  if (doFind && f > GAME_START) {
    for (let a = lo; a <= hi; a++) {
      const v = rd(a), p = prevByte[a];
      if (f > GAME_START + 1 && v !== p) {
        if (((v - p) & 0xff) < 0x40 && v > p) { incCount.set(a, (incCount.get(a) || 0) + 1); if (!incLog.has(a)) incLog.set(a, []); incLog.get(a).push(`f${f}:${p}->${v}`); }
        if (((p - v) & 0xff) < 0x40 && v < p) { decCount.set(a, (decCount.get(a) || 0) + 1); if (!decLog.has(a)) decLog.set(a, []); decLog.get(a).push(`f${f}:${p}->${v}`); }
      }
      prevByte[a] = v;
    }
  } else if (doFind) {
    for (let a = lo; a <= hi; a++) prevByte[a] = rd(a);
  }
}

// final snapshot of key indicators
for (const a of [0x08a3, 0x436e, 0x4344, 0x435c, 0x435d, 0x089c, 0x089d, 0x089e, 0x08a4, 0x08a5]) ind[a] = rd(a);

// ---- report ----
console.log(`SCRIPT ${path.basename(scriptPath)}  frames=${total}  invocations=${invCount}  distinctEntryPCs=${entryPCs.size}`);
const pr = (p) => portReads.get(p) || 0;
console.log(`PORTS: 0x48(player input)=${pr(0x48)}  0x49(coin/start)=${pr(0x49)}  0x67(coinage DIP)=${pr(0x67)}`);
console.log(`STATE@end: credits 0x8a3=${ind[0x08a3]}  game_active 0x436e=0x${ind[0x436e].toString(16)}  ` +
            `current_player 0x4344=${ind[0x4344]}  score 0x89c-e=${ind[0x089c]},${ind[0x089d]},${ind[0x089e]}  ` +
            `0x8a4/5=${ind[0x08a4]},${ind[0x08a5]}`);

if (watch.length) {
  console.log('-- watch timelines (changes only) --');
  for (const a of watch) {
    const tl = wtl.get(a); const ch = []; let prev = null;
    tl.forEach((v, f) => { if (v !== prev) { ch.push(`f${f}=0x${v.toString(16)}`); prev = v; } });
    console.log(`  0x${a.toString(16)}: ${ch.join(' ')}`);
  }
}

if (doFind) {
  const topInc = [...incCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topDec = [...decCount.entries()].filter(([, c]) => c >= 1).sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log('-- INCREMENTING bytes after game start (score candidates) --');
  for (const [a, c] of topInc) console.log(`  0x${a.toString(16)} x${c}: ${incLog.get(a).slice(0, 8).join(' ')}`);
  console.log('-- DECREMENTING bytes after game start (lives candidates) --');
  for (const [a, c] of topDec) console.log(`  0x${a.toString(16)} x${c}: ${decLog.get(a).slice(0, 10).join(' ')}`);
}

if (baseline) {
  const newPCs = [...entryPCs].filter((p) => !baseline.has(p)).sort();
  const missing = [...baseline].filter((p) => !entryPCs.has(p)).length;
  console.log(`-- COVERAGE vs baseline (${baseline.size}) --`);
  console.log(`  NEW entryPCs (${newPCs.length}): ${newPCs.join(' ')}`);
  console.log(`  (reached ${entryPCs.size}; ${missing} baseline PCs not reached by this script)`);
}
