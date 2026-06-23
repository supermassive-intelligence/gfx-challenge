// gen_segmented_trace.js -- segment-chain capture for a long/interrupted routine.
//
// PILOT (cdoc/pilot-2a40-segment-chain-workorder.md): proves "interrupts as recorded
// yield boundaries" (cdoc/long-routine-validation-plan.md, APPROVED 2026-06-22) at the
// DATA level for one long clean routine (0x2a40 PRINT_DIGITS, ALWAYS-DECLINE ~8800 T).
//
// It reuses heavy_trace_capture.js's frame-tracking technique VERBATIM (SP-depth returns,
// `pendingISR` entry flag, wrapped mem/IO callbacks, the opcode-peek suppression) and adds,
// for a target entryPC, emission of a SEGMENT CHAIN per target invocation:
//   * Boundaries: target entry; each point an ISR frame opens on top of the target
//     (interrupt start); each point that ISR frame closes (resume); target exit.
//   * A SEGMENT is the target's own subtree execution between consecutive boundaries, with
//     ISR time EXCLUDED (an access belongs to the current segment iff the target invocation
//     is active AND no ISR frame is open -- isrDepth==0). The target's callees run at
//     isrDepth==0, so a segment captures the target subtree minus ISR (which is exactly what
//     the inclusive whole-invocation = segments + ISR-intervals must reconstruct: V1).
//   * Per segment: target_pc, invocation_id, seg_index, entry_regs (full snapshot),
//     read_set, write_set, regs_out, end_boundary ('interrupt'|'exit'), boundary_pc,
//     n_instructions, informational cycle_count.
//   * Interleaved ISR-interval records (everything executed while isrDepth>0 during the
//     target -- the ISR handler + its callees + any nested ISR), tagged so V1 folds them in.
//
// WZ caveat: the vendored core does NOT model the hidden WZ register, so `entry_regs` cannot
// carry a real WZ. This is fine for 0x2a40 (clean; no WZ-derived flag dependence at any
// boundary) -- proceed without WZ; do NOT invent one. Real WZ capture is only needed for the
// WZ-exposer hazards (Scope-B; would require core changes) and is out of scope here.
//
// Output: a SEPARATE file traces/segmented/<script>.<target>.jsonl. Does NOT touch the frozen
// exclusive plans, composites-inclusive.jsonl, or any golden.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

// scaled_up root (so `traces/...` paths resolve the same whether run from machine/ or root).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resolveRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

// CALL/RST opcodes (verbatim from heavy_trace_capture.js): a frame opens only on an actual
// push, so conditional CALLs are decoded; RET-family is detected by SP-depth.
const CALL_OPCODES = new Set([
  0xcd,
  0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc,
  0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff,
]);

function composeF(flags) {
  return ((flags.S & 1) << 7) | ((flags.Y & 1) << 5) | ((flags.H & 1) << 4)
       | ((flags.X & 1) << 3) | ((flags.P & 1) << 2) | ((flags.N & 1) << 1) | (flags.C & 1)
       | ((flags.Z & 1) << 6);
}

// Faithful register snapshot (verbatim shape from heavy_trace_capture.js). No WZ -- see header.
function snapshot(st) {
  return {
    a: st.a, f: composeF(st.flags),
    b: st.b, c: st.c, d: st.d, e: st.e, h: st.h, l: st.l,
    ix: st.ix, iy: st.iy, sp: st.sp, i: st.i, r: st.r,
    a_p: st.a_prime, f_p: composeF(st.flags_prime),
    b_p: st.b_prime, c_p: st.c_prime, d_p: st.d_prime, e_p: st.e_prime,
    h_p: st.h_prime, l_p: st.l_prime,
  };
}

/**
 * Capture the segment chain for `targetPC` over a deterministic run of `scriptText`.
 * Loads ROMs from the flat oracle image (EC1; byte-identical to the rom-file assembler,
 * verified) so the run matches a captureTrace(rom-files) run instruction-for-instruction.
 * @returns {{ records: object[], invocations: number }}  records = segment|isr|summary lines.
 */
