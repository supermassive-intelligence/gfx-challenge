// coro_2a40.test.js -- pilot V3 for the COROUTINE-ized 0x2a40 (PRINT_DIGITS) port.
// Work order: cdoc/pilot-2a40-coroutine-port-workorder.md. Builds on the V1/V2 segment
// pilot (segment_chain_2a40.test.js, GREEN) and cdoc/long-routine-validation-plan.md.
//
//  V3a -- OUTPUT EQUIVALENCE (pass/fail). For each of the 20 attract invocations, the
//      generator port driven to completion produces a write sequence + regs_out
//      BYTE-IDENTICAL to the shipped whole-routine port (./print_digits.js) run on the same
//      hermetic entry state. Yielding must not change output. Also anchored to ground truth:
//      the shipped port's data writes equal the recorded own-write reconstruction
//      (segment write_sets concatenated, Z80 stack scaffolding stripped as bench.js does).
//  V3b -- CADENCE CORRECTNESS (pass/fail). Driving the coroutine against the RECORDED
//      interrupt schedule (cumulative segment own-cycles), the number of interrupts the
//      driver services over the span equals the recorded n_interrupts within +/-1, all 20.
//  V3c -- PARTITION AGREEMENT (DIAGNOSTIC, report only). Fraction of serviced interrupts
//      placed in their own inter-boundary interval (no catch-up overshoot). Not asserted.
//
// Plus a reported FINDING (diagnostic): a single fixed own-cycle gap does NOT reproduce
// cadence -- un-modeled ISR durations perturb the routine-own-cycle spacing of interrupts --
// which is why the schedule must come from the driver (here: the recorded chain), exactly as
// cdoc/long-routine-validation-plan.md S5 prescribes.
//
// WZ caveat: the core models no WZ; 0x2a40 is clean, so NA here -- not fabricated.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINT_DIGITS } from '../ports/print_digits.js';
import { PRINT_DIGITS_CORO, driveCoro } from '../ports/print_digits_coro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = 0x2a40;
const SEG_FILE = path.resolve(ROOT, 'traces/segmented/attract-only.0x2a40.jsonl');
const FLAT = new Uint8Array(fs.readFileSync(path.resolve(ROOT, 'disassembler/oracle/berzerk_flat.bin')));

// --- ROM image (same load as the segment capture: ROM0 + ROM_MAIN + empty ROM6 socket) ---
function romImage() {
  const img = new Uint8Array(0x10000);
  img.set(FLAT.subarray(0x0000, 0x0800), 0x0000);
  img.set(FLAT.subarray(0x1000, 0x3800), 0x1000);
  for (let a = 0x3800; a <= 0x3fff; a++) img[a] = 0xff;
  return img;
}

// --- bench-style hermetic ctx (copied construction from bench.js buildCtx) -----------
function decomposeF(f){return {S:(f>>7)&1,Z:(f>>6)&1,Y:(f>>5)&1,H:(f>>4)&1,X:(f>>3)&1,P:(f>>2)&1,N:(f>>1)&1,C:f&1};}
function composeF(fl){return ((fl.S&1)<<7)|((fl.Z&1)<<6)|((fl.Y&1)<<5)|((fl.H&1)<<4)|((fl.X&1)<<3)|((fl.P&1)<<2)|((fl.N&1)<<1)|(fl.C&1);}
function buildCtx(entryRegs, reads, img) {
  const mem = img.slice();
  const seeded = new Set(), ioQ = new Map();
  for (const [a, v, t] of reads) {
    if (t === 'io') { const p = a & 0xff; if (!ioQ.has(p)) ioQ.set(p, []); ioQ.get(p).push(v & 0xff); continue; }
    const aa = a & 0xffff; if (!seeded.has(aa)) { mem[aa] = v & 0xff; seeded.add(aa); }
  }
  const writes = [], ioWrites = [], ioCursor = new Map();
  const ri = entryRegs;
  const regs = { a:ri.a, b:ri.b, c:ri.c, d:ri.d, e:ri.e, h:ri.h, l:ri.l, ix:ri.ix, iy:ri.iy,
                 a_p:ri.a_p, b_p:ri.b_p, c_p:ri.c_p, d_p:ri.d_p, e_p:ri.e_p, h_p:ri.h_p, l_p:ri.l_p };
  const ctx = {
    regs, flags: decomposeF(ri.f), flags_p: decomposeF(ri.f_p), cycles: 0,
    mem: {
      r8: (a) => mem[a & 0xffff],
      w8: (a, v) => { a &= 0xffff; v &= 0xff; writes.push([a, v, 'mem']); if (a >= 0x0800) mem[a] = v; },
      r16: (a) => mem[a & 0xffff] | (mem[(a + 1) & 0xffff] << 8),
      w16: (a, v) => { ctx.mem.w8(a, v & 0xff); ctx.mem.w8(a + 1, (v >> 8) & 0xff); },
    },
    io: {
      in: (p) => { p &= 0xff; const q = ioQ.get(p); const i = ioCursor.get(p) || 0; if (!q || i >= q.length) return 0xff; ioCursor.set(p, i + 1); return q[i]; },
      out: (p, v) => { ioWrites.push([p & 0xff, v & 0xff, 'io']); },
    },
    _writes: writes, _ioWrites: ioWrites,
  };
  ctx.retAddr = (mem[ri.sp & 0xffff] | (mem[(ri.sp + 1) & 0xffff] << 8)) & 0xffff;
  return ctx;
}

