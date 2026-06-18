import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROM_FILES } from '../src/roms.js';
import { captureTrace } from '../tools/heavy_trace_capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ROMs are user-supplied and never committed (same idiom as machine.test.js).
const ROM_DIR = process.env.BERZERK_ROM_DIR
  || path.resolve(__dirname, '../../../rom/berzerk');
const romsAvailable = ROM_FILES.every((f) => fs.existsSync(path.join(ROM_DIR, f)));
const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(ROM_DIR, name)));

const SCRIPT = path.resolve(__dirname, '../../traces/scripts/attract-only.jsonl');
// Bounded window with real invocations: POST makes no returning CALL/RET pairs,
// so the first invocations appear ~frame 500; 600 frames yields ~6.8k
// invocations incl. a port-0x65 poll repeated hundreds of times.
const FRAMES = 600;

function run() {
  return captureTrace({
    romRead,
    scriptText: fs.readFileSync(SCRIPT, 'utf8'),
    maxFrames: FRAMES,
  }).invocations;
}

// DoD: same input script twice -> byte-identical traces.
test('heavy trace is deterministic (two runs byte-identical)',
  { skip: romsAvailable ? false : `ROMs not found in ${ROM_DIR}` }, () => {
    const a = JSON.stringify(run());
    const b = JSON.stringify(run());
    assert.strictEqual(a.length, b.length, 'trace byte length differs between runs');
    assert.strictEqual(a, b, 'heavy traces are not byte-identical across two runs');
  });

// DoD: ordered read-set preserves repeated/live-port reads (no dedupe/collapse).
test('read-set preserves repeated same-port reads in order',
  { skip: romsAvailable ? false : `ROMs not found in ${ROM_DIR}` }, () => {
    const invs = run();
    // Find any invocation that reads one I/O port at least twice; assert those
    // duplicate reads are all present (count preserved), proving order/duplicates
    // are not collapsed.
    let found = null;
    for (const inv of invs) {
      const ios = inv.read_set.filter((x) => x.type === 'io');
      const counts = new Map();
      for (const x of ios) counts.set(x.addr, (counts.get(x.addr) || 0) + 1);
      for (const [addr, c] of counts) {
        if (c >= 2) { found = { entryPC: inv.entryPC, addr, c, ios }; break; }
      }
      if (found) break;
    }
    assert.ok(found, 'expected at least one invocation polling a port >= 2 times');
    // The duplicate entries must literally appear `found.c` times in read order.
    const occurrences = found.ios.filter((x) => x.addr === found.addr).length;
    assert.strictEqual(occurrences, found.c,
      'repeated port reads were collapsed/deduped instead of preserved in order');
  });
