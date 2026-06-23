// PRINT_DIGITS_CORO @0x2a40 -- generator (resumable coroutine) variant of the shipped
// whole-routine port (./print_digits.js). PILOT V3
// (cdoc/pilot-2a40-coroutine-port-workorder.md): prove a long ALWAYS-DECLINE routine can
// run as a pure-JS coroutine that YIELDS at natural seams so interrupts interleave at the
// recorded cadence -- the capability Scope B (core-free build) rests on.
//
// RELATIONSHIP TO THE SHIPPED PORT: this is a faithful, instruction-for-instruction COPY of
// print_digits.js with `yield` checkpoints inserted at seams. It is a SEPARATE file; the
// shipped port + PORT_META are left untouched (work-order hard boundary). The two
// implementations are proven byte-identical by V3a (coroutine, drained, == whole-routine
// port output, all 20 attract invocations) -- yielding does not change the result, because
// 0x2a40 is clean (interrupt-dependency probe: strict deps = 0) so its output is independent
// of exactly when it is preempted.
//
// CYCLE BUDGET (the only place cycle accounting re-enters; coarse, just to PLACE yields):
// the coroutine accumulates the SAME per-step Z80 cost estimate `cyc` the shipped port
// already carries. For 0x2a40 that hand-calibrated table reproduces the core's real cycle
// count for the whole subtree EXACTLY (measured: port `cyc` == recorded own-cycle total,
// diff 0, all 20 invocations), so the budget is exact rather than merely approximate here.
//
// YIELD GRANULARITY: a seam is yielded after the pre-loop CALCULATE_MAGIC call and at the
// END of each digit iteration (per character / per inner-loop iteration). Seams are ATOMIC:
// no sub-PRINT_CHAR resume (not needed -- see work order). Each yield carries the current
// `cyc`; the DRIVER (test / Scope-B machine) compares it to the scheduled interrupt
// boundaries and services the ISR(s) that the budget has crossed. The coroutine itself is
// schedule-agnostic: it only exposes preemptible seams.
//
// WZ caveat: the core models no WZ; entry snapshots carry none. 0x2a40 is clean (no
// WZ-derived flag dependence), so this is NA here -- not fabricated.
import { CALCULATE_MAGIC_IMAGE_RAM_ADDRESS } from './magic_image_addr.js';
import { PRINT_CHAR } from './print_char.js';

const FLAG_KEYS = ['S', 'Z', 'Y', 'H', 'X', 'P', 'N', 'C'];

