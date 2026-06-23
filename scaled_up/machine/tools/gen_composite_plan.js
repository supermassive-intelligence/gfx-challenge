// gen_composite_plan.js -- build the SEPARATE inclusive composite test-plan (T9.2 Option 2).
//
// The committed traces/test-plans/*.jsonl are EXCLUSIVE (leaf-first) and stay FROZEN.
// Inclusive (subtree-folded) capture is NOT a strict superset of them: at full 3085f on
// attract-only it DROPS 8 hazard-bucket records (their guard subtrees fold in an ISR /
// coroutine access that breaks the interrupt-free self-check) and CONTENT-CHANGES 5
// records (composites whose exclusive record accidentally self-validated -- inclusive
// folds in the callee reads). So we do NOT regenerate the committed plans. Instead this
// tool emits ONLY the records inclusive ADDS -- the non-leaf composite bodies -- keyed by
// (entry_pc, path_id) absent from every committed exclusive plan. path_id is identical
// under both attributions (same executed PC sequence; only access ATTRIBUTION differs),
// so this filter:
//   - drops the 5 content-changed (same key -> excluded; the frozen exclusive version wins)
//   - never needs the 8 dropped (they exist only in exclusive, which stays authoritative)
//   - keeps exactly the new composite paths (0x1553, 0x2a40, 0x15a0, ... bodies).
// The bench then runs committed-exclusive (leaves) + this file (composites).
//
// MEMORY: inclusive capture attributes each access to EVERY open frame, so deep frames
// blow up the read/write sets -> heap-heavy. Run with extra heap, e.g.
//   NODE_OPTIONS=--max-old-space-size=4096 node tools/gen_composite_plan.js
//
// Usage: node tools/gen_composite_plan.js [out.jsonl] [maxFramesPerScript]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROM_FILES } from '../src/roms.js';
import { generateTestPlan } from './generate_test_plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, '../../traces/scripts');
const PLANS_DIR = path.resolve(__dirname, '../../traces/test-plans');
const SCRIPTS = ['attract-only', 'coin-start-first-maze', 'free-play', 'maze-transition', 'player-death'];

function committedKeys() {
  const keys = new Set();
  for (const s of SCRIPTS) {
    const p = path.join(PLANS_DIR, s + '.jsonl');
    for (const ln of fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)) {
      const r = JSON.parse(ln);
      keys.add(`${r.entry_pc}/${r.path_id}`);
    }
  }
  return keys;
}

function main() {
  const outPath = process.argv[2] || path.join(PLANS_DIR, 'composites-inclusive.jsonl');
  const maxFrames = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const romDir = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(romDir, name)));
  for (const f of ROM_FILES) if (!fs.existsSync(path.join(romDir, f))) { console.error(`ROM ${f} not found in ${romDir}`); process.exit(1); }

  const excluded = committedKeys();                 // frozen exclusive (entry_pc/path_id)
  const kept = new Map();                            // key -> record (dedup across scripts)
  for (const s of SCRIPTS) {
    const scriptText = fs.readFileSync(path.join(SCRIPTS_DIR, s + '.jsonl'), 'utf8');
    const { records } = generateTestPlan({ romRead, scriptText, maxFrames, inclusive: true });
    let added = 0;
    for (const r of records) {
      const k = `${r.entry_pc}/${r.path_id}`;
      if (excluded.has(k) || kept.has(k)) continue;  // already covered by exclusive or earlier script
      kept.set(k, r); added++;
    }
    console.error(`  ${s}: ${records.length} inclusive records -> +${added} new composite (running total ${kept.size})`);
  }
  const out = [...kept.values()];
  fs.writeFileSync(outPath, out.map(r => JSON.stringify(r)).join('\n') + '\n');
  const routines = new Set(out.map(r => r.entry_pc));
  console.error(`composite plan: ${out.length} records over ${routines.size} composite routines -> ${outPath}`);
}

main();
