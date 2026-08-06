// dump_frame_js.js -- dump JS VRAM+colorRAM raw bytes at a target frame.
// Usage: node tools/dump_frame_js.js <script> <frame> <out.bin>
// Layout: 8192 bytes VRAM (0x4000-0x5FFF) then 2048 bytes colorRAM (0x8000-0x87FF).
import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

const [,, scriptPath, frameArg, outPath] = process.argv;
const target = parseInt(frameArg, 10);

const romDir = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const romData = {};
for (const f of ROM_FILES) romData[f] = new Uint8Array(fs.readFileSync(path.join(romDir, f)));

const { header, records } = parseScript(fs.readFileSync(scriptPath, 'utf8'));
const machine = new Machine();
machine.loadRoms(assembleRoms((name) => romData[name]));
machine.reset();
const player = new ScriptPlayer(machine.input, header, records);

for (let f = 0; f <= target; f++) {
  player.applyFrame(f);
  machine.runFrame();
}

const buf = new Uint8Array(10240);
buf.set(machine.video.vram, 0);
buf.set(machine.video.colorram, 8192);
fs.writeFileSync(outPath, buf);
console.error(`dumped frame ${target} -> ${outPath} (${buf.length} bytes)`);
