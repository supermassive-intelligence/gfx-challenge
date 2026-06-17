/**
 * CPU-visible input ports and DIP switches for the Berzerk machine.
 *
 * Every port/field/bit/polarity/default is pinned in cdoc/hardware-berzerk.md
 * Section 6 (extracted from berzerk.cpp INPUT_PORTS_START(berzerk) +
 * BERZERK_COINAGE); section numbers are cited inline. Field names are the
 * canonical names the input-script schema (T3.1) resolves on both platforms,
 * so setField() throws on any unknown name -- that typo guard is load-bearing
 * for T3.1/T3.2 cross-platform replay.
 *
 * Polarity is PER-BIT, not per-port (SW2 mixes active-high service buttons with
 * active-low unused bits). MONITOR_TYPE is intentionally absent: it is a fake
 * MAME config port (video pen weights), never CPU-readable. [Section 6.1]
 */

// BERZERK_COINAGE: all 16 nibble values defined, default 0x00 = 1C/1C. [Section 6.4]
export const COINAGE = {
  '1C/1C': 0x00, '1C/2C': 0x01, '1C/3C': 0x02, '1C/4C': 0x03,
  '1C/5C': 0x04, '1C/6C': 0x05, '1C/7C': 0x06, '1C/10C': 0x07,
  '1 Coin/14 Credits': 0x08, '2C/1C': 0x09, '2C/3C': 0x0a, '2C/5C': 0x0b,
  '2C/7C': 0x0c, '4C/3C': 0x0d, '4C/5C': 0x0e, '4C/7C': 0x0f,
};

const COIN_BANK = () => ({
  COINAGE: { mask: 0x0f, type: 'dip', def: 0x00, settings: COINAGE },
  _UNUSED: { mask: 0xf0, type: 'unused', polarity: 'low' },
});

// Port table. Each field: { mask, type:'input'|'dip'|'unused', polarity?, def?, settings? }.
// [Section 6.1/6.2/6.3]
export const PORTS = {
  P1: { addr: 0x48, fields: {
    LEFT: { mask: 0x01, type: 'input', polarity: 'low' },
    RIGHT: { mask: 0x02, type: 'input', polarity: 'low' },
    UP: { mask: 0x04, type: 'input', polarity: 'low' },
    DOWN: { mask: 0x08, type: 'input', polarity: 'low' },
    BUTTON1: { mask: 0x10, type: 'input', polarity: 'low' },
    _UNUSED: { mask: 0xe0, type: 'unused', polarity: 'low' },
  } },
  SYSTEM: { addr: 0x49, fields: {
    START1: { mask: 0x01, type: 'input', polarity: 'low' },
    START2: { mask: 0x02, type: 'input', polarity: 'low' },
    _UNUSED: { mask: 0x1c, type: 'unused', polarity: 'low' },
    COIN3: { mask: 0x20, type: 'input', polarity: 'low' },
    COIN2: { mask: 0x40, type: 'input', polarity: 'low' },
    COIN1: { mask: 0x80, type: 'input', polarity: 'low' },
  } },
  P2: { addr: 0x4a, fields: {
    LEFT: { mask: 0x01, type: 'input', polarity: 'low' },
    RIGHT: { mask: 0x02, type: 'input', polarity: 'low' },
    UP: { mask: 0x04, type: 'input', polarity: 'low' },
    DOWN: { mask: 0x08, type: 'input', polarity: 'low' },
    BUTTON1: { mask: 0x10, type: 'input', polarity: 'low' },
    _UNUSED: { mask: 0x60, type: 'unused', polarity: 'low' },
    CABINET: { mask: 0x80, type: 'dip', def: 0x80, settings: { Upright: 0x80, Cocktail: 0x00 } },
  } },
  SW2: { addr: 0x65, fields: {
    SERVICE1: { mask: 0x01, type: 'input', polarity: 'high' }, // "Free Game"
    _UNUSED: { mask: 0x7e, type: 'unused', polarity: 'low' },
    SERVICE2: { mask: 0x80, type: 'input', polarity: 'high' }, // "Bookkeeping"
  } },
  F2: { addr: 0x61, fields: {
    COLOR_TEST: { mask: 0x03, type: 'dip', def: 0x00, settings: { Off: 0x00, On: 0x03 } },
    _UNUSED: { mask: 0x3c, type: 'unused', polarity: 'low' },
    BONUS_LIFE: { mask: 0xc0, type: 'dip', def: 0xc0,
      settings: { '5000 and 10000': 0xc0, '5000': 0x40, '10000': 0x80, None: 0x00 } },
  } },
  F3: { addr: 0x60, fields: {
    INPUT_TEST_MODE: { mask: 0x01, type: 'dip', def: 0x00, settings: { Off: 0x00, On: 0x01 } },
    CROSSHAIR_PATTERN: { mask: 0x02, type: 'dip', def: 0x00, settings: { Off: 0x00, On: 0x02 } },
    _UNUSED: { mask: 0x3c, type: 'unused', polarity: 'low' },
    LANGUAGE: { mask: 0xc0, type: 'dip', def: 0x00,
      settings: { English: 0x00, German: 0x40, French: 0x80, Spanish: 0xc0 } },
  } },
  F4: { addr: 0x64, fields: COIN_BANK() },
  F5: { addr: 0x63, fields: COIN_BANK() },
  F6: { addr: 0x62, fields: COIN_BANK() },
};

