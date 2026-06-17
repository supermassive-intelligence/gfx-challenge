import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';
import { fnv1a32 } from '../src/hash.js';

/**
 * replay_hash.js – headless replay of a script to dump frame hashes.
 * Usage: node replay_hash.js <input_script> <output_hashes>
 */

async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node replay_hash.js <input_script> <output_hashes>");
    process.exit(1);
  }

  // 1. Load ROMs from the absolute path provided by the user
  const romDir = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romData = {};
  try {
    for (const f of ROM_FILES) {
      romData[f] = new Uint8Array(fs.readFileSync(path.join(romDir, f)));
    }
  } catch (e) {
    console.error(`❌ Error loading ROMs from ${romDir}: ${e.message}`);
    process.exit(1);
  }

  // 2. Parse script
  const scriptContent = fs.readFileSync(inputPath, 'utf8');
  const { header, records } = parseScript(scriptContent);

  // 3. Initialize Machine
  const machine = new Machine();
  machine.loadRoms(assembleRoms((name) => romData[name]));
  machine.reset();

  const player = new ScriptPlayer(machine.input, header, records);

  // 4. Run frames and hash
  const hashes = [];
  const totalFrames = header.frames || 1000;

  for (let f = 0; f < totalFrames; f++) {
    // apply input changes at vblank
    player.applyFrame(f);

    // Execute the frame (CPU cycles + interrupts)
    machine.runFrame();

    // hash VRAM + color RAM
    // VRAM: 0x4000-0x5FFF (8KB), color RAM: 0x8000-0x87FF (2KB)
    const buffer = new Uint8Array(10240);
    buffer.set(machine.video.vram, 0);
    buffer.set(machine.video.colorram, 8192);

    const hash = fnv1a32(buffer);
    hashes.push(`${f},0x${hash.toString(16).padStart(8, '0')}`);
  }

  fs.writeFileSync(outputPath, hashes.join('\n') + '\n');
  console.log(`✅ Hashed ${totalFrames} frames to ${outputPath}`);
}

main().catch(err => {
  console.error(`❌ Fatal: ${err.message}`);
  process.exit(1);
});
