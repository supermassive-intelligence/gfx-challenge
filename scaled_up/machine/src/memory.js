/**
 * Memory subsystem for the Berzerk machine.
 *
 * Implements the address space defined in `cdoc/hardware-berzerk.md`.
 * Uses a TypedArray for main memory and dispatches accesses to handlers
 * for specific device windows.
 */

export const MEM_SIZE = 65536;

export const MAP = {
  ROM0: { start: 0x0000, end: 0x0800 },
  NVRAM: { start: 0x0800, end: 0x0C00 }, // Note: mirrored from 0x0400
  ROM_MAIN: { start: 0x1000, end: 0x4000 }, // ROM1-5
  VRAM: { start: 0x4000, end: 0x6000 },
  MAGICRAM: { start: 0x6000, end: 0x8000 },
  COLOR_RAM: { start: 0x8000, end: 0x8800 }, // Mirrored from 0x3800
};

export class Memory {
  constructor() {
    this.ram = new Uint8Array(MEM_SIZE);
    this.roms = new Map(); // regionName -> Uint8Array
    this.taps = []; // Array of { range: {start, end}, callback: (addr, val, type) => void }
    this.handlers = {
      read: new Map(),
      write: new Map(),
    };
  }

  /**
   * Load ROM data into a specific region.
   * @param {string} regionName - Key from MAP
   * @param {Uint8Array} data - ROM bytes
   */
  loadRom(regionName, data) {
    const region = MAP[regionName];
    if (!region) throw new Error(`Unknown ROM region: ${regionName}`);
    if (data.length > (region.end - region.start)) {
      throw new Error(`ROM data too large for region ${regionName}`);
    }
    this.roms.set(regionName, data);
  }

  /**
   * Register a handler for a specific address range.
   */
  setHandler(start, end, readFn = null, writeFn = null) {
    if (readFn) this.handlers.read.set(start, { end, fn: readFn });
    if (writeFn) this.handlers.write.set(start, { end, writeFn });
  }

  /**
   * Add a trace tap for a range.
   */
  addTap(start, end, callback) {
    this.taps.push({ range: { start, end }, callback });
  }

  _fireTaps(addr, val, type) {
    for (const tap of this.taps) {
      if (addr >= tap.range.start && addr < tap.range.end) {
        tap.callback(addr, val, type);
      }
    }
  }

  read8(addr) {
    addr &= 0xFFFF;

    // 1. Check device handlers
    for (const [start, { end, fn }] of this.handlers.read) {
      if (addr >= start && addr < end) {
        const val = fn(addr);
        this._fireTaps(addr, val, 'read');
        return val;
      }
    }

    // 2. Check ROM regions
    if (addr >= MAP.ROM0.start && addr < MAP.ROM0.end) {
      const rom = this.roms.get('ROM0');
      const val = rom ? rom[addr - MAP.ROM0.start] : 0xff;
      this._fireTaps(addr, val, 'read');
      return val;
    }
    if (addr >= MAP.ROM_MAIN.start && addr < MAP.ROM_MAIN.end) {
      const rom = this.roms.get('ROM_MAIN');
      const val = rom ? rom[addr - MAP.ROM_MAIN.start] : 0xff;
      this._fireTaps(addr, val, 'read');
      return val;
    }

    // 3. Default to RAM
    const val = this.ram[addr];
    this._fireTaps(addr, val, 'read');
    return val;
  }

  write8(addr, val) {
    addr &= 0xFFFF;
    val &= 0xFF;

    // 1. Check device handlers
    for (const [start, { end, writeFn }] of this.handlers.write) {
      if (addr >= start && addr < end) {
        writeFn(addr, val);
        this._fireTaps(addr, val, 'write');
        return;
      }
    }

    // 2. ROM writes are ignored
    if (addr >= MAP.ROM0.start && addr < MAP.ROM0.end) {
      this._fireTaps(addr, val, 'write');
      return;
    }
    if (addr >= MAP.ROM_MAIN.start && addr < MAP.ROM_MAIN.end) {
      this._fireTaps(addr, val, 'write');
      return;
    }

    // 3. Default to RAM
    this.ram[addr] = val;
    this._fireTaps(addr, val, 'write');
  }

  read16(addr) {
    return this.read8(addr) | (this.read8(addr + 1) << 8);
  }

  write16(addr, val) {
    this.write8(addr, val & 0xFF);
    this.write8(addr + 1, (val >> 8) & 0xFF);
  }
}