const ADDR_TO_PORT = {};
for (const [name, p] of Object.entries(PORTS)) ADDR_TO_PORT[p.addr] = name;

export class Input {
  /** dipOverrides: { PortName: { FieldName: value|settingName } }, optional. */
  constructor(dipOverrides = {}) {
    this.pressed = {}; // pressed[port][field] = bool
    this.dips = {};    // dips[port][field] = numeric value at its bit positions
    for (const [pn, p] of Object.entries(PORTS)) {
      this.pressed[pn] = {};
      this.dips[pn] = {};
      for (const [fn, f] of Object.entries(p.fields)) {
        if (f.type === 'input') this.pressed[pn][fn] = false;
        else if (f.type === 'dip') this.dips[pn][fn] = f.def; // factory default [Section 6.3]
      }
    }
    for (const [pn, fields] of Object.entries(dipOverrides)) {
      for (const [fn, val] of Object.entries(fields)) this.setField(pn, fn, val);
    }
  }

  _field(portName, fieldName) {
    const p = PORTS[portName];
    if (!p) throw new Error(`Unknown input port: ${portName}`);
    const f = p.fields[fieldName];
    if (!f || f.type === 'unused') {
      throw new Error(`Unknown field "${fieldName}" on port ${portName}`);
    }
    return f;
  }

  /** Set an input field (value truthy = pressed) or a DIP (value = setting name or masked number). */
  setField(portName, fieldName, value) {
    const f = this._field(portName, fieldName);
    if (f.type === 'input') {
      this.pressed[portName][fieldName] = !!value;
      return;
    }
    // DIP: accept a setting name or a numeric value confined to the field mask.
    let v;
    if (typeof value === 'string') {
      if (!(value in f.settings)) {
        throw new Error(`Unknown setting "${value}" for ${portName}.${fieldName}`);
      }
      v = f.settings[value];
    } else {
      if ((value & ~f.mask) !== 0) {
        throw new Error(`Value 0x${(value >>> 0).toString(16)} exceeds mask `
          + `0x${f.mask.toString(16)} for ${portName}.${fieldName}`);
      }
      v = value & f.mask;
    }
    this.dips[portName][fieldName] = v;
  }

  /** Compose the 8-bit value the CPU reads from a named port. [Section 6.2] */
  readPort(portName) {
    const p = PORTS[portName];
    if (!p) throw new Error(`Unknown input port: ${portName}`);
    let v = 0;
    for (const [fn, f] of Object.entries(p.fields)) {
      if (f.type === 'dip') {
        v |= this.dips[portName][fn] & f.mask;
      } else if (f.type === 'unused') {
        if (f.polarity === 'low') v |= f.mask; // unused active-low reads 1
      } else { // input
        const pressed = this.pressed[portName][fn];
        if (f.polarity === 'low') { if (!pressed) v |= f.mask; }
        else if (pressed) v |= f.mask;
      }
    }
    return v & 0xff;
  }

  /** Read by I/O address, honoring the 0x18 mirror on the 0x60-0x67 block. [Section 6.1] */
  readAddress(addr) {
    addr &= 0xff;
    const base = (addr >= 0x60 && addr <= 0x7f) ? (addr & ~0x18) : addr;
    const name = ADDR_TO_PORT[base];
    if (!name) throw new Error(`No input port at address 0x${addr.toString(16)}`);
    return this.readPort(name);
  }
}
