import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

async function main() {
  const [,, inputPath, startFrame, endFrame] = process.argv;
  if (!inputPath || !startFrame || !endFrame) {
    console.error("Usage: node dump_trace.js <input_script> <start_frame> <end_frame>");
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

  const sFrame = parseInt(startFrame);
  const eFrame = parseInt(endFrame);

  console.log(`Running to frame ${sFrame}...`);
  for (let f = 0; f < sFrame; f++) {
    player.applyFrame(f);
    machine.runFrame();
  }

  console.log(`Tracing frames ${sFrame} to ${eFrame}...`);
  machine.cpu.enableTrace();
  for (let f = sFrame; f < eFrame; f++) {
    player.applyFrame(f);
    machine.runFrame();
  }
  const trace = machine.cpu.disableTrace();

  const outPath = `trace_${sFrame}_${eFrame}.txt`;
  fs.writeFileSync(outPath, trace.join('\n') + '\n');
  console.log(`✅ Trace dumped to ${outPath} (${trace.length} instructions)`);
}

main().catch(console.error);
