// credited_probe.mjs -- COVERAGE/STATE probe for credited-gameplay scripts (capture-only,
// no engine changes). Work order: cdoc/credited-gameplay-capture-workorder.md.
//
// Two independent deterministic runs of the same script (same boot + inputs => identical
// execution):
//   (1) captureTrace() -> the authoritative set of distinct entry PCs reached.
//   (2) a plain Machine run that samples a panel of RAM addresses every frame, to PROVE a
//       scenario happened via state change (game_active_flag, score, lives, etc.) and to
//       discover gameplay-only indicators the attract-derived RAM map lacks.
//
// Usage: node tools/credited_probe.mjs <script.jsonl> [--panel] [--watch=0xADDR,0xADDR,...]
//   --panel : dump every work-RAM byte (0x0800-0x0bff + 0x4340-0x437f) that CHANGES over
//             the run, with first/last value + first-change frame (used to find indicators).

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
const doPanel = args.includes('--panel');
const watchArg = args.find((a) => a.startsWith('--watch='));
const watch = watchArg ? watchArg.split('=')[1].split(',').map((s) => parseInt(s, 16)) : [];
const scriptText = fs.readFileSync(path.isAbsolute(scriptPath) ? scriptPath : path.resolve(ROOT, scriptPath), 'utf8');

// ---- run 1: entry PCs via captureTrace ----
const entryPCs = new Set();
const firstSeen = new Map();   // entryPC -> first frame index... we don't have frame here, only set.
let invCount = 0;
const { frames } = captureTrace({ romRead, scriptText, onInvocation: (inv) => { invCount++; entryPCs.add(inv.entryPC); } });

// ---- run 2: per-frame RAM panel sampling ----
const { header, records } = parseScript(scriptText);
const machine = new Machine();
machine.loadRoms(assembleRoms(romRead));
machine.reset();
const player = new ScriptPlayer(machine.input, header, records);
const rd = (a) => machine.memory.read8(a) & 0xff;

// addresses to sample for panel-diff (work RAM + VRAM game-var band; NOT bitmap)
const panelAddrs = [];
for (let a = 0x0800; a <= 0x08ff; a++) panelAddrs.push(a);   // NVRAM low (engine state, credits, score)
for (let a = 0x0900; a <= 0x094f; a++) panelAddrs.push(a);
for (let a = 0x4340; a <= 0x437f; a++) panelAddrs.push(a);   // game var band
const first = new Map(), last = new Map(), firstChangeFrame = new Map();
const watchTimeline = new Map(watch.map((a) => [a, []]));

const total = Math.min(header.frames || 0, frames || (header.frames || 0));
for (let f = 0; f < total; f++) {
  player.applyFrame(f);
  machine.runFrame();
  for (const a of panelAddrs) {
    const v = rd(a);
    if (!first.has(a)) { first.set(a, v); last.set(a, v); continue; }
    if (v !== last.get(a)) { if (!firstChangeFrame.has(a)) firstChangeFrame.set(a, f); last.set(a, v); }
  }
  for (const a of watch) watchTimeline.get(a).push(rd(a));
}

// ---- report ----
console.log(`SCRIPT ${path.basename(scriptPath)}  frames=${total}  invocations=${invCount}  distinctEntryPCs=${entryPCs.size}`);

// key mapped indicators (from cdoc/ram-map-berzerk.md)
const ind = (a, name) => {
  const f0 = first.get(a), f1 = last.get(a), fc = firstChangeFrame.get(a);
  console.log(`  ${name} @0x${a.toString(16)}: boot=0x${(f0||0).toString(16)} final=0x${(f1||0).toString(16)}` +
              `${fc!==undefined ? `  firstChange@frame ${fc}` : '  (unchanged)'}`);
};
console.log('-- mapped indicators --');
ind(0x436e, 'game_active_flag');
ind(0x4344, 'current_player ');
ind(0x435c, 'lcg_seed.lo    ');
ind(0x435d, 'lcg_seed.hi    ');
ind(0x434b, 'robot_count    ');
ind(0x434c, 'level_counter  ');
ind(0x089c, 'score_cnt[0]   ');
ind(0x089d, 'score_cnt[1]   ');
ind(0x089e, 'score_cnt[2]   ');

if (watch.length) {
  console.log('-- watch timelines (value @ each frame where it changed) --');
  for (const a of watch) {
    const tl = watchTimeline.get(a);
    const changes = [];
    let prev = null;
    tl.forEach((v, f) => { if (v !== prev) { changes.push(`f${f}=0x${v.toString(16)}`); prev = v; } });
    console.log(`  0x${a.toString(16)}: ${changes.join(' ')}`);
  }
}

if (doPanel) {
  console.log('-- CHANGED work-RAM bytes (addr: boot->final @firstChangeFrame) --');
  const changed = panelAddrs.filter((a) => firstChangeFrame.has(a));
  for (const a of changed) {
    console.log(`  0x${a.toString(16)}: 0x${first.get(a).toString(16)} -> 0x${last.get(a).toString(16)} @${firstChangeFrame.get(a)}`);
  }
  console.log(`  (${changed.length} addresses changed)`);
}

// emit the entryPC set to a file for diffing
const outSet = path.resolve(ROOT, 'traces/segmented', path.basename(scriptPath).replace(/\.jsonl$/, '') + '.entrypcs.json');
fs.mkdirSync(path.dirname(outSet), { recursive: true });
fs.writeFileSync(outSet, JSON.stringify([...entryPCs].sort()));
console.log(`entryPCs -> ${outSet}`);
