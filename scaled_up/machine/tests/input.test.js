import test from 'node:test';
import assert from 'node:assert';
import { Input, PORTS, COINAGE } from '../src/input.js';

// All expected values are pinned in cdoc/hardware-berzerk.md Section 6, cited
// per case (extracted from berzerk.cpp INPUT_PORTS + BERZERK_COINAGE).

// ---------------------------------------------------------------------------
// Section 6.2/6.3 -- factory default reads (no input pressed, DIPs default).
// ---------------------------------------------------------------------------
test('Section 6.2/6.3: factory default port reads', () => {
  const inp = new Input();
  assert.strictEqual(inp.readPort('P1'), 0xff);
  assert.strictEqual(inp.readPort('SYSTEM'), 0xff);
  assert.strictEqual(inp.readPort('P2'), 0xff);   // Cabinet default Upright (0x80) sets bit 7
  assert.strictEqual(inp.readPort('SW2'), 0x7e);  // active-high services inactive -> 0
  assert.strictEqual(inp.readPort('F2'), 0xfc);   // Bonus Life 0xc0 + unused 0x3c
  assert.strictEqual(inp.readPort('F3'), 0x3c);   // all DIPs 0x00 + unused 0x3c
  assert.strictEqual(inp.readPort('F4'), 0xf0);
  assert.strictEqual(inp.readPort('F5'), 0xf0);
  assert.strictEqual(inp.readPort('F6'), 0xf0);
});

// ---------------------------------------------------------------------------
// Section 6.2 -- every input field flips exactly its documented bit, with the
// documented polarity (active-low clears, active-high sets).
// ---------------------------------------------------------------------------
test('Section 6.2: each input field flips exactly its bit at its polarity', () => {
  for (const [portName, p] of Object.entries(PORTS)) {
    for (const [fieldName, f] of Object.entries(p.fields)) {
      if (f.type !== 'input') continue;
      const inp = new Input();
      const base = inp.readPort(portName);
      inp.setField(portName, fieldName, 1);
      const pressed = inp.readPort(portName);
      assert.strictEqual(base ^ pressed, f.mask,
        `${portName}.${fieldName} flips exactly 0x${f.mask.toString(16)}`);
      if (f.polarity === 'low') {
        assert.strictEqual(base & f.mask, f.mask, `${portName}.${fieldName} idle high`);
        assert.strictEqual(pressed & f.mask, 0, `${portName}.${fieldName} pressed low`);
      } else {
        assert.strictEqual(base & f.mask, 0, `${portName}.${fieldName} idle low`);
        assert.strictEqual(pressed & f.mask, f.mask, `${portName}.${fieldName} pressed high`);
      }
      inp.setField(portName, fieldName, 0);
      assert.strictEqual(inp.readPort(portName), base, `${portName}.${fieldName} releases`);
    }
  }
});

// ---------------------------------------------------------------------------
// Section 6.2 -- SW2 mixed polarity: a per-port "all active-low" assumption is
// wrong. SERVICE1 (bit0) and SERVICE2 (bit7) are active-HIGH; the middle is
// active-low unused. Pressing a service SETS its bit (vs P1 active-low CLEARS).
// ---------------------------------------------------------------------------
test('Section 6.2: SW2 mixed polarity (active-high services over active-low unused)', () => {
  const inp = new Input();
  assert.strictEqual(inp.readPort('SW2'), 0x7e); // both services idle -> 0; unused -> 1

  inp.setField('SW2', 'SERVICE1', 1);
  assert.strictEqual(inp.readPort('SW2'), 0x7f, 'SERVICE1 sets bit 0 (active-high)');
  inp.setField('SW2', 'SERVICE2', 1);
  assert.strictEqual(inp.readPort('SW2'), 0xff, 'SERVICE2 sets bit 7 (active-high)');

  // Contrast: a P1 button is active-low -> pressing CLEARS its bit.
  const p1 = new Input();
  p1.setField('P1', 'BUTTON1', 1);
  assert.strictEqual(p1.readPort('P1'), 0xff & ~0x10);
});

