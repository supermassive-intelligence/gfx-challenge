/**
 * Deterministic frame scheduler for the Berzerk machine: runs the Z80 in
 * cycle-budgeted slices and raises NMI/IRQ at the documented scanline
 * positions. Cycle-counted only -- never wall-clock -- so two runs from reset
 * are bit-identical (Phase 3/4 reproducibility).
 *
 * Every constant and position is pinned in cdoc/hardware-berzerk.md Section 5
 * (extracted from berzerk.cpp); section numbers are cited per item.
 */

// --- Clocks & frame budget [Section 5.1] ---
export const MASTER_CLOCK = 10_000_000;
export const CPU_CLOCK = MASTER_CLOCK / 4;      // 2.5 MHz
export const PIXEL_CLOCK = MASTER_CLOCK / 2;    // 5 MHz
export const HTOTAL = 0x140;                     // 320
export const VTOTAL = 0x106;                     // 262
export const VBEND = 0x20;                       // 32
export const VBSTART = 0x100;                    // 256
export const CYCLES_PER_SCANLINE = HTOTAL / (PIXEL_CLOCK / CPU_CLOCK); // 160
export const CYCLES_PER_FRAME = CYCLES_PER_SCANLINE * VTOTAL;          // 41920
export const IRQ_VECTOR = 0xfc;                  // [Section 5.4]

// --- vsync chain <-> scanline [Section 5.2] ---
export function vposToVsync(vpos) {
  const v256 = (vpos < VBEND || vpos >= VBSTART) ? 1 : 0;
  let counter = v256 ? (vpos - VBSTART + 0xda) : vpos;
  if (v256 && counter < 0) counter += VTOTAL;
  return { counter: counter & 0xff, v256 };
}

export function vsyncToVpos(counter, v256) {
  let vpos = v256 ? (counter - 0xda + VBSTART) : counter;
  if (v256 && vpos >= VTOTAL) vpos -= VTOTAL;
  return vpos;
}

// --- Trigger tables (counts & v256 are paired columns) [Section 5.3] ---
const IRQ_COUNTS = [0x80, 0xda];
const IRQ_V256 = [0, 1];
const NMI_COUNTS = [0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0, 0xf0];
const NMI_V256 = [0, 0, 0, 0, 0, 0, 0, 1];

function buildEvents() {
  const ev = [];
  for (let i = 0; i < IRQ_COUNTS.length; i++) {
    const vpos = vsyncToVpos(IRQ_COUNTS[i], IRQ_V256[i]);
    ev.push({ type: 'irq', vpos, cycle: vpos * CYCLES_PER_SCANLINE });
  }
  for (let i = 0; i < NMI_COUNTS.length; i++) {
    const vpos = vsyncToVpos(NMI_COUNTS[i], NMI_V256[i]);
    ev.push({ type: 'nmi', vpos, cycle: vpos * CYCLES_PER_SCANLINE });
  }
  ev.sort((a, b) => a.cycle - b.cycle);
  return ev;
}

// Sorted per-frame event table (2 IRQ + 8 NMI). [Section 5.3]
export const FRAME_EVENTS = buildEvents();

export class Scheduler {
  /** cpu: a Z80CPU-like object with step()->cycles, interrupt(nm,data), getState(). */
  constructor(cpu) {
    this.cpu = cpu;
    this.onInterrupt = null; // optional (type, vpos, frame) hook for tracing/tests
    this.onStep = null;      // optional (scheduler) hook fired before each cpu.step()
    this.reset();
  }

  reset() {
    this.irqEnabled = false; // port 0x4F  [Section 5.4]
    this.nmiEnabled = false; // ports 0x4C/0x4D  [Section 5.5]
    this.irqPending = false; // held IRQ line awaiting iff1
    this.frameCycle = 0;     // position within the frame; carries across frames
    this.frameCount = 0;
  }

  // --- Port-driven enables [Section 5.4/5.5] ---
  // port 0x4F. Gates whether a NEW trigger asserts the IRQ line; it does NOT
  // retract an already-held IRQ -- MAME's HOLD_LINE survives irq_enable_w(0),
  // so a pending IRQ is still delivered once iff1 allows. [Section 5.4]
  setIrqEnable(on) { this.irqEnabled = !!on; }
  enableNmi() { this.nmiEnabled = true; }
  disableNmi() { this.nmiEnabled = false; }

  // HARDWARE-NOTE ONLY -- do NOT wire this to the 0x4E read at T2.9. The
  // schematic / address-map comment suggests reading 0x4E clears the pending
  // frame IRQ, but MAME's intercept_v256_r (L496-504) implements NO clear, and
  // we match the oracle (0x3800 precedent in decisions.md). A held IRQ is
  // cleared only by the CPU's interrupt acknowledge (_serviceHeldIrq). This
  // method exists to record the hardware note, not to be called. [Section 5.4]
  ackIrq() { this.irqPending = false; }

  // --- Readable position [Section 5.1/5.2] ---
  vpos() { return Math.floor(this.frameCycle / CYCLES_PER_SCANLINE) % VTOTAL; }
  v256() { return vposToVsync(this.vpos()).v256; }
  vcounter() { return vposToVsync(this.vpos()).counter; }

  // Service a held IRQ once the core will accept it (iff1 set). Returns the
  // cycle cost of the acknowledge (0 if not serviced). [Section 5.4]
  _serviceHeldIrq() {
    if (!this.irqPending || !this.cpu.getState().iff1) return 0;
    const c0 = this.cpu.getState().cycle_counter;
    this.cpu.interrupt(false, IRQ_VECTOR);
    const c1 = this.cpu.getState().cycle_counter;
    this.irqPending = false;
    return c1 - c0;
  }

  // Fire an NMI now (pulse); returns the acknowledge cycle cost. [Section 5.5]
  _fireNmi() {
    const c0 = this.cpu.getState().cycle_counter;
    this.cpu.interrupt(true);
    const c1 = this.cpu.getState().cycle_counter;
    return c1 - c0;
  }

  /** Advance exactly one video frame (CYCLES_PER_FRAME), carrying the overshoot. */
  runFrame(vblankCallback) {
    const target = CYCLES_PER_FRAME;
    let evIdx = 0;
    while (evIdx < FRAME_EVENTS.length && FRAME_EVENTS[evIdx].cycle < this.frameCycle) evIdx++;

    while (this.frameCycle < target) {
      // Raise any events whose cycle offset we've reached.
      while (evIdx < FRAME_EVENTS.length && FRAME_EVENTS[evIdx].cycle <= this.frameCycle) {
        const ev = FRAME_EVENTS[evIdx++];
        if (ev.type === 'nmi' && this.nmiEnabled) {
          this.frameCycle += this._fireNmi();
          if (this.onInterrupt) this.onInterrupt('nmi', ev.vpos, this.frameCount);
        } else if (ev.type === 'irq' && this.irqEnabled) {
          this.irqPending = true; // held until iff1 (5.4)
          if (this.onInterrupt) this.onInterrupt('irq', ev.vpos, this.frameCount);
        }
      }
      this.frameCycle += this._serviceHeldIrq();
      if (this.onStep) this.onStep(this); // PC about to execute (incl. just-serviced IRQ)
      this.frameCycle += this.cpu.step();
    }

    this.frameCount++;
    this.frameCycle -= target; // carry remainder into the next frame
    if (vblankCallback) vblankCallback(this);
  }

  /** Run N frames. */
  runFrames(n, vblankCallback) {
    for (let i = 0; i < n; i++) this.runFrame(vblankCallback);
  }
}
