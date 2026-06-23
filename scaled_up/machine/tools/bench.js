// bench.js -- T8.1: hermetic test bench for PORTED JS routines. NO emulator: no CPU
// core, no full Machine. Each test-plan case (cdoc/schemas/test-plan.md) supplies a
// mock memory (ROM image + writable read-seeds) + an ordered IO FIFO + entry regs;
// the bench invokes a hand-ported JS routine and diffs regs_out + data writes.
//
// What a JS port must reproduce (and what it must NOT):
//   - DATA writes (RAM/VRAM/IO) and register OUTPUTS, including flags.
//   - It must NOT model the Z80 stack. Stack scaffolding in the captured record --
//     the routine's own push/pop of saved registers and the CALL return address --
//     is STRIPPED before comparison (the contiguous block of mem accesses around
//     the entry SP). Likewise `sp` (a `ret` pops the return address: out = in+2) and
//     `r` (refresh, interrupt-perturbed; T5.1 not load-bearing) are NOT compared.
//
// Port contract:  port(ctx) mutates ctx in place.
//   ctx.regs   = { a,b,c,d,e,h,l,ix,iy, a_p,b_p,c_p,d_p,e_p,h_p,l_p }
//   ctx.flags  = { S,Z,Y,H,X,P,N,C }      ctx.flags_p = shadow flags
//   ctx.mem    = { r8(a), w8(a,v), r16(a), w16(a,v) }   (w* records into mem.writes)
//   ctx.io     = { in(p), out(p,v) }                    (out records into io.writes)
//
// Usage (CLI):  node tools/bench.js <plan.jsonl> [<plan2.jsonl> ...]
// Usage (test): import { runBench } from './bench.js'; import { PORTS } from '../ports/index.js'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRoms, ROM_FILES } from '../src/roms.js';   // pure ROM byte assembler (NOT the machine)

const CMP_KEYS = ['a','f','b','c','d','e','h','l','ix','iy',
                  'a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p'];  // excludes sp, r
// X/Y-FLAG TOLERANCE (extends the T2.3 core-gate tolerance to the port bench). The
// undocumented X(bit3)/Y(bit5) flags come from the internal WZ register on hardware;
// the vendored live core (z80_core.js) does NOT model WZ -- it uses the n-based BIT
// rule -- so for some BIT-at-ret routines the MAME-captured record's X/Y differ from
// what the live machine produces. T2.3 PROVED (decode-oracle scan) that Berzerk never
// branches on X/Y, so they are not behaviorally load-bearing; comparing the JS port to
// MAME's X/Y would hold it to a standard the un-hooked machine itself cannot meet. We
// therefore MASK X(bit3)/Y(bit5) when comparing the F and F' bytes -- every documented
// flag (S/Z/H/P/N/C), all registers, and all memory writes are still compared exactly,
// so a genuine regression still fails. See decisions.md 2026-06-19 (T2.3 extension).
const F_KEYS = new Set(['f', 'f_p']);
const XY_MASK = ~((1 << 3) | (1 << 5)) & 0xff;   // clear bit5 (Y) and bit3 (X)
function composeF(fl){return ((fl.S&1)<<7)|((fl.Z&1)<<6)|((fl.Y&1)<<5)|((fl.H&1)<<4)|((fl.X&1)<<3)|((fl.P&1)<<2)|((fl.N&1)<<1)|(fl.C&1);}
function decomposeF(f){return {S:(f>>7)&1,Z:(f>>6)&1,Y:(f>>5)&1,H:(f>>4)&1,X:(f>>3)&1,P:(f>>2)&1,N:(f>>1)&1,C:f&1};}

/** Optional flat ROM image (0x0000-0x37FF). Ports that read ROM constant tables
 *  need it; pure-RAM ports (e.g. RANDOM) do not. Built from ROM bytes only. */
export function loadRomImage(romRead) {
  const { ROM0, ROM_MAIN } = assembleRoms(romRead);
  const img = new Uint8Array(0x10000);
  img.set(ROM0, 0x0000);
  img.set(ROM_MAIN, 0x1000);
  for (let a=0x3800; a<=0x3fff; a++) img[a] = 0xff;          // empty ROM6 socket
  return img;
}

