import fs from 'node:fs';
import path from 'node:path';

/**
 * diff_hashes.js – compares two frame-hash files and reports divergence.
 * Usage: node diff_hashes.js <hashes_a> <hashes_b> <input_script>
 */

function main() {
  const [,, fileA, fileB, scriptPath] = process.argv;
  if (!fileA || !fileB || !scriptPath) {
    console.error("Usage: node diff_hashes.js <hashes_a> <hashes_b> <input_script>");
    process.exit(1);
  }

  const a = fs.readFileSync(fileA, 'utf8').trim().split('\n');
  const b = fs.readFileSync(fileB, 'utf8').trim().split('\n');

  if (a.length !== b.length) {
    console.error(`❌ Frame count mismatch: ${fileA} has ${a.length} frames, ${fileB} has ${b.length}.`);
    process.exit(1);
  }

  let firstDiff = -1;
  let diffCount = 0;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (firstDiff === -1) firstDiff = i;
      diffCount++;
    }
  }

  if (diffCount === 0) {
    console.log("✅ Hash files are identical! Bit-perfect match.");
    process.exit(0);
  }

  // Find the nearest preceding input event for debugging
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const lines = scriptContent.split('\n').filter(l => l.trim());
  let lastEvent = "None (Cold Boot)";
  for (const line of lines) {
    if (line.includes('"type":"input"')) {
      const match = line.match(/"frame":\s*(\d+)/);
      if (match && parseInt(match[1]) <= firstDiff) {
        lastEvent = line;
      }
    }
  }

  console.error(`❌ Divergence detected!`);
  console.error(`First diff at frame: ${firstDiff}`);
  console.error(`Total divergent frames: ${diffCount}/${a.length}`);
  console.error(`Nearest preceding input event: ${lastEvent}`);
  process.exit(1);
}

main();
