/**
 * Thin, swappable adapter over the vendored Z80 core (DrGoldfire/Z80.js).
 *
 * The core itself is untouched logic (src/cpu/z80_core.js). This adapter is
 * the ONLY machine-facing surface: it wires the machine's memory/IO callbacks
 * to the core's required {mem_read, mem_write, io_read, io_write} object and
 * exposes the per-instruction step + register access the rest of the machine
 * and the validation tools rely on. Swapping cores means rewriting this file.
 *
 * Callbacks (constructor argument):
 *   readByte(addr)        -> byte
 *   writeByte(addr, val)
 *   readPort(port)        -> byte
 *   writePort(port, val)
 */

import { Z80 } from './z80_core.js';

export class Z80CPU {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.core = new Z80({
      mem_read: (addr) => callbacks.readByte(addr & 0xffff) & 0xff,
      mem_write: (addr, val) => callbacks.writeByte(addr & 0xffff, val & 0xff),
      io_read: (port) => callbacks.readPort(port & 0xffff) & 0xff,
      io_write: (port, val) => callbacks.writePort(port & 0xffff, val & 0xff),
    });
    this.core.reset();
  }

  /** Execute one instruction (incl. prefixes/interrupt handling). Returns cycles. */
  step() {
    return this.core.run_instruction();
  }

  reset() {
    this.core.reset();
  }

  /** Raise an interrupt line. nonMaskable=true -> NMI; otherwise maskable IRQ with data bus byte. */
  interrupt(nonMaskable, data) {
    this.core.interrupt(nonMaskable, data);
  }

  /** Full core state passthrough (used by the SingleStepTests runner). */
  getState() {
    return this.core.getState();
  }

  setState(state) {
    this.core.setState(state);
  }

  // --- Register convenience accessors (used by run_zex.js CP/M shim) ---
  get pc() { return this.core.getState().pc; }
  set pc(v) { const s = this.core.getState(); s.pc = v & 0xffff; this.core.setState(s); }

  get sp() { return this.core.getState().sp; }
  set sp(v) { const s = this.core.getState(); s.sp = v & 0xffff; this.core.setState(s); }

  get c() { return this.core.getState().c; }
  get e() { return this.core.getState().e; }
  get d() { return this.core.getState().d; }
  get de() { const s = this.core.getState(); return (s.d << 8) | s.e; }
}