// Stack-scaffolding addresses for a case: the contiguous run of mem-accessed
// addresses descending from sp+1 (return address at sp/sp+1, then any pushes
// below). Data lives at fixed addresses far from the live stack, so the run stops
// at the first gap -- giving the exact push/pop/ret byte set with no magic window.
function stackAddrs(rec) {
  const sp = rec.regs_in.sp;
  const touched = new Set();
  for (const [a,,t] of rec.reads)  if (t === 'mem') touched.add(a & 0xffff);
  for (const [a,,t] of rec.writes) if (t === 'mem') touched.add(a & 0xffff);
  const stack = new Set();
  for (let a = (sp + 1) & 0xffff; touched.has(a); a = (a - 1) & 0xffff) stack.add(a);
  return stack;
}

// Expected DATA writes = recorded writes minus stack writes; io normalized to port.
function expectedWrites(rec, stack) {
  return rec.writes
    .filter(([a,,t]) => t === 'io' || !stack.has(a & 0xffff))
    .map(([a,v,t]) => [t === 'io' ? (a & 0xff) : (a & 0xffff), v & 0xff, t]);
}

function buildCtx(rec, romImage) {
  const mem = romImage ? romImage.slice() : new Uint8Array(0x10000);
  const seeded = new Set();
  const ioQ = new Map();
  for (const [a,v,t] of rec.reads) {
    if (t === 'io') { const p = a & 0xff; if (!ioQ.has(p)) ioQ.set(p, []); ioQ.get(p).push(v & 0xff); continue; }
    const aa = a & 0xffff; if (!seeded.has(aa)) { mem[aa] = v & 0xff; seeded.add(aa); }
  }
  const writes = [];
  const ioCursor = new Map();
  const ioWrites = [];
  const ri = rec.regs_in;
  const regs = { a:ri.a, b:ri.b, c:ri.c, d:ri.d, e:ri.e, h:ri.h, l:ri.l, ix:ri.ix, iy:ri.iy,
                 a_p:ri.a_p, b_p:ri.b_p, c_p:ri.c_p, d_p:ri.d_p, e_p:ri.e_p, h_p:ri.h_p, l_p:ri.l_p };
  const ctx = {
    regs,
    flags: decomposeF(ri.f), flags_p: decomposeF(ri.f_p),
    mem: {
      r8: (a) => mem[a & 0xffff],
      w8: (a, v) => { a&=0xffff; v&=0xff; writes.push([a, v, 'mem']); if (a >= 0x0800) mem[a] = v; },
      r16: (a) => mem[a & 0xffff] | (mem[(a+1) & 0xffff] << 8),
      w16: (a, v) => { ctx.mem.w8(a, v & 0xff); ctx.mem.w8(a+1, (v >> 8) & 0xff); },
    },
    io: {
      in: (p) => { p&=0xff; const q=ioQ.get(p); const i=ioCursor.get(p)||0; if(!q||i>=q.length) return 0xff; ioCursor.set(p,i+1); return q[i]; },
      out: (p, v) => { ioWrites.push([p & 0xff, v & 0xff, 'io']); },
    },
    _writes: writes, _ioWrites: ioWrites,
  };
  // retAddr = the return address the CALL pushed (the word at entry sp). Inline-param
  // ports (0x3657/0x297b) read their constant data bytes that follow the call site at
  // this address; mirrors the live hook's ctx.retAddr so a port is caller-agnostic.
  ctx.retAddr = (mem[ri.sp & 0xffff] | (mem[(ri.sp + 1) & 0xffff] << 8)) & 0xffff;
  return ctx;
}

function regsOutOf(ctx) {
  const r = ctx.regs;
  return { a:r.a&0xff, f:composeF(ctx.flags), b:r.b&0xff, c:r.c&0xff, d:r.d&0xff, e:r.e&0xff,
           h:r.h&0xff, l:r.l&0xff, ix:r.ix&0xffff, iy:r.iy&0xffff,
           a_p:r.a_p&0xff, f_p:composeF(ctx.flags_p), b_p:r.b_p&0xff, c_p:r.c_p&0xff,
           d_p:r.d_p&0xff, e_p:r.e_p&0xff, h_p:r.h_p&0xff, l_p:r.l_p&0xff };
}

