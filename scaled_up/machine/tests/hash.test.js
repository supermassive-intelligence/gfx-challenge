import test from 'node:test';
import assert from 'node:assert';
import { fnv1a32 } from '../src/hash.js';

// Cross-platform test vectors: these same values are verified in the MAME Lua
// harness (replay.lua) to confirm the two sides produce identical hashes.
// Recorded in cdoc/decisions.md (T3.2/T3.3).

test('fnv1a32: empty input produces FNV offset basis', () => {
  assert.strictEqual(fnv1a32(new Uint8Array(0)), 0x811c9dc5);
});

test('fnv1a32: single byte 0x61 ("a")', () => {
  // FNV-1a 32-bit of ASCII "a" = 0xe40c292c (standard test vector)
  assert.strictEqual(fnv1a32(new Uint8Array([0x61])), 0xe40c292c);
});

test('fnv1a32: known vector "hello"', () => {
  // FNV-1a 32-bit of ASCII "hello" = 0x4f9f2cab (verified from our implementation)
  const data = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  assert.strictEqual(fnv1a32(data), 0x4f9f2cab);
});

test('fnv1a32: all-zero 10240-byte buffer produces a consistent result', () => {
  // Mirrors the VRAM+colorRAM buffer size used in replay_hash.js and replay.lua.
  const buf = new Uint8Array(10240);
  const h1 = fnv1a32(buf);
  const h2 = fnv1a32(buf);
  assert.strictEqual(h1, h2);
  assert.ok(h1 >>> 0 === h1, 'result must be unsigned 32-bit');
});

test('fnv1a32: different inputs produce different hashes', () => {
  const a = new Uint8Array(10240);
  const b = new Uint8Array(10240);
  b[0] = 0x01;
  assert.notStrictEqual(fnv1a32(a), fnv1a32(b));
});
