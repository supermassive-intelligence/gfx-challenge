import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Memory, MAP, MEM_SIZE, ROM_UNLOADED_FILL, UNMAPPED_FILL } from '../src/memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.resolve(__dirname, '../../cdoc/hardware-berzerk.md');

const region = (name) => MAP.find((r) => r.name === name);

// ---------------------------------------------------------------------------
// Single source of truth: MAP must agree with hardware-berzerk.md Section 2.
// No memory-map literals are hand-duplicated in the tests below; they all read
// from MAP, and MAP itself is cross-checked against the contract table here.
// ---------------------------------------------------------------------------
test('MAP agrees with hardware-berzerk.md Section 2 table', () => {
  const doc = fs.readFileSync(CONTRACT, 'utf8');
  const sec = doc.slice(doc.indexOf('## 2.'), doc.indexOf('## 3.'));
  const kindOf = { ROM: 'rom', RAM: 'ram', device: 'device', unmapped: 'unmapped' };

  const rows = [];
  for (const line of sec.split('\n')) {
    const m = line.match(/^\|\s*0x([0-9a-fA-F]+)-0x([0-9a-fA-F]+)\s*\|[^|]*\|\s*([A-Za-z]+)\s*\|/);
    if (!m) continue;
    rows.push({ start: parseInt(m[1], 16), end: parseInt(m[2], 16) + 1, kind: kindOf[m[3]] });
  }

  assert.strictEqual(rows.length, MAP.length, 'row count matches MAP region count');
  for (const row of rows) {
    const r = MAP.find((x) => x.start === row.start);
    assert.ok(r, `contract range 0x${row.start.toString(16)} present in MAP`);
    assert.strictEqual(r.end, row.end, `${r.name} end matches contract`);
    assert.strictEqual(r.kind, row.kind, `${r.name} kind matches contract`);
  }
});

test('every address 0x0000-0xFFFF resolves (mirrors cover the canonical gaps)', () => {
  // Canonical ranges do not tile contiguously -- the NVRAM (0x0C00-0x0FFF) and
  // color-RAM (0x8800-0xBFFF) mirrors fill the gaps. Coverage is therefore that
  // every address reads a valid byte without throwing (an unmapped address would
  // fail to resolve and throw).
  const mem = new Memory();
  for (let addr = 0; addr < MEM_SIZE; addr++) {
    const v = mem.read8(addr);
    assert.ok(v >= 0 && v <= 0xff, `0x${addr.toString(16)} resolves to a byte`);
  }
});

// ---------------------------------------------------------------------------
// Every documented range readable/writable per its spec.
// ---------------------------------------------------------------------------
test('RAM and device regions are read/write at both ends', () => {
  const mem = new Memory();
  for (const r of MAP.filter((x) => x.kind === 'ram' || x.kind === 'device')) {
    for (const addr of [r.start, r.end - 1]) {
      mem.write8(addr, 0x5a);
      assert.strictEqual(mem.read8(addr), 0x5a, `${r.name} @0x${addr.toString(16)} R/W`);
      mem.write8(addr, 0xa5);
      assert.strictEqual(mem.read8(addr), 0xa5, `${r.name} @0x${addr.toString(16)} R/W again`);
    }
  }
});

test('ROM regions read loaded data; writes are ignored', () => {
  const mem = new Memory();
  for (const r of MAP.filter((x) => x.kind === 'rom')) {
    const data = new Uint8Array(r.end - r.start);
    data[0] = 0x11; data[data.length - 1] = 0x22;
    mem.loadRom(r.rom, data);
    assert.strictEqual(mem.read8(r.start), 0x11, `${r.name} first byte`);
    assert.strictEqual(mem.read8(r.end - 1), 0x22, `${r.name} last byte`);
    mem.write8(r.start, 0xee);
    assert.strictEqual(mem.read8(r.start), 0x11, `${r.name} write ignored`);
  }
});

test('unloaded ROM reads ROM_UNLOADED_FILL', () => {
  const mem = new Memory();
  for (const r of MAP.filter((x) => x.kind === 'rom')) {
    assert.strictEqual(mem.read8(r.start), ROM_UNLOADED_FILL, `${r.name} unloaded`);
  }
});

// ---------------------------------------------------------------------------
// Mirrors mirror.
// ---------------------------------------------------------------------------
test('mirrored regions alias their base storage', () => {
  const mem = new Memory();
  for (const r of MAP.filter((x) => x.mirror !== undefined)) {
    const size = r.end - r.start;
    mem.write8(r.start, 0x3c);
    const aliased = r.start + r.mirror;
    assert.strictEqual(mem.read8(aliased), 0x3c,
      `${r.name}: 0x${aliased.toString(16)} aliases base`);
    // Write through the mirror, read at base.
    mem.write8(r.start + r.mirror, 0xc3);
    assert.strictEqual(mem.read8(r.start), 0xc3, `${r.name}: mirror write hits base`);
    // Index folds modulo size: first and last cell are independent.
    mem.write8(r.start, 0x01);
    mem.write8(r.start + size - 1, 0x02);
    assert.notStrictEqual(mem.read8(r.start), mem.read8(r.start + size - 1));
  }
});

