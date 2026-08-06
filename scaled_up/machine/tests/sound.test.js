import test from 'node:test';
import assert from 'node:assert';
import { Sound, RecordingBackend, SilentBackend } from '../src/sound.js';

// Behavior pinned in cdoc/hardware-berzerk.md Section 7 (S14001A 0x44 protocol;
// other audio ports -> 6840; 0x46 -> sfxctrl). Tests run the recording backend,
// so no sample audio files are needed (DoD).

function rec() {
  const b = new RecordingBackend();
  return { snd: new Sound(b), ev: b.events };
}

// ---------------------------------------------------------------------------
// Section 7 -- S14001A speech word load (0x44, data>>6 == 0).
// ---------------------------------------------------------------------------
test('Section 7: writing 0x44 with mode 0 plays the 6-bit word address', () => {
  const { snd, ev } = rec();
  snd.writePort(0x44, 0x12);          // mode 0, address 0x12 (INTRUDER per vocab)
  snd.writePort(0x44, 0x3f);          // address 0x3f (max)
  snd.writePort(0x44, 0x00);          // address 0x00
  assert.deepStrictEqual(ev, [
    { kind: 'speech', op: 'play', address: 0x12 },
    { kind: 'speech', op: 'play', address: 0x3f },
    { kind: 'speech', op: 'play', address: 0x00 },
  ]);
});

// ---------------------------------------------------------------------------
// Section 7 -- S14001A control write (0x44, data>>6 == 1): volume (data>>3&7),
// clock divisor 16-(data&7).
// ---------------------------------------------------------------------------
test('Section 7: 0x44 mode 1 sets volume and clock divisor per the formulas', () => {
  const { snd, ev } = rec();
  snd.writePort(0x44, 0b01_111_010);  // 0x7a: volume=7, divisor=16-2=14
  assert.deepStrictEqual(ev[0], { kind: 'speech', op: 'control', volume: 7, clockDivisor: 14 });
  assert.strictEqual(snd.volume, 7);
  assert.strictEqual(snd.clockDivisor, 14);

  snd.writePort(0x44, 0b01_000_111);  // 0x47: volume=0, divisor=16-7=9
  assert.deepStrictEqual(ev[1], { kind: 'speech', op: 'control', volume: 0, clockDivisor: 9 });
});

test('Section 7: 0x44 modes 2 and 3 are unused (no event)', () => {
  const { snd, ev } = rec();
  snd.writePort(0x44, 0x80); // mode 2
  snd.writePort(0x44, 0xc0); // mode 3
  assert.strictEqual(ev.length, 0);
});

// ---------------------------------------------------------------------------
// Section 7 -- 0x46 is sfxctrl; the other audio ports are 6840 SFX writes.
// ---------------------------------------------------------------------------
test('Section 7: 0x46 emits sfxctrl; 0x40-0x43/0x45/0x47 emit raw sfx writes', () => {
  const { snd, ev } = rec();
  snd.writePort(0x46, 0x80);
  assert.deepStrictEqual(ev[0], { kind: 'sfxctrl', port: 0x46, data: 0x80 });

  ev.length = 0;
  for (const p of [0x40, 0x41, 0x42, 0x43, 0x45, 0x47]) snd.writePort(p, 0xa5);
  assert.deepStrictEqual(ev, [0x40, 0x41, 0x42, 0x43, 0x45, 0x47].map(
    (port) => ({ kind: 'sfx', port, data: 0xa5 })));
});

test('writes outside 0x40-0x47 are ignored', () => {
  const { snd, ev } = rec();
  snd.writePort(0x3f, 0xff);
  snd.writePort(0x48, 0xff);
  assert.strictEqual(ev.length, 0);
});

// ---------------------------------------------------------------------------
// A documented sequence -> the expected event order.
// ---------------------------------------------------------------------------
test('Section 7: a control-then-speak-then-sfx sequence yields ordered events', () => {
  const { snd, ev } = rec();
  snd.writePort(0x44, 0x7a);  // set volume/clock
  snd.writePort(0x44, 0x08);  // speak word 0x08 (ALERT)
  snd.writePort(0x42, 0x10);  // an SFX register write
  assert.deepStrictEqual(ev.map((e) => e.kind + ':' + (e.op || e.port)), [
    'speech:control', 'speech:play', 'sfx:66',
  ]);
});

// ---------------------------------------------------------------------------
// Status read -- Section 7 does not pin it; sample playback reports READY.
// (Timing approximation noted in cdoc/decisions.md.)
// ---------------------------------------------------------------------------
test('S14001A status read reports ready (bit 6 set)', () => {
  const { snd } = rec();
  assert.strictEqual(snd.readStatus(), 0x40);
});

// ---------------------------------------------------------------------------
// Backend is pluggable; the default silent backend needs no files and records
// nothing observable.
// ---------------------------------------------------------------------------
test('default SilentBackend requires no audio files and is inert', () => {
  const snd = new Sound(); // SilentBackend
  assert.doesNotThrow(() => {
    snd.writePort(0x44, 0x12);
    snd.writePort(0x40, 0x01);
  });
  assert.ok(snd.backend instanceof SilentBackend);
});
