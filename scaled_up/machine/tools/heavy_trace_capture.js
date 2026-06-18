// heavy_trace_capture.js -- per-invocation heavyweight trace on the JS machine.
//
// Records one record per CALL/RST/interrupt invocation: entry PC, regs_in,
// ordered read-set, regs_out, write-set, (informational) cycle count, caller PC.
// Emits one JSON line per invocation, per cdoc/schemas/heavy-trace.md.
//
// API used (all verified to exist in src/, no event API is invented):
//   - machine.cpu.getState()              -> full register snapshot
//   - machine.cpu.callbacks.{readByte,writeByte,readPort,writePort}
//                                          -> the live mem/IO callbacks the core
//                                             dispatches through (we wrap them)
//   - machine.scheduler.onStep(sch)        -> fires before each cpu.step()
//   - machine.cpu.step() / machine.cpu.interrupt(nm,data) (wrapped for cycles/ISR)
//   - machine.memory.read8(addr)           -> non-recording opcode classification
//
// Usage (CLI):  node tools/heavy_trace_capture.js <input_script> <out.jsonl> [maxFrames]
// Usage (test): import { captureTrace } from './heavy_trace_capture.js'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

// --- opcode classification (single-byte CALL / RST; conditional CALL cc) ------
// RET-family is NOT decoded here: returns are detected by SP-depth (a routine
// is closed when SP rises above its entry SP), which covers RET, RET cc, RETI,
// RETN uniformly. CALL/RST must be decoded because conditional CALLs only push
// when taken, and we open a frame only on an actual push (SP -= 2).
const CALL_OPCODES = new Set([
  0xcd,                                     // CALL nn
  0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc, // CALL cc,nn
  0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff, // RST p
]);

function composeF(flags) {
  return ((flags.S & 1) << 7) | ((flags.Z & 1) << 6) | ((flags.Y & 1) << 5)
       | ((flags.H & 1) << 4) | ((flags.X & 1) << 3) | ((flags.P & 1) << 2)
       | ((flags.N & 1) << 1) | (flags.C & 1);
}

// Faithful register snapshot: A,F,B,C,D,E,H,L,IX,IY,SP,I,R + shadow set.
function snapshot(st) {
  return {
    a: st.a, f: composeF(st.flags),
    b: st.b, c: st.c, d: st.d, e: st.e, h: st.h, l: st.l,
    ix: st.ix, iy: st.iy, sp: st.sp, i: st.i, r: st.r,
    // shadow registers (A'F'B'C'D'E'H'L')
    a_p: st.a_prime, f_p: composeF(st.flags_prime),
    b_p: st.b_prime, c_p: st.c_prime, d_p: st.d_prime, e_p: st.e_prime,
    h_p: st.h_prime, l_p: st.l_prime,
  };
}

/**
 * Run a script on the JS machine and capture per-invocation traces.
 * @param {object} opts
 * @param {(name:string)=>Uint8Array} opts.romRead  ROM byte reader
 * @param {string} opts.scriptText                  input-script JSONL text
 * @param {number} [opts.maxFrames]                 cap frames (default header.frames)
 * @param {(inv:object)=>void} [opts.onInvocation]  stream sink; if absent, collected
 * @returns {{invocations: object[], frames: number}}
 */
