/**
 * Memory subsystem for the Berzerk machine (program address space).
 *
 * Mirrors the original hardware map exactly -- ported routines keep absolute
 * addresses forever, so this layout is permanent API. Authoritative map:
 * cdoc/hardware-berzerk.md Section 2 (which this module is checked against by
 * tests/memory.test.js). The map below resolves the contract's mirror notes to
 * MAME-style mirror masks and splits the program-ROM region at 0x37FF
 * (0x3800-0x3FFF is the unpopulated ROM6 socket).
 *
 * Region kinds:
 *   rom      - read-only; bytes come from a loaded ROM file; writes ignored.
 *              An address inside a rom region with no loaded byte reads
 *              ROM_UNLOADED_FILL (e.g. the empty ROM6 socket at 0x3800-0x3FFF).
 *   ram      - read/write backing store.
 *   device   - read/write backing store by default; a real device handler
 *              (magic-RAM ALU etc.) is attached later via setHandler (T2.5+).
 *   unmapped - noprw(); reads return UNMAPPED_FILL, writes ignored.
 *
 * Mirrored regions (NVRAM, color RAM) carry a MAME-style `mirror` mask: an
 * address belongs to the region when its non-mirror, non-size bits equal the
 * region base, and it indexes the region modulo its (power-of-two) size.
 */

// Two distinct "nothing there" mechanisms, both MAME-verified in the debugger
// on 2026-06-12 (berzerk loaded):
//   ROM_UNLOADED_FILL - an address inside a mapped ROM region with no ROM byte
//     loaded. MAME fills the unloaded ROM with 0xFF. Verified: `print b@3800`
//     (empty ROM6 socket) -> 0xFF.  [berzerk_map L670 + RC31A ROM table]
//   UNMAPPED_FILL - a noprw() address that is not mapped at all; reads return
//     the address space's default value 0x00. Verified: `print b@c000` -> 0x00.
//     [berzerk_map L674]
// These differ (0xFF vs 0x00); collapsing them would diverge from the oracle on
// any stray read above 0xC000.
export const ROM_UNLOADED_FILL = 0xff;
export const UNMAPPED_FILL = 0x00;

export const MEM_SIZE = 0x10000;

/**
 * Canonical region table. `start`/`end` are the canonical (non-mirrored) range,
 * end exclusive. `mirror` (optional) is the MAME mirror mask; mirrored regions
 * have a power-of-two size (end - start). This is the single source of truth;
 * tests derive expectations from it and cross-check it against §2 of the
 * hardware contract.
 */
export const MAP = [
  { name: 'ROM0',      start: 0x0000, end: 0x0800, kind: 'rom', rom: 'ROM0' },
  { name: 'NVRAM',     start: 0x0800, end: 0x0c00, kind: 'ram', mirror: 0x0400 },
  { name: 'ROM_MAIN',  start: 0x1000, end: 0x3800, kind: 'rom', rom: 'ROM_MAIN' },
  { name: 'ROM6',      start: 0x3800, end: 0x4000, kind: 'rom', rom: 'ROM6' },
  { name: 'VRAM',      start: 0x4000, end: 0x6000, kind: 'ram' },
  { name: 'MAGICRAM',  start: 0x6000, end: 0x8000, kind: 'device' },
  { name: 'COLOR_RAM', start: 0x8000, end: 0x8800, kind: 'ram', mirror: 0x3800 },
  { name: 'UNMAPPED',  start: 0xc000, end: 0x10000, kind: 'unmapped' },
];

const BY_NAME = new Map(MAP.map((r) => [r.name, r]));

export class Memory {
  constructor() {
    this.ram = new Uint8Array(MEM_SIZE); // backing store for ram/device regions
    this.roms = new Map();               // region name -> Uint8Array
    this.taps = [];                      // { start, end, callback }
    this.handlers = [];                  // { start, end, read, write } (override)
  }

  /** Load ROM bytes for a region (path/file plumbing lives in the caller). */
  loadRom(regionName, data) {
    const region = BY_NAME.get(regionName);
    if (!region || region.kind !== 'rom') throw new Error(`Not a ROM region: ${regionName}`);
    if (data.length > region.end - region.start) {
      throw new Error(`ROM data (${data.length}) too large for ${regionName} (${region.end - region.start})`);
    }
    this.roms.set(regionName, data);
  }

  /**
   * Attach a device handler over an address window, overriding default region
   * behavior. read(addr)->byte and/or write(addr,val). Used by T2.5+ to wire
   * the magic-RAM ALU and other devices.
   */
  setHandler(start, end, read = null, write = null) {
    this.handlers.push({ start, end, read, write });
  }

  /** Register a trace tap: callback(addr, value, type) on any access in range. */
  addTap(start, end, callback) {
    this.taps.push({ start, end, callback });
  }

  _fireTaps(addr, val, type) {
    for (const t of this.taps) {
      if (addr >= t.start && addr < t.end) t.callback(addr, val, type);
    }
  }

  _handlerFor(addr) {
    for (const h of this.handlers) {
      if (addr >= h.start && addr < h.end) return h;
    }
    return null;
  }

  // Resolve an address to its region and physical index (handles mirrors).
  _resolve(addr) {
    for (const r of MAP) {
      if (r.mirror !== undefined) {
        const size = r.end - r.start;              // power of two
        if ((addr & ~(r.mirror | (size - 1))) === r.start) {
          return { region: r, index: addr & (size - 1) };
        }
      } else if (addr >= r.start && addr < r.end) {
        return { region: r, index: addr - r.start };
      }
    }
    return null; // map is total over 0x0000-0xFFFF, so this should not happen
  }

  read8(addr) {
    addr &= 0xffff;
    const h = this._handlerFor(addr);
    if (h && h.read) {
      const v = h.read(addr) & 0xff;
      this._fireTaps(addr, v, 'read');
      return v;
    }
    const loc = this._resolve(addr);
    let v;
    if (loc.region.kind === 'rom') {
      const rom = this.roms.get(loc.region.rom);
      v = rom && loc.index < rom.length ? rom[loc.index] : ROM_UNLOADED_FILL;
    } else if (loc.region.kind === 'unmapped') {
      v = UNMAPPED_FILL;
    } else {
      v = this.ram[loc.region.start + loc.index];
    }
    this._fireTaps(addr, v, 'read');
    return v;
  }

  write8(addr, val) {
    addr &= 0xffff;
    val &= 0xff;
    const h = this._handlerFor(addr);
    if (h && h.write) {
      h.write(addr, val);
      this._fireTaps(addr, val, 'write');
      return;
    }
    const loc = this._resolve(addr);
    // rom and unpopulated swallow writes; ram/device store (folded).
    if (loc.region.kind === 'ram' || loc.region.kind === 'device') {
      this.ram[loc.region.start + loc.index] = val;
    }
    this._fireTaps(addr, val, 'write');
  }

  read16(addr) {
    return this.read8(addr) | (this.read8((addr + 1) & 0xffff) << 8);
  }

  write16(addr, val) {
    this.write8(addr, val & 0xff);
    this.write8((addr + 1) & 0xffff, (val >> 8) & 0xff);
  }
}
