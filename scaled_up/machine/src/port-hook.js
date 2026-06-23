// port-hook.js -- T9.1: live dispatch of ported JS routines (CALL-target replacement).
//
// Goal: when the Z80's PC reaches a registered CALL target, run the JS port from
// machine/ports/ IN PLACE OF the Z80 routine, applying its effects to the LIVE
// machine (shared memory + I/O), then return as if the routine executed `ret`
// (pop the return address into PC, sp += 2). The Z80 core executes everything
// else. One implementation, two callers: the SAME port(ctx) functions the T8.1
// bench runs are driven here through the SAME ctx.{regs,flags,mem,io} interface --
// only the backing of ctx differs (here it is the live core state + live memory/
// IO callbacks; in the bench it is a mock memory + scripted IO FIFO).
//
// CYCLE ACCOUNTING (the load-bearing decision):
//   A native JS port executes in ZERO Z80 cycles. If we advanced the scheduler by
//   0, interrupt cadence would shift: the V256/interrupt-phase entropy (T5.1/T5.2)
//   is timing-locked, so fewer charged cycles => interrupts land at different beam
//   positions => the machine diverges from its own un-hooked behaviour. So the
//   dispatcher charges the DISPLACED routine's own cycle cost -- the heavy-trace
//   `cycle_count` (entry instruction through `ret` inclusive, T4.1 schema). For
//   RANDOM @0x2678 that is 140 (push hl;ld hl,(nn);ld d,h;ld e,l;add hl,hl;
//   add hl,de;add hl,hl;add hl,de;ld de,nn;add hl,de;ld (nn),hl;ld a,h;pop hl;ret
//   = 11+16+4+4+11+11+11+11+10+11+16+4+10+10), and matches the captured `cycles`
//   field of every RANDOM test-plan record. The dispatcher returns this count to
//   the scheduler exactly as cpu.step() would, so frame timing is conserved.
//
//   GRANULARITY (the subtle part): the displaced cycles would be charged
//   ATOMICALLY (one step), whereas the real routine crosses ~14 instruction
//   boundaries at which the scheduler checks for interrupts. If an interrupt
//   event lands STRICTLY inside the displaced window, the real routine services
//   it mid-routine (at one beam position) but an atomic charge would service it
//   after the routine (at a ~1-scanline-later beam position) -- and the ISR reads
//   V256 (port 0x4E bit0), so that shift perturbs the entropy phase (T5.1/T5.2),
//   the counter 0x089F, the LCG seed 0x435C, and downstream object placement.
//   Measured: it diverges (attract frame 2090, 2 visible bytes) if charged blindly.
//   RESOLUTION: fast-path ONLY when no interrupt event splits the window
//   (scheduler.eventWithin). When one does, DECLINE -- return null so the Z80 core
//   runs the real routine for that call, which is byte-identical to un-hooked by
//   construction. When none does, atomic charging is provably identical to the 14
//   sub-steps (same total cycles, no interrupt between them, RANDOM bit-exact), so
//   the machine's own output is unchanged. This makes the hook transparent.
//
// STACK OVERLAPS VRAM (the other subtle part):
//   Berzerk's stack lives inside the 0x4000-0x5FFF screen RAM (observed sp ~0x42xx).
//   A routine's `push` therefore SCRIBBLES its saved register onto VRAM -- transient
//   noise the real machine and MAME both produce (the golden gate matched it). A
//   register-only port skips the push, so without replaying it the hooked machine
//   diverges from un-hooked by exactly those bytes (measured: attract frame 2090,
//   bytes 0x42f0/0x42f1 = HL of RANDOM's `push hl`). So the hook REPLAYS each
//   routine's entry pushes (PORT_META.pushes) through live memory. The pop/ret only
//   read, so the sole observable memory effect of the stack frame is the push bytes;
//   `push X ... pop X; ret` leaves net sp = entry_sp + 2, which the RET below sets.

import { PORTS, PORT_META } from '../ports/index.js';

const FLAG_KEYS = ['S', 'Z', 'Y', 'H', 'X', 'P', 'N', 'C'];

function composeF(fl) {
  return ((fl.S & 1) << 7) | ((fl.Z & 1) << 6) | ((fl.Y & 1) << 5) | ((fl.H & 1) << 4) |
         ((fl.X & 1) << 3) | ((fl.P & 1) << 2) | ((fl.N & 1) << 1) | (fl.C & 1);
}

