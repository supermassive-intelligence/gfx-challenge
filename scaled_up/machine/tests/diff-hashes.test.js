import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Helpers: write a temp file, return its path.
function tmp(name, content) {
  const p = join(tmpdir(), name);
  writeFileSync(p, content);
  return p;
}

function cleanup(...paths) {
  for (const p of paths) { try { unlinkSync(p); } catch {} }
}

const TOOL = new URL('../tools/diff_hashes.js', import.meta.url).pathname;

// A minimal valid script with no input records (attract-only style).
const EMPTY_SCRIPT = JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 3 }) + '\n';

// ---------------------------------------------------------------------------
// Identical files → exit 0
// ---------------------------------------------------------------------------
test('diff_hashes: identical files exits 0', () => {
  const content = '0,0xaabbccdd\n1,0x11223344\n2,0xdeadbeef\n';
  const a = tmp('a_identical.hashes', content);
  const b = tmp('b_identical.hashes', content);
  const s = tmp('empty.jsonl', EMPTY_SCRIPT);
  try {
    execFileSync('node', [TOOL, a, b, s]);
  } finally {
    cleanup(a, b, s);
  }
  // reaching here without throwing = exit 0
});

// ---------------------------------------------------------------------------
// Divergent files → exit 1 with first-diff frame in stderr
// ---------------------------------------------------------------------------
test('diff_hashes: divergent files exits 1 and reports first diff frame', () => {
  const a = tmp('a_div.hashes', '0,0xaabbccdd\n1,0x11111111\n2,0xdeadbeef\n');
  const b = tmp('b_div.hashes', '0,0xaabbccdd\n1,0x22222222\n2,0xdeadbeef\n');
  const s = tmp('empty2.jsonl', EMPTY_SCRIPT);
  try {
    let threw = false;
    try {
      execFileSync('node', [TOOL, a, b, s], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.status, 1);
      const stderr = e.stderr.toString();
      assert.match(stderr, /First diff at frame: 1/);
      assert.match(stderr, /Total divergent frames: 1\/3/);
    }
    assert.ok(threw, 'expected process to exit 1');
  } finally {
    cleanup(a, b, s);
  }
});

// ---------------------------------------------------------------------------
// Frame count mismatch → exit 1
// ---------------------------------------------------------------------------
test('diff_hashes: frame count mismatch exits 1', () => {
  const a = tmp('a_cnt.hashes', '0,0xaabbccdd\n1,0x11223344\n');
  const b = tmp('b_cnt.hashes', '0,0xaabbccdd\n');
  const s = tmp('empty3.jsonl', EMPTY_SCRIPT);
  try {
    let threw = false;
    try {
      execFileSync('node', [TOOL, a, b, s], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.status, 1);
    }
    assert.ok(threw, 'expected process to exit 1 on frame count mismatch');
  } finally {
    cleanup(a, b, s);
  }
});

// ---------------------------------------------------------------------------
// Nearest preceding input event reported correctly
// ---------------------------------------------------------------------------
test('diff_hashes: reports nearest preceding input event', () => {
  const a = tmp('a_inp.hashes', '0,0xaa\n1,0xbb\n2,0xcc\n3,0xdd\n');
  const b = tmp('b_inp.hashes', '0,0xaa\n1,0xbb\n2,0xcc\n3,0xee\n'); // diff at frame 3
  const script = [
    JSON.stringify({ type: 'header', game: 'berzerk', version: 1, dips: {}, frames: 4 }),
    JSON.stringify({ type: 'input', frame: 2, port: 'SYSTEM', field: 'COIN1', value: 1 }),
  ].join('\n') + '\n';
  const s = tmp('inp.jsonl', script);
  try {
    let threw = false;
    try {
      execFileSync('node', [TOOL, a, b, s], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      threw = true;
      const stderr = e.stderr.toString();
      assert.match(stderr, /First diff at frame: 3/);
      assert.match(stderr, /COIN1/);
    }
    assert.ok(threw);
  } finally {
    cleanup(a, b, s);
  }
});
