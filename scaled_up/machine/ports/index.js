// Registry of ported JS routines, keyed by entry_pc (matches test-plan `entry_pc`).
// Phase 9 grows this bottom-up; the bench (tools/bench.js) runs each port against
// its test-plan cases. Routines without an entry here are reported as "skipped".
import { RANDOM } from './random.js';

export const PORTS = new Map([
  ['0x2678', RANDOM],
]);
