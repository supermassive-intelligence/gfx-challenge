// routine_fidelity_diff.js -- T4.2 MAME-vs-JS routine fidelity comparison.
//
// State-keyed pairing (timing-robust, per Sudnya's T4.2 decision): JS and MAME
// run their own attract sessions and DRIFT after the deterministic window, so we
// do NOT pair by frame/index. Instead we pair invocations of the same routine by
// their CONSUMED INPUTS (input registers the routine reads + the routine's data
// reads), then assert the OUTPUTS match.
//
// Normalization (applied identically to both sides):
//   * fetch  = read whose addr is in the routine code span [codeLo, codeHi)  -> kept
//   * stack  = read/write whose addr is in [entrySP-16, entrySP+1]           -> stripped
//   * data   = everything else                                               -> kept
//   R is excluded from key and diff (refresh counter, not architectural).
//   SP is excluded from the diff (net-zero rule; MAME also updates SP mid-RET).
//
// Diff per matched pair:
//   * regs_out for every register except r,sp:
//       - if regs_in[reg] equal across the pair      -> regs_out[reg] must be equal
//       - if regs_in[reg] differs (non-consumed ctx) -> reg must be UNCHANGED on
//         both sides (proves the routine didn't touch it)
//   * read_set minus stack (fetches+data, ordered) must be identical
//   * write_set minus stack (ordered) must be identical
//
// Usage: node routine_fidelity_diff.js <mame_full.jsonl> <pairsPerRoutine>

import fs from 'node:fs';
import readline from 'node:readline';

const REGS = ['a','f','b','c','d','e','h','l','ix','iy','i',
              'a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p']; // excl r, sp

const ROUTINES = [
  { name: 'RANDOM',  entryPC: 0x2678, jsFile: '/tmp/js_2678.jsonl', span: 0x40, keyRegs: [] },
  { name: 'RT_18e0', entryPC: 0x18e0, jsFile: '/tmp/js_18e0.jsonl', span: 0x40, keyRegs: [] },
  { name: 'RT_1ce7', entryPC: 0x1ce7, jsFile: '/tmp/js_1ce7.jsonl', span: 0x40, keyRegs: ['h','l'] },
  { name: 'RT_287f', entryPC: 0x287f, jsFile: '/tmp/js_287f.jsonl', span: 0x40, keyRegs: [] },
];

const mameFull = process.argv[2];
const PAIRS = parseInt(process.argv[3] || '3', 10);

function entrySP(rec) { return rec.entrySP !== undefined ? rec.entrySP : rec.regs_in.sp; }
function isFetch(addr, r) { return addr >= r.entryPC && addr < r.entryPC + r.span; }
function isStack(addr, sp) { return addr >= sp - 16 && addr <= sp + 1; }

function classify(rec, r) {
  const sp = entrySP(rec);
  const data = [], nonStackReads = [], nonStackWrites = [];
  for (const e of rec.read_set) {
    if (isStack(e.addr, sp)) continue;
    nonStackReads.push(e);
    if (!isFetch(e.addr, r)) data.push(e);
  }
  for (const e of rec.write_set) {
    if (isStack(e.addr, sp)) continue;
    nonStackWrites.push(e);
  }
  return { data, nonStackReads, nonStackWrites, sp };
}

function keyOf(rec, r, cl) {
  const regs = r.keyRegs.map(k => rec.regs_in[k]);
  const data = cl.data.map(d => [d.addr, d.val, d.type]);
  return JSON.stringify([regs, data]);
}

function loadJS(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

async function loadMAME(entryPC) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(mameFull) });
  const tag = `"entryPC":${entryPC},`;
  for await (const line of rl) {
    if (line.includes(tag)) out.push(JSON.parse(line));
  }
  return out;
}

function eqList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].addr !== b[i].addr || a[i].val !== b[i].val || a[i].type !== b[i].type) return false;
  }
  return true;
}

function fmtAccess(list) {
  return list.map(e => `${e.type}[0x${e.addr.toString(16)}]=0x${e.val.toString(16).padStart(2,'0')}`).join(' ');
}