// regs_out comparison: bench's CMP_KEYS + X/Y mask (nothing looser).
const CMP_KEYS = ['a','f','b','c','d','e','h','l','ix','iy','a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p'];
const F_KEYS = new Set(['f','f_p']);
const XY_MASK = ~((1<<3)|(1<<5)) & 0xff;
function regsOutOf(ctx){
  const r = ctx.regs;
  return { a:r.a&0xff, f:composeF(ctx.flags), b:r.b&0xff, c:r.c&0xff, d:r.d&0xff, e:r.e&0xff, h:r.h&0xff, l:r.l&0xff,
           ix:r.ix&0xffff, iy:r.iy&0xffff, a_p:r.a_p&0xff, f_p:composeF(ctx.flags_p), b_p:r.b_p&0xff, c_p:r.c_p&0xff,
           d_p:r.d_p&0xff, e_p:r.e_p&0xff, h_p:r.h_p&0xff, l_p:r.l_p&0xff };
}
function regDiff(exp, got){
  for (const k of CMP_KEYS){ let a=exp[k]|0, b=got[k]|0; if (F_KEYS.has(k)){ a&=XY_MASK; b&=XY_MASK; } if (a!==b) return `${k} exp 0x${a.toString(16)} got 0x${b.toString(16)}`; }
  return null;
}
function writesDiff(exp, got){
  if (exp.length !== got.length) return `length exp ${exp.length} got ${got.length}`;
  for (let i=0;i<exp.length;i++){ const e=exp[i], g=got[i]; if ((e[0]&0xffff)!==(g[0]&0xffff) || (e[1]&0xff)!==(g[1]&0xff) || e[2]!==g[2]) return `write[${i}] exp ${JSON.stringify(e)} got ${JSON.stringify(g)}`; }
  return null;
}

// stack-scaffolding strip (copied from bench.js): contiguous run descending from entry sp+1.
function stackAddrs(sp, reads, writes){
  const touched = new Set();
  for (const [a,,t] of reads)  if (t==='mem') touched.add(a&0xffff);
  for (const [a,,t] of writes) if (t==='mem') touched.add(a&0xffff);
  const stack = new Set();
  for (let a=(sp+1)&0xffff; touched.has(a); a=(a-1)&0xffff) stack.add(a);
  return stack;
}

function loadChain(){
  const lines = fs.readFileSync(SEG_FILE,'utf8').trim().split('\n').map((l)=>JSON.parse(l));
  const byInv = new Map();
  for (const r of lines){
    if (r.type==='invocation_summary') byInv.set(r.invocation_id, { summary:r, segs:[] });
    else if (r.type==='segment') byInv.get(r.invocation_id).segs.push(r);
  }
  return byInv;
}