// Generator: identical computation to PRINT_DIGITS, with `yield { cyc, seam }` at seams.
// Mutates ctx in place exactly as the shipped port does; sets ctx.cycles = cyc at `ret`.
export function* PRINT_DIGITS_CORO(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  let cyc = 0;

  const swapAF = () => {
    const ta = g.a; g.a = g.a_p; g.a_p = ta;
    for (const k of FLAG_KEYS) { const tv = fl[k]; fl[k] = ctx.flags_p[k]; ctx.flags_p[k] = tv; }
  };
  const exDEHL = () => { const d = g.d, e = g.e; g.d = g.h; g.e = g.l; g.h = d; g.l = e; };
  const HL = () => ((g.h << 8) | g.l) & 0xffff;
  const setHL = (v) => { g.h = (v >> 8) & 0xff; g.l = v & 0xff; };
  const DE = () => ((g.d << 8) | g.e) & 0xffff;
  const setDE = (v) => { g.d = (v >> 8) & 0xff; g.e = v & 0xff; };

  cyc += 11;                                       // 2A40 push bc
  const savB = g.b & 0xff, savC = g.c & 0xff;
  g.b = 0x00; cyc += 7;                            // 2A41 ld b,$00
  exDEHL(); cyc += 4;                              // 2A43 ex de,hl   HL = coords
  CALCULATE_MAGIC_IMAGE_RAM_ADDRESS(ctx); cyc += 17 + ctx.cycles; // 2A44 call $29A3 -> HL=addr, A=ctrl
  exDEHL(); cyc += 4;                              // 2A47 ex de,hl   DE=addr, HL=BCD ptr
  swapAF(); cyc += 4;                              // 2A48 ex af,af'  park ctrl byte
  g.b = savB; g.c = savC; cyc += 10;              // 2A49 pop bc
  g.c &= ~0x01; cyc += 8;                          // 2A4A res 0,c

  yield { cyc, seam: 'pre-loop' };                 // SEAM: after CALCULATE_MAGIC, before the digit loop

  do {
    cyc += 4;                                      // 2A4C ld a,b
    const isLast = ((g.b - 1) & 0xff) === 0;       // 2A4D dec a -> Z when B==1
    cyc += 4;
    if (isLast) { cyc += 7; g.c |= 0x01; cyc += 8; } // 2A4E jr nz (not taken) ; 2A50 set 0,c
    else { cyc += 12; }                            // 2A4E jr nz taken
    let a = r8(HL()); cyc += 7;                    // 2A52 ld a,(hl)
    cyc += 8;                                       // 2A53 bit 0,b
    if (g.b & 0x01) {                              // 2A55 jr nz,$2A60 (odd index: lower nibble)
      cyc += 12;
      setHL((HL() + 1) & 0xffff); cyc += 6;        // 2A60 inc hl  (advance to next byte)
    } else {                                       // even index: upper nibble
      cyc += 7;
      a = (a >> 4) & 0x0f; cyc += 32;              // 2A57-2A5D srl a x4
      setHL((HL() - 1) & 0xffff); cyc += 6;        // 2A5F dec hl
      setHL((HL() + 1) & 0xffff); cyc += 6;        // 2A60 inc hl  (net unchanged)
    }
    a &= 0x0f; cyc += 7;                           // 2A61 and $0F
    let ch;
    if (a !== 0) {                                 // 2A63 jr nz,$2A6D
      cyc += 12;
      g.c |= 0x01; cyc += 8;                       // 2A6D set 0,c
      ch = (a + 0x30) & 0xff; cyc += 7;            // 2A6F add a,$30
      cyc += 7;                                    // 2A71 cp $3A
      if (ch < 0x3a) { cyc += 12; }                // 2A73 jr c (digit 0-9)
      else { cyc += 7; ch = (ch + 0x07) & 0xff; cyc += 7; } // 2A75 add a,$07 (A-F)
    } else {                                       // nibble == 0
      cyc += 7;
      cyc += 8;                                    // 2A65 bit 0,c
      if (g.c & 0x01) {                            // 2A67 jr nz,$2A6F (padding disabled -> print '0')
        cyc += 12;
        ch = (0x00 + 0x30) & 0xff; cyc += 7;       // 2A6F add a,$30 -> '0'
        cyc += 7;                                  // 2A71 cp $3A
        cyc += 12;                                 // 2A73 jr c
      } else {                                     // leading: print space
        cyc += 7;
        ch = 0x20; cyc += 7;                       // 2A69 ld a,$20
        cyc += 12;                                 // 2A6B jr $2A77
      }
    }

    // 2A77 push hl ; 2A78 push bc ; 2A79 ld c,a ; 2A7A ex af,af' ; call PRINT_CHAR
    cyc += 11 + 11;
    const pHL = HL(), pB = g.b, pC = g.c;
    g.c = ch & 0xff; cyc += 4;                     // 2A79 ld c,a  (char ordinal)
    swapAF(); cyc += 4;                            // 2A7A ex af,af' (ctrl byte -> live A)
    PRINT_CHAR(ctx); cyc += 17 + ctx.cycles;       // 2A7B call $29DB
    swapAF(); cyc += 4;                            // 2A7E ex af,af'
    g.b = pB; g.c = pC; cyc += 10;                 // 2A7F pop bc
    setHL(pHL); cyc += 10;                         // 2A80 pop hl

    g.a = r8(0x4379); cyc += 13;                   // 2A81 ld a,($4379) FLIP
    const flip = g.a !== 0;                        // 2A84 or a
    fl.Z = g.a === 0 ? 1 : 0; fl.S = (g.a >> 7) & 1; fl.N = 0; fl.H = 0;
    fl.C = 0; fl.P = parity8(g.a); fl.Y = (g.a >> 5) & 1; fl.X = (g.a >> 3) & 1;
    cyc += 4;
    if (flip) { cyc += 12; setDE((DE() - 1) & 0xffff); cyc += 6; } // 2A85 jr nz ; 2A8A dec de
    else { cyc += 7; setDE((DE() + 1) & 0xffff); cyc += 6; cyc += 12; } // 2A87 inc de ; 2A88 jr
    g.b = (g.b - 1) & 0xff;                         // 2A8B djnz
    cyc += (g.b !== 0) ? 13 : 8;

    yield { cyc, seam: 'digit' };                  // SEAM: end of one digit iteration
  } while (g.b !== 0);

  cyc += 10;                                       // 2A8D ret
  ctx.cycles = cyc;
}

function parity8(v) { let p = 1; for (let i = 0; i < 8; i++) p ^= (v >> i) & 1; return p; }

// Drive the coroutine to completion against a SCHEDULE of interrupt boundaries (in
// routine-own cycles). At each seam the driver services every scheduled interrupt the
// budget has now crossed (atomic seam -> "service all interrupts that fell in this seam").
// Returns the seam list and the number of interrupts serviced (the V3b yield count).
//   boundaries: ascending array of own-cycle offsets (the recorded schedule).
// This mirrors the Scope-B driver in cdoc/long-routine-validation-plan.md S5 -- the only
// difference is the schedule source (here: the recorded chain; there: the interrupt
// controller). No ISR is run (work order: drive cadence from the recorded chain).
export function driveCoro(ctx, boundaries) {
  const gen = PRINT_DIGITS_CORO(ctx);
  const seams = [];        // { cyc, seam, servicedHere }
  let serviced = 0, bi = 0;
  let step = gen.next();
  while (!step.done) {
    const { cyc, seam } = step.value;
    let here = 0;
    while (bi < boundaries.length && cyc >= boundaries[bi]) { serviced++; here++; bi++; }
    seams.push({ cyc, seam, servicedHere: here });
    step = gen.next();
  }
  // final flush: any scheduled boundary <= the final cycle total (after `ret`) is serviced
  // at the exit seam. ctx.cycles holds the full total at this point.
  let here = 0;
  while (bi < boundaries.length && ctx.cycles >= boundaries[bi]) { serviced++; here++; bi++; }
  if (here) seams.push({ cyc: ctx.cycles, seam: 'exit', servicedHere: here });
  return { seams, serviced };
}
