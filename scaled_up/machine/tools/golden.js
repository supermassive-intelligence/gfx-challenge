/**
 * golden.js – run all scenario scripts through the JS machine and compare
 * against committed MAME golden hash files.
 *
 * Usage:
 *   node tools/golden.js [--update]
 *
 * Without --update: replays every scenario, diffs against fixtures/goldens/,
 * prints a summary table, exits 1 if any scenario diverges.
 *
 * With --update: (re)generates the JS hash files only -- you still need to
 * run MAME manually to regenerate the golden files.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const SCRIPTS_DIR = join(ROOT, '..', 'traces', 'scripts');
const GOLDENS_DIR = join(ROOT, 'fixtures', 'goldens');

const UPDATE = process.argv.includes('--update');

// Discover all scenario scripts
const scripts = readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.jsonl'));
if (scripts.length === 0) {
  console.error(`❌ No scripts found in ${SCRIPTS_DIR}`);
  process.exit(1);
}

const results = [];

for (const scriptFile of scripts) {
  const name = basename(scriptFile, '.jsonl');
  const scriptPath = join(SCRIPTS_DIR, scriptFile);
  const goldenPath = join(GOLDENS_DIR, `${name}.hashes`);
  const jsHashPath = join(tmpdir(), `golden-js-${name}.hashes`);

  process.stdout.write(`  ${name.padEnd(30)}`);

  // 1. Generate JS hashes
  const replay = spawnSync('node', [
    join(__dir, 'replay_hash.js'),
    scriptPath,
    jsHashPath,
  ], { encoding: 'utf8' });

  if (replay.status !== 0) {
    process.stdout.write(`❌ JS replay failed\n`);
    results.push({ name, status: 'ERROR', detail: replay.stderr });
    continue;
  }

  // 2. If --update, just report that hashes were generated
  if (UPDATE) {
    process.stdout.write(`✅ generated (${jsHashPath})\n`);
    results.push({ name, status: 'UPDATED' });
    continue;
  }

  // 3. Check golden exists
  if (!existsSync(goldenPath)) {
    process.stdout.write(`⚠️  no golden (run MAME to generate)\n`);
    results.push({ name, status: 'NO_GOLDEN' });
    continue;
  }

  // 4. Diff JS hashes against golden
  const diff = spawnSync('node', [
    join(__dir, 'diff_hashes.js'),
    jsHashPath,
    goldenPath,
    scriptPath,
  ], { encoding: 'utf8' });

  if (diff.status === 0) {
    process.stdout.write(`✅ PASS\n`);
    results.push({ name, status: 'PASS' });
  } else {
    // Extract first diff frame from stderr
    const match = diff.stderr.match(/First diff at frame: (\d+)/);
    const total = diff.stderr.match(/Total divergent frames: (\d+)\/(\d+)/);
    const detail = match
      ? `first diff @ frame ${match[1]}, ${total ? total[1] + '/' + total[2] + ' frames' : ''}`
      : diff.stderr.trim();
    process.stdout.write(`❌ FAIL – ${detail}\n`);
    results.push({ name, status: 'FAIL', detail });
  }
}

// Summary
console.log('');
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const missing = results.filter(r => r.status === 'NO_GOLDEN').length;
const errors  = results.filter(r => r.status === 'ERROR').length;

console.log(`Results: ${passed} pass, ${failed} fail, ${missing} no-golden, ${errors} error`);

if (failed > 0 || errors > 0) process.exit(1);
if (missing > 0) process.exit(2);  // goldens not yet generated -- not a test failure
process.exit(0);
