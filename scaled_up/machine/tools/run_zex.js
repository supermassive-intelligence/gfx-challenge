import fs from 'node:fs';
import path from 'node:path';
import { Z80CPU } from '../src/cpu/z80.js';

/**
 * Minimal CP/M-80 shim to run the Z80 exercisers (zexdoc, zexall) as the
 * coarse-grained integration gate. zex gives only end-of-group CRCs; the
 * fine-grained per-opcode gate is tools/run_sst.js.
 *
 * The .com binary is loaded at 0x0100 and entered there. It reaches the BDOS by
 * CALL 0x0005, with the function number in C; it exits by jumping to 0x0000
 * (CP/M warm boot). Rather than test pc on every instruction (which would force
 * a full getState() per step and dominate runtime), we set up the CP/M zero
 * page with trap stubs and let the CPU run uninterrupted:
 *
 *   0x0000: OUT (0xFF),A ; HALT   -> warm boot trap (sets `done`)
 *   0x0005: OUT (0x00),A ; RET    -> BDOS trap (emulate function, then return)
 *
 * The OUT instructions fire the writePort callback, where we read C/D/E via
 * getState() -- only on BDOS calls, so negligible. This is exactly how a real
 * CP/M zero page is laid out (a JP/vector at 0x0005), so the exercisers behave
 * identically while the hot path is pure cpu.step().
 */

function runZex(binaryPath) {
  const binary = fs.readFileSync(binaryPath);
  const ram = new Uint8Array(65536);
  ram.set(binary, 0x0100);

  // Zero-page trap stubs (see header).
  ram[0x0000] = 0xd3; ram[0x0001] = 0xff; ram[0x0002] = 0x76; // OUT (FF),A ; HALT
  ram[0x0005] = 0xd3; ram[0x0006] = 0x00; ram[0x0007] = 0xc9; // OUT (00),A ; RET

  let out = '';
  let done = false;
  let cpu;

  const writePort = (port) => {
    // OUT (n),A drives the port as (A<<8)|n, so dispatch on the low byte only.
    const p = port & 0xff;
    if (p === 0xff) { done = true; return; }
    if (p !== 0x00) return;
    const s = cpu.getState();        // only on BDOS calls
    if (s.c === 9) {                 // print $-terminated string at DE
      let p = (s.d << 8) | s.e, str = '';
      while (ram[p] !== 0x24) { str += String.fromCharCode(ram[p]); p = (p + 1) & 0xffff; }
      out += str;
      process.stdout.write(str);
    } else if (s.c === 2) {          // print char in E
      const ch = String.fromCharCode(s.e);
      out += ch;
      process.stdout.write(ch);
    }
  };

  cpu = new Z80CPU({
    readByte: (addr) => ram[addr],
    writeByte: (addr, val) => { ram[addr] = val; },
    readPort: () => 0,
    writePort: (port) => writePort(port),
  });
  cpu.pc = 0x0100;
  cpu.sp = 0xf000;

  console.log(`Running ${path.basename(binaryPath)}...`);

  const GUARD = 100_000_000_000; // safety cap; a correct run exits via warm boot
  let instr = 0;
  for (; !done && instr < GUARD; instr++) cpu.step();

  if (!done) {
    console.error(`\nGuard cap hit (${GUARD} instructions) without warm boot.`);
    return 1;
  }

  // zex prints "  OK" per group and an error banner / "CRC" on mismatch.
  const failed = /ERROR|CRC/i.test(out);
  console.log(`\n[${path.basename(binaryPath)}] instructions executed: ${instr}`);
  if (failed) {
    console.error('FAIL: exerciser reported an error.');
    return 1;
  }
  console.log('PASS: all groups OK, warm boot reached.');
  return 0;
}

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error('Usage: node run_zex.js <path-to-binary>');
  process.exit(1);
}

try {
  process.exit(runZex(fixturePath));
} catch (e) {
  console.error(e);
  process.exit(1);
}