// 16-bit register value from a getState snapshot, by push mnemonic. A numeric
// entry is a LITERAL residue value (e.g. an inner `call`'s return address that the
// real routine transiently pushes onto the VRAM-overlapping stack); see PORT_META.
function reg16(st, name) {
  if (typeof name === 'number') return name & 0xffff;
  switch (name) {
    case 'hl': return ((st.h << 8) | st.l) & 0xffff;
    case 'de': return ((st.d << 8) | st.e) & 0xffff;
    case 'bc': return ((st.b << 8) | st.c) & 0xffff;
    case 'af': return ((st.a << 8) | composeF(st.flags)) & 0xffff;
    case 'ix': return st.ix & 0xffff;
    case 'iy': return st.iy & 0xffff;
    default: throw new Error(`port-hook: unknown push register '${name}'`);
  }
}

// Build the port ctx from the live core state + the machine's mem/IO callbacks.
// Identical shape to tools/bench.js buildCtx() so a port cannot tell the two
// callers apart. `st` is a snapshot from cpu.getState(); mutations land back via
// applyCtx(). mem/io go straight to the LIVE callbacks (shared memory, T2.4).
function buildLiveCtx(st, cb) {
  const r = st;
  const regs = {
    a: r.a, b: r.b, c: r.c, d: r.d, e: r.e, h: r.h, l: r.l, ix: r.ix, iy: r.iy,
    a_p: r.a_prime, b_p: r.b_prime, c_p: r.c_prime, d_p: r.d_prime,
    e_p: r.e_prime, h_p: r.h_prime, l_p: r.l_prime,
  };
  const flags = {}, flags_p = {};
  for (const k of FLAG_KEYS) { flags[k] = r.flags[k]; flags_p[k] = r.flags_prime[k]; }
  const mem = {
    r8: (a) => cb.readByte(a & 0xffff) & 0xff,
    w8: (a, v) => cb.writeByte(a & 0xffff, v & 0xff),
    r16: (a) => (cb.readByte(a & 0xffff) & 0xff) | ((cb.readByte((a + 1) & 0xffff) & 0xff) << 8),
    w16: (a, v) => { cb.writeByte(a & 0xffff, v & 0xff); cb.writeByte((a + 1) & 0xffff, (v >> 8) & 0xff); },
  };
  const io = {
    in: (p) => cb.readPort(p & 0xff) & 0xff,
    out: (p, v) => cb.writePort(p & 0xff, v & 0xff),
  };
  return { regs, flags, flags_p, mem, io };
}

// Write the port's register/flag results back into the state snapshot in place.
// sp/pc/i/r are NOT touched here (the RET below owns sp/pc; i/r are untouched --
// r is interrupt-refresh, not load-bearing and never read by Berzerk, T5.1).
function applyCtx(st, ctx) {
  const g = ctx.regs;
  st.a = g.a & 0xff; st.b = g.b & 0xff; st.c = g.c & 0xff; st.d = g.d & 0xff;
  st.e = g.e & 0xff; st.h = g.h & 0xff; st.l = g.l & 0xff;
  st.ix = g.ix & 0xffff; st.iy = g.iy & 0xffff;
  st.a_prime = g.a_p & 0xff; st.b_prime = g.b_p & 0xff; st.c_prime = g.c_p & 0xff;
  st.d_prime = g.d_p & 0xff; st.e_prime = g.e_p & 0xff; st.h_prime = g.h_p & 0xff;
  st.l_prime = g.l_p & 0xff;
  for (const k of FLAG_KEYS) { st.flags[k] = ctx.flags[k] & 1; st.flags_prime[k] = ctx.flags_p[k] & 1; }
}

/**
 * Build a dispatch function for installation into a Z80CPU (cpu.installPortHook).
 * Returns dispatch(pc, cpu) -> cycles to charge, or null to fall through to the
 * core. When a port runs, it returns the displaced routine's cycle cost so the
 * scheduler charges it exactly as it would a real cpu.step().
 *
 * @param {Map<string,Function>} [ports]   entry_pc("0x2678") -> port fn
 * @param {Map<string,object>}   [meta]    entry_pc -> { cycles, maxCycles?,
 *   pushes:[reg-name|literal,...] } -- pushes entries are register names (entry
 *   pushes) or numbers (inner-call return-address residue on the VRAM stack).
 * @param {object} [scheduler]  scheduler with eventWithin(cycles); when provided,
 *   a call whose displaced window an interrupt would split is declined (core runs
 *   it) so the hook stays byte-transparent. Without it, every registered call is
 *   fast-pathed (correct only for routines never interrupt-split -- tests/bench).
 */
