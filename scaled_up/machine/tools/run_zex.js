import fs from 'node:fs';
import path from 'node:path';
import { Z80CPU } from '../src/cpu/z80.js';

/**
 * Minimal CP/M shim to run Z80 exercisers (zexdoc, zexall).
 *
 * These programs are CP/M-80 binaries. They are loaded at 0x0100.
 * They call CP/M BDOS functions by jumping to 0x0005 with function
 * number in register C.
 */

function runZex(binaryPath) {
  const binary = fs.readFileSync(binaryPath);
  const ram = new Uint8Array(65536);

  // Load binary at 0x0100
  ram.set(binary, 0x0100);

  const callbacks = {
    readByte: (addr) => ram[addr],
    writeByte: (addr, val) => { ram[addr] = val; },
    readPort: (port) => 0,
    writePort: (port, val) => {},
  };

  const cpu = new Z80CPU(callbacks);
  cpu.pc = 0x0100;
  cpu.sp = 0xf000;

  console.log(`Running ${path.basename(binaryPath)}...`);

  // Run loop
  let cycles = 0;
  const MAX_CYCLES = 100_000_000;

  while (cycles < MAX_CYCLES) {
    // Check for CP/M BDOS call (jump to 0x0005)
    if (cpu.pc === 0x0005) {
      const func = cpu.c; // In CP/M, the function number is in register C
      if (func === 0x09) {
        const strAddr = cpu.de;
        let out = "";
        let ptr = strAddr;
        while (true) {
          const char = ram[ptr++];
          if (char === 0x24) break; // '$' is the string terminator in CP/M
          out += String.fromCharCode(char);
        }
        process.stdout.write(out);
      }

      // Return from BDOS call
      cpu.pc++;
    }

    const prevPc = cpu.pc;
    cycles += cpu.step();

    // Log unknown opcodes or stalls
    if (cpu.pc === prevPc) {
      console.error(`CPU stalled at PC 0x${prevPc.toString(16).padStart(4, '0')}`);
      process.exit(1);
    }

    if (cpu.pc >= 65536) break;
  }
}

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("Usage: node run_zex.js <path-to-binary>");
  process.exit(1);
}

try {
  runZex(fixturePath);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