// Mem writes preserve order; io writes appended after (their relative order to mem
// is not recorded -- heavy-trace.md note #4 -- so compare the two streams separately).
function diffCase(rec, ctx) {
  const got = regsOutOf(ctx);
  for (const k of CMP_KEYS) {
    const mask = F_KEYS.has(k) ? XY_MASK : 0xffffff;   // mask undocumented X/Y on F/F'
    if (((got[k]|0) & mask) !== ((rec.regs_out[k]|0) & mask))
      return { ok:false, why:`regs_out.${k} got 0x${(got[k]|0).toString(16)} want 0x${(rec.regs_out[k]|0).toString(16)}` };
  }
  const stack = stackAddrs(rec);
  const wantAll = expectedWrites(rec, stack);
  const wantMem = wantAll.filter(w => w[2] === 'mem');
  const wantIo  = wantAll.filter(w => w[2] === 'io');
  const gotMem = ctx._writes, gotIo = ctx._ioWrites;
  const eqList = (g, w) => g.length === w.length && g.every((x,i) => x[0]===w[i][0] && x[1]===w[i][1] && x[2]===w[i][2]);
  if (!eqList(gotMem, wantMem)) return { ok:false, why:`mem writes got ${JSON.stringify(gotMem)} want ${JSON.stringify(wantMem)}` };
  if (!eqList(gotIo, wantIo))   return { ok:false, why:`io writes got ${JSON.stringify(gotIo)} want ${JSON.stringify(wantIo)}` };
  return { ok:true };
}

/**
 * @param {object[]} records  test-plan records
 * @param {Map<string,Function>} ports  entry_pc("0x2678") -> port fn
 * @param {Uint8Array} [romImage]
 * @returns {{routines:Map, totalPass:number, totalFail:number, totalSkip:number}}
 */
export function runBench(records, ports, romImage) {
  const routines = new Map();   // entry_pc -> {name, pass, fail, skip, firstFail}
  let totalPass=0, totalFail=0, totalSkip=0;
  for (const rec of records) {
    const port = ports.get(rec.entry_pc);
    let e = routines.get(rec.entry_pc);
    if (!e) { e = { name: rec.routine, pass:0, fail:0, skip:0, firstFail:null }; routines.set(rec.entry_pc, e); }
    if (!port) { e.skip++; totalSkip++; continue; }            // no port yet (expected pre-T9)
    let res;
    try {
      const ctx = buildCtx(rec, romImage);
      port(ctx);
      res = diffCase(rec, ctx);
    } catch (err) { res = { ok:false, why:`threw: ${err.message}` }; }
    if (res.ok) { e.pass++; totalPass++; }
    else { e.fail++; totalFail++; if (!e.firstFail) e.firstFail = `${rec.entry_pc} path ${rec.path_id}: ${res.why}`; }
  }
  return { routines, totalPass, totalFail, totalSkip };
}

export function loadPlan(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Usage: node bench.js <plan.jsonl> [...]'); process.exit(2); }
  const { PORTS } = await import('../ports/index.js');
  const romDir = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  let romImage;
  if (ROM_FILES.every((f) => fs.existsSync(path.join(romDir, f)))) {
    romImage = loadRomImage((n) => new Uint8Array(fs.readFileSync(path.join(romDir, n))));
  }
  const records = files.flatMap(loadPlan);
  const { routines, totalPass, totalFail, totalSkip } = runBench(records, PORTS, romImage);
  const ported = [...routines.values()].filter(r => r.pass + r.fail > 0);
  for (const [pc, r] of routines) {
    if (r.pass + r.fail === 0) continue;
    const tag = r.fail ? 'FAIL' : 'ok';
    console.log(`  ${tag}  ${pc} ${r.name}: ${r.pass} pass, ${r.fail} fail${r.firstFail ? '  -- ' + r.firstFail : ''}`);
  }
  console.log(`bench: ${ported.length} ported routine(s); ${totalPass} pass, ${totalFail} fail, ${totalSkip} cases skipped (no port yet)`);
  process.exit(totalFail > 0 ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