export function captureSegmented({ flat, scriptText, targetPC, maxFrames }) {
  const { header, records: scriptRecords } = parseScript(scriptText);
  const machine = new Machine();
  machine.loadRoms({ ROM0: flat.slice(0x0000, 0x0800), ROM_MAIN: flat.slice(0x1000, 0x3800) });
  machine.reset();
  const player = new ScriptPlayer(machine.input, header, scriptRecords);

  const out = [];

  // --- verbatim frame model (boundary detection) -----------------------------
  const frames = [];          // open invocations, innermost last
  let totalCycles = 0;
  let prev = null;
  let pendingISR = null;
  let isrDepth = 0;           // count of open is_isr frames (ISR-subtree gate)

  // --- target / segment state ------------------------------------------------
  let nextInvId = 0;
  let targetInv = null;       // { invocation_id, target_entry_sp, _frame, segments[], isrRecords[] }
  let curSeg = null;          // accumulating segment (null during ISR time)
  let curISR = null;          // accumulating ISR interval (set while isrDepth>0 under target)
  let segCounter = 0;

  function newSegment(st) {
    return {
      seg_index: segCounter,
      entry_pc: st.pc & 0xffff,      // V2 seeds the core's PC from this (snapshot has no PC)
      entry_regs: snapshot(st),
      read_set: [], write_set: [],
      _startCycles: totalCycles, n_instructions: 0,
    };
  }

  function finishSegment(seg, regsOutSnap, endBoundary, boundaryPC) {
    seg.regs_out = regsOutSnap;
    seg.end_boundary = endBoundary;
    seg.boundary_pc = boundaryPC;
    seg.cycle_count = totalCycles - seg._startCycles;
    delete seg._startCycles;
    targetInv.segments.push(seg);
  }

  function emitChain(inv) {
    // Execution order: seg0, isr0, seg1, isr1, ..., seg(last). ISR i ends segment i.
    out.push({
      type: 'invocation_summary', target_pc: '0x' + targetPC.toString(16),
      invocation_id: inv.invocation_id, target_entry_sp: inv.target_entry_sp,
      n_segments: inv.segments.length, n_interrupts: inv.isrRecords.length,
    });
    const isrByAfter = new Map();
    for (const isr of inv.isrRecords) isrByAfter.set(isr.after_seg_index, isr);
    for (const seg of inv.segments) {
      out.push({
        type: 'segment', target_pc: '0x' + targetPC.toString(16),
        invocation_id: inv.invocation_id, seg_index: seg.seg_index,
        entry_pc: '0x' + (seg.entry_pc & 0xffff).toString(16),
        entry_regs: seg.entry_regs, read_set: seg.read_set, write_set: seg.write_set,
        regs_out: seg.regs_out, end_boundary: seg.end_boundary,
        boundary_pc: '0x' + (seg.boundary_pc & 0xffff).toString(16),
        n_instructions: seg.n_instructions, cycle_count: seg.cycle_count,
      });
      const isr = isrByAfter.get(seg.seg_index);
      if (isr) out.push(isr);
    }
  }

  // --- wrap the live mem/IO callbacks (verbatim opcode-peek suppression) -------
  const cb = machine.cpu.callbacks;
  const origReadByte = cb.readByte, origWriteByte = cb.writeByte;
  const origReadPort = cb.readPort, origWritePort = cb.writePort;
  let peek = null;

  // Attribution: only within a target invocation. curISR and curSeg are MUTUALLY
  // EXCLUSIVE -- curISR is non-null for the whole interrupt interval (set in the
  // interrupt() wrapper, before origInterrupt pushes the return PC, until the ISR
  // resumes), curSeg is non-null during segment time. Routing by which is set (NOT by
  // isrDepth) ensures the interrupt-entry PC-push + IM2 vector read land in the ISR
  // interval -- without this they fall in the gap (curSeg already nulled, isrDepth not
  // yet incremented) and V1 loses exactly those bytes.
  function pushRead(entry) {
    if (curISR) curISR.read_set.push(entry);
    else if (targetInv && curSeg) curSeg.read_set.push(entry);
  }
  function pushWrite(entry) {
    if (curISR) curISR.write_set.push(entry);
    else if (targetInv && curSeg) curSeg.write_set.push(entry);
  }

  cb.readByte = (addr) => {
    const val = origReadByte(addr) & 0xff;
    if (peek && !peek.used && (addr & 0xffff) === peek.pc) { peek.used = true; return val; }
    pushRead([addr & 0xffff, val, 'mem']);
    return val;
  };
  cb.writeByte = (addr, v) => { pushWrite([addr & 0xffff, v & 0xff, 'mem']); return origWriteByte(addr, v); };
  cb.readPort = (port) => { const val = origReadPort(port) & 0xff; pushRead([port & 0xffff, val, 'io']); return val; };
  cb.writePort = (port, v) => { pushWrite([port & 0xffff, v & 0xff, 'io']); return origWritePort(port, v); };

  // --- wrap step() to accumulate cycles --------------------------------------
  const origStep = machine.cpu.step.bind(machine.cpu);
  machine.cpu.step = () => { const c = origStep(); totalCycles += c; return c; };

  // --- wrap interrupt(): finalize the current segment at the CLEAN mainline state
  // (PC == boundary_pc, SP still mainline) BEFORE the interrupt perturbs PC/SP. -------
  const origInterrupt = machine.cpu.interrupt.bind(machine.cpu);
  machine.cpu.interrupt = (nm, data) => {
    const stBefore = machine.cpu.getState();
    const boundaryPC = stBefore.pc;                 // pushed return address == resume PC
    if (targetInv && isrDepth === 0 && curSeg) {
      // segment ends here (interrupt boundary)
      finishSegment(curSeg, snapshot(stBefore), 'interrupt', boundaryPC);
      const endedIndex = curSeg.seg_index;
      curSeg = null;
      // open the ISR interval (the ISR handler + callees + any nested ISR)
      curISR = {
        type: 'isr', invocation_id: targetInv.invocation_id, after_seg_index: endedIndex,
        entryPC: null, callerPC: '0x' + (boundaryPC & 0xffff).toString(16),
        regs_in: snapshot(stBefore), read_set: [], write_set: [],
        _startCycles: totalCycles,
      };
    }
    pendingISR = { callerPC: boundaryPC };
    return origInterrupt(nm, data);
  };

  // --- per-instruction boundary: reconcile stack, then arm peek (verbatim shape) -----
  machine.scheduler.onStep = () => {
    const st = machine.cpu.getState();
    const pc = st.pc, sp = st.sp;

    // 1) RETURNS: close any frame whose entry SP has been popped past.
    while (frames.length && sp > frames[frames.length - 1]._entrySP) {
      const f = frames.pop();
      if (f.is_isr) {
        isrDepth--;
        if (isrDepth === 0 && targetInv && curISR) {
          // ISR interval ends -> resume. Finalize the ISR record; start the next segment.
          curISR.entryPC = f.entryPC != null ? ('0x' + (f.entryPC & 0xffff).toString(16)) : curISR.entryPC;
          curISR.regs_out = snapshot(st);
          curISR.end_pc = '0x' + (st.pc & 0xffff).toString(16);
          curISR.cycle_count = totalCycles - curISR._startCycles;
          delete curISR._startCycles;
          targetInv.isrRecords.push(curISR);
          curISR = null;
          segCounter++;
          curSeg = newSegment(st);            // resume PC == prior segment's boundary_pc
        }
      } else if (targetInv && f === targetInv._frame) {
        // TARGET exit: finalize the last segment.
        if (curSeg) finishSegment(curSeg, snapshot(st), 'exit', st.pc);
        curSeg = null;
        emitChain(targetInv);
        targetInv = null;
      }
    }

    // 2) ENTRIES.
    if (pendingISR) {
      frames.push({ entryPC: pc, callerPC: pendingISR.callerPC, is_isr: true, _entrySP: sp });
      isrDepth++;
      if (curISR && curISR.entryPC == null) curISR.entryPC = '0x' + (pc & 0xffff).toString(16);
      pendingISR = null;
    } else if (prev && CALL_OPCODES.has(prev.opcode) && sp === ((prev.sp - 2) & 0xffff)) {
      const fr = { entryPC: pc, callerPC: prev.pc, is_isr: false, _entrySP: sp };
      frames.push(fr);
      if (pc === targetPC && !targetInv) {
        // new target invocation -> open segment 0
        segCounter = 0;
        targetInv = { invocation_id: nextInvId++, target_entry_sp: sp, _frame: fr, segments: [], isrRecords: [] };
        curSeg = newSegment(st);
      }
    }

    // 3) Count the about-to-execute instruction for the active segment (target subtree, no ISR).
    if (targetInv && isrDepth === 0 && curSeg) curSeg.n_instructions++;

    // 4) Remember this instruction; arm the opcode-peek suppression for the upcoming step().
    prev = { pc, sp, opcode: machine.memory.read8(pc) & 0xff };
    peek = { pc, used: false };
  };

  // --- run -------------------------------------------------------------------
  const total = Math.min(header.frames || 0, maxFrames || (header.frames || 0));
  for (let f = 0; f < total; f++) { player.applyFrame(f); machine.runFrame(); }

  // Flush a target still open at end-of-run (regs_out = final state).
  if (targetInv) {
    const st = machine.cpu.getState();
    if (curSeg) finishSegment(curSeg, snapshot(st), 'exit', st.pc);
    emitChain(targetInv);
    targetInv = null;
  }

  return { records: out, invocations: nextInvId };
}

// --- CLI --------------------------------------------------------------------
function main() {
  const [, , scriptArg, targetArg, outArg] = process.argv;
  if (!scriptArg || !targetArg || !outArg) {
    console.error('Usage: node gen_segmented_trace.js <input_script> <targetPC hex> <out.jsonl>');
    process.exit(1);
  }
  const flatPath = path.resolve(ROOT, 'disassembler/oracle/berzerk_flat.bin');
  const flat = new Uint8Array(fs.readFileSync(flatPath));
  const scriptText = fs.readFileSync(resolveRoot(scriptArg), 'utf8');
  const targetPC = parseInt(targetArg, 16);
  const { records, invocations } = captureSegmented({ flat, scriptText, targetPC });
  const outPath = resolveRoot(outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const segs = records.filter((r) => r.type === 'segment').length;
  const isrs = records.filter((r) => r.type === 'isr').length;
  console.error(`segmented trace: ${invocations} invocation(s) of 0x${targetPC.toString(16)}, `
    + `${segs} segment(s), ${isrs} ISR interval(s) -> ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
