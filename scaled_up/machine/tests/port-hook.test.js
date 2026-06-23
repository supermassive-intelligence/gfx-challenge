import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { assembleRoms, ROM_FILES } from '../src/roms.js';
import { ScriptPlayer, parseScript } from '../src/script-player.js';
import { fnv1a32 } from '../src/hash.js';
import { makePortHook } from '../src/port-hook.js';
import { Z80CPU } from '../src/cpu/z80.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_DIR = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const SCRIPTS = path.resolve(__dirname, '../../traces/scripts');
const romsPresent = ROM_FILES.every((f) => fs.existsSync(path.join(ROM_DIR, f)));

// ---------------------------------------------------------------------------
// Unit: the dispatcher's mechanics, against a tiny RAM-backed mock CPU.
// A synthetic port at 0x0500 writes a data byte, bumps A, and returns. We assert
// the hook (a) ran the port against LIVE memory, (b) returned as if `ret`
// (pc<-return addr, sp+=2), and (c) charged the configured displaced cycles.
// ---------------------------------------------------------------------------
test('port-hook: dispatch applies port effects, performs RET, charges cycles', () => {
  const ram = new Uint8Array(0x10000);
  // Return address 0x1234 sits on the stack at sp=0x4300.
  ram[0x4300] = 0x34; ram[0x4301] = 0x12;
  const cpu = new Z80CPU({
    readByte: (a) => ram[a & 0xffff],
    writeByte: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff,
    writePort: () => {},
  });
  const st = cpu.getState();
  st.pc = 0x0500; st.sp = 0x4300; st.a = 0x10;
  cpu.setState(st);

  const synth = (ctx) => { ctx.mem.w8(0x0900, 0x77); ctx.regs.a = (ctx.regs.a + 1) & 0xff; };
  cpu.installPortHook(makePortHook(new Map([['0x500', synth]]), new Map([['0x500', { cycles: 42 }]])));

  const cycles = cpu.step();
  const out = cpu.getState();
  assert.strictEqual(cycles, 42, 'charged the configured displaced cycle cost');
  assert.strictEqual(ram[0x0900], 0x77, 'port wrote to LIVE memory');
  assert.strictEqual(out.a, 0x11, 'port register write-back applied');
  assert.strictEqual(out.pc, 0x1234, 'RET popped the return address into PC');
  assert.strictEqual(out.sp, 0x4302, 'RET advanced sp by 2');
});

test('port-hook: replays the routine entry pushes into live memory (stack overlaps VRAM)', () => {
  // sp=0x42f2 sits in the 0x4000-0x5FFF window (VRAM in the real machine). A
  // routine that `push hl`es must leave HL on the stack -- the hook replays it.
  const ram = new Uint8Array(0x10000);
  ram[0x42f2] = 0xCD; ram[0x42f3] = 0xAB;   // return address 0xABCD at entry sp
  const cpu = new Z80CPU({
    readByte: (a) => ram[a & 0xffff], writeByte: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff, writePort: () => {},
  });
  const st = cpu.getState(); st.pc = 0x2678; st.sp = 0x42f2; st.h = 0x08; st.l = 0xd0;
  cpu.setState(st);
  // A RANDOM-like port that preserves HL; meta declares `push hl`.
  const port = (ctx) => { ctx.regs.a = 0x99; };
  cpu.installPortHook(makePortHook(new Map([['0x2678', port]]),
                                   new Map([['0x2678', { cycles: 140, pushes: ['hl'] }]])));
  cpu.step();
  assert.strictEqual(ram[0x42f1], 0x08, 'push hl wrote H to sp-1 (VRAM byte)');
  assert.strictEqual(ram[0x42f0], 0xd0, 'push hl wrote L to sp-2 (VRAM byte)');
  const out = cpu.getState();
  assert.strictEqual(out.pc, 0xabcd, 'RET popped return address from entry sp');
  assert.strictEqual(out.sp, 0x42f4, 'net sp = entry_sp + 2 (push/pop balanced, then ret)');
});

test('port-hook: framesToDrop=1 performs a non-local return (drops one extra word)', () => {
  // 0x15cb-style: the success path does `pop hl; ret`, discarding its caller's
  // return address (at entrySp) and returning to the grandparent (at entrySp+2).
  const ram = new Uint8Array(0x10000);
  ram[0x4300] = 0xAA; ram[0x4301] = 0xAA;   // caller return addr 0xAAAA (discarded)
  ram[0x4302] = 0xBB; ram[0x4303] = 0xBB;   // grandparent return addr 0xBBBB
  const cpu = new Z80CPU({
    readByte: (a) => ram[a & 0xffff], writeByte: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff, writePort: () => {},
  });
  const st = cpu.getState(); st.pc = 0x15cb; st.sp = 0x4300; cpu.setState(st);
  const port = (ctx) => { ctx.framesToDrop = 1; };
  cpu.installPortHook(makePortHook(new Map([['0x15cb', port]]), new Map([['0x15cb', { cycles: 50 }]])));
  cpu.step();
  const out = cpu.getState();
  assert.strictEqual(out.pc, 0xbbbb, 'returned to the grandparent (entrySp+2)');
  assert.strictEqual(out.sp, 0x4304, 'sp dropped two words (entrySp + 4)');
});

