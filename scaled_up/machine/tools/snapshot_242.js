import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

async function main() {
  const [,, inputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: node snapshot_242.js <input_script>");
    process.exit(1);
  }

  const romDir = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romData = {};
  try {
    for (const f of ROM_FILES) {
      romData[f] = new Uint8Array(fs.readFileSync(path.join(romDir, f)));
    }
  } catch (e) {
    console.error(`❌ Error loading ROMs: ${e.message}`);
    process.exit(1);
  }

  const scriptContent = fs.readFileSync(inputPath, 'utf8');
  const { header, records } = parseScript(scriptContent);

  const machine = new Machine();
  machine.loadRoms(assembleRoms((name) => romData[name]));
  machine.reset();

  const player = new ScriptPlayer(machine.input, header, records);

  const TARGET_FRAME = 242;
  console.log(`Advancing emulator to frame ${TARGET_FRAME}...`);

  for (let f = 0; f < TARGET_FRAME; f++) {
    player.applyFrame(f);
    machine.runFrame();
  }

  console.log(`\n=== EMULATOR STATE SNAPSHOT AT FRAME ${TARGET_FRAME} ===\n`);

  const state = machine.cpu.getState();
  
  console.log("--- CPU Registers ---");
  console.log(`PC: 0x${state.pc.toString(16).padStart(4, '0')}`);
  console.log(`SP: 0x${state.sp.toString(16).padStart(4, '0')}`);
  console.log(`A:  0x${state.a.toString(16).padStart(2, '0')}  B: 0x${state.b.toString(16).padStart(2, '0')}  C: 0x${state.c.toString(16).padStart(2, '0')}`);
  console.log(`D:  0x${state.d.toString(16).padStart(2, '0')}  E: 0x${state.e.toString(16).padStart(2, '0')}  H: 0x${state.h.toString(16).padStart(2, '0')}  L: 0x${state.l.toString(16).padStart(2, '0')}`);
  console.log(`IX: 0x${state.ix.toString(16).padStart(4, '0')}  IY: 0x${state.iy.toString(16).padStart(4, '0')}`);
  console.log(`I:  0x${state.i.toString(16).padStart(2, '0')}  R: 0x${state.r.toString(16).padStart(2, '0')}`);
  
  console.log("\n--- CPU Flags ---");
  const f = state.flags;
  console.log(`S:${f.S} Z:${f.Z} Y:${f.Y} H:${f.H} X:${f.X} P:${f.P} N:${f.N} C:${f.C}`);

  console.log("\n--- Memory around PC ---");
  const startAddr = (state.pc & ~0x7) ;
  for (let addr = startAddr; addr < startAddr + 16; addr++) {
    const val = machine.memory.read8(addr);
    const isPC = (addr === state.pc) ? " <--" : "    ";
    console.log(`${addr.toString(16).padStart(4, '0')}: 0x${val.toString(16).padStart(2, '0')}${isPC}`);
  }

  console.log("\n======================================================\n");
}

main().catch(console.error);
