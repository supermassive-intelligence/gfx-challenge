// isr_dep_probe.mjs -- does interrupted mainline code read ISR side-effects?
//
// Re-emulates attract-only deterministically and measures:
//  (A) interrupt-span histogram: which routine invocations are preempted by an
//      ISR mid-execution, and how often.
//  (B) ISR write footprint: the set of RAM addresses any ISR (and its callees)
//      writes.
//  (C) GLOBAL provenance dependency: any mainline READ whose most-recent writer
//      was an ISR (a superset signal -- mainline consuming ISR output anywhere).
//  (D) STRICT SPANNING dependency (the real test): a routine that was open when
//      an interrupt fired, after the ISR returns, reads an address that ISR
//      wrote during the split -- before the routine overwrote that address
//      itself. This is exactly "the interrupted routine depends on the
//      interrupt's side effects."
//
// Reuses the heavy_trace_capture frame-tracking technique (SP-depth returns,
// pendingISR entry flag, wrapped mem/IO callbacks). Mem only for data-dep
// tracking (RAM cross-routine state); IO writes reported separately.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Machine } = await import(`${ROOT}/machine/src/machine.js`);

const flat = new Uint8Array(fs.readFileSync(`${ROOT}/disassembler/oracle/berzerk_flat.bin`));
const FRAMES = parseInt(process.argv[2] || '3085', 10);

const machine = new Machine();
machine.loadRoms({ ROM0: flat.slice(0x0000, 0x0800), ROM_MAIN: flat.slice(0x1000, 0x3800) });
machine.reset();

const CALL_OPCODES = new Set([
  0xcd, 0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc,
  0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff,
]);
const hx = (n) => '0x' + (n & 0xffff).toString(16).padStart(4, '0');

// --- invocation stack -------------------------------------------------------
const frames = [];            // open invocations, innermost last
let prev = null;
let pendingISR = null;
let invId = 0;
let isrDepth = 0;             // # of open ISR frames (>0 == in ISR context)
let curIsrWrites = null;      // Set of addrs written by the current top-level ISR

// per-address provenance: true iff most-recent write was in ISR context
const lastWriterISR = new Map();

// reporting accumulators
const interruptedInner = new Map();   // innermost-routine entryPC -> times preempted
const interruptedAny = new Map();     // any spanning routine entryPC -> times spanned
const isrFootprint = new Map();       // RAM addr -> write count by ISRs
const isrIoFootprint = new Map();     // IO port -> write count by ISRs
const globalDep = new Map();          // "readerPC@addr" -> count (provenance superset)
const strictDep = new Map();          // "readerPC@addr" -> count (true spanning dep)
let totalInterrupts = 0;
let totalInvocations = 0;

function curFrame() { return frames.length ? frames[frames.length - 1] : null; }
function inc(map, k) { map.set(k, (map.get(k) || 0) + 1); }

function openFrame(entryPC, sp, isISR) {
  const fr = { entryPC, _entrySP: sp, is_isr: !!isISR, id: ++invId, watch: new Map() };
  frames.push(fr);
  if (isISR) {
    isrDepth++;
    if (isrDepth === 1) curIsrWrites = new Set();   // start top-level ISR footprint
    totalInterrupts++;
    // (A) every currently-open mainline frame is spanned by this interrupt
    const inner = [...frames].reverse().find((f) => !f.is_isr);
    if (inner) inc(interruptedInner, inner.entryPC);
    for (const f of frames) if (!f.is_isr) { f._spanned = true; inc(interruptedAny, f.entryPC); }
  }
}

function closeFrame() {
  const f = frames.pop();
  if (!f.is_isr) totalInvocations++;
  if (f.is_isr) {
    isrDepth--;
    if (isrDepth === 0) {
      // top-level ISR fully returned: arm watches on still-open mainline frames
      for (const fr of frames) if (!fr.is_isr) {
        for (const addr of curIsrWrites) fr.watch.set(addr, true);
      }
      curIsrWrites = null;
    }
  }
}

// --- wrap mem/IO callbacks --------------------------------------------------
const cb = machine.cpu.callbacks;
const oRB = cb.readByte, oWB = cb.writeByte, oRP = cb.readPort, oWP = cb.writePort;
let peek = null;

cb.readByte = (addr) => {
  const a = addr & 0xffff;
  const val = oRB(addr) & 0xff;
  if (peek && !peek.used && a === peek.pc) { peek.used = true; return val; }
  const fr = curFrame();
  if (fr && !fr.is_isr) {
    // (C) global provenance: most-recent writer was an ISR
    if (lastWriterISR.get(a) === true) inc(globalDep, `${hx(fr.entryPC)}@${hx(a)}`);
    // (D) strict spanning: this frame was interrupted and this addr is a live
    //     ISR-written value it hasn't overwritten yet
    if (fr.watch.get(a) === true) inc(strictDep, `${hx(fr.entryPC)}@${hx(a)}`);
  }
  return val;
};
cb.writeByte = (addr, v) => {
  const a = addr & 0xffff;
  const inIsr = isrDepth > 0;
  lastWriterISR.set(a, inIsr);
  if (inIsr) { inc(isrFootprint, a); if (curIsrWrites) curIsrWrites.add(a); }
  else { for (const fr of frames) if (!fr.is_isr) fr.watch.delete(a); } // mainline overwrote
  return oWB(addr, v);
};
cb.readPort = (port) => oRP(port) & 0xff;
cb.writePort = (port, v) => {
  if (isrDepth > 0) inc(isrIoFootprint, port & 0xffff);
  return oWP(port, v);
};

