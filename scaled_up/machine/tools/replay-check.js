#!/usr/bin/env node
/**
 * Validates an input-script JSONL file against the frozen schema (T3.1):
 *   1. Parses the JSONL via parseScript().
 *   2. Constructs a ScriptPlayer with a fresh Input -- this validates every
 *      port/field name and DIP key at construction.
 *   3. Exits 0 on success, 1 with an error message on failure.
 *
 * Usage:
 *   node tools/replay-check.js <path/to/script.jsonl>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseScript, ScriptPlayer } from '../src/script-player.js';
import { Input } from '../src/input.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const [,, scriptPath] = process.argv;
if (!scriptPath) {
  console.error('Usage: node replay-check.js <path/to/script.jsonl>');
  process.exit(1);
}

const fullPath = resolve(__dir, '..', scriptPath.startsWith('/') ? scriptPath : scriptPath);
let jsonl;
try {
  jsonl = readFileSync(fullPath, 'utf8');
} catch (e) {
  console.error(`Cannot read file: ${fullPath}\n${e.message}`);
  process.exit(1);
}

try {
  const { header, records } = parseScript(jsonl);
  const player = new ScriptPlayer(new Input(), header, records);
  console.log(`OK: ${records.length} input records, ${player.totalFrames} declared frames, all field names valid.`);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
}
