/**
 * Video and Magic RAM subsystem for Berzerk.
 *
 * Implements the VRAM, Color RAM, and the hardware ALU logic (Magic RAM)
 * used for sprite blitting and collision detection.
 */

import { MAP } from './memory.js';

/**
 * 74181 ALU implementation.
 * The Z80 Magic RAM uses two 74181 chips to process nibbles.
 * The function is determined by the 4-bit select input.
 */
class ALU74181 {
  /**
   * Compute the 74181 ALU function.
   * @param {number} a - Input A (nibble)
   * @param {number} b - Input B (nibble)
   * @param {number} select - 4-bit function select
   * @returns {number} Resulting 4-bit output
   */
  static compute(a, b, select) {
    // The 74181 is a complex 4-bit ALU. We simulate it based on the
    // documented function table.
    // a, b are nibbles (0-15). select is 0-15.

    // Simplified simulation for common Berzerk ops if needed,
    // but for accuracy we can use a lookup or a bit-accurate model.
    // Since we are in scaffold phase, we implement the core logic.

    // Reference: https://www.ti.com/product/en-us/SN74181-S
    // However, for a port, we can use the known behavior of the 74181.
    // Many emulators use a precomputed table for the 74181.

    // For now, we implement a few common ops or a placeholder.
    // In a real port, this would be a 16x16x16 lookup table.
    return 0; // Placeholder
  }
}

export class Video {
  constructor(memory) {
    this.memory = memory;

    // VRAM is mapped to memory.ram in [0x4000, 0x6000)
    // Color RAM is mapped to memory.ram in [0x8000, 0x8800)

    this.intercept = 1;
    this.lastShiftData = 0;
    this.magicramControl = 0;
  }

  /**
   * Handle writes to the Magic RAM window [0x6000, 0x8000).
   * @param {number} offset - Offset from 0x6000
   * @param {number} data - Byte to write
   */
  magicramWrite(offset, data) {
    const currentVideoData = this.memory.read8(0x4000 + offset);

    // 1. Shifter/Flipper logic
    // Combine last_shift_data (7 bits) and current data
    let combined = ((this.lastShiftData << 8) | data) & 0xFFFF;
    let shiftAmount = this.magicramControl & 0x07;
    let shiftFlopOutput = (combined >> shiftAmount) & 0xFF;

    // Flip bits if control bit 3 is set
    if (this.magicramControl & 0x08) {
      shiftFlopOutput = this._bitswap(shiftFlopOutput);
    }

    // 2. Collision Detection
    if ((shiftFlopOutput & currentVideoData) !== 0) {
      this.intercept = 0;
    }

    // 3. ALU Step
    // Two 74181s process the low and high nibbles
    const select = (this.magicramControl >> 4) & 0x0F;
    const lowA = shiftFlopOutput & 0x0F;
    const highA = (shiftFlopOutput >> 4) & 0x0F;
    const lowB = currentVideoData & 0x0F;
    const highB = (currentVideoData >> 4) & 0x0F;

    const lowOut = ALU74181.compute(lowA, lowB, select);
    const highOut = ALU74181.compute(highA, highB, select);

    const aluOutput = (highOut << 4) | lowOut;

    // Result is inverted and written to VRAM
    this.memory.write8(0x4000 + offset, aluOutput ^ 0xFF);

    // Save data for next write (only 7 bits preserved per MAME)
    this.lastShiftData = data & 0x7F;
  }

  /**
   * Control write for Magic RAM
   */
  magicramControlWrite(data) {
    this.magicramControl = data;
    this.lastShiftData = 0;
    this.intercept = 1;
  }

  /**
   * Read the intercept flag and V256 status.
   * @returns {number} 8-bit value
   */
  readIntercept() {
    // v256 is a placeholder for the screen position logic (T2.6)
    const v256 = 0;
    return ((this.intercept ^ 1) << 7) | v256;
  }

  _bitswap(val) {
    // Simplified bitswap for the 0,1,2,3,4,5,6,7 order mentioned in MAME
    // Which is actually just a no-op for that specific sequence.
    return val;
  }

  /**
   * Rasterize VRAM and Color RAM to an RGBA buffer.
   * @param {Uint8ClampedArray} buf - Target buffer (width * height * 4)
   */
  renderToRGBA(buf) {
    const width = 256;
    const height = 224;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // This is a simplified rasterizer.
        // Real Berzerk uses a complex bitmap + color RAM mapping.
        const vramAddr = 0x4000 + (y * 256) + x; // Simplification
        const colorAddr = 0x8000 + (y * 32) + (x >> 3); // Block granularity

        const pixel = this.memory.read8(vramAddr);
        const color = this.memory.read8(colorAddr);

        const idx = (y * width + x) * 4;
        buf[idx] = 0;     // R
        buf[idx + 1] = 0; // G
        buf[idx + 2] = 0; // B
        buf[idx + 3] = 255; // A
      }
    }
  }
}
