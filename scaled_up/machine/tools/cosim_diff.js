// cosim_diff.js -- drift detector comparing JS vs MAME register snapshots at 0x26D9.
//
// Inputs are the JSONL files from cosim_capture_js.js and sync_capture.lua, each
// capturing full Z80 register state at every entry to PC=0x26D9 (the once-per-
// frame BOTTOM_OF_SCREEN IRQ handler). 0x26D9 is also reachable via `jr c,$26d9`
// during POST (isolated stray hits), so we align on the steady once-per-frame run.
//
// IMPORTANT (see cdoc/decisions.md 2026-06-16): the IRQ fires at a fixed scanline,
// so register-at-IRQ samples a free-running foreground at a timing-dependent
// position. The two cores are NOT cycle-locked, so divergence here is dominated
// by cycle-timing phase drift, not architectural bugs. This tool is therefore a
// DRIFT DETECTOR, not an equivalence gate: it fails only when drift REGRESSES
// against a saved baseline. Correctness is gated by the VRAM-hash golden gate (T3.4).
//
// Usage:
//   node tools/cosim_diff.js [js.jsonl] [mame.jsonl]                 # report, exit 0
//   node tools/cosim_diff.js [js] [mame] --write-baseline <file>     # save metrics
//   node tools/cosim_diff.js [js] [mame] --baseline <file>           # fail on regression

import fs from 'node:fs';

const FIELDS = ['af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp', 'af_', 'bc_', 'de_', 'hl_', 'i', 'r'];
const NOISY = new Set(['r']); // R increments per opcode fetch; tolerated per decisions.md
const XY_MASK = 0x28;          // F5|F3 undocumented flag bits, also tolerated

function load(p) {
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Trim to the steady once-per-frame run (skips the isolated POST `jr` hit).
function steady(recs) {
  for (let i = 0; i < recs.length - 1; i++) {
    if (recs[i + 1].frame - recs[i].frame === 1) return recs.slice(i);
  }
  return recs;
}

function isRealDiff(field, a, b) {
  if (a === b) return false;
  if (NOISY.has(field)) return false;
  if ((field === 'af' || field === 'af_') && ((a ^ b) & ~XY_MASK) === 0) return false; // X/Y bits only
  return true;
}

function metrics(js, mame) {
  const n = Math.min(js.length, mame.length);
  let firstReal = -1, realCount = 0, phaseMatch = 0;
  for (let i = 0; i < n; i++) {
    if (js[i].ret !== undefined && js[i].ret === mame[i].ret) phaseMatch++;
    const real = FIELDS.some((f) => isRealDiff(f, js[i][f], mame[i][f]));
    if (real) { realCount++; if (firstReal === -1) firstReal = i; }
  }
  return { comparedHits: n, firstRealDivergence: firstReal, realDivergeHits: realCount, phaseMatch };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const jsPath = positional[0] || '/tmp/cosim_js.jsonl';
  const mamePath = positional[1] || '/tmp/cosim_mame.jsonl';
  const writeBaseline = flag('--write-baseline');
  const baselinePath = flag('--baseline');

  const js = steady(load(jsPath));
  const mame = steady(load(mamePath));
  const m = metrics(js, mame);

  console.log('=== 0x26D9 drift report ===');
  console.log(`JS steady hits:   ${js.length} (first frame ${js[0].frame})`);
  console.log(`MAME steady hits: ${mame.length} (first frame ${mame[0].frame})`);
  console.log(`compared hits:              ${m.comparedHits}`);
  console.log(`first real divergence hit:  ${m.firstRealDivergence}`);
  console.log(`hits with real divergence:  ${m.realDivergeHits}`);
  console.log(`foreground phase matches:   ${m.phaseMatch} / ${m.comparedHits}`);

  if (writeBaseline) {
    fs.writeFileSync(writeBaseline, JSON.stringify(m, null, 2) + '\n');
    console.log(`\nwrote baseline -> ${writeBaseline}`);
    process.exit(0);
  }

  if (baselinePath) {
    const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const regressions = [];
    if (m.phaseMatch < base.phaseMatch) regressions.push(`phaseMatch ${m.phaseMatch} < baseline ${base.phaseMatch}`);
    if (m.realDivergeHits > base.realDivergeHits) regressions.push(`realDivergeHits ${m.realDivergeHits} > baseline ${base.realDivergeHits}`);
    if (base.firstRealDivergence >= 0 && m.firstRealDivergence >= 0 && m.firstRealDivergence < base.firstRealDivergence) {
      regressions.push(`firstRealDivergence ${m.firstRealDivergence} earlier than baseline ${base.firstRealDivergence}`);
    }
    if (regressions.length) {
      console.log('\nDRIFT REGRESSION vs baseline:');
      for (const r of regressions) console.log(`  ${r}`);
      process.exit(1);
    }
    console.log('\nno drift regression vs baseline.');
    process.exit(0);
  }

  console.log('\n(no baseline given -- report only. Use --write-baseline to pin, --baseline to gate.)');
  process.exit(0);
}

main();