// --- interrupt + step wrapping ----------------------------------------------
const oInt = machine.cpu.interrupt.bind(machine.cpu);
machine.cpu.interrupt = (nm, data) => { const r = oInt(nm, data); pendingISR = true; return r; };

machine.scheduler.onStep = () => {
  const st = machine.cpu.getState();
  const pc = st.pc, sp = st.sp;
  while (frames.length && sp > frames[frames.length - 1]._entrySP) closeFrame();
  if (pendingISR) { openFrame(pc, sp, true); pendingISR = null; }
  else if (prev && CALL_OPCODES.has(prev.opcode) && sp === ((prev.sp - 2) & 0xffff)) {
    openFrame(pc, sp, false);
  }
  prev = { pc, sp, opcode: machine.memory.read8(pc) & 0xff };
  peek = { pc, used: false };
};

// --- run --------------------------------------------------------------------
for (let f = 0; f < FRAMES; f++) machine.runFrame();

// --- report -----------------------------------------------------------------
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`\n=== ISR DEPENDENCY PROBE (attract-only, ${FRAMES} frames) ===`);
console.log(`mainline invocations closed: ${totalInvocations}`);
console.log(`ISR entries (interrupts serviced): ${totalInterrupts}`);

console.log(`\n(A) ROUTINES PREEMPTED MID-EXECUTION (innermost executing frame), top 20:`);
for (const [pc, n] of top(interruptedInner, 20)) console.log(`   ${pc}  preempted ${n}x`);
console.log(`   distinct innermost-preempted routines: ${interruptedInner.size}`);
console.log(`   distinct routines spanning an interrupt (any stack depth): ${interruptedAny.size}`);

console.log(`\n(B) ISR RAM WRITE FOOTPRINT (distinct addrs: ${isrFootprint.size}), top 25:`);
for (const [a, n] of top(isrFootprint, 25)) console.log(`   ${hx(a)}  written ${n}x by ISRs`);
console.log(`   ISR IO-port writes (distinct ports: ${isrIoFootprint.size}): ` +
  top(isrIoFootprint, 16).map(([p, n]) => `${hx(p)}(${n})`).join(' '));

console.log(`\n(C) GLOBAL provenance deps (mainline reads an ISR-written value, superset):`);
console.log(`    distinct (reader@addr) pairs: ${globalDep.size};  total such reads: ` +
  [...globalDep.values()].reduce((a, b) => a + b, 0));
for (const [k, n] of top(globalDep, 25)) console.log(`   ${k}  ${n}x`);

console.log(`\n(D) STRICT SPANNING deps (interrupted routine reads ISR's live write after resume):`);
console.log(`    distinct (reader@addr) pairs: ${strictDep.size};  total: ` +
  [...strictDep.values()].reduce((a, b) => a + b, 0));
for (const [k, n] of top(strictDep, 40)) console.log(`   ${k}  ${n}x`);
// per-reader-routine rollups
const rollup = (map) => {
  const r = new Map();
  for (const [k, n] of map) { const pc = k.split('@')[0]; r.set(pc, (r.get(pc) || 0) + n); }
  return r;
};
const PORTED = new Set('0x14f3 0x1505 0x151a 0x1553 0x15a0 0x15cb 0x1776 0x1ce7 0x1f91 0x1f94 0x22f1 0x2341 0x25e4 0x2678 0x272d 0x27a9 0x2817 0x29a3 0x2a40 0x3719'.split(' '));
const HAZARD = new Set('0x1721 0x18cd 0x1c6e 0x1d12 0x1e6d 0x1e78 0x2436 0x2b54 0x287f'.split(' '));
const cls = (pc) => PORTED.has(pc) ? 'PORTED' : HAZARD.has(pc) ? 'HAZARD' : 'other';
console.log(`\n(D2) STRICT spanning deps by reader routine:`);
for (const [pc, n] of [...rollup(strictDep).entries()].sort((a, b) => b[1] - a[1]))
  console.log(`   ${pc}  [${cls(pc)}]  ${n} reads`);
console.log(`\n(C2) GLOBAL provenance deps by reader routine (top 15):`);
for (const [pc, n] of [...rollup(globalDep).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
  console.log(`   ${pc}  [${cls(pc)}]  ${n} reads`);

// positive controls: known ISR-maintained RNG-phase counter (0x089f/0x08a0) and
// whether RNG (0x2678) consumes ISR-written entropy
console.log(`\n(E) POSITIVE CONTROLS:`);
for (const a of [0x089f, 0x08a0, 0x082c, 0x082d])
  console.log(`   ISR footprint ${hx(a)}: ${isrFootprint.get(a) || 0} writes`);
const rngGlobal = [...globalDep.entries()].filter(([k]) => k.startsWith('0x2678@'));
console.log(`   RNG 0x2678 global provenance deps: ` +
  (rngGlobal.length ? rngGlobal.map(([k, n]) => `${k}(${n})`).join(' ') : 'none'));
console.log('\n=== END ===');
