import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROM_FILES } from '../src/roms.js';
import { generateTestPlan, replayFromRecord, buildRomImage, explainRecord } from '../tools/generate_test_plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ROMs are user-supplied and never committed (same idiom as heavy-trace.test.js).
const ROM_DIR = process.env.BERZERK_ROM_DIR || path.resolve(__dirname, '../../../rom/berzerk');
const romsAvailable = ROM_FILES.every((f) => fs.existsSync(path.join(ROM_DIR, f)));
const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(ROM_DIR, name)));
const skip = romsAvailable ? false : `ROMs not found in ${ROM_DIR}`;

const SCRIPT = path.resolve(__dirname, '../../traces/scripts/attract-only.jsonl');
// Bounded window: invocations begin ~frame 500 (POST). 700 frames yields a few
// dozen leaf-replayable records across ~20 routines -- fast and representative.
const FRAMES = 700;

function plan() {
  return generateTestPlan({ romRead, scriptText: fs.readFileSync(SCRIPT, 'utf8'), maxFrames: FRAMES });
}

// Compose `f` the same way the schema/generator does, for regs comparison.
function composeF(fl){return ((fl.S&1)<<7)|((fl.Z&1)<<6)|((fl.Y&1)<<5)|((fl.H&1)<<4)|((fl.X&1)<<3)|((fl.P&1)<<2)|((fl.N&1)<<1)|(fl.C&1);}
const CMP = ['a','f','b','c','d','e','h','l','ix','iy','sp','i','a_p','f_p','b_p','c_p','d_p','e_p','h_p','l_p']; // no `r`

test('generator emits at least one record over multiple routines', { skip }, () => {
  const { records, stats } = plan();
  assert.ok(records.length > 0, 'no records generated');
  const routines = new Set(records.map((r) => r.entry_pc));
  assert.ok(routines.size >= 5, `expected >=5 distinct routines, got ${routines.size}`);
  assert.ok(stats.replayed_ok > 0, 'no invocation replayed ok');
});

// DoD: replaying every emitted record on the JS machine reproduces regs_out + writes.
test('every emitted record self-validates (replay reproduces regs_out + writes)', { skip }, () => {
  const rom = buildRomImage(romRead);
  const { records } = plan();
  for (const rec of records) {
    const rep = replayFromRecord(rom, rec);
    assert.ok(rep.ok, `record ${rec.routine} ${rec.entry_pc} (path ${rec.path_id}) failed to return: ${rep.reason}`);
    // regs_out (excluding r)
    for (const k of CMP) {
      assert.strictEqual(rep.regs_out[k] | 0, rec.regs_out[k] | 0,
        `regs_out.${k} mismatch for ${rec.routine} ${rec.entry_pc} path ${rec.path_id}`);
    }
    // writes (ordered, device-port for io)
    assert.strictEqual(rep.writes.length, rec.writes.length,
      `write count mismatch for ${rec.routine} ${rec.entry_pc} path ${rec.path_id}`);
    for (let i = 0; i < rec.writes.length; i++) {
      const [a, v, t] = rec.writes[i];
      const w = rep.writes[i];
      const wa = t === 'io' ? (w.addr & 0xff) : (w.addr & 0xffff);
      assert.ok(wa === a && (w.val & 0xff) === v && w.type === t,
        `write[${i}] mismatch for ${rec.routine} ${rec.entry_pc} path ${rec.path_id}: got [${wa},${w.val},${w.type}] want [${a},${v},${t}]`);
    }
  }
});

// --explain: explainRecord reproduces the EXACT executed instruction trace (the pcPath
// that generation discards down to path_id) with data reads/writes attributed per insn.
// RANDOM (0x2678) is the canonical straight-line reference: a single 14-instruction path.
test('explainRecord yields the RANDOM instruction trace with reads/writes attributed', { skip }, () => {
  const rom = buildRomImage(romRead);
  // RANDOM first fires ~frame 950, so widen the window enough to capture it.
  const { records } = generateTestPlan({ romRead, scriptText: fs.readFileSync(SCRIPT, 'utf8'), maxFrames: 1100 });
  const rnd = records.find((r) => r.entry_pc === '0x2678');
  assert.ok(rnd, 'no RANDOM (0x2678) record in the window');
  const res = explainRecord(rom, rnd);
  assert.ok(res.ok && res.returned, 'explainRecord did not return cleanly');
  const mnem = res.steps.map((s) => s.m);
  assert.deepStrictEqual(mnem, [
    'push hl', 'ld hl,($435c)', 'ld d,h', 'ld e,l',
    'add hl,hl', 'add hl,de', 'add hl,hl', 'add hl,de',
    'ld de,$3153', 'add hl,de', 'ld ($435c),hl', 'ld a,h', 'pop hl', 'ret',
  ], 'RANDOM instruction sequence mismatch');
  // Read/write ATTRIBUTION (the point of the tool): code/operand fetches are not logged;
  // only data accesses are, on the instruction that caused them.
  const ld = res.steps[1];                              // ld hl,($435c)
  assert.deepStrictEqual(ld.reads.map((r) => r[0]), [0x435c, 0x435d], 'seed read not attributed to ld hl,(nn)');
  assert.strictEqual(ld.writes.length, 0, 'ld hl,(nn) must not write');
  assert.strictEqual(res.steps[0].writes.length, 2, 'push hl writes two bytes (the saved HL)');
  const store = res.steps.find((s) => s.m === 'ld ($435c),hl');
  assert.deepStrictEqual(store.writes.map((w) => w[0]), [0x435c, 0x435d], 'seed store not attributed');
  assert.strictEqual(res.steps[res.steps.length - 1].reads.length, 2, 'ret reads the 2-byte return address');
});

// Determinism: same window -> same record set (path_ids + counts stable).
test('plan generation is deterministic', { skip }, () => {
  const a = plan().records.map((r) => `${r.entry_pc}:${r.path_id}`).sort().join('|');
  const b = plan().records.map((r) => `${r.entry_pc}:${r.path_id}`).sort().join('|');
  assert.strictEqual(a, b, 'record set differs between two generations');
});
