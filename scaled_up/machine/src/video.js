/**
 * Video subsystem for the Berzerk machine: VRAM, the Magic RAM write path
 * (74181 ALU + barrel shifter), color RAM, the collision/intercept flop, and
 * a renderToRGBA rasterizer.
 *
 * Every behavior here is pinned in cdoc/hardware-berzerk.md Section 4 (extracted
 * from berzerk.cpp and cross-checked against the 74181 datasheet); section
 * numbers are cited per method. Video owns the VRAM/color backing store; wiring
 * it into the memory address space and the I/O ports (so CPU accesses route
 * here) is T2.9 machine assembly -- out of scope for T2.5.
 *
 * The Magic RAM window (0x6000-0x7FFF) shares the VRAM backing store: a read of
 * 0x6000+x returns videoram[x] (= read of 0x4000+x).
 */

export const VRAM_SIZE = 0x2000;   // 8 KB, 32 bytes/scanline
export const COLOR_SIZE = 0x800;   // 2 KB

// Visible vertical window (cdoc/hardware-berzerk.md sec5: vsync chain). The displayed
// scanlines are the non-vblank rows [VBEND, VBSTART); VBSTART-VBEND = 224 visible rows.
export const VBEND = 0x20;          // 32: first visible scanline (top of screen)
export const VISIBLE_ROWS = 0x100 - VBEND;   // VBSTART(0x100) - VBEND = 224

// 74181 logic-mode (M=1) F output by select, on full bytes (each bit is
// independent in logic mode). A = shifted data, B = current VRAM. This is the
// "F (active-high)" column of spec Section 4.3 (== datasheet positive logic).
function alu181(a, b, select) {
  switch (select & 0x0f) {
    case 0x0: return ~a & 0xff;
    case 0x1: return ~(a | b) & 0xff;
    case 0x2: return ~a & b & 0xff;
    case 0x3: return 0x00;
    case 0x4: return ~(a & b) & 0xff;
    case 0x5: return ~b & 0xff;
    case 0x6: return (a ^ b) & 0xff;
    case 0x7: return a & ~b & 0xff;
    case 0x8: return (~a | b) & 0xff;
    case 0x9: return ~(a ^ b) & 0xff;
    case 0xa: return b & 0xff;
    case 0xb: return a & b & 0xff;
    case 0xc: return 0xff;
    case 0xd: return (a | ~b) & 0xff;
    case 0xe: return (a | b) & 0xff;
    default:  return a & 0xff; // 0xf
  }
}

function bitreverse8(v) {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((v >> i) & 1) << (7 - i);
  return r & 0xff;
}

export class Video {
  constructor() {
    this.vram = new Uint8Array(VRAM_SIZE);   // shared by the 0x4000 and 0x6000 windows
    this.colorram = new Uint8Array(COLOR_SIZE);
    this.reset();
  }

  reset() {
    // machine_reset: control = 0. The flop starts in the post-control (set)
    // state; a control write sets it, a collision resets it. [Section 4.2/4.4]
    this.magicControl = 0;
    this.lastShiftData = 0;
    this.intercept = 1;
  }

  // --- Direct VRAM window 0x4000-0x5FFF (offset 0..0x1FFF) --- [Section 4.1]
  readVram(offset) { return this.vram[offset & 0x1fff]; }
  writeVram(offset, data) { this.vram[offset & 0x1fff] = data & 0xff; }

  // --- Magic RAM window 0x6000-0x7FFF --- [Section 4.1/4.3]
  // Reads alias the shared VRAM backing store.
  readMagic(offset) { return this.vram[offset & 0x1fff]; }

