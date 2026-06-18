import test from 'node:test';
import assert from 'node:assert';
import { Input } from '../src/input.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';

// All schema references: cdoc/schemas/input-script.md (FROZEN, T3.1).

// ---------------------------------------------------------------------------
// parseScript -- header validation
// ---------------------------------------------------------------------------
test('parseScript: rejects empty input', () => {
  assert.throws(() => parseScript(''), /Empty input script/);
});

test('parseScript: rejects missing header', () => {
  const jsonl = JSON.stringify({ type: 'input', frame: 0, port: 'P1', field: 'UP', value: 1 });
  assert.throws(() => parseScript(jsonl), /First record must be type:"header"/);
});

test('parseScript: rejects wrong game', () => {
  const jsonl = JSON.stringify({ type: 'header', game: 'defender', version: 1, frames: 10 });
  assert.throws(() => parseScript(jsonl), /Unsupported game/);
});

test('parseScript: rejects wrong version', () => {
  const jsonl = JSON.stringify({ type: 'header', game: 'berzerk', version: 2, frames: 10 });
  assert.throws(() => parseScript(jsonl), /Unsupported version/);
});

test('parseScript: parses valid script into header + records', () => {
  const lines = [
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 60 }),
    JSON.stringify({ type: 'input', frame: 10, port: 'P1', field: 'UP', value: 1 }),
    JSON.stringify({ type: 'input', frame: 20, port: 'P1', field: 'UP', value: 0 }),
  ];
  const { header, records } = parseScript(lines.join('\n'));
  assert.strictEqual(header.frames, 60);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].frame, 10);
  assert.strictEqual(records[1].frame, 20);
});

test('parseScript: ignores blank lines', () => {
  const lines = [
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 5 }),
    '',
    JSON.stringify({ type: 'input', frame: 1, port: 'SYSTEM', field: 'COIN1', value: 1 }),
    '   ',
  ];
  const { records } = parseScript(lines.join('\n'));
  assert.strictEqual(records.length, 1);
});

// ---------------------------------------------------------------------------
// ScriptPlayer construction -- field validation
// ---------------------------------------------------------------------------
test('ScriptPlayer: throws on unknown port in records', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 10 }),
    JSON.stringify({ type: 'input', frame: 1, port: 'BADPORT', field: 'UP', value: 1 }),
  ].join('\n'));
  assert.throws(() => new ScriptPlayer(new Input(), header, records), /unknown port/);
});

test('ScriptPlayer: throws on unknown field in records', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 10 }),
    JSON.stringify({ type: 'input', frame: 1, port: 'P1', field: 'BADFIELD', value: 1 }),
  ].join('\n'));
  assert.throws(() => new ScriptPlayer(new Input(), header, records), /unknown field/);
});

test('ScriptPlayer: throws on unused field in records', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 10 }),
    JSON.stringify({ type: 'input', frame: 1, port: 'P1', field: '_UNUSED', value: 1 }),
  ].join('\n'));
  assert.throws(() => new ScriptPlayer(new Input(), header, records), /unknown field/);
});

test('ScriptPlayer: throws on malformed dip key in header', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: { 'F3_LANGUAGE': 'English' }, frames: 10 }),
  ].join('\n'));
  assert.throws(() => new ScriptPlayer(new Input(), header, records), /bad dip key/);
});

test('ScriptPlayer: throws on unknown dip port in header', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: { 'BADPORT.LANGUAGE': 'English' }, frames: 10 }),
  ].join('\n'));
  assert.throws(() => new ScriptPlayer(new Input(), header, records), /unknown port/);
});

// ---------------------------------------------------------------------------
// DIP override from header applied before frame 0
// ---------------------------------------------------------------------------
test('ScriptPlayer: header dip overrides are applied at construction', () => {
  const inp = new Input();
  // Default language is English (0x00 on F3); override to German (0x40).
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: { 'F3.LANGUAGE': 'German' }, frames: 0 }),
  ].join('\n'));
  new ScriptPlayer(inp, header, records);
  // F3 port: LANGUAGE German = 0x40; other F3 bits: INPUT_TEST_MODE=0, CROSSHAIR=0 -> 0x00; unused 0x3c
  assert.strictEqual(inp.readPort('F3'), 0x40 | 0x3c);
});

