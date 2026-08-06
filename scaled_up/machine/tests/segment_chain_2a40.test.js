// segment_chain_2a40.test.js -- pilot V1/V2 for the segment-chain capture of 0x2a40.
// Work order: cdoc/pilot-2a40-segment-chain-workorder.md. Plan: cdoc/long-routine-
// validation-plan.md (APPROVED 2026-06-22).
//
//  V1 (lossless segmentation): for every 0x2a40 invocation, the ordered concatenation of
//      its segment write_sets + the folded ISR-interval write_sets equals the whole-
//      invocation write_set from a plain heavy_trace_capture (INCLUSIVE mode) of the same
//      deterministic run; and the last segment's regs_out equals the whole regs_out.
//  V2 (per-segment snapshot-sufficiency): each segment, replayed on a fresh Z80 core
//      seeded ONLY with its entry snapshot (entry_pc + entry_regs) + its recorded read_set,
//      reproduces its regs_out and write_set byte-exact (bench.js X/Y-flag mask, nothing
//      looser). Proves each segment is a pure function of its boundary snapshot.
//
// WZ caveat: the core does not model WZ; entry snapshots carry no WZ. 0x2a40 is clean
// (no WZ-derived flag dependence at any boundary), so this is NA here -- not fabricated.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Z80CPU } from '../src/cpu/z80.js';
import { captureTrace } from '../tools/heavy_trace_capture.js';
import { captureSegmented } from '../tools/gen_segmented_trace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROM_DIR = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const TARGET = 0x2a40;
const SEG_FILE = path.resolve(ROOT, 'traces/segmented/attract-only.0x2a40.jsonl');
const SCRIPT = path.resolve(ROOT, 'traces/scripts/attract-only.jsonl');
const FLAT = new Uint8Array(fs.readFileSync(path.resolve(ROOT, 'disassembler/oracle/berzerk_flat.bin')));

// --- reg helpers (copied from generate_test_plan.js / bench.js; same construction) ----
function composeF(fl){return ((fl.S&1)<<7)|((fl.Z&1)<<6)|((fl.Y&1)<<5)|((fl.H&1)<<4)|((fl.X&1)<<3)|((fl.P&1)<<2)|((fl.N&1)<<1)|(fl.C&1);}
function decomposeF(f){return {S:(f>>7)&1,Z:(f>>6)&1,Y:(f>>5)&1,H:(f>>4)&1,X:(f>>3)&1,P:(f>>2)&1,N:(f>>1)&1,C:f&1};}
function stateFromRegs(r){
  return {
    a:r.a,b:r.b,c:r.c,d:r.d,e:r.e,h:r.h,l:r.l,
    a_prime:r.a_p,b_prime:r.b_p,c_prime:r.c_p,d_prime:r.d_p,e_prime:r.e_p,h_prime:r.h_p,l_prime:r.l_p,
    ix:r.ix,iy:r.iy,i:r.i,r:r.r,sp:r.sp,pc:undefined,
    flags:decomposeF(r.f),flags_prime:decomposeF(r.f_p),
    imode:2,iff1:0,iff2:0,halted:false,do_delayed_di:false,do_delayed_ei:false,cycle_counter:0,
  };
}
function regsFromState(st){
  return {
    a:st.a,f:composeF(st.flags),b:st.b,c:st.c,d:st.d,e:st.e,h:st.h,l:st.l,
    ix:st.ix,iy:st.iy,sp:st.sp,i:st.i,r:st.r,
    a_p:st.a_prime,f_p:composeF(st.flags_prime),b_p:st.b_prime,c_p:st.c_prime,
    d_p:st.d_prime,e_p:st.e_prime,h_p:st.h_prime,l_p:st.l_prime,
  };
}
// bench.js comparison: excludes sp/r/i; masks undocumented X(bit3)/Y(bit5) on f/f_p.
const CMP_KEYS = ['a','f','b','c','d','e','h','l','ix','iy','a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p'];
const F_KEYS = new Set(['f','f_p']);
const XY_MASK = ~((1<<3)|(1<<5)) & 0xff;
function regDiff(exp, got){
  for(const k of CMP_KEYS){
    let a=exp[k]|0, b=got[k]|0;
    if(F_KEYS.has(k)){ a&=XY_MASK; b&=XY_MASK; }
    if(a!==b) return `${k} exp 0x${a.toString(16)} got 0x${b.toString(16)}`;
  }
  return null;
}
// canonical write key (handles [addr,val,type] arrays and {addr,val,type} objects; io->&0xff)
function canonW(w){
  const addr = Array.isArray(w)?w[0]:w.addr, val = Array.isArray(w)?w[1]:w.val, type = Array.isArray(w)?w[2]:w.type;
  const a = type==='io' ? (addr&0xff) : (addr&0xffff);
  return `${type}:${a.toString(16)}=${(val&0xff).toString(16)}`;
}
function writesDiff(exp, got){
  if(exp.length!==got.length) return `length exp ${exp.length} got ${got.length}`;
  for(let i=0;i<exp.length;i++){ const e=canonW(exp[i]), g=canonW(got[i]); if(e!==g) return `write[${i}] exp ${e} got ${g}`; }
  return null;
}

