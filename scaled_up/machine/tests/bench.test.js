import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench, loadPlan } from '../tools/bench.js';
import { PORTS } from '../ports/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = path.resolve(__dirname, '../../traces/test-plans');

// ---- Hermetic harness tests (no files, no ROM, no CPU) ----------------------
// A synthetic record + a trivial inline port exercise: register diff, IO/mem write
// diff, stack-scaffolding stripping, and failure detection.

function rec(over = {}) {
  // a routine entered with sp=0x4300: caller pushed the return address at 0x4300/01;
  // the routine pushes BC (saving it) at 0x42fe/ff, writes one DATA byte to 0x0822,
  // then pops BC and rets. Stack bytes must be stripped; only the data write counts.
  const regs_in = { a:1,f:0,b:0xAA,c:0xBB,d:0,e:0,h:0,l:0,ix:0,iy:0,sp:0x4300,i:7,r:0,
                    a_p:0,f_p:0,b_p:0,c_p:0,d_p:0,e_p:0,h_p:0,l_p:0 };
  return {
    routine:'SYN', entry_pc:'0xTEST',
    regs_in,
    reads:[[0x42fe,0xBB,'mem'],[0x42ff,0xAA,'mem'],[0x4300,0x34,'mem'],[0x4301,0x12,'mem']], // pop bc + ret addr
    regs_out:{ ...regs_in, a:2, sp:0x4302, r:9 },  // a:1->2; sp/r are scaffolding (not compared)
    writes:[[0x42ff,0xAA,'mem'],[0x42fe,0xBB,'mem'],[0x0822,0x77,'mem']], // push bc (stack) + data
    cycles:10, path_id:'syn00000',
    ...over,
  };
}
// correct port: a++ and write the data byte; leaves bc/etc; does NOT touch the stack.
function goodPort(ctx){ ctx.regs.a = (ctx.regs.a + 1) & 0xff; ctx.mem.w8(0x0822, 0x77); }

test('bench: correct port passes; stack writes are stripped, only data compared', () => {
  const ports = new Map([['0xTEST', goodPort]]);
  const r = runBench([rec()], ports);
  assert.strictEqual(r.totalPass, 1, 'expected the correct port to pass');
  assert.strictEqual(r.totalFail, 0);
});

test('bench: wrong register output is detected (fail)', () => {
  const ports = new Map([['0xTEST', (ctx)=>{ ctx.regs.a = 99; ctx.mem.w8(0x0822,0x77); }]]);
  const r = runBench([rec()], ports);
  assert.strictEqual(r.totalFail, 1, 'wrong A must fail');
});

test('bench: wrong/missing data write is detected (fail)', () => {
  const ports = new Map([['0xTEST', (ctx)=>{ ctx.regs.a = (ctx.regs.a+1)&0xff; /* forgets the write */ }]]);
  const r = runBench([rec()], ports);
  assert.strictEqual(r.totalFail, 1, 'missing data write must fail');
});

test('bench: a thrown port is a fail, not a crash', () => {
  const ports = new Map([['0xTEST', ()=>{ throw new Error('boom'); }]]);
  const r = runBench([rec()], ports);
  assert.strictEqual(r.totalFail, 1);
  assert.match(r.routines.get('0xTEST').firstFail, /threw/);
});

test('bench: unported routines are skipped, not failed', () => {
  const r = runBench([rec()], new Map());
  assert.strictEqual(r.totalSkip, 1);
  assert.strictEqual(r.totalFail, 0);
});

// ---- Integration: the real RANDOM port vs committed test-plan cases ----------
const plansExist = fs.existsSync(PLAN_DIR) && fs.readdirSync(PLAN_DIR).some(f => f.endsWith('.jsonl'));

test('bench: RANDOM port reproduces all RANDOM cases in the committed plans',
  { skip: plansExist ? false : `no plans in ${PLAN_DIR}` }, () => {
    const records = fs.readdirSync(PLAN_DIR).filter(f => f.endsWith('.jsonl'))
      .flatMap(f => loadPlan(path.join(PLAN_DIR, f)))
      .filter(r => r.entry_pc === '0x2678');
    assert.ok(records.length > 0, 'no RANDOM cases found in plans');
    const r = runBench(records, PORTS);              // RANDOM needs no ROM (reads only 0x435C)
    assert.strictEqual(r.totalFail, 0, `RANDOM failed: ${[...r.routines.values()][0]?.firstFail}`);
    assert.strictEqual(r.totalPass, records.length, 'not all RANDOM cases passed');
  });
