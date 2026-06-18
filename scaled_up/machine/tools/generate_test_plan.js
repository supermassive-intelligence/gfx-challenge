// generate_test_plan.js -- T7.1: turn heavyweight traces into hermetic per-routine
// test cases (cdoc/schemas/test-plan.md). One JSONL per trace; one record per kept
// invocation. Selection is SELF-VALIDATING: each candidate is replayed on a fresh
// Z80 core against a mock memory, and ONLY records that reproduce regs_out+writes
// are kept. Records that can't be replayed hermetically (ISRs, coroutine/stack-swap
// routines -- heavy-trace.md known limitation) are reported and excluded.
//
// Why replay-by-EXECUTION (not by scripting the read_set): executing from the real
// ROM serves all code/operand fetches and ROM constant tables, so the test record's
// `reads` need only carry WRITABLE-memory + IO reads. This also sidesteps the
// read_set artifacts (heavy-trace.md notes #1,#2,#6): the not-taken-JR displacement
// gap and code-fetch noise never matter because the core re-fetches from ROM.
//
// Usage (CLI):  node tools/generate_test_plan.js <input_script> <out.jsonl> [maxFrames] [perRoutine]
// Usage (test): import { generateTestPlan } from './generate_test_plan.js'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Z80CPU } from '../src/cpu/z80.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { captureTrace } from './heavy_trace_capture.js';

// Memory fill rules mirrored from cdoc/hardware-berzerk.md / src/memory.js:
//   ROM0 0x0000-0x07FF, ROM1-5 0x1000-0x37FF  -> game ROM image (code + const)
//   ROM6 0x3800-0x3FFF (empty socket)         -> 0xFF
//   everything else                            -> 0x00, writable seeds overlaid
const ROM_LO1 = 0x0000, ROM_HI1 = 0x07ff;
const ROM_LO2 = 0x1000, ROM_HI2 = 0x37ff;
function isRomAddr(a) { return (a >= ROM_LO1 && a <= ROM_HI1) || (a >= ROM_LO2 && a <= ROM_HI2); }

function composeF(fl) {
  return ((fl.S & 1) << 7) | ((fl.Z & 1) << 6) | ((fl.Y & 1) << 5) | ((fl.H & 1) << 4)
       | ((fl.X & 1) << 3) | ((fl.P & 1) << 2) | ((fl.N & 1) << 1) | (fl.C & 1);
}
function decomposeF(f) {
  return { S:(f>>7)&1, Z:(f>>6)&1, Y:(f>>5)&1, H:(f>>4)&1, X:(f>>3)&1, P:(f>>2)&1, N:(f>>1)&1, C:f&1 };
}
const REG_KEYS = ['a','f','b','c','d','e','h','l','ix','iy','sp','i','r',
                  'a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p'];

// Build a full core state object from a heavy-trace reg snapshot (defaults for the
// interrupt-mode fields the schema omits -- a routine's arithmetic doesn't depend
// on them, and we never deliver interrupts during hermetic replay).
function stateFromRegs(r) {
  return {
    a:r.a, b:r.b, c:r.c, d:r.d, e:r.e, h:r.h, l:r.l,
    a_prime:r.a_p, b_prime:r.b_p, c_prime:r.c_p, d_prime:r.d_p,
    e_prime:r.e_p, h_prime:r.h_p, l_prime:r.l_p,
    ix:r.ix, iy:r.iy, i:r.i, r:r.r, sp:r.sp, pc:undefined, // pc set by caller
    flags: decomposeF(r.f), flags_prime: decomposeF(r.f_p),
    imode:2, iff1:0, iff2:0, halted:false,
    do_delayed_di:false, do_delayed_ei:false, cycle_counter:0,
  };
}
function regsFromState(st) {
  return {
    a:st.a, f:composeF(st.flags), b:st.b, c:st.c, d:st.d, e:st.e, h:st.h, l:st.l,
    ix:st.ix, iy:st.iy, sp:st.sp, i:st.i, r:st.r,
    a_p:st.a_prime, f_p:composeF(st.flags_prime), b_p:st.b_prime, c_p:st.c_prime,
    d_p:st.d_prime, e_p:st.e_prime, h_p:st.h_prime, l_p:st.l_prime,
  };
}
// Compare all regs EXCEPT `r` (the refresh counter). `r` is perturbed by any
// interrupt that fired during the captured invocation (the ISR's M1 fetches inflate
// it) while our interrupt-free replay does not -- and `r` is never load-bearing in
// Berzerk (entropy is port 0x4E/V256, not `ld a,r`; T5.1). It stays in the record
// for completeness; the bench must not assert on it.
const CMP_KEYS = REG_KEYS.filter(k => k !== 'r');
function regsEqual(a, b) { for (const k of CMP_KEYS) if ((a[k]|0) !== (b[k]|0)) return false; return true; }

function fnv1a(str) { let h = 0x811c9dc5; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h>>>0).toString(16).padStart(8,'0'); }