export function makePortHook(ports = PORTS, meta = PORT_META, scheduler = null) {
  return function dispatch(pc, cpu) {
    const key = '0x' + (pc & 0xffff).toString(16);
    const port = ports.get(key);
    if (!port) return null;                       // not registered -> core runs it
    const m = meta.get(key) || {};
    const baseCost = m.cycles ?? 0;
    // The interrupt-decline gate must use the routine's WORST-CASE cost. A
    // branching routine's real cost is path-dependent (e.g. `ret z` taken vs not);
    // the port reports the actual taken-path cost via ctx.cycles below, but we do
    // not know it until the port runs. Gate on maxCycles (>= every path's cost) so
    // we decline whenever an interrupt could split ANY path -- safe because actual
    // cost <= gate, so a fast-path here provably has no interrupt within its window.
    const gate = m.maxCycles ?? baseCost;
    if (scheduler && scheduler.eventWithin(gate)) return null;
    const cb = cpu.callbacks;
    const st = cpu.getState();
    const entrySp = st.sp & 0xffff;
    const ctx = buildLiveCtx(st, cb);
    // retAddr = the return address the CALL pushed (mem at entry sp). Inline-param
    // routines (e.g. 0x3657 COLOUR_FILL, 0x297b PRINT_STRING) read constant bytes
    // that follow the `call` AT this address, then resume PAST them -- so the port
    // needs it both to fetch its inline data and to compute its resume PC.
    ctx.retAddr = (cb.readByte(entrySp) | (cb.readByte((entrySp + 1) & 0xffff) << 8)) & 0xffff;
    port(ctx);                                    // SAME function the bench runs
    // A port may set ctx.cycles to the exact cost of the path it took (branching
    // routines); otherwise the straight-line base cost applies.
    const cost = (ctx.cycles != null) ? (ctx.cycles | 0) : baseCost;
    applyCtx(st, ctx);                            // register/flag write-back
    // Capture push residue from the OUTPUT register bank (post write-back). For a
    // balanced `push X ... pop X` frame the residue byte left on the VRAM-overlapping
    // stack equals X at push time, and the matching `pop X` restores exactly that into
    // X -- so residue == X_out. Reading the output bank is therefore correct in general
    // and necessary when X is pushed AFTER the routine modifies it (PRINT_CHAR pushes
    // `af` after an ADD HL chain, so the residue F-byte is f_out, not f_in). For every
    // previously-ported routine X_out == X_in (they push registers they do not change),
    // so this is identical to the old entry-bank capture; numeric literals are bank-
    // independent. See decisions.md 2026-06-18 (post-port push capture).
    const pushVals = (m.pushes || []).map((name) => reg16(st, name));
    // Replay entry pushes into LIVE memory (stack overlaps VRAM -- see header).
    // push X: (sp-1)=hi, (sp-2)=lo, sp-=2 -- descending, in push order.
    let sp = entrySp;
    for (const v of pushVals) {
      cb.writeByte((sp - 1) & 0xffff, (v >> 8) & 0xff);
      cb.writeByte((sp - 2) & 0xffff, v & 0xff);
      sp = (sp - 2) & 0xffff;
    }
    // RETURN MODEL. Default: matched pop/ret leave net sp = entrySp + 2; the return
    // address sits at entrySp (the pushes above were balanced by the pops). Two
    // port-signalled extensions handle routines whose real control flow is not a
    // plain single `ret`:
    //
    //   ctx.framesToDrop = N  -- the routine drops N EXTRA return words before its
    //     final `ret` (a non-local return to an ancestor N levels up, via `pop`s).
    //     0x15cb BOLT_VS_ACTOR does `pop hl; ret` on success (N=1): it discards its
    //     own caller's return address and returns to the grandparent. Effect:
    //     pc = mem[entrySp + 2N], sp = entrySp + 2 + 2N. Its early-exit `ret z/m/nc`
    //     paths are normal single returns (N=0). The port sets framesToDrop per path.
    //
    //   ctx.returnPc = ADDR  -- the routine resumes at an absolute address the port
    //     computed, not at the word on the stack. Inline-parameter routines do this:
    //     0x297b PRINT_STRING ends `inc hl; jp (hl)` to a computed address PAST a
    //     variable-length inline string; 0x3657 COLOUR_FILL returns to retAddr+5
    //     (5 inline constant bytes consumed). sp nets to entrySp + 2 (one frame).
    //     Takes precedence over framesToDrop (an inline-param routine pops exactly
    //     one frame; its resume PC is explicit, not stack-sourced).
    const drop = (ctx.framesToDrop | 0);
    if (ctx.returnPc != null) {
      st.pc = ctx.returnPc & 0xffff;
      st.sp = (entrySp + 2) & 0xffff;
    } else {
      const base = (entrySp + 2 * drop) & 0xffff;   // the word we return THROUGH
      const lo = cb.readByte(base) & 0xff;
      const hi = cb.readByte((base + 1) & 0xffff) & 0xff;
      st.pc = (lo | (hi << 8)) & 0xffff;
      st.sp = (base + 2) & 0xffff;
    }
    cpu.setState(st);
    return cost;                                  // charge displaced cycles
  };
}
