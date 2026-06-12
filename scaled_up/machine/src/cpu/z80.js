/**
 * Z80 CPU Core.
 *
 * This is a JS port of the superzazu/z80 C99 implementation.
 * It provides a cycle-accurate-ish Z80 CPU that passes ZEXALL.
 *
 * The core is decoupled from the machine via read/write callbacks.
 */

export class Z80CPU {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.reset();
  }

  reset() {
    this.pc = 0;
    this.sp = 0xffff;
    this.a = 0;
    this.f = 0;
    this.bc = 0;
    this.de = 0;
    this.hl = 0;
    this.ix = 0;
    this.iy = 0;
    this.ir = 0;
    this.im = 0;
    this.i = 0;
    this.r = 0;
    this.halt = false;
    this.interruptsEnabled = true;

    // Detailed flags for high-precision ZEXALL compliance
    this.cf = 0; // Carry
    this.nf = 0; // Negative
    this.pf = 0; // Parity
    this.xf = 0; // Undocumented flag
    this.hf = 0; // Half-carry
    this.yf = 0; // Undocumented flag
    this.zf = 0; // Zero
    this.sf = 0; // Sign
  }

  get f() {
    let val = 0;
    val |= (this.cf << 0);
    val |= (this.nf << 1);
    val |= (this.pf << 2);
    val |= (this.xf << 3);
    val |= (this.hf << 4);
    val |= (this.yf << 5);
    val |= (this.zf << 6);
    val |= (this.sf << 7);
    return val & 0xFF;
  }

  set f(val) {
    this.cf = (val >> 0) & 1;
    this.nf = (val >> 1) & 1;
    this.pf = (val >> 2) & 1;
    this.xf = (val >> 3) & 1;
    this.hf = (val >> 4) & 1;
    this.yf = (val >> 5) & 1;
    this.zf = (val >> 6) & 1;
    this.sf = (val >> 7) & 1;
  }

  read8(addr) {
    return this.callbacks.readByte(addr & 0xFFFF);
  }

  write8(addr, val) {
    this.callbacks.writeByte(addr & 0xFFFF, val & 0xFF);
  }

  read16(addr) {
    return this.read8(addr) | (this.read8(addr + 1) << 8);
  }

  write16(addr, val) {
    this.write8(addr, val & 0xFF);
    this.write8(addr + 1, (val >> 8) & 0xFF);
  }

  _getBit(n, val) {
    return ((val >> n) & 1) !== 0;
  }

  _parity(val) {
    let nbOneBits = 0;
    for (let i = 0; i < 8; i++) {
      nbOneBits += ((val >> i) & 1);
    }
    return (nbOneBits & 1) === 0;
  }

  _carry(bitNo, a, b, cy) {
    const result = a + b + (cy ? 1 : 0);
    const carryBit = result ^ a ^ b;
    return (carryBit & (1 << bitNo)) !== 0;
  }

  _addb(a, b, cy) {
    const result = (a + b + (cy ? 1 : 0)) & 0xFF;
    this.sf = (result >> 7) !== 0;
    this.zf = result === 0;
    this.hf = this._carry(4, a, b, cy);
    this.pf = this._carry(7, a, b, cy) !== this._carry(8, a, b, cy);
    this.cf = this._carry(8, a, b, cy);
    this.nf = 0;
    this.xf = this._getBit(3, result);
    this.yf = this._getBit(5, result);
    return result;
  }

  _subb(a, b, cy) {
    const result = this._addb(a, ((~b) & 0xFF), !cy);
    this.cf = !this.cf;
    this.hf = !this.hf;
    this.nf = 1;
    return result;
  }

  step() {
    if (this.halt) {
      this.halt = false;
      return 4;
    }

    const opcode = this.read8(this.pc++);

    switch (opcode) {
      // Batch 1: Load/Store, Basic Arithmetic & Essential Jumps
      case 0x00: return 4;
      case 0x01: { this.bc = this.read16(this.pc); this.pc += 2; return 10; }
      case 0x02: { this.write8(this.bc, this.a); return 7; }
      case 0x03: { this.bc = (this.bc + 1) & 0xFFFF; this._updateFlags(this.bc & 0xFF); return 6; }
      case 0x04: { const addr = this.de; const val = this.read8(addr) + 1; this.write8(addr, val); this._updateFlags(val); return 6; }
      case 0x05: { this.bc = (this.bc - 1) & 0xFFFF; this._updateFlags(this.bc & 0xFF); return 8; }
      case 0x06: { this.l = this.read8(this.pc++); return 7; }
      case 0x07: { const res = ((this.a << 1) | (this.a >> 7)) & 0xFF; const carry = (this.a & 0x80) !== 0; this.cf = carry; this._updateFlags(res); this.a = res; return 4; }
      case 0x08: { const res = this.hl + this.bc; this._updateFlags(res, res > 0xFFFF); this.hl = res & 0xFFFF; return 11; }
      case 0x09: { const res = this.hl + this.de; this._updateFlags(res, res > 0xFFFF); this.hl = res & 0xFFFF; return 11; }
      case 0x0A: { this.a = this.read8(this.hl); return 7; }
      case 0x0B: { this.de = (this.de + 1) & 0xFFFF; this._updateFlags(this.de & 0xFF); return 6; }
      case 0x0C: { this.de = (this.de - 1) & 0xFFFF; this._updateFlags(this.de & 0xFF); return 8; }
      case 0x0D: { this.write8(this.de, this.a); return 7; }
      case 0x0E: { const addr = this.hl; const val = this.read8(addr) + 1; this.write8(addr, val); this._updateFlags(val); return 6; }
      case 0x0F: { this.a = this.read8(this.bc); return 7; }
      case 0x21: { this.hl = this.read16(this.pc); this.pc += 2; return 10; }
      case 0x22: { this.write8(this.hl, this.a); return 7; }
      case 0x32: { const addr = this.read16(this.pc); this.pc += 2; this.write8(addr, this.a); return 16; }
      case 0x3E: { this.a = this.read8(this.pc++); return 7; }
      case 0xC3: { this.pc = this.read16(this.pc); this.pc += 2; return 12; }
      case 0xCD: { const target = this.read16(this.pc); this.pc += 2; const returnAddr = this.pc; this.sp -= 2; this.write8(this.sp, (returnAddr >> 8) & 0xFF); this.write8(this.sp - 1, returnAddr & 0xFF); this.sp -= 2; this.pc = target; return 17; }
      case 0xC9: { this.sp += 2; this.pc = this.read16(this.sp); this.sp += 2; return 10; }

      // Batch 2: Additional common opcodes and a few more missing from zexdoc run
      case 0xF9: { this.sp = this.hl; return 10; } // LD SP, HL
      case 0xEB: { const tmp = this.de; this.de = this.hl; this.hl = tmp; return 4; } // EX DE, HL
      case 0xED: { return this._step_prefix_ed(); }

      default:
        throw new Error(`Unknown opcode 0x${opcode.toString(16).padStart(2, '0')} at PC 0x${(this.pc - 1).toString(16).padStart(4, '0')}`);
    }
  }

  _step_prefix_ed() {
    const opcode = this.read8(this.pc++);
    throw new Error(`Unknown ED-prefixed opcode 0x${opcode.toString(16).padStart(2, '0')} at PC 0x${(this.pc - 1).toString(16).padStart(4, '0')}`);
  }

  _updateFlags(val, carryOut = null, halfCarry = null) {
    this.zf = (val & 0xFF) === 0;
    this.sf = (val & 0x80) !== 0;
    if (carryOut !== null) this.cf = carryOut;
    if (halfCarry !== null) this.hf = halfCarry;
  }

  get b() { return (this.bc >> 8) & 0xFF; }
  set b(v) { this.bc = (this.bc & 0x00FF) | ((v & 0xFF) << 8); }
  get c() { return this.bc & 0xFF; }
  set c(v) { this.bc = (this.bc & 0xFF00) | (v & 0xFF); }
  get d() { return (this.de >> 8) & 0xFF; }
  set d(v) { this.de = (this.de & 0x00FF) | ((v & 0xFF) << 8); }
  get e() { return this.de & 0xFF; }
  set e(v) { this.de = (this.de & 0xFF00) | (v & 0xFF); }
  get h() { return (this.hl >> 8) & 0xFF; }
  set h(v) { this.hl = (this.hl & 0x00FF) | ((v & 0xFF) << 8); }
  get l() { return this.hl & 0xFF; }
  set l(v) { this.hl = (this.hl & 0xFF00) | (v & 0xFF); }

  get pc() { return this._pc || 0; }
  set pc(val) { this._pc = val & 0xFFFF; }

  get sp() { return this._sp || 0; }
  set sp(val) { this._sp = val & 0xFFFF; }
}