/** Build the flat ROM image (0x0000-0x37FF) the mock memory loads. */
export function buildRomImage(romRead) {
  const { ROM0, ROM_MAIN } = assembleRoms(romRead);
  const img = new Uint8Array(0x3800);
  img.set(ROM0, 0x0000);
  img.set(ROM_MAIN, 0x1000);
  return img;
}

/**
 * Hermetically replay a test-plan RECORD on a fresh core, using ONLY the record's
 * own fields (entry_pc, regs_in, reads). This is exactly what the Phase-8 bench
 * does, so success here proves the record is self-sufficient.
 * @param {Uint8Array} romBytes  flat ROM image (buildRomImage)
 * @param {object} rec  { entry_pc:(int|hex string), regs_in, reads:[[addr,val,type]] }
 * Returns { ok, regs_out, writes, pcPath } or { ok:false, reason }.
 */
export function replayFromRecord(romBytes, rec) {
  const mem = new Uint8Array(0x10000);
  mem.set(romBytes.subarray(ROM_LO1, ROM_HI1+1), ROM_LO1);
  mem.set(romBytes.subarray(ROM_LO2, ROM_HI2+1), ROM_LO2);
  for (let a=0x3800; a<=0x3fff; a++) mem[a] = 0xff;            // empty ROM6 socket
  const seeded = new Set();
  const ioQ = new Map();                                       // device port -> FIFO
  for (const [addr, val, type] of rec.reads) {
    if (type === 'io') { const p = addr & 0xff; if (!ioQ.has(p)) ioQ.set(p, []); ioQ.get(p).push(val & 0xff); continue; }
    const a = addr & 0xffff;
    if (!seeded.has(a)) { mem[a] = val & 0xff; seeded.add(a); }
  }
  const ioCursor = new Map();
  const writes = [];
  let ioStarved = false;
  const cpu = new Z80CPU({
    readByte: (a) => mem[a & 0xffff],
    writeByte: (a, v) => { a&=0xffff; writes.push({addr:a, val:v&0xff, type:'mem'}); if (a >= 0x0800) mem[a] = v & 0xff; },
    readPort: (p) => { p&=0xff; const q=ioQ.get(p); const i=ioCursor.get(p)||0; if(!q||i>=q.length){ioStarved=true;return 0xff;} ioCursor.set(p,i+1); return q[i]; },
    writePort: (p, v) => { writes.push({addr:p&0xff, val:v&0xff, type:'io'}); },
  });
  const entryPC = typeof rec.entry_pc === 'string' ? parseInt(rec.entry_pc, 16) : rec.entry_pc;
  const st = stateFromRegs(rec.regs_in); st.pc = entryPC;
  cpu.setState(st);
  const entrySP = rec.regs_in.sp;
  const pcPath = [];
  let steps = 0;
  const MAX = 50000;  // a returning leaf is far shorter; this only bounds how fast
                      // non-returning (coroutine/stack-swap) invocations are rejected.
  while (true) {
    const s = cpu.getState();
    if (s.sp > entrySP && steps > 0) break;                   // returned (SP rose above entry)
    pcPath.push(s.pc);
    cpu.step();
    if (++steps > MAX) return { ok:false, reason:'no-return' };
    if (ioStarved) return { ok:false, reason:'io-starved' };
  }
  return { ok:true, regs_out: regsFromState(cpu.getState()), writes, pcPath };
}

// data-only read list for the record (writable + IO, in capture order)
function recordReads(inv) {
  const out = [];
  for (const rd of inv.read_set) {
    if (rd.type === 'io') { out.push([rd.addr & 0xff, rd.val, 'io']); continue; }
    const a = rd.addr & 0xffff;
    if (isRomAddr(a)) continue;
    out.push([a, rd.val, 'mem']);
  }
  return out;
}
// IO bus addresses are captured as the full 16-bit bus (A<<8|port or BC); the
// meaningful device port is the low byte. Normalize io addrs to the device port so
// records and the self-check compare on (device-port, value), not incidental A/B.
function normAddr(w) { return w.type === 'io' ? (w.addr & 0xff) : (w.addr & 0xffff); }
function writeList(ws) { return ws.map(w => [normAddr(w), w.val, w.type]); }
function writesEqual(replayWs, captureWs) {
  if (replayWs.length !== captureWs.length) return false;
  for (let i=0;i<replayWs.length;i++){
    const a = replayWs[i], b = captureWs[i];
    if (normAddr(a)!==normAddr(b) || (a.val&0xff)!==(b.val&0xff) || a.type!==b.type) return false;
  }
  return true;
}

/**
 * @param {object} o
 * @param {(name:string)=>Uint8Array} o.romRead
 * @param {string} o.scriptText
 * @param {number} [o.maxFrames]
 * @param {number} [o.perRoutine]  max distinct paths kept per routine (default 8)
 * @param {(pc:number)=>string} [o.nameOf]  routine namer (T6.1); falls back to hex
 * @returns {{records:object[], stats:object}}
 */
