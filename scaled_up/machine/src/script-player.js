/**
 * Deterministic input-script player for the Berzerk machine.
 *
 * Consumes a JSONL input script (schema: cdoc/schemas/input-script.md, FROZEN)
 * and applies input changes to the machine's Input instance at the correct
 * VBlank boundary. Validated against T2.7's known-field registry so a typo in
 * a script file throws at construction, not silently during replay.
 *
 * Usage: construct with the parsed header + records, pass applyFrame as the
 * vblankCallback to Scheduler.runFrame(). The player mutates the Input object;
 * it does not own it.
 */

import { PORTS } from './input.js';

/**
 * Parse a JSONL string into { header, records }.
 * Throws if the header is missing or malformed.
 */
export function parseScript(jsonl) {
  const lines = jsonl.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('Empty input script');
  const header = JSON.parse(lines[0]);
  if (header.type !== 'header') throw new Error('First record must be type:"header"');
  if (header.game !== 'berzerk') throw new Error(`Unsupported game: ${header.game}`);
  if (header.version !== 1) throw new Error(`Unsupported version: ${header.version}`);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const r = JSON.parse(lines[i]);
    if (r.type !== 'input') throw new Error(`Unknown record type: ${r.type}`);
    records.push(r);
  }
  return { header, records };
}

/**
 * Validate that a port/field pair names a real, non-unused field.
 * Used at construction to catch typos before replay begins.
 */
function validateField(port, field) {
  const p = PORTS[port];
  if (!p) throw new Error(`ScriptPlayer: unknown port "${port}"`);
  const f = p.fields[field];
  if (!f || f.type === 'unused') {
    throw new Error(`ScriptPlayer: unknown field "${field}" on port "${port}"`);
  }
}

export class ScriptPlayer {
  /**
   * input: an Input instance (owned by the machine, mutated here).
   * header: parsed header record from parseScript().
   * records: parsed input records from parseScript().
   */
  constructor(input, header, records) {
    this._input = input;
    this._totalFrames = header.frames ?? Infinity;
    this._records = records;
    this._cursor = 0; // index into records; advances monotonically

    // Validate all port/field names up front.
    for (const r of records) validateField(r.port, r.field);

    // Apply DIP overrides from header before any frames run.
    const dips = header.dips ?? {};
    for (const [key, val] of Object.entries(dips)) {
      const [port, field] = key.split('.');
      if (!port || !field) {
        throw new Error(`ScriptPlayer: bad dip key "${key}" (expected "Port.Field")`);
      }
      validateField(port, field);
      input.setField(port, field, val);
    }
  }

  /**
   * Apply all input records whose frame == frameIndex.
   * Call this as the VBlank callback: scheduler.runFrame(sched => player.applyFrame(sched.frameCount)).
   */
  applyFrame(frameIndex) {
    while (this._cursor < this._records.length) {
      const r = this._records[this._cursor];
      if (r.frame !== frameIndex) break;
      this._input.setField(r.port, r.field, r.value);
      this._cursor++;
    }
  }

  /** True once all records have been delivered. */
  done() {
    return this._cursor >= this._records.length;
  }

  /** Frame count declared in the header (Infinity if absent). */
  get totalFrames() { return this._totalFrames; }
}