// --- load the segmented chain (grouped by invocation, in execution/file order) --------
function loadChain(){
  const lines = fs.readFileSync(SEG_FILE,'utf8').trim().split('\n').map((l)=>JSON.parse(l));
  const byInv = new Map();     // id -> { summary, items:[seg|isr in file order], segments:[] }
  for(const r of lines){
    if(r.type==='invocation_summary'){ byInv.set(r.invocation_id, {summary:r, items:[], segments:[]}); }
    else { const g = byInv.get(r.invocation_id); g.items.push(r); if(r.type==='segment') g.segments.push(r); }
  }
  return byInv;
}

// --- V2 hermetic core replay of one segment (run exactly n_instructions) --------------
function replaySegment(seg){
  const mem = new Uint8Array(0x10000);
  mem.set(FLAT.subarray(0x0000,0x0800),0x0000);     // ROM0
  mem.set(FLAT.subarray(0x1000,0x3800),0x1000);     // ROM_MAIN
  for(let a=0x3800;a<=0x3fff;a++) mem[a]=0xff;       // empty ROM6 socket
  const seeded=new Set(), ioQ=new Map();
  for(const [addr,val,type] of seg.read_set){
    if(type==='io'){ const p=addr&0xff; if(!ioQ.has(p))ioQ.set(p,[]); ioQ.get(p).push(val&0xff); continue; }
    const a=addr&0xffff; if(!seeded.has(a)){ mem[a]=val&0xff; seeded.add(a); }
  }
  const writes=[]; const ioCursor=new Map(); let starvePort=null;
  const cpu = new Z80CPU({
    readByte:(a)=>mem[a&0xffff],
    writeByte:(a,v)=>{ a&=0xffff; writes.push([a,v&0xff,'mem']); if(a>=0x0800) mem[a]=v&0xff; },
    readPort:(p)=>{ p&=0xff; const q=ioQ.get(p); const i=ioCursor.get(p)||0; if(!q||i>=q.length){ starvePort=p; return 0xff; } ioCursor.set(p,i+1); return q[i]; },
    writePort:(p,v)=>{ writes.push([p&0xff,v&0xff,'io']); },
  });
  const st = stateFromRegs(seg.entry_regs); st.pc = parseInt(seg.entry_pc,16);
  cpu.setState(st);
  for(let i=0;i<seg.n_instructions;i++) cpu.step();
  const s = cpu.getState();
  return { regs_out: regsFromState(s), writes, finalPC: s.pc & 0xffff, starvePort };
}