export function generateTestPlan({ romRead, scriptText, maxFrames, perRoutine = 8, nameOf }) {
  const romBytes = buildRomImage(romRead);
  const { invocations } = captureTrace({ romRead, scriptText, maxFrames });

  // group by routine; within a routine keep one record per distinct PC-path, capped.
  const byRoutine = new Map();                                // entryPC -> Map(path_id -> record)
  const stats = { invocations: invocations.length, replayed_ok: 0, replay_failed: 0,
                  failReasons: {}, routines_total: new Set(), routines_kept: new Set(),
                  capped: 0, perRoutine: new Map(), maxKeptPath: 0 };
  const pr = (pc) => { let e = stats.perRoutine.get(pc); if (!e) { e = {ok:0, fail:0, reasons:{}}; stats.perRoutine.set(pc, e); } return e; };

  for (const inv of invocations) {
    stats.routines_total.add(inv.entryPC);
    const p = pr(inv.entryPC);
    if (inv.is_isr) { stats.replay_failed++; stats.failReasons.isr = (stats.failReasons.isr||0)+1; p.fail++; p.reasons.isr=(p.reasons.isr||0)+1; continue; }
    // Validate from the RECORD's own fields (data-only reads) -- the exact contract
    // the Phase-8 bench replays under, so a kept record is provably self-sufficient.
    const reads = recordReads(inv);
    const rep = replayFromRecord(romBytes, { entry_pc: inv.entryPC, regs_in: inv.regs_in, reads });
    if (!rep.ok) { stats.replay_failed++; stats.failReasons[rep.reason]=(stats.failReasons[rep.reason]||0)+1; p.fail++; p.reasons[rep.reason]=(p.reasons[rep.reason]||0)+1; continue; }
    // self-check: replay must reproduce regs_out + writes
    const okRegs = regsEqual(rep.regs_out, inv.regs_out);
    const okWrites = writesEqual(rep.writes, inv.write_set);
    if (!okRegs || !okWrites) {
      stats.replay_failed++;
      const why = !okRegs && !okWrites ? 'regs+writes' : !okRegs ? 'regs' : 'writes';
      stats.failReasons[why] = (stats.failReasons[why]||0)+1;
      p.fail++; p.reasons[why]=(p.reasons[why]||0)+1;
      continue;
    }
    p.ok++;
    stats.replayed_ok++;
    if (rep.pcPath.length > stats.maxKeptPath) stats.maxKeptPath = rep.pcPath.length;
    const path_id = fnv1a(rep.pcPath.map(p=>p.toString(16)).join(','));
    if (!byRoutine.has(inv.entryPC)) byRoutine.set(inv.entryPC, new Map());
    const paths = byRoutine.get(inv.entryPC);
    if (paths.has(path_id)) continue;                          // dedupe: this path already covered
    if (paths.size >= perRoutine) { stats.capped++; continue; }
    const hx = '0x' + inv.entryPC.toString(16).padStart(4,'0');
    paths.set(path_id, {
      routine: (nameOf && nameOf(inv.entryPC)) || hx,
      entry_pc: hx,
      regs_in: inv.regs_in,
      reads,
      regs_out: inv.regs_out,
      writes: writeList(inv.write_set),
      cycles: inv.cycle_count,
      path_id,
    });
  }

  const records = [];
  for (const [pc, paths] of [...byRoutine.entries()].sort((a,b)=>a[0]-b[0])) {
    stats.routines_kept.add(pc);
    for (const rec of paths.values()) records.push(rec);
  }
  stats.routines_total = stats.routines_total.size;
  stats.routines_kept = stats.routines_kept.size;
  return { records, stats };
}

// --- CLI ---------------------------------------------------------------------
function loadLabels() {
  // T6.1 names for readable `routine` fields (does not affect selection/validation).
  try {
    const p = path.resolve(fileURLToPath(import.meta.url), '../../../disassembler/oracle/labels.json');
    const lab = JSON.parse(fs.readFileSync(p, 'utf8'));
    const m = new Map(Object.entries(lab).map(([k,v]) => [parseInt(k,16), v]));
    return (pc) => m.get(pc) || null;
  } catch { return null; }
}
function main() {
  const [, , scriptPath, outPath, maxArg, perArg] = process.argv;
  if (!scriptPath || !outPath) {
    console.error('Usage: node generate_test_plan.js <input_script> <out.jsonl> [maxFrames] [perRoutine]');
    process.exit(1);
  }
  const romDir = process.env.BERZERK_ROM_DIR || '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
  const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(romDir, name)));
  for (const f of ROM_FILES) if (!fs.existsSync(path.join(romDir, f))) { console.error(`ROM ${f} not found in ${romDir}`); process.exit(1); }
  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  const { records, stats } = generateTestPlan({
    romRead, scriptText,
    maxFrames: maxArg ? parseInt(maxArg,10) : undefined,
    perRoutine: perArg ? parseInt(perArg,10) : 8,
    nameOf: loadLabels(),
  });
  fs.writeFileSync(outPath, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.error(`test plan: ${records.length} records over ${stats.routines_kept}/${stats.routines_total} routines -> ${outPath}`);
  console.error(`  invocations ${stats.invocations}; replayed_ok ${stats.replayed_ok}; failed ${stats.replay_failed} ${JSON.stringify(stats.failReasons)}; capped ${stats.capped}; maxKeptPath ${stats.maxKeptPath}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
