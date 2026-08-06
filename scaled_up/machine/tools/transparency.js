// transparency.js -- T9.2 fast hooked==un-hooked regression with a divergence
// localizer. Replaces the per-batch `for s in ...; replay_hash x2; diff` loop with
// three cost cuts:
//   1. CACHE the un-hooked reference frame-hashes per script (machine/.cache/). The
//      un-hooked path never runs a port, so it is stable across port additions; the
//      cache is invalidated only when the script OR any src/ file is newer than it.
//   2. SCOPE: given target port PC(s), first probe which scripts actually dispatch
//      them and run the (expensive) hooked pass ONLY on those. A new leaf reached by
//      one script needn't re-run the other four.
//   3. LOCALIZE: on divergence, report the first bad frame, the differing VRAM/color
//      byte addresses, and which ports dispatched in that frame and the one before --
//      so a regression points at a routine instead of just "frame N differs".
//
// Usage:
//   node tools/transparency.js                 # all 5 scripts, full hooked==un-hooked
//   node tools/transparency.js 0x1ce7 0x15cb   # only scripts that dispatch these PCs
//   node tools/transparency.js --refresh       # force-rebuild the un-hooked cache

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';
import { fnv1a32 } from '../src/hash.js';
import { makePortHook } from '../src/port-hook.js';
import { PORTS, PORT_META } from '../ports/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_DIR = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const SCRIPTS_DIR = path.resolve(__dirname, '../../traces/scripts');
const SRC_DIR = path.resolve(__dirname, '../src');
const CACHE_DIR = path.resolve(__dirname, '../.cache');
const ALL_SCRIPTS = ['attract-only', 'coin-start-first-maze', 'free-play',
                     'maze-transition', 'player-death'];

function loadRoms() {
  const romData = {};
  for (const f of ROM_FILES) romData[f] = new Uint8Array(fs.readFileSync(path.join(ROM_DIR, f)));
  return assembleRoms((n) => romData[n]);
}

function parse(script) {
  return parseScript(fs.readFileSync(path.join(SCRIPTS_DIR, script + '.jsonl'), 'utf8'));
}

// Run a script. Returns { hashes, buffers?, dispatchByFrame? }. When `hooks` is a
// counting map, dispatchByFrame[f] = Map(pc -> count) for that frame. When
// `keepBuffers`, buffers[f] is the full 10240-byte VRAM+color snapshot (for the
// localizer; only used on the un-hooked re-run after a divergence).
function run(roms, script, { hooks = null, counter = null, keepBuffers = false } = {}) {
  const { header, records } = parse(script);
  const m = new Machine();
  m.loadRoms(roms);
  m.reset();
  if (hooks) m.cpu.installPortHook(makePortHook(hooks, PORT_META, m.scheduler));
  const player = new ScriptPlayer(m.input, header, records);
  const frames = header.frames || records.length || 1;
  const hashes = new Array(frames);
  const buffers = keepBuffers ? new Array(frames) : null;
  const buf = new Uint8Array(10240);
  for (let f = 0; f < frames; f++) {
    if (counter) counter.frame = f;
    player.applyFrame(f);
    m.runFrame();
    buf.set(m.video.vram, 0);
    buf.set(m.video.colorram, 8192);
    hashes[f] = fnv1a32(buf) >>> 0;
    if (keepBuffers) buffers[f] = buf.slice();
  }
  return { hashes, buffers, frames };
}

// A ports map whose entries count dispatches per frame (behaviour unchanged).
function countingPorts(counter) {
  const wrapped = new Map();
  for (const [pc, fn] of PORTS) {
    wrapped.set(pc, (ctx) => {
      const byF = counter.byFrame[counter.frame] || (counter.byFrame[counter.frame] = new Map());
      byF.set(pc, (byF.get(pc) || 0) + 1);
      counter.total.set(pc, (counter.total.get(pc) || 0) + 1);
      return fn(ctx);
    });
  }
  return wrapped;
}

function srcNewerThan(file) {
  if (!fs.existsSync(file)) return true;
  const t = fs.statSync(file).mtimeMs;
  const scan = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return scan(p);
    return fs.statSync(p).mtimeMs > t;
  });
  return scan(SRC_DIR);
}

