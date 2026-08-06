import test from 'node:test';
import assert from 'node:assert';
import { Z80CPU } from '../src/cpu/z80.js';

// Pins the read-set characteristic surfaced by the T4.2 MAME spot-check
// (heavy-trace.md consumption note #6): the vendored DrGoldfire core
// (do_conditional_relative_jump) fetches a JR cc / DJNZ displacement byte via
// the memory callback ONLY when the branch is taken. A not-taken conditional
// relative branch advances PC without a mem_read of the displacement, so that
// operand fetch is ABSENT from any read-set built from the memory callbacks.
// Real Z80 / MAME always fetch it; this is the one explained read_set delta.
//
// This is a CHARACTERISTIC test (locks current behavior), not a bug assertion.

function buildCPU() {
  const mem = new Uint8Array(0x10000);
  const reads = [];
  const cpu = new Z80CPU({
    readByte: (a) => { reads.push(a & 0xffff); return mem[a & 0xffff]; },
    writeByte: (a, v) => { mem[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff,
    writePort: () => {},
  });
  return { cpu, mem, reads };
}

function setCarry(cpu, c) {
  const s = cpu.getState();
  s.pc = 0x0000;
  s.flags.C = c;
  cpu.setState(s);
}

// JR C,+2 at 0x0000: opcode 0x38, displacement 0x02 at 0x0001.
function loadJRC(mem) { mem[0x0000] = 0x38; mem[0x0001] = 0x02; mem[0x0002] = 0x00; }

test('not-taken JR cc issues NO displacement read (core characteristic)', () => {
  const { cpu, mem, reads } = buildCPU();
  loadJRC(mem);
  setCarry(cpu, 0);            // carry clear -> JR C not taken
  cpu.step();
  assert.strictEqual(cpu.pc, 0x0002, 'not-taken JR C should fall through to PC+2');
  assert.ok(!reads.includes(0x0001),
    `displacement byte at 0x0001 must NOT be read when branch not taken; reads=${JSON.stringify(reads)}`);
});

test('taken JR cc DOES issue the displacement read', () => {
  const { cpu, mem, reads } = buildCPU();
  loadJRC(mem);
  setCarry(cpu, 1);            // carry set -> JR C taken
  cpu.step();
  assert.strictEqual(cpu.pc, 0x0004, 'taken JR C,+2 should jump to 0x0000+2+2');
  assert.ok(reads.includes(0x0001),
    `displacement byte at 0x0001 must be read when branch taken; reads=${JSON.stringify(reads)}`);
});