function diffPair(js, mame, r) {
  const cj = classify(js, r), cm = classify(mame, r);
  const regLines = [], regBad = [];
  for (const reg of REGS) {
    const ji = js.regs_in[reg], mi = mame.regs_in[reg];
    const jo = js.regs_out[reg], mo = mame.regs_out[reg];
    let status;
    if (ji === mi) {
      status = (jo === mo) ? 'OK' : 'MISMATCH';
    } else {
      const jU = (jo === ji), mU = (mo === mi);
      status = (jU && mU) ? 'OK(passthru)' : 'MISMATCH(ctx-dep)';
    }
    if (status.startsWith('MISMATCH')) regBad.push(reg);
    if (ji !== mi || jo !== mo || status !== 'OK')
      regLines.push(`    ${reg.padEnd(4)} in:JS=${ji} MAME=${mi}  out:JS=${jo} MAME=${mo}  -> ${status}`);
  }
  const readsOK = eqList(cj.nonStackReads, cm.nonStackReads);
  const writesOK = eqList(cj.nonStackWrites, cm.nonStackWrites);
  const jsDelta = js.regs_out.sp - js.regs_in.sp;
  const mameDelta = mame.regs_out.sp - entrySP(mame);
  return { regLines, regBad, readsOK, writesOK, cj, cm, jsDelta, mameDelta };
}

(async () => {
  for (const r of ROUTINES) {
    console.log(`\n================ ${r.name} @ 0x${r.entryPC.toString(16)} ================`);
    let jsRecs;
    try { jsRecs = loadJS(r.jsFile); } catch (e) { console.log(`  (no JS file ${r.jsFile})`); continue; }
    const mameRecs = await loadMAME(r.entryPC);
    console.log(`  JS records: ${jsRecs.length}   MAME records: ${mameRecs.length}`);

    // Build MAME key index.
    const mameByKey = new Map();
    for (const m of mameRecs) {
      const cm = classify(m, r);
      const k = keyOf(m, r, cm);
      if (!mameByKey.has(k)) mameByKey.set(k, m);
    }
    // Find JS records whose key matches a MAME key; dedupe by key.
    const seen = new Set();
    const pairs = [];
    for (const j of jsRecs) {
      const cj = classify(j, r);
      const k = keyOf(j, r, cj);
      if (seen.has(k)) continue;
      const m = mameByKey.get(k);
      if (m) { pairs.push([j, m]); seen.add(k); }
      if (pairs.length >= PAIRS) break;
    }
    console.log(`  matched distinct-input pairs found: ${pairs.length} (showing up to ${PAIRS})`);

    let allGood = true;
    pairs.forEach(([j, m], idx) => {
      const d = diffPair(j, m, r);
      const pass = d.regBad.length === 0 && d.readsOK && d.writesOK;
      allGood = allGood && pass;
      console.log(`\n  --- pair #${idx+1}  [${pass ? 'MATCH' : 'DIFF'}] ---`);
      console.log(`    key input regs: ${r.keyRegs.length ? r.keyRegs.map(k=>`${k}=${j.regs_in[k]}`).join(' ') : '(none)'}`);
      console.log(`    data reads (key): ${fmtAccess(d.cj.data) || '(none)'}`);
      console.log(`    read_set\\stack  JS: ${fmtAccess(d.cj.nonStackReads)}`);
      console.log(`    read_set\\stack MAME: ${fmtAccess(d.cm.nonStackReads)}   -> ${d.readsOK ? 'MATCH' : 'DIFF'}`);
      console.log(`    write_set\\stack  JS: ${fmtAccess(d.cj.nonStackWrites) || '(none)'}`);
      console.log(`    write_set\\stack MAME: ${fmtAccess(d.cm.nonStackWrites) || '(none)'}   -> ${d.writesOK ? 'MATCH' : 'DIFF'}`);
      console.log(`    SP delta JS=${d.jsDelta} MAME=${d.mameDelta} (excluded from verdict; MAME updates SP mid-RET)`);
      console.log(`    regs_out diff (only differing/notable fields; r,sp excluded):`);
      console.log(d.regLines.length ? d.regLines.join('\n') : '      (all compared registers identical)');
    });
    console.log(`\n  ==> ${r.name}: ${allGood && pairs.length ? 'ALL PAIRS MATCH' : (pairs.length ? 'SOME DIFF' : 'NO PAIRS')}`);
  }
})();