  // Writes run the shift/flip/collision/74181/invert pipeline. [Section 4.3]
  writeMagic(offset, data) {
    offset &= 0x1fff;
    data &= 0xff;
    const current = this.vram[offset];

    // 1. barrel shift, refilling vacated MSBs from the previous write
    let shifted = (((this.lastShiftData << 8) | data) >> (this.magicControl & 0x07)) & 0xff;
    // 2. flip (bit-reverse)
    if (this.magicControl & 0x08) shifted = bitreverse8(shifted);
    // 3. collision resets the intercept flop (J/K with J low)
    if (shifted & current) this.intercept = 0;
    // 4-5. 74181 logic-mode op, then inverted store (74181 outputs active-low)
    const f = alu181(shifted, current, this.magicControl >> 4);
    this.vram[offset] = f ^ 0xff;
    // 6. latch low 7 bits of the raw data for the next write
    this.lastShiftData = data & 0x7f;
  }

  // --- Port 0x4B: magic RAM control --- [Section 4.2]
  writeControl(data) {
    this.magicControl = data & 0xff;
    this.lastShiftData = 0;
    this.intercept = 1; // control write SETS the flop
  }

  // --- Port 0x4E: intercept (bit 7, inverted) + V256 counter --- [Section 4.4]
  // v256 comes from screen timing (T2.6); 0 here keeps T2.5 device-only. The
  // separate frame-IRQ clear on this read is interrupt wiring (T2.6).
  readIntercept(v256 = 0) {
    return (((this.intercept ^ 1) << 7) | (v256 & 0x7f)) & 0xff;
  }

  // --- Color RAM window 0x8000-0x87FF (offset 0..0x7FF) --- [Section 4.5]
  readColor(offset) { return this.colorram[offset & 0x7ff]; }
  writeColor(offset, data) { this.colorram[offset & 0x7ff] = data & 0xff; }

  // The color byte governing a given VRAM offset (4-pixel x 4-scanline block).
  colorAddr(vramOffset) {
    return ((vramOffset >> 2) & 0x07e0) | (vramOffset & 0x001f);
  }

  // Rasterize VRAM+color RAM to an RGBA byte buffer (256 wide; 224 visible
  // rows = 224*256*4 bytes). [Section 4.5] Display-only; RGBI levels approximate.
  //
  // The visible window is the non-vblank scanlines [VBEND, VBSTART) = [32, 256) per the
  // vsync chain (cdoc/hardware-berzerk.md sec5: VBEND=0x20, VBSTART=0x100; 256-32=224
  // visible rows). A VRAM scanline `vy` therefore maps to screen row `vy - VBEND`. The
  // top band (VRAM rows 0-31 = 0x4000-0x43ff: boot flag / coroutine stacks / game vars
  // overlapping VRAM) is in vertical blank and NOT displayed; the BOTTOM status strip --
  // including the player score drawn at scanlines ~245-253 -- IS visible. The previous
  // row-0-anchored window (offs>>5 >= 224) rendered the top stack/var band as garbage and
  // cropped the bottom strip, so the score never appeared on screen.
  renderToRGBA(buf) {
    for (let offs = 0; offs < VRAM_SIZE; offs++) {
      const y = (offs >> 5) - VBEND;       // VRAM scanline -> screen row
      if (y < 0 || y >= VISIBLE_ROWS) continue;   // outside the visible window
      const data = this.vram[offs];
      const color = this.colorram[this.colorAddr(offs)];
      const baseX = (offs & 0x1f) << 3;
      for (let bit = 0; bit < 8; bit++) {
        const on = (data >> (7 - bit)) & 1;          // MSB = leftmost pixel
        const nibble = bit < 4 ? (color >> 4) : (color & 0x0f); // left/right half
        const [r, g, b] = on ? rgbiPen(nibble) : [0, 0, 0];
        const p = (y * 256 + baseX + bit) * 4;
        buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 0xff;
      }
    }
    return buf;
  }
}

// RGBI nibble -> [r,g,b]. bit0=R bit1=G bit2=B bit3=intensity. Levels are a
// display approximation (exact resistor-network values unpinned; see Section 4.5).
function rgbiPen(n) {
  const level = (n & 0x08) ? 0xff : 0x80;
  return [(n & 1) ? level : 0, (n & 2) ? level : 0, (n & 4) ? level : 0];
}