// ====================================================================================
test('pilot 0x2a40: V1 lossless segmentation + V2 per-segment snapshot-sufficiency', () => {
  assert.ok(fs.existsSync(SEG_FILE), `missing ${SEG_FILE} -- run gen_segmented_trace.js first`);

  // Whole-invocation reference: a plain heavy_trace_capture in INCLUSIVE mode of the same
  // deterministic run (rom-file load == flat-bin load, verified byte-identical).
  const romRead = (n)=>new Uint8Array(fs.readFileSync(path.join(ROM_DIR,n)));
  const scriptText = fs.readFileSync(SCRIPT,'utf8');
  const wholes = [];
  captureTrace({ romRead, scriptText, inclusive:true, onInvocation:(inv)=>{ if(inv.entryPC===TARGET) wholes.push(inv); } });

  const chain = loadChain();
  assert.strictEqual(chain.size, wholes.length, `invocation count: chain ${chain.size} vs inclusive ${wholes.length}`);
  assert.strictEqual(wholes.length, 20, `expected 20 invocations, got ${wholes.length}`);

  let multi=0, totalSegs=0, v1pass=0;
  const v2results = [];                 // {id, seg, ok, reason}

  for(let id=0; id<wholes.length; id++){
    const g = chain.get(id);
    assert.ok(g, `no chain for invocation ${id}`);
    const whole = wholes[id];
    if(g.summary.n_interrupts >= 1) multi++;
    totalSegs += g.segments.length;

    // ---- V1: ordered (segments + ISRs) write_set == inclusive whole ----
    const recon = [];
    for(const item of g.items) for(const w of item.write_set) recon.push(w);
    const wd = writesDiff(whole.write_set, recon);
    assert.strictEqual(wd, null, `V1 inv ${id}: write_set mismatch -- ${wd}`);
    // last segment regs_out == whole regs_out
    const last = g.segments[g.segments.length-1];
    assert.strictEqual(last.end_boundary, 'exit', `V1 inv ${id}: last segment not an exit boundary`);
    const rdWhole = regDiff(whole.regs_out, last.regs_out);
    assert.strictEqual(rdWhole, null, `V1 inv ${id}: last regs_out != whole regs_out -- ${rdWhole}`);
    v1pass++;

    // ---- V2: each segment self-validates hermetically ----
    for(const seg of g.segments){
      const res = replaySegment(seg);
      let reason = null;
      if(res.starvePort != null) reason = `io-starved on port 0x${res.starvePort.toString(16)} (read not in segment read_set)`;
      else if(res.finalPC !== parseInt(seg.boundary_pc,16)) reason = `path diverged: ended at 0x${res.finalPC.toString(16)}, boundary 0x${parseInt(seg.boundary_pc,16).toString(16)} (hidden input the snapshot missed)`;
      else { const rd = regDiff(seg.regs_out, res.regs_out); if(rd) reason = `regs_out: ${rd}`;
             else { const w = writesDiff(seg.write_set, res.writes); if(w) reason = `write_set: ${w}`; } }
      v2results.push({ id, seg: seg.seg_index, ok: reason===null, reason });
    }
  }

  // ---- report ----
  const v2pass = v2results.filter(r=>r.ok).length;
  const v2fail = v2results.filter(r=>!r.ok);
  console.log(`\n  0x2a40 invocations captured: ${wholes.length}`);
  console.log(`  multi-segment (>=1 interrupt): ${multi}`);
  console.log(`  total segments: ${totalSegs}`);
  console.log(`  V1 pass: ${v1pass}/${wholes.length} (lossless segmentation + last regs_out)`);
  console.log(`  V2 pass: ${v2pass}/${v2results.length} (per-segment snapshot-sufficiency)`);
  for(const f of v2fail) console.log(`  V2 FAIL  inv ${f.id} seg ${f.seg}: ${f.reason}`);

  // ---- the pilot is done iff BOTH are fully green ----
  assert.strictEqual(v1pass, wholes.length, 'V1 not green for all invocations');
  assert.strictEqual(v2fail.length, 0, `V2 failing segments (findings): ${v2fail.map(f=>`(${f.id},${f.seg})`).join(' ')}`);
});