export function captureTrace({ romRead, scriptText, maxFrames, onInvocation }) {
  const { header, records } = parseScript(scriptText);
  const machine = new Machine();
  machine.loadRoms(assembleRoms(romRead));
  machine.reset();
  const player = new ScriptPlayer(machine.input, header, records);

  const collected = [];
  const emit = onInvocation || ((inv) => collected.push(inv));

  // --- invocation stack -------------------------------------------------------
  const frames = [];           // open invocations, innermost last
  let totalCycles = 0;         // monotonic sum of step() cycle returns
  let prev = null;             // { pc, sp, opcode } of the last instruction seen
  let pendingISR = null;       // { callerPC } set by the interrupt wrapper

  function curFrame() { return frames.length ? frames[frames.length - 1] : null; }

  function openFrame({ entryPC, callerPC, sp, isISR }) {
    frames.push({
      entryPC, callerPC, is_isr: !!isISR,
      regs_in: snapshot(machine.cpu.getState()),
      read_set: [], write_set: [],
      _entrySP: sp, _startCycles: totalCycles,
    });
  }

  function closeFrame(stateNow) {
    const f = frames.pop();
    const inv = {
      entryPC: f.entryPC,
      callerPC: f.callerPC,
      is_isr: f.is_isr,
      regs_in: f.regs_in,
      read_set: f.read_set,
      regs_out: snapshot(stateNow),
      write_set: f.write_set,
      cycle_count: totalCycles - f._startCycles,
    };
    emit(inv);
  }

  // --- (b) wrap the live mem/IO callbacks (mem vs io tagged) ------------------
  const cb = machine.cpu.callbacks;
  const origReadByte = cb.readByte, origWriteByte = cb.writeByte;
  const origReadPort = cb.readPort, origWritePort = cb.writePort;
  // The adapter step() peeks readByte(pc) once before the core re-fetches the
  // same opcode; suppress exactly that one peek so the read-set is the core's
  // true access sequence (no duplicated opcode fetch).
  let peek = null; // { pc, used }

  cb.readByte = (addr) => {
    const val = origReadByte(addr) & 0xff;
    if (peek && !peek.used && (addr & 0xffff) === peek.pc) { peek.used = true; return val; }
    const fr = curFrame();
    if (fr) fr.read_set.push({ addr: addr & 0xffff, val, type: 'mem' });
    return val;
  };
  cb.writeByte = (addr, v) => {
    const fr = curFrame();
    if (fr) fr.write_set.push({ addr: addr & 0xffff, val: v & 0xff, type: 'mem' });
    return origWriteByte(addr, v);
  };
  cb.readPort = (port) => {
    const val = origReadPort(port) & 0xff;
    const fr = curFrame();
    if (fr) fr.read_set.push({ addr: port & 0xffff, val, type: 'io' });
    return val;
  };
  cb.writePort = (port, v) => {
    const fr = curFrame();
    if (fr) fr.write_set.push({ addr: port & 0xffff, val: v & 0xff, type: 'io' });
    return origWritePort(port, v);
  };

  // --- wrap step() to accumulate cycles ---------------------------------------
  const origStep = machine.cpu.step.bind(machine.cpu);
  machine.cpu.step = () => { const c = origStep(); totalCycles += c; return c; };

  // --- wrap interrupt() to flag ISR entry (callerPC = interrupted PC) ----------
  const origInterrupt = machine.cpu.interrupt.bind(machine.cpu);
  machine.cpu.interrupt = (nm, data) => {
    const callerPC = machine.cpu.getState().pc; // PC pushed as the return address
    const r = origInterrupt(nm, data);
    pendingISR = { callerPC };
    return r;
  };

  // --- (c) per-instruction boundary: reconcile stack, then arm peek -----------
  machine.scheduler.onStep = () => {
    const st = machine.cpu.getState();
    const pc = st.pc, sp = st.sp;

    // 1) RETURNS: close any frame whose entry SP has been popped past.
    while (frames.length && sp > frames[frames.length - 1]._entrySP) {
      closeFrame(st);
    }

    // 2) ENTRIES.
    if (pendingISR) {
      // Interrupt service routine = its own invocation (frozen rule).
      openFrame({ entryPC: pc, callerPC: pendingISR.callerPC, sp, isISR: true });
      pendingISR = null;
    } else if (prev && CALL_OPCODES.has(prev.opcode) && sp === ((prev.sp - 2) & 0xffff)) {
      // A CALL/RST that actually pushed (taken): open a frame.
      openFrame({ entryPC: pc, callerPC: prev.pc, sp, isISR: false });
    }

    // 3) Remember this instruction (opcode via NON-recording direct read).
    prev = { pc, sp, opcode: machine.memory.read8(pc) & 0xff };

    // 4) Arm the adapter opcode-peek suppression for the upcoming step().
    peek = { pc, used: false };
  };

  // --- run -------------------------------------------------------------------
  const total = Math.min(header.frames || 0, maxFrames || (header.frames || 0));
  for (let f = 0; f < total; f++) {
    player.applyFrame(f);
    machine.runFrame();
  }
  // Flush invocations still open at end-of-run (regs_out = final state).
  const finalState = machine.cpu.getState();
  while (frames.length) closeFrame(finalState);

  return { invocations: collected, frames: total };
}

// --- CLI --------------------------------------------------------------------
function main() {
  const [, , scriptPath, outPath, maxArg] = process.argv;
  if (!scriptPath || !outPath) {
    console.error('Usage: node heavy_trace_capture.js <input_script> <out.jsonl> [maxFrames]');
    process.exit(1);
  }
  const romDir = process.env.BERZERK_ROM_DIR
    || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(romDir, name)));
  for (const f of ROM_FILES) {
    if (!fs.existsSync(path.join(romDir, f))) {
      console.error(`ROM ${f} not found in ${romDir} (set BERZERK_ROM_DIR)`);
      process.exit(1);
    }
  }
  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let n = 0;
  const { frames } = captureTrace({
    romRead, scriptText,
    maxFrames: maxArg ? parseInt(maxArg, 10) : undefined,
    onInvocation: (inv) => { out.write(JSON.stringify(inv) + '\n'); n++; },
  });
  out.end(() => console.error(`heavy trace: ${n} invocations over ${frames} frames -> ${outPath}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