test('port-hook: returnPc resumes at a port-computed address (inline-param) + exposes retAddr', () => {
  // 0x3657/0x297b-style: the call return address points at inline constant bytes;
  // the port reads them via ctx.retAddr and resumes PAST them at an absolute PC.
  const ram = new Uint8Array(0x10000);
  ram[0x4300] = 0x00; ram[0x4301] = 0x20;   // return addr 0x2000 (-> inline data)
  ram[0x2000] = 0x05; ram[0x2001] = 0x06;   // two inline constant bytes
  const cpu = new Z80CPU({
    readByte: (a) => ram[a & 0xffff], writeByte: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff, writePort: () => {},
  });
  const st = cpu.getState(); st.pc = 0x3657; st.sp = 0x4300; cpu.setState(st);
  let sawRetAddr = -1, sawInline = -1;
  const port = (ctx) => {
    sawRetAddr = ctx.retAddr;
    sawInline = ctx.mem.r8(ctx.retAddr) + ctx.mem.r8(ctx.retAddr + 1);   // 5 + 6
    ctx.returnPc = (ctx.retAddr + 2) & 0xffff;   // resume past the 2 inline bytes
  };
  cpu.installPortHook(makePortHook(new Map([['0x3657', port]]), new Map([['0x3657', { cycles: 60 }]])));
  cpu.step();
  const out = cpu.getState();
  assert.strictEqual(sawRetAddr, 0x2000, 'ctx.retAddr is the CALL return address');
  assert.strictEqual(sawInline, 0x0b, 'port read inline constants via retAddr');
  assert.strictEqual(out.pc, 0x2002, 'resumed at the port-computed returnPc');
  assert.strictEqual(out.sp, 0x4302, 'sp netted one frame (entrySp + 2)');
});

test('port-hook: unregistered PC falls through to the core (returns null -> core runs)', () => {
  const ram = new Uint8Array(0x10000);
  ram[0x0500] = 0x00; // NOP at PC
  const cpu = new Z80CPU({
    readByte: (a) => ram[a & 0xffff], writeByte: (a, v) => { ram[a & 0xffff] = v & 0xff; },
    readPort: () => 0xff, writePort: () => {},
  });
  const st = cpu.getState(); st.pc = 0x0500; cpu.setState(st);
  cpu.installPortHook(makePortHook(new Map(), new Map()));  // empty registry/meta
  const cycles = cpu.step();                                 // NOP executes in the core
  assert.strictEqual(cycles, 4, 'core executed the NOP (4 cycles), hook fell through');
  assert.strictEqual(cpu.getState().pc, 0x0501, 'PC advanced past the NOP');
});

// ---------------------------------------------------------------------------
// Integration (the strong check): hooked ≡ un-hooked over a window that
// exercises RANDOM (first fires ~frame 950). Because the RANDOM port is
// behaviorally exact (T8.1), installing it must not change the machine's own
// per-frame video output AT ALL. Any divergence => the hook's RET semantics,
// write-back, or cycle accounting is wrong.
// ---------------------------------------------------------------------------
function runHashes(frames, installHooks, script = 'attract-only.jsonl') {
  const romData = {};
  for (const f of ROM_FILES) romData[f] = new Uint8Array(fs.readFileSync(path.join(ROM_DIR, f)));
  const { header, records } = parseScript(fs.readFileSync(path.join(SCRIPTS, script), 'utf8'));
  const m = new Machine();
  m.loadRoms(assembleRoms((n) => romData[n]));
  m.reset();
  if (installHooks) m.installPortHooks();
  const player = new ScriptPlayer(m.input, header, records);
  const hashes = [];
  const buf = new Uint8Array(10240);
  for (let f = 0; f < frames; f++) {
    player.applyFrame(f);
    m.runFrame();
    buf.set(m.video.vram, 0);
    buf.set(m.video.colorram, 8192);
    hashes.push(fnv1a32(buf) >>> 0);
  }
  return hashes;
}

test('port-hook: hooked RANDOM is byte-identical to un-hooked over 2200 frames (full-VRAM, exercises RANDOM)',
  { skip: romsPresent ? false : `ROMs absent at ${ROM_DIR}` }, () => {
    const N = 2200;                       // covers RANDOM first fire (~950) + the
                                          // stack-in-VRAM tearing frames 2090/2149
    const base = runHashes(N, false);
    const hook = runHashes(N, true);
    const firstDiff = base.findIndex((h, i) => h !== hook[i]);
    assert.strictEqual(firstDiff, -1,
      `hooked diverged from un-hooked at frame ${firstDiff} ` +
      `(base=0x${(base[firstDiff] >>> 0).toString(16)} hook=0x${(hook[firstDiff] >>> 0).toString(16)})`);
  });

// T9.2: the gameplay routines (sound triggers, SET_VELOCITY, credits/score, etc.)
// are NOT reached in attract -- coin-start-first-maze drives a coin insert into the
// first maze, exercising them live. The full ported set must stay byte-transparent.
test('port-hook: hooked == un-hooked over coin-start-first-maze (exercises gameplay ports)',
  { skip: romsPresent ? false : `ROMs absent at ${ROM_DIR}` }, () => {
    const N = 942;                          // the script's full length
    const base = runHashes(N, false, 'coin-start-first-maze.jsonl');
    const hook = runHashes(N, true, 'coin-start-first-maze.jsonl');
    const firstDiff = base.findIndex((h, i) => h !== hook[i]);
    assert.strictEqual(firstDiff, -1,
      `hooked diverged from un-hooked at frame ${firstDiff} ` +
      `(base=0x${(base[firstDiff] >>> 0).toString(16)} hook=0x${(hook[firstDiff] >>> 0).toString(16)})`);
  });
