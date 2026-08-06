// gameplay_probe.js -- execution-coverage probe (NOT a port artifact).
//
// Runs an input script on the UN-HOOKED JS machine and reports, per script:
//   - total distinct PCs executed (coverage breadth),
//   - for a watchlist of routine entry PCs, the FIRST frame each was executed
//     (or "never") -- this distinguishes "routine ran but isn't leaf-replayable"
//     (absent from the test plan yet present here) from "routine never ran"
//     (the real coverage gap the credited-gameplay scripts are meant to close).
//
// This is a diagnostic, not a deliverable: it answers "does this script enter
// scored gameplay and execute the bolt engine / digit blitter?" empirically,
// before any human records a real game.
//
// Usage: node tools/gameplay_probe.js <script.jsonl> [maxFrames]
import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

// Routine entry PCs of interest (from the T9.2 triage / disassembly).
// Bodies the attract-derived scripts are believed never to reach:
const WATCH = {
  0x1553: 'BOLT_ENGINE (body)',
  0x2a40: 'DIGIT_BLITTER (body)',
  0x2341: 'UPDATE_SCORE',
  0x1908: 'DRAW_DIGIT',
  0x197b: 'DRAW_SCORE',
  0x272d: 'ERASE_PATTERN',
  0x151a: 'COLLISION_SENSE',
  0x287f: 'SHOOT',
  0x2334: 'GET_PLAYER_SCORE_PTR',
  0x18e0: 'GET_CREDITS_AS_BCD',
};

function probe(scriptText, romRead, maxFramesArg) {
  const { header, records } = parseScript(scriptText);
  const machine = new Machine();
  machine.loadRoms(assembleRoms(romRead));
  machine.reset();
  // NB: no installPortHooks() -- pure Z80, so every routine body executes.
  const player = new ScriptPlayer(machine.input, header, records);

  const seen = new Uint8Array(0x10000);     // PC visited at least once
  let distinct = 0;
  const firstFrame = new Map();             // watch PC -> first frame seen
  let frame = 0;

  machine.scheduler.onStep = () => {
    const pc = machine.cpu.getState().pc & 0xffff;
    if (!seen[pc]) { seen[pc] = 1; distinct++; }
    if (WATCH[pc] !== undefined && !firstFrame.has(pc)) firstFrame.set(pc, frame);
  };

  const total = Math.min(header.frames || 0, maxFramesArg || (header.frames || 0));
  for (frame = 0; frame < total; frame++) {
    player.applyFrame(frame);
    machine.runFrame();
  }

  // game-state signals (best-effort; values are reported, not interpreted):
  const r8 = (a) => machine.memory.read8(a & 0xffff) & 0xff;
  return {
    frames: total, distinct,
    watch: Object.keys(WATCH).map(k => {
      const pc = Number(k);
      return { pc, name: WATCH[pc], frame: firstFrame.has(pc) ? firstFrame.get(pc) : null };
    }),
    ram: {
      // score bytes (P1 at 0x433e..0x4340 per score_ptr.js), credits region, and
      // a few work-RAM bytes -- raw, for eyeballing "did the game start".
      score_p1: [r8(0x433e), r8(0x433f), r8(0x4340)],
      score_p2: [r8(0x4341), r8(0x4342), r8(0x4343)],
      sel_4344: r8(0x4344),
    },
  };
}

function main() {
  const [, , scriptPath, maxArg] = process.argv;
  if (!scriptPath) { console.error('Usage: node gameplay_probe.js <script.jsonl> [maxFrames]'); process.exit(1); }
  const romDir = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(romDir, name)));
  for (const f of ROM_FILES) {
    if (!fs.existsSync(path.join(romDir, f))) { console.error(`ROM ${f} not found in ${romDir}`); process.exit(1); }
  }
  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  const res = probe(scriptText, romRead, maxArg ? parseInt(maxArg, 10) : undefined);
  console.log(`script=${path.basename(scriptPath)} frames=${res.frames} distinctPCs=${res.distinct}`);
  console.log(`  score_p1=${res.ram.score_p1} score_p2=${res.ram.score_p2} sel@4344=${res.ram.sel_4344}`);
  for (const w of res.watch) {
    const hex = '0x' + w.pc.toString(16);
    console.log(`  ${w.frame === null ? 'NEVER ' : 'frame ' + String(w.frame).padStart(4)} ${hex.padEnd(7)} ${w.name}`);
  }
}

main();