test('pilot 0x2a40 V3: coroutine output-equivalence (V3a) + cadence (V3b) + partition diagnostic (V3c)', () => {
  assert.ok(fs.existsSync(SEG_FILE), `missing ${SEG_FILE} -- run gen_segmented_trace.js first`);
  const chain = loadChain();
  assert.strictEqual(chain.size, 20, `expected 20 invocations, got ${chain.size}`);
  const img = romImage();

  let v3a = 0, v3aAnchor = 0, v3b = 0;
  const rows = [];                 // per-invocation report
  let serviced1 = 0, servicedTotal = 0;   // V3c
  let fixedGapErrSum = 0; const fixedGapErrs = [];  // finding: fixed-gap diagnostic
  const GAP = 4070;                // representative full inter-boundary own-cycle gap (observed cap ~4079)

  for (let id = 0; id < 20; id++){
    const g = chain.get(id);
    assert.ok(g, `no chain for invocation ${id}`);
    const entry = g.segs[0].entry_regs;
    const reads = [], writesRec = [];
    for (const s of g.segs){ for (const r of s.read_set) reads.push(r); for (const w of s.write_set) writesRec.push(w); }
    // cumulative own-cycle boundaries at each interrupt (non-exit segment ends).
    let acc = 0; const cum = []; for (const s of g.segs){ acc += s.cycle_count; cum.push(acc); }
    const boundaries = cum.slice(0, -1);
    const nInt = g.summary.n_interrupts;
    assert.strictEqual(boundaries.length, nInt, `inv ${id}: boundary count ${boundaries.length} != n_interrupts ${nInt}`);

    // ---- V3a: shipped vs coroutine-drained (drive with empty schedule = pure drain) ----
    const ctxShip = buildCtx(entry, reads, img);
    PRINT_DIGITS(ctxShip);
    const shipRegs = regsOutOf(ctxShip);

    const ctxCoro = buildCtx(entry, reads, img);
    driveCoro(ctxCoro, []);                       // drain, service nothing
    const coroRegs = regsOutOf(ctxCoro);

    const wMem = writesDiff(ctxShip._writes, ctxCoro._writes);
    const wIo  = writesDiff(ctxShip._ioWrites, ctxCoro._ioWrites);
    const rD   = regDiff(shipRegs, coroRegs);
    const v3aOk = !wMem && !wIo && !rD;
    if (v3aOk) v3a++;

    // anchor: shipped data-writes == recorded own-write reconstruction (stack stripped).
    const stack = stackAddrs(entry.sp, reads, writesRec);
    const wantMem = writesRec.filter(([a,,t]) => t==='mem' && !stack.has(a&0xffff)).map(([a,v]) => [a&0xffff, v&0xff, 'mem']);
    const wantIo  = writesRec.filter(([,,t]) => t==='io').map(([a,v]) => [a&0xff, v&0xff, 'io']);
    const aMem = writesDiff(wantMem, ctxShip._writes);
    const aIo  = writesDiff(wantIo, ctxShip._ioWrites);
    const anchorOk = !aMem && !aIo;
    if (anchorOk) v3aAnchor++;

    // ---- V3b: drive coroutine against the RECORDED schedule, count serviced interrupts ----
    const ctxCad = buildCtx(entry, reads, img);
    const { seams, serviced } = driveCoro(ctxCad, boundaries);
    const v3bOk = Math.abs(serviced - nInt) <= 1;
    if (v3bOk) v3b++;

    // V3c: of serviced interrupts, how many landed alone in their interval (servicedHere==1)
    for (const s of seams){ if (s.servicedHere > 0){ servicedTotal += s.servicedHere; if (s.servicedHere === 1) serviced1++; } }

    // finding: fixed-gap predictor (phase-seeded at the first recorded boundary).
    let fixedPred = 0;
    if (nInt > 0){ fixedPred = 1; for (let c = boundaries[0] + GAP; c <= boundaries[boundaries.length-1] + 1; c += GAP) fixedPred++; }
    const fge = Math.abs(fixedPred - nInt); fixedGapErrs.push(fge); fixedGapErrSum += fge;

    rows.push({ id, B: entry.b, nInt, serviced, fixedPred, ownCyc: acc, portCyc: ctxShip.cycles, v3aOk, anchorOk, v3bOk });

    assert.ok(v3aOk, `V3a inv ${id}: coroutine output != shipped port -- mem:${wMem} io:${wIo} regs:${rD}`);
    assert.ok(anchorOk, `V3a-anchor inv ${id}: shipped writes != recorded reconstruction -- mem:${aMem} io:${aIo}`);
    assert.ok(v3bOk, `V3b inv ${id}: serviced ${serviced} vs recorded ${nInt} (|diff|>1)`);
  }

  // ---------------- report ----------------
  console.log('\n  inv  B  recOwnCyc portCyc  V3a  anchor  recInt  servd  |d|  fixedGapPred');
  for (const r of rows){
    console.log(`  ${String(r.id).padStart(2)}   ${r.B}  ${String(r.ownCyc).padStart(8)} ${String(r.portCyc).padStart(7)}  ${r.v3aOk?'ok ':'FAIL'}  ${r.anchorOk?'ok ':'FAIL'}    ${String(r.nInt).padStart(4)}   ${String(r.serviced).padStart(4)}  ${Math.abs(r.serviced-r.nInt)}    ${String(r.fixedPred).padStart(4)}`);
  }
  console.log(`\n  V3a output-equivalence (coroutine == shipped port): ${v3a}/20`);
  console.log(`  V3a anchor (shipped == recorded reconstruction):     ${v3aAnchor}/20`);
  console.log(`  V3b cadence (serviced == recorded n_interrupts +/-1): ${v3b}/20`);
  const exact = rows.filter(r => r.serviced === r.nInt).length;
  console.log(`      of which EXACT (serviced == n_interrupts):        ${exact}/20`);
  console.log(`  V3c partition (DIAGNOSTIC): ${serviced1}/${servicedTotal} interrupts serviced alone in their interval ` +
              `(${servicedTotal? (100*serviced1/servicedTotal).toFixed(0):'0'}%)`);
  // finding
  const fixedExact = fixedGapErrs.filter(e => e === 0).length;
  const fixedWithin1 = fixedGapErrs.filter(e => e <= 1).length;
  console.log(`\n  FINDING -- fixed own-cycle gap (G=${GAP}) predictor vs recorded n_interrupts:`);
  console.log(`    exact: ${fixedExact}/20, within +/-1: ${fixedWithin1}/20, total abs error: ${fixedGapErrSum}, max: ${Math.max(...fixedGapErrs)}`);
  console.log(`    -> a fixed routine-internal gap canNOT reproduce cadence; the schedule must`);
  console.log(`       come from the driver (recorded chain / interrupt controller). This is the`);
  console.log(`       cost-model requirement for the Scope-B coroutine driver.`);

  assert.strictEqual(v3a, 20, 'V3a not green for all invocations');
  assert.strictEqual(v3aAnchor, 20, 'V3a anchor not green for all invocations');
  assert.strictEqual(v3b, 20, 'V3b not green for all invocations');
});
