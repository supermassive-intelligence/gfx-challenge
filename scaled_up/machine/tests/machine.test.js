import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ROMs are user-supplied and never committed. Default to the repo-root rom dir;
// override with BERZERK_ROM_DIR. The boot test skips (not fails) if absent.
const ROM_DIR = process.env.BERZERK_ROM_DIR
  || path.resolve(__dirname, '../../../rom/berzerk');

function romsAvailable() {
  return ROM_FILES.every((f) => fs.existsSync(path.join(ROM_DIR, f)));
}

function nonZeroBytes(arr) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) n++;
  return n;
}

// Wiring smoke -- always runs, no ROM needed. Composing + running a frame must
// not throw even with unloaded ROM (reads return the 0xFF fill).
test('machine composes and runs frames without ROMs (no throw)', () => {
  const m = new Machine();
  m.reset();
  assert.doesNotThrow(() => { for (let i = 0; i < 3; i++) m.runFrame(); });
  const buf = new Uint8Array(256 * 224 * 4);
  assert.doesNotThrow(() => m.renderToRGBA(buf));
});

// Integration boot test (Phase-2 exit gate, machine-checkable half).
test('boots the real ROM: VRAM drawn, CPU not wedged', { skip: romsAvailable() ? false : `ROMs not found in ${ROM_DIR} (set BERZERK_ROM_DIR)` }, () => {
  const read = (name) => new Uint8Array(fs.readFileSync(path.join(ROM_DIR, name)));
  const m = new Machine();
  m.loadRoms(assembleRoms(read));
  m.reset();

  // Run ~600 frames (~10s): power-on self-test (incl. Magic RAM ALU) then attract.
  // Track the max non-zero VRAM over the tail so a momentarily-blank attract
  // frame can't flake the assertion.
  let maxTailVram = 0;
  let endPc = 0;
  for (let f = 0; f < 600; f++) {
    m.runFrame();
    if (f >= 480) maxTailVram = Math.max(maxTailVram, nonZeroBytes(m.video.vram));
    if (f === 599) endPc = m.cpu.getState().pc;
  }

  // If the Magic RAM ALU / memory / timing were wrong the self-test wedges and
  // nothing is drawn. Attract mode draws the maze + text -> many non-zero bytes.
  assert.ok(maxTailVram > 50,
    `expected attract mode to draw VRAM, got max ${maxTailVram} non-zero bytes`);
  // Reached game code past the ROM0 self-test (not stuck in the 0x0000-0x07FF
  // boot/self-test region), and not halted/wedged.
  assert.strictEqual(m.cpu.getState().halted, false, 'CPU should not be halted');
  assert.ok(endPc >= 0x1000, `expected PC in game ROM, got 0x${endPc.toString(16)}`);
});