function cachedUnhooked(roms, script, refresh) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `unhooked-${script}.hashes`);
  const scriptFile = path.join(SCRIPTS_DIR, script + '.jsonl');
  const stale = refresh || !fs.existsSync(cacheFile) ||
    fs.statSync(scriptFile).mtimeMs > fs.statSync(cacheFile).mtimeMs ||
    srcNewerThan(cacheFile);
  if (!stale) {
    return fs.readFileSync(cacheFile, 'utf8').trim().split('\n').map((h) => parseInt(h, 16) >>> 0);
  }
  const { hashes } = run(roms, script);
  fs.writeFileSync(cacheFile, hashes.map((h) => h.toString(16)).join('\n') + '\n');
  return hashes;
}

function localize(roms, script, frame, hookBuffers) {
  // Re-run un-hooked keeping buffers up to the bad frame for a byte-level diff.
  const { buffers } = run(roms, script, { keepBuffers: true });
  const u = buffers[frame], h = hookBuffers[frame];
  const diffs = [];
  for (let i = 0; i < 10240 && diffs.length < 12; i++) {
    if (u[i] !== h[i]) {
      const addr = i < 8192 ? 0x4000 + i : 0x8000 + (i - 8192);
      diffs.push(`0x${addr.toString(16)}: unhooked=0x${u[i].toString(16)} hooked=0x${h[i].toString(16)}`);
    }
  }
  return diffs;
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const targets = args.filter((a) => /^0x[0-9a-f]+$/i.test(a)).map((a) => a.toLowerCase());
  const roms = loadRoms();

  // Single hooked pass per script (counting + hashes + buffers). When targets are
  // given, a script that dispatches NONE of them cannot have newly diverged from the
  // last green checkpoint (the new port is the only change), so it is SKIPPED -- only
  // dispatching scripts are compared. With no targets every script is verified.
  let anyFail = false, verified = 0, skipped = 0;
  const probe = {};
  for (const s of ALL_SCRIPTS) {
    const counter = { frame: 0, byFrame: {}, total: new Map() };
    const { hashes, buffers } = run(roms, s, { hooks: countingPorts(counter), counter, keepBuffers: true });
    probe[s] = counter.total;
    if (targets.length && !targets.some((pc) => counter.total.get(pc))) {
      skipped++;
      console.log(`skip ${s} (dispatches none of: ${targets.join(' ')})`);
      continue;
    }
    verified++;
    const ref = cachedUnhooked(roms, s, refresh);
    let bad = -1;
    for (let f = 0; f < hashes.length; f++) if (hashes[f] !== ref[f]) { bad = f; break; }
    if (bad === -1) {
      const hit = targets.length ? '  [' + targets.filter((pc) => probe[s].get(pc)).map((pc) => `${pc}x${probe[s].get(pc)}`).join(' ') + ']' : '';
      console.log(`PASS ${s} (${hashes.length} frames)${hit}`);
    } else {
      anyFail = true;
      console.log(`FAIL ${s}: first divergence at frame ${bad} ` +
        `(unhooked=0x${ref[bad].toString(16)} hooked=0x${hashes[bad].toString(16)})`);
      const here = counter.byFrame[bad], prev = counter.byFrame[bad - 1];
      const fmt = (m) => m ? [...m.entries()].map(([pc, n]) => `${pc}x${n}`).join(' ') : '(none)';
      console.log(`  ports dispatched @frame ${bad - 1}: ${fmt(prev)}`);
      console.log(`  ports dispatched @frame ${bad}:   ${fmt(here)}`);
      for (const d of localize(roms, s, bad, buffers)) console.log('  diff ' + d);
    }
  }
  if (targets.length) {
    const unexercised = targets.filter((pc) => !ALL_SCRIPTS.some((s) => probe[s].get(pc)));
    if (unexercised.length) console.log(`WARNING: no script dispatches ${unexercised.join(' ')} (unexercised -- bench-only coverage)`);
  }
  console.log(`transparency: ${verified} verified, ${skipped} skipped, ${anyFail ? 'DIVERGED' : 'all green'}`);
  process.exit(anyFail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
