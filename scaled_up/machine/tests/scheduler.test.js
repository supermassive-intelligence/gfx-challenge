import test from 'node:test';
import assert from 'node:assert';
import { Z80CPU } from '../src/cpu/z80.js';
import {
  Scheduler, FRAME_EVENTS, vposToVsync, vsyncToVpos,
  CYCLES_PER_SCANLINE, CYCLES_PER_FRAME, HTOTAL, VTOTAL,
} from '../src/scheduler.js';

// All expected values are hand-derived from cdoc/hardware-berzerk.md Section 5,
// cited per case.

// A minimal deterministic CPU for cadence tests: consumes 4 cycles/step, always
// accepts interrupts (iff1=1), and records interrupt() calls.
class MockCpu {
  constructor() { this.cc = 0; this.iff1 = 1; this.calls = []; }
  step() { this.cc += 4; return 4; }
  getState() { return { iff1: this.iff1, cycle_counter: this.cc }; }
  interrupt(nm, data) { this.cc += nm ? 11 : 19; this.calls.push({ nm, data }); }
}

// ---------------------------------------------------------------------------
// Section 5.1 -- cycles per frame matches the spec-derived value exactly.
// ---------------------------------------------------------------------------
test('Section 5.1: cycles per scanline/frame are the spec-derived constants', () => {
  assert.strictEqual(CYCLES_PER_SCANLINE, 160);          // 320 / 2
  assert.strictEqual(CYCLES_PER_FRAME, 41920);           // 160 * 262
  assert.strictEqual(CYCLES_PER_FRAME, (HTOTAL / 2) * VTOTAL);
  assert.strictEqual(CYCLES_PER_FRAME, CYCLES_PER_SCANLINE * VTOTAL);
});

// ---------------------------------------------------------------------------
// Section 5.2/5.3 -- vsync chain conversion and the resolved firing positions.
// ---------------------------------------------------------------------------
test('Section 5.2: vsync<->vpos conversion (the 0xf0 "duplicate" dissolves)', () => {
  assert.strictEqual(vsyncToVpos(0xf0, 0), 240);  // (0xf0, v256=0)
  assert.strictEqual(vsyncToVpos(0xf0, 1), 16);   // (0xf0, v256=1) -> line 16
  assert.strictEqual(vsyncToVpos(0x80, 0), 128);  // IRQ0
  assert.strictEqual(vsyncToVpos(0xda, 1), 256);  // IRQ1
  // round-trip over the visible (V256=0) region
  for (let vpos = 32; vpos < 256; vpos++) {
    const { counter, v256 } = vposToVsync(vpos);
    assert.strictEqual(vsyncToVpos(counter, v256), vpos, `round-trip vpos ${vpos}`);
  }
});

test('Section 5.3: the per-frame event table is sorted with the resolved positions', () => {
  const order = FRAME_EVENTS.map((e) => `${e.type}@${e.vpos}`);
  assert.deepStrictEqual(order, [
    'nmi@16', 'nmi@48', 'nmi@80', 'nmi@112', 'irq@128',
    'nmi@144', 'nmi@176', 'nmi@208', 'nmi@240', 'irq@256',
  ]);
  // cycle offsets are vpos * 160
  for (const e of FRAME_EVENTS) assert.strictEqual(e.cycle, e.vpos * 160);
});

// ---------------------------------------------------------------------------
// Section 5.3/5.4/5.5 -- NMI/IRQ delivered at the documented cadence over N
// frames (count + position), and suppressed when disabled.
// ---------------------------------------------------------------------------
test('Section 5.3: 8 NMI + 2 IRQ per frame at the documented positions', () => {
  const sched = new Scheduler(new MockCpu());
  sched.setIrqEnable(true);
  sched.enableNmi();
  const fired = [];
  sched.onInterrupt = (type, vpos) => fired.push({ type, vpos });

  sched.runFrames(3);

  const nmis = fired.filter((f) => f.type === 'nmi');
  const irqs = fired.filter((f) => f.type === 'irq');
  assert.strictEqual(nmis.length, 24, '8 NMI * 3 frames');
  assert.strictEqual(irqs.length, 6, '2 IRQ * 3 frames');
  assert.deepStrictEqual([...new Set(nmis.map((f) => f.vpos))].sort((a, b) => a - b),
    [16, 48, 80, 112, 144, 176, 208, 240]);
  assert.deepStrictEqual([...new Set(irqs.map((f) => f.vpos))].sort((a, b) => a - b),
    [128, 256]);
});