test('NVRAM mirror: 0x0800 and 0x0C00 are the same cell', () => {
  const mem = new Memory();
  const nv = region('NVRAM');
  mem.write8(nv.start, 0x7e);
  assert.strictEqual(mem.read8(nv.start + nv.mirror), 0x7e);
});

test('Color RAM mirror responds through 0xBFFF', () => {
  const mem = new Memory();
  const cr = region('COLOR_RAM');
  mem.write8(cr.start, 0x9d);
  // 0x8000 | 0x3800 = 0xB800 is the top mirror copy of the base cell.
  assert.strictEqual(mem.read8(cr.start | cr.mirror), 0x9d);
});

// ---------------------------------------------------------------------------
// "Nothing there" access behavior is defined and tested -- two mechanisms.
// ---------------------------------------------------------------------------
test('empty ROM6 socket (0x3800-0x3FFF) reads ROM_UNLOADED_FILL, ignores writes', () => {
  const mem = new Memory();
  const rom6 = region('ROM6');
  assert.strictEqual(mem.read8(rom6.start), ROM_UNLOADED_FILL);
  assert.strictEqual(mem.read8(rom6.end - 1), ROM_UNLOADED_FILL);
  mem.write8(rom6.start, 0x12);
  assert.strictEqual(mem.read8(rom6.start), ROM_UNLOADED_FILL, 'write ignored');
});

test('unmapped region (0xC000-0xFFFF) reads UNMAPPED_FILL, ignores writes', () => {
  const mem = new Memory();
  for (const r of MAP.filter((x) => x.kind === 'unmapped')) {
    assert.strictEqual(mem.read8(r.start), UNMAPPED_FILL, `${r.name} reads fill`);
    assert.strictEqual(mem.read8(r.end - 1), UNMAPPED_FILL, `${r.name} end reads fill`);
    mem.write8(r.start, 0x77);
    assert.strictEqual(mem.read8(r.start), UNMAPPED_FILL, `${r.name} write ignored`);
  }
});

// The two fill values are pinned here. Both MAME debugger-verified 2026-06-12
// with berzerk loaded: `print b@3800` -> 0xFF (unloaded ROM6 socket), and
// `print b@c000` -> 0x00 (noprw() unmapped, address-space default). They are
// deliberately different; collapsing them would diverge from the oracle on any
// stray read at/above 0xC000.  [berzerk_map L670/L674 + RC31A ROM table]
test('fill values are pinned (ROM unloaded=0xFF, unmapped=0x00; MAME-verified)', () => {
  assert.strictEqual(ROM_UNLOADED_FILL, 0xff);
  assert.strictEqual(UNMAPPED_FILL, 0x00);
});

// ---------------------------------------------------------------------------
// Device handler hook (real devices arrive in T2.5+).
// ---------------------------------------------------------------------------
test('a device handler overrides default region behavior', () => {
  const mem = new Memory();
  const magic = region('MAGICRAM');
  const writes = [];
  mem.setHandler(magic.start, magic.end,
    () => 0x42,
    (addr, val) => writes.push([addr, val]));
  assert.strictEqual(mem.read8(magic.start), 0x42, 'handler read used');
  mem.write8(magic.start, 0x99);
  assert.deepStrictEqual(writes, [[magic.start, 0x99]], 'handler write used');
});

// ---------------------------------------------------------------------------
// Trace taps fire with (addr, value, type).
// ---------------------------------------------------------------------------
test('taps fire on access in range with (addr, value, type)', () => {
  const mem = new Memory();
  const vram = region('VRAM');
  const events = [];
  mem.addTap(vram.start, vram.end, (addr, val, type) => events.push({ addr, val, type }));

  mem.write8(vram.start + 0x10, 0xcc);
  mem.read8(vram.start + 0x10);

  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(events[0], { addr: vram.start + 0x10, val: 0xcc, type: 'write' });
  assert.deepStrictEqual(events[1], { addr: vram.start + 0x10, val: 0xcc, type: 'read' });
});

test('taps ignore access outside their range', () => {
  const mem = new Memory();
  let fired = false;
  const vram = region('VRAM');
  mem.addTap(vram.start, vram.end, () => { fired = true; });
  mem.write8(vram.end, 0xcc); // first byte past the tap range (magic RAM)
  assert.strictEqual(fired, false);
});

// ---------------------------------------------------------------------------
// 16-bit helpers and ROM loading guards.
// ---------------------------------------------------------------------------
test('16-bit access is little-endian', () => {
  const mem = new Memory();
  const vram = region('VRAM');
  mem.write16(vram.start, 0xbeef);
  assert.strictEqual(mem.read8(vram.start), 0xef);
  assert.strictEqual(mem.read8(vram.start + 1), 0xbe);
  assert.strictEqual(mem.read16(vram.start), 0xbeef);
});

test('loadRom rejects oversized data and non-ROM regions', () => {
  const mem = new Memory();
  const rom = MAP.find((r) => r.kind === 'rom');
  assert.throws(() => mem.loadRom(rom.rom, new Uint8Array(rom.end - rom.start + 1)));
  assert.throws(() => mem.loadRom('VRAM', new Uint8Array(1)));
});
