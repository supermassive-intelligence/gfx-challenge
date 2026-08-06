import test from 'node:test';
import assert from 'node:assert';
import { Video } from '../src/video.js';

// All expected values are hand-derived from cdoc/hardware-berzerk.md Section 4
// (the magicram pipeline + 74181 table + color-block formula), cited per case.

// ---------------------------------------------------------------------------
// Section 4.3 -- the 16 74181 logic-mode functions.
// Fixed inputs A (shifted) = 0xAA, B (current VRAM) = 0xCC exercise all four
// (A_i,B_i) bit combinations. Expected = "stored = F^0xFF" column of the §4.3
// table evaluated at A=0xAA,B=0xCC (worked out by hand):
//   0:A 1:A|B 2:A|~B 3:0xFF 4:A&B 5:B 6:~(A^B) 7:~A|B
//   8:A&~B 9:A^B A:~B B:~(A&B) C:0x00 D:~A&B E:~(A|B) F:~A
// ---------------------------------------------------------------------------
const A = 0xaa, B = 0xcc;
const EXPECTED_BY_SELECT = [
  0xaa, 0xee, 0xbb, 0xff, 0x88, 0xcc, 0x99, 0xdd,
  0x22, 0x66, 0x33, 0x77, 0x00, 0x44, 0x11, 0x55,
];

test('Section 4.3: 74181 logic-mode table for all 16 selects (shift 0, no flip)', () => {
  for (let select = 0; select < 16; select++) {
    const v = new Video();
    const off = 0x100;
    v.writeVram(off, B);              // current VRAM byte
    v.writeControl(select << 4);      // select in bits 7-4, shift 0, no flip
    v.writeMagic(off, A);             // shifted data = A (shift 0)
    assert.strictEqual(v.readVram(off), EXPECTED_BY_SELECT[select],
      `select 0x${select.toString(16)}: stored byte`);
    // The magic window aliases the same store (§4.1).
    assert.strictEqual(v.readMagic(off), EXPECTED_BY_SELECT[select]);
  }
});

test('Section 4.3: common Berzerk control bytes (direct/OR/XOR/clear)', () => {
  const cases = [
    { ctrl: 0x00, b: 0x0f, a: 0x3c, want: 0x3c },        // direct: vram = shifted
    { ctrl: 0x10, b: 0x0f, a: 0x30, want: 0x0f | 0x30 }, // OR:  shifted | vram
    { ctrl: 0x90, b: 0xff, a: 0x0f, want: 0xff ^ 0x0f }, // XOR: shifted ^ vram
    { ctrl: 0xc0, b: 0xab, a: 0x55, want: 0x00 },        // clear: 0x00
  ];
  for (const c of cases) {
    const v = new Video();
    v.writeVram(0, c.b);
    v.writeControl(c.ctrl);
    v.writeMagic(0, c.a);
    assert.strictEqual(v.readVram(0), c.want, `ctrl 0x${c.ctrl.toString(16)}`);
  }
});

// ---------------------------------------------------------------------------
// Section 4.3 step 1 + 6 -- the barrel shift refills vacated MSBs from the
// previous write's last_shift_data. This is the classic across-byte-boundary
// horizontal shift. Control = 0x03 (select 0 = direct write, shift 3, no flip).
//   write1 data=0xFF: shifted = (0x00FF)>>3 = 0x1F, stored = 0x1F; latch 0x7F.
//   write2 data=0x00: shifted = (0x7F00)>>3 = 0xE0, stored = 0xE0  <- from latch.
// ---------------------------------------------------------------------------
test('Section 4.3: shift across byte boundary uses last_shift_data', () => {
  const v = new Video();
  v.writeControl(0x03);
  v.writeMagic(0, 0xff);
  assert.strictEqual(v.readVram(0), 0x1f, 'first write shifted right 3');
  v.writeMagic(1, 0x00);
  assert.strictEqual(v.readVram(1), 0xe0, 'second write filled from latch');
});

test('Section 4.3: flip (control bit 3) bit-reverses the shifted data', () => {
  const v = new Video();
  v.writeControl(0x08);          // select 0 (direct), shift 0, flip on
  v.writeMagic(0, 0b00000001);   // shifted 0x01 -> reversed 0x80 -> stored 0x80
  assert.strictEqual(v.readVram(0), 0x80);
});

// ---------------------------------------------------------------------------
// Section 4.4 -- collision/intercept flop. Control write SETS it (read bit7=0);
// a colliding magicram write RESETS it (read bit7=1); reads do not change it.
// ---------------------------------------------------------------------------
test('Section 4.4: intercept set by control, reset by collision, read inverted', () => {
  const v = new Video();

  // Control write sets the flop -> read bit 7 == 0 (no collision yet).
  v.writeControl(0x00);
  assert.strictEqual(v.readIntercept() & 0x80, 0x00);

  // No-collision write (shifted & current == 0) leaves it set.
  v.writeVram(0, 0x00);
  v.writeControl(0x00);
  v.writeMagic(0, 0xff);            // 0xff & 0x00 == 0 -> no collision
  assert.strictEqual(v.readIntercept() & 0x80, 0x00, 'no collision -> bit7 clear');

  // Colliding write resets the flop -> read bit 7 == 1.
  v.writeVram(1, 0xff);
  v.writeControl(0x00);            // re-set the flop
  v.writeMagic(1, 0xff);           // 0xff & 0xff != 0 -> collision
  assert.strictEqual(v.readIntercept() & 0x80, 0x80, 'collision -> bit7 set');

  // Reading does not change the flop (no clear-on-read of intercept).
  assert.strictEqual(v.readIntercept() & 0x80, 0x80, 'still set after read');

  // A control write sets it again.
  v.writeControl(0x00);
  assert.strictEqual(v.readIntercept() & 0x80, 0x00, 'control write re-sets');
});

