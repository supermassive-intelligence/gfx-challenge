// replay_hash_visible.js -- per-frame hash of VISIBLE VRAM rows only + colorRAM.
// Visible region: VRAM rows 0-223 = offsets 0x0000-0x1BFF (7168 bytes), excluding
// off-screen scratch rows 224-255 (0x5C00-0x5FFF). colorRAM 0x8000-0x87FF (2048).
// Matches tools/mame/replay_hash_visible.lua. Usage: node ... <script> <out.hashes>
import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';
import { fnv1a32 } from '../src/hash.js';

const VIS_VRAM = 224 * 32; // 7168 bytes (rows 0-223)

const [,, inputPath, outputPath] = process.argv;
const romDir = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const romData = {};
for (const f of ROM_FILES) romData[f] = new Uint8Array(fs.readFileSync(path.join(romDir, f)));

const { header, records } = parseScript(fs.readFileSync(inputPath, 'utf8'));
const machine = new Machine();
machine.loadRoms(assembleRoms((name) => romData[name]));
machine.reset();
if (process.env.BERZERK_PORT_HOOKS) machine.installPortHooks();  // T9.1 dispatch
const player = new ScriptPlayer(machine.input, header, records);

const hashes = [];
const totalFrames = header.frames || 1000;
for (let f = 0; f < totalFrames; f++) {
  player.applyFrame(f);
  machine.runFrame();
  const buf = new Uint8Array(VIS_VRAM + 2048);
  buf.set(machine.video.vram.subarray(0, VIS_VRAM), 0);
  buf.set(machine.video.colorram, VIS_VRAM);
  hashes.push(`${f},0x${fnv1a32(buf).toString(16).padStart(8, '0')}`);
}
fs.writeFileSync(outputPath, hashes.join('\n') + '\n');
console.error(`hashed ${totalFrames} frames (visible-only) -> ${outputPath}`);