test('Section 5.4/5.5: interrupts are suppressed while their port is disabled', () => {
  // Reset state: both disabled -> nothing fires.
  let sched = new Scheduler(new MockCpu());
  let fired = [];
  sched.onInterrupt = (t) => fired.push(t);
  sched.runFrame();
  assert.strictEqual(fired.length, 0, 'both disabled -> no interrupts');

  // Only NMI enabled.
  sched = new Scheduler(new MockCpu());
  sched.enableNmi();
  fired = [];
  sched.onInterrupt = (t) => fired.push(t);
  sched.runFrame();
  assert.strictEqual(fired.filter((t) => t === 'nmi').length, 8);
  assert.strictEqual(fired.filter((t) => t === 'irq').length, 0);

  // Only IRQ enabled.
  sched = new Scheduler(new MockCpu());
  sched.setIrqEnable(true);
  fired = [];
  sched.onInterrupt = (t) => fired.push(t);
  sched.runFrame();
  assert.strictEqual(fired.filter((t) => t === 'irq').length, 2);
  assert.strictEqual(fired.filter((t) => t === 'nmi').length, 0);
});

test('Section 5.4: a held IRQ survives setIrqEnable(false) (MAME HOLD_LINE)', () => {
  const cpu = new MockCpu();
  cpu.iff1 = 0;                  // core cannot accept a maskable IRQ yet
  const sched = new Scheduler(cpu);
  sched.setIrqEnable(true);

  sched.runFrame();             // IRQ triggers fire -> line held (iff1=0, unserviced)
  assert.strictEqual(sched.irqPending, true, 'IRQ held while iff1=0');

  sched.setIrqEnable(false);    // disabling the port must NOT retract HOLD_LINE
  assert.strictEqual(sched.irqPending, true, 'held IRQ survives irq_enable_w(0)');

  cpu.iff1 = 1;                 // now the core can accept it
  cpu.calls = [];
  sched.runFrame();            // held IRQ delivered; no new triggers (port off)
  const irqCalls = cpu.calls.filter((c) => !c.nm);
  assert.strictEqual(irqCalls.length, 1, 'exactly the held IRQ is delivered');
  assert.strictEqual(irqCalls[0].data, 0xfc, 'with vector 0xFC');
});

// ---------------------------------------------------------------------------
// Determinism: two runs of M frames from reset produce identical CPU state and
// memory -- proving the timer chain, not just the constants. Uses the real Z80
// core with a tiny deterministic program (IM1, EI, tight loop; RETI/RETN
// handlers) so NMI/IRQ actually push/return through the stack.
// ---------------------------------------------------------------------------
function makeMachine() {
  const ram = new Uint8Array(0x10000);
  ram[0x0000] = 0xed; ram[0x0001] = 0x56;                 // IM 1
  ram[0x0002] = 0xfb;                                     // EI
  ram[0x0003] = 0xc3; ram[0x0004] = 0x03; ram[0x0005] = 0x00; // JP 0x0003
  ram[0x0038] = 0xed; ram[0x0039] = 0x4d;                 // RETI (IM1 IRQ)
  ram[0x0066] = 0xed; ram[0x0067] = 0x45;                 // RETN (NMI)
  const cpu = new Z80CPU({
    readByte: (a) => ram[a], writeByte: (a, v) => { ram[a] = v; },
    readPort: () => 0, writePort: () => {},
  });
  cpu.pc = 0x0000;
  cpu.sp = 0xf000;
  return { ram, cpu };
}

function runMachine(frames, irq, nmi) {
  const { ram, cpu } = makeMachine();
  const sched = new Scheduler(cpu);
  if (irq) sched.setIrqEnable(true);
  if (nmi) sched.enableNmi();
  sched.runFrames(frames);
  return { state: cpu.getState(), ram: Array.from(ram), frameCycle: sched.frameCycle };
}

test('determinism: two M-frame runs from reset are bit-identical', () => {
  const a = runMachine(3, true, true);
  const b = runMachine(3, true, true);
  assert.deepStrictEqual(a.state, b.state, 'identical CPU state');
  assert.deepStrictEqual(a.ram, b.ram, 'identical memory');
  assert.strictEqual(a.frameCycle, b.frameCycle, 'identical carry');
});

test('determinism: the timer chain actually affects state (enabled != disabled)', () => {
  const withInts = runMachine(3, true, true);
  const noInts = runMachine(3, false, false);
  // NMIs push the return address; with interrupts off the stack region is untouched.
  assert.notDeepStrictEqual(withInts.ram, noInts.ram);
  assert.notStrictEqual(withInts.state.sp, undefined);
});