test('Section 4.4: readIntercept ORs the V256 counter into the low bits', () => {
  const v = new Video();
  v.writeControl(0x00);            // intercept set -> bit7 = 0
  assert.strictEqual(v.readIntercept(0x2a), 0x2a);
});

// ---------------------------------------------------------------------------
// Section 4.5 -- color RAM is one byte per 4-pixel x 4-scanline block:
//   colorAddr = ((offs >> 2) & 0x07E0) | (offs & 0x001F)
// 32 bytes per scanline, so offs = (y<<5) | xByte.
// ---------------------------------------------------------------------------
test('Section 4.5: color block addressing groups 4 scanlines, per byte-column', () => {
  const v = new Video();
  const addr = (y, xb) => v.colorAddr((y << 5) | xb);

  // Four scanlines y..y+3 share one color row; y+4 starts a new one.
  assert.strictEqual(addr(0, 0), addr(1, 0), 'y=0 and y=1 same block');
  assert.strictEqual(addr(0, 0), addr(3, 0), 'y=0..3 same block');
  assert.notStrictEqual(addr(0, 0), addr(4, 0), 'y=4 new vertical block');

  // Byte columns map straight through (the 4-pixel split is via the nibble).
  assert.strictEqual(addr(0, 1), 1);
  assert.strictEqual(addr(0, 0x1f), 0x1f);

  // Whole map stays within the 2 KB color RAM.
  assert.strictEqual(v.colorAddr(0x1fff) < 0x800, true);
});

test('Section 4.5: color RAM read/write at block boundaries', () => {
  const v = new Video();
  v.writeColor(0x000, 0x12);
  v.writeColor(0x7ff, 0x34);
  assert.strictEqual(v.readColor(0x000), 0x12);
  assert.strictEqual(v.readColor(0x7ff), 0x34);
});

// ---------------------------------------------------------------------------
// Section 4.5 -- renderToRGBA: MSB = leftmost pixel; left 4 px use the color's
// high nibble, right 4 px the low nibble; set bit -> pen, clear bit -> black.
// ---------------------------------------------------------------------------
test('Section 4.5: renderToRGBA maps MSB-first with high/low color nibbles', () => {
  const v = new Video();
  // The visible window is scanlines [VBEND=32, 256); VRAM scanline 32 is screen row 0.
  // Write at VRAM offset 32*32 = 0x400 (first visible scanline) so it lands at screen y=0.
  const offs = 32 << 5;            // 0x400 -- VRAM scanline 32 == screen row 0
  // VRAM byte 0x81 = bit7 (leftmost) and bit0 (rightmost) set.
  v.writeVram(offs, 0x81);
  // high nibble = 1 (R), low nibble = 4 (B).
  v.writeColor(v.colorAddr(offs), 0x14);
  const buf = new Uint8Array(256 * 224 * 4);
  v.renderToRGBA(buf);

  // Pixel 0 (leftmost, bit7 set, high nibble=1=R) -> red, at screen row 0.
  assert.deepStrictEqual([buf[0], buf[1], buf[2], buf[3]], [0x80, 0, 0, 0xff]);
  // Pixel 1 (bit6 clear) -> black.
  assert.deepStrictEqual([buf[4], buf[5], buf[6], buf[7]], [0, 0, 0, 0xff]);
  // Pixel 7 (rightmost, bit0 set, low nibble=4=B) -> blue.
  const p7 = 7 * 4;
  assert.deepStrictEqual([buf[p7], buf[p7 + 1], buf[p7 + 2], buf[p7 + 3]], [0, 0, 0x80, 0xff]);

  // The top stack/var band (VRAM rows 0-31) is in vblank and must NOT render: a pixel
  // written at VRAM offset 0 stays off-screen (no longer painted at screen row 0).
  const v2 = new Video();
  v2.writeVram(0, 0xff);
  v2.writeColor(0, 0x14);
  const buf2 = new Uint8Array(256 * 224 * 4);
  v2.renderToRGBA(buf2);
  assert.deepStrictEqual([buf2[0], buf2[1], buf2[2], buf2[3]], [0, 0, 0, 0xff]);
});

test('reset restores control/latch/intercept to power-on state (Section 4.2)', () => {
  const v = new Video();
  v.writeControl(0x9b);
  v.writeMagic(0, 0xff);
  v.reset();
  assert.strictEqual(v.magicControl, 0);
  assert.strictEqual(v.lastShiftData, 0);
  assert.strictEqual(v.readIntercept() & 0x80, 0x00);
});
