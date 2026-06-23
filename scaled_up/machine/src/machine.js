/**
 * Berzerk machine: composes CPU + memory + video + scheduler + input + sound.
 * This is the Phase-2 integration point (T2.9).
 *
 * Memory windows route to Video (which owns the VRAM/color backing store):
 *   0x4000-0x5FFF VRAM, 0x6000-0x7FFF Magic RAM, 0x8000-0xBFFF Color RAM
 *   (color mirror 0x3800). [hardware-berzerk.md §2/§4]
 * I/O ports route per §3/§5. The scheduler stays wall-clock-free; a shell
 * (T2.9 browser, or the headless test) paces runFrame().
 */

import { Z80CPU } from './cpu/z80.js';
import { Memory } from './memory.js';
import { Video } from './video.js';
import { Scheduler } from './scheduler.js';
import { Input } from './input.js';
import { Sound, SilentBackend } from './sound.js';
import { makePortHook } from './port-hook.js';

export class Machine {
  constructor({ audioBackend, dipOverrides } = {}) {
    this.memory = new Memory();
    this.video = new Video();
    this.input = new Input(dipOverrides);
    this.sound = new Sound(audioBackend || new SilentBackend());

    // VRAM / Magic RAM / Color RAM windows -> Video backing store. [§2/§4]
    this.memory.setHandler(0x4000, 0x6000,
      (a) => this.video.readVram(a - 0x4000),
      (a, v) => this.video.writeVram(a - 0x4000, v));
    this.memory.setHandler(0x6000, 0x8000,
      (a) => this.video.readMagic(a - 0x6000),
      (a, v) => this.video.writeMagic(a - 0x6000, v));
    this.memory.setHandler(0x8000, 0xc000, // color + 0x3800 mirror (readColor folds)
      (a) => this.video.readColor(a - 0x8000),
      (a, v) => this.video.writeColor(a - 0x8000, v));

    this.cpu = new Z80CPU({
      readByte: (a) => this.memory.read8(a),
      writeByte: (a, v) => this.memory.write8(a, v),
      readPort: (p) => this._ioRead(p),
      writePort: (p, v) => this._ioWrite(p, v),
    });
    this.scheduler = new Scheduler(this.cpu);
  }

  // I/O reads. Global port mask is 0xFF. [§3]
  _ioRead(port) {
    port &= 0xff;
    if (port >= 0x40 && port <= 0x47) return port === 0x44 ? this.sound.readStatus() : 0xff;
    if (port === 0x48 || port === 0x49 || port === 0x4a) return this.input.readAddress(port);
    if (port === 0x4c) { this.scheduler.enableNmi(); return 0; }  // read side-effect [§5.5]
    if (port === 0x4d) { this.scheduler.disableNmi(); return 0; } // read side-effect [§5.5]
    if (port === 0x4e) return this.video.readIntercept(this.scheduler.v256()); // [§4.4/§5.2]
    const base = port & ~0x18; // 0x60-0x7f DIP/LED mirror fold [§6.1]
    if (base >= 0x60 && base <= 0x65) return this.input.readAddress(port);
    if (base === 0x66 || base === 0x67) return 0; // LED reads (state side-effect; value 0)
    return 0xff;
  }

  // I/O writes. [§3/§5]
  _ioWrite(port, data) {
    port &= 0xff;
    data &= 0xff;
    if (port >= 0x40 && port <= 0x47) { this.sound.writePort(port, data); return; }
    if (port === 0x4b) { this.video.writeControl(data); return; }   // Magic RAM control [§4.2]
    if (port === 0x4c) { this.scheduler.enableNmi(); return; }       // [§5.5]
    if (port === 0x4d) { this.scheduler.disableNmi(); return; }      // [§5.5]
    if (port === 0x4f) { this.scheduler.setIrqEnable(data & 1); return; } // [§5.4]
    // 0x66/0x67 LED writes and DIP-range writes: ignored.
  }

  /** Install the T9.1 port-dispatch hook so registered JS ports (machine/ports/)
   *  run in place of their Z80 routines at CALL targets. Off by default; opt-in so
   *  the un-hooked machine remains the reference. Pass custom maps for tests. */
  installPortHooks(ports, meta) {
    this.cpu.installPortHook(makePortHook(ports, meta, this.scheduler));
  }

  /** Load assembled program ROM data: { ROM0: Uint8Array, ROM_MAIN: Uint8Array }. */
  loadRoms(romData) {
    this.memory.loadRom('ROM0', romData.ROM0);
    this.memory.loadRom('ROM_MAIN', romData.ROM_MAIN);
  }

  reset() {
    this.cpu.reset();   // Z80 reset -> pc=0x0000
    this.video.reset();
    this.scheduler.reset();
  }

  /** Advance one video frame; vblankCallback(machine) fires at frame end. */
  runFrame(vblankCallback) {
    this.scheduler.runFrame(() => { if (vblankCallback) vblankCallback(this); });
  }

  /** Convenience: rasterize the current frame to an RGBA buffer (256x224x4). */
  renderToRGBA(buf) {
    return this.video.renderToRGBA(buf);
  }

  /** Apply an input field (keyboard shell / input-script player call this). */
  setInput(port, field, value) {
    this.input.setField(port, field, value);
  }
}