// ---------------------------------------------------------------------------
// Section 6.3 -- DIP defaults and setField (by name and by value).
// ---------------------------------------------------------------------------
test('Section 6.3: DIP factory defaults match the spec', () => {
  const inp = new Input();
  assert.strictEqual(inp.dips.P2.CABINET, 0x80, 'Cabinet=Upright');
  assert.strictEqual(inp.dips.F2.COLOR_TEST, 0x00);
  assert.strictEqual(inp.dips.F2.BONUS_LIFE, 0xc0, '5000 and 10000');
  assert.strictEqual(inp.dips.F3.INPUT_TEST_MODE, 0x00);
  assert.strictEqual(inp.dips.F3.CROSSHAIR_PATTERN, 0x00);
  assert.strictEqual(inp.dips.F3.LANGUAGE, 0x00, 'English (base set)');
  assert.strictEqual(inp.dips.F4.COINAGE, 0x00, '1C/1C');
});

test('Section 6.3: DIPs settable by name and by masked value; Cabinet to Cocktail', () => {
  const inp = new Input();
  inp.setField('P2', 'CABINET', 'Cocktail');
  assert.strictEqual(inp.readPort('P2') & 0x80, 0x00, 'Cocktail clears bit 7');
  inp.setField('F3', 'LANGUAGE', 'German');
  assert.strictEqual(inp.readPort('F3') & 0xc0, 0x40);
  inp.setField('F2', 'BONUS_LIFE', 0x00); // None, by value
  assert.strictEqual(inp.readPort('F2') & 0xc0, 0x00);
});

test('constructor DIP overrides apply (validated)', () => {
  const inp = new Input({ F4: { COINAGE: '2C/1C' }, P2: { CABINET: 'Cocktail' } });
  assert.strictEqual(inp.readPort('F4') & 0x0f, 0x09);
  assert.strictEqual(inp.readPort('P2') & 0x80, 0x00);
});

// ---------------------------------------------------------------------------
// Section 6.4 -- every coinage nibble 0x00-0x0f maps to a defined setting.
// ---------------------------------------------------------------------------
test('Section 6.4: coinage table covers all 16 nibble values with no gaps', () => {
  const values = Object.values(COINAGE).sort((a, b) => a - b);
  assert.deepStrictEqual(values, Array.from({ length: 16 }, (_, i) => i));
  assert.strictEqual(new Set(values).size, 16, 'no duplicate codes');
});

// ---------------------------------------------------------------------------
// Section 6.1 -- 0x18 mirror on the 0x60-0x67 DIP block; direct addresses.
// ---------------------------------------------------------------------------
test('Section 6.1: readAddress maps ports and honors the 0x18 DIP mirror', () => {
  const inp = new Input();
  assert.strictEqual(inp.readAddress(0x48), inp.readPort('P1'));
  assert.strictEqual(inp.readAddress(0x49), inp.readPort('SYSTEM'));
  assert.strictEqual(inp.readAddress(0x4a), inp.readPort('P2'));
  // F3 at 0x60 and its three mirror images.
  for (const a of [0x60, 0x68, 0x70, 0x78]) {
    assert.strictEqual(inp.readAddress(a), inp.readPort('F3'), `mirror 0x${a.toString(16)}`);
  }
  assert.strictEqual(inp.readAddress(0x6d), inp.readPort('SW2')); // 0x65 mirror at +0x08
});

// ---------------------------------------------------------------------------
// Typo guard -- unknown port/field/setting throw (load-bearing for T3.1/T3.2).
// ---------------------------------------------------------------------------
test('typo guard: unknown port/field/setting and out-of-mask values throw', () => {
  const inp = new Input();
  assert.throws(() => inp.setField('NOPE', 'LEFT', 1), /Unknown input port/);
  assert.throws(() => inp.setField('P1', 'JUMP', 1), /Unknown field/);
  assert.throws(() => inp.setField('P1', '_UNUSED', 1), /Unknown field/); // unused not addressable
  assert.throws(() => inp.readPort('NOPE'), /Unknown input port/);
  assert.throws(() => inp.readAddress(0x00), /No input port/);
  assert.throws(() => inp.setField('F3', 'LANGUAGE', 'Klingon'), /Unknown setting/);
  assert.throws(() => inp.setField('F4', 'COINAGE', 0x10), /exceeds mask/); // 0x10 outside 0x0f
});