// ---------------------------------------------------------------------------
// applyFrame -- correct frame delivery
// ---------------------------------------------------------------------------
test('ScriptPlayer: applyFrame delivers records at the right frame', () => {
  const inp = new Input();
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 60 }),
    JSON.stringify({ type: 'input', frame: 5, port: 'P1', field: 'UP', value: 1 }),
    JSON.stringify({ type: 'input', frame: 5, port: 'P1', field: 'BUTTON1', value: 1 }),
    JSON.stringify({ type: 'input', frame: 10, port: 'P1', field: 'UP', value: 0 }),
  ].join('\n'));
  const player = new ScriptPlayer(inp, header, records);

  // Before frame 5: P1 reads factory default (all released, active-low -> 0xff)
  player.applyFrame(0);
  assert.strictEqual(inp.readPort('P1'), 0xff);
  player.applyFrame(4);
  assert.strictEqual(inp.readPort('P1'), 0xff);

  // Frame 5: UP (mask 0x04) and BUTTON1 (mask 0x10) go low.
  player.applyFrame(5);
  assert.strictEqual(inp.readPort('P1') & 0x14, 0x00);

  // Frame 6-9: still held.
  player.applyFrame(7);
  assert.strictEqual(inp.readPort('P1') & 0x04, 0x00);

  // Frame 10: UP released.
  player.applyFrame(10);
  assert.strictEqual(inp.readPort('P1') & 0x04, 0x04); // UP back high (released, active-low idle)
  assert.strictEqual(inp.readPort('P1') & 0x10, 0x00); // BUTTON1 still held
});

test('ScriptPlayer: done() is false while records remain, true when exhausted', () => {
  const inp = new Input();
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 10 }),
    JSON.stringify({ type: 'input', frame: 3, port: 'SYSTEM', field: 'COIN1', value: 1 }),
  ].join('\n'));
  const player = new ScriptPlayer(inp, header, records);
  assert.strictEqual(player.done(), false);
  player.applyFrame(3);
  assert.strictEqual(player.done(), true);
});

test('ScriptPlayer: totalFrames matches header', () => {
  const { header, records } = parseScript([
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 120 }),
  ].join('\n'));
  const player = new ScriptPlayer(new Input(), header, records);
  assert.strictEqual(player.totalFrames, 120);
});

// ---------------------------------------------------------------------------
// Determinism: replaying the same script twice from reset gives identical output.
// Uses the scheduler's frameCount as the frame index, matching the intended API.
// ---------------------------------------------------------------------------
test('Determinism: same script replayed twice produces identical Input state', () => {
  const script = [
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: { 'F3.LANGUAGE': 'German' }, frames: 20 }),
    JSON.stringify({ type: 'input', frame: 2,  port: 'P1',     field: 'LEFT',   value: 1 }),
    JSON.stringify({ type: 'input', frame: 5,  port: 'SYSTEM', field: 'COIN1',  value: 1 }),
    JSON.stringify({ type: 'input', frame: 6,  port: 'SYSTEM', field: 'COIN1',  value: 0 }),
    JSON.stringify({ type: 'input', frame: 10, port: 'SYSTEM', field: 'START1', value: 1 }),
    JSON.stringify({ type: 'input', frame: 11, port: 'SYSTEM', field: 'START1', value: 0 }),
  ].join('\n');

  function runReplay(scriptText) {
    const inp = new Input();
    const { header, records } = parseScript(scriptText);
    const player = new ScriptPlayer(inp, header, records);
    const snapshots = [];
    for (let f = 0; f <= 20; f++) {
      player.applyFrame(f);
      snapshots.push({
        f,
        P1: inp.readPort('P1'),
        SYSTEM: inp.readPort('SYSTEM'),
        F3: inp.readPort('F3'),
      });
    }
    return snapshots;
  }

  const run1 = runReplay(script);
  const run2 = runReplay(script);
  assert.deepStrictEqual(run1, run2);
});
