import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

async function main() {
  const [,, inputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: node debug_divergence.js <input_script>");
    process.exit(1);
  }

  const romDir = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romData = {};
  for (const f of ROM_FILES) {
    romData[f] = new Uint8Array(fs.readFileSync(path.join(romDir, f)));
  }

  const scriptContent = fs.readFileSync(inputPath, 'utf8');
  const { header, records } = parseScript(scriptContent);

  const machine = new Machine();
  machine.loadRoms(assembleRoms((name) => romData[name]));
  machine.reset();

  const player = new ScriptPlayer(machine.input, header, records);

  const TARGET_FRAME = 242;
  console.log(`Running to frame ${TARGET_FRAME}...`);

  for (let f = 0; f < TARGET_FRAME + 1; f++) {
    player.applyFrame(f);
    machine.runFrame();
    
    if (f === TARGET_FRAME) {
      console.log(`--- State at Frame ${f} ---`);
      const state = machine.cpu.getState();
      console.log("CPU State:", JSON.stringify(state, null, 2));
      console.log("PC:", state.pc.toString(16));
      
      // Dump some VRAM around a known area or just a sample
      const vramSample = new Uint8Array(16);
      vramSample.set(machine.video.vram.subarray(0, 16));
      console.log("VRAM Sample (first 16 bytes):", vramSample);
    }
  }
}

main().catch(console.error);
