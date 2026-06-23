// BOLT_HIT_SCAN @0x15a0 -- scan the actor list, testing each actor against the bolt
// (IY) for a box overlap via BOLT_VS_ACTOR_COLLISION (0x15cb, ported). Non-leaf
// composite: composes 0x15cb once for the head actor ($0876), then once per actor in
// the circular list at ($0870), advancing through each actor's back-link at
// (actor-1):(actor-2) until the link wraps to the list head.
//
// NON-LOCAL RETURN (the wrinkle): 0x15cb does `pop hl; ret` on a HIT (its
// framesToDrop=1) -- it discards the inner `call $15cb` return address (0x15ab for the
// head call / 0x15b9 for the loop call) and returns STRAIGHT to 0x15a0's caller. We
// compose 0x15cb as a JS call, so:
//   * before each inner call we point ctx.retAddr at THAT call's return address, so
//     0x15cb's `pop hl` loads the value the real machine loads (HL_out = 0x15ab|0x15b9);
//   * on the hit signal we STOP the scan and let 0x15a0's OWN hook return normally.
// From the hook's view a hit and a clean loop-exit return to the SAME place
// (mem[entrySp]): the inner non-local ret and 0x15a0's own `ret` both land at 0x15a0's
// caller, because the hooked 0x15a0 never pushed the inner `call` frame. So 0x15a0's
// framesToDrop is 0 either way -- we clear the inner's signal before returning.
//
// CYCLES: path-dependent (port sets exact ctx.cycles = 0x15a0 overhead + each inner
// 0x15cb's reported cost). Measured over the 5 regression scripts: 186..2579 T (54
// invocations; attract 24 / free-play 5 / maze 5 / death 20 / coin-start 0). 2579 is
// well under the inter-interrupt gap (~4000 T), so unlike 0x2a40 this routine genuinely
// FAST-PATHS (declines only on frames an interrupt would split) -> live transparency
// is real here, not bench-only.
//
// RESIDUE: every observed invocation runs with SP in WORK RAM (0x0824/0x0826), so the
// inner-call return-address residue lands at 0x0822-0x0825 -- outside the 0x4000-0x5FFF
// rendered window. It is therefore invisible to the display hash by STACK PLACEMENT
// (structural across all 54 invocations, not coincidental like 0x157e), so PORT_META
// declares no pushes. (The residue itself is path-dependent -- 0x15ab on the BC==0
// path, BC on a clean loop exit, 0x15b9 on a loop hit -- which the static output-bank
// push model could not express anyway; here it does not need to.)
//
// Disassembly (entry .. ret):
//   15a0 ld (iy+$00),$00     15b1 jr z,$15ca       15c2 ld a,l
//   15a4 ld ix,($0876)       15b3 push bc          15c3 cp c
//   15a8 call $15cb          15b4 pop ix           15c4 jr nz,$15b6
//   15ab ld bc,($0870)       15b6 call $15cb       15c6 ld a,h
//   15af ld a,b              15b9 ld h,(ix-$01)    15c7 cp b
//   15b0 or c                15bc ld l,(ix-$02)    15c8 jr nz,$15b6
//                            15bf push hl          15ca ret
//                            15c0 pop ix
import { or8, cp8 } from './z80flags.js';
import { BOLT_VS_ACTOR_COLLISION } from './bolt_vs_actor_15cb.js';

export function BOLT_HIT_SCAN(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const r16 = (a) => ctx.mem.r16(a & 0xffff) & 0xffff;
  const savedRet = ctx.retAddr;
  let cyc = 0;

  // Compose 0x15cb with the inner call's return address visible as ctx.retAddr (its
  // `pop hl` on a hit loads exactly that). Returns true on a HIT (non-local return).
  const callInner = (innerRet) => {
    ctx.retAddr = innerRet;
    ctx.framesToDrop = 0;
    ctx.cycles = 0;
    BOLT_VS_ACTOR_COLLISION(ctx);
    cyc += ctx.cycles;
    return ctx.framesToDrop === 1;
  };
  const finish = (extra) => { ctx.retAddr = savedRet; ctx.framesToDrop = 0; ctx.cycles = cyc + (extra || 0); };

  ctx.mem.w8((g.iy + 0x00) & 0xffff, 0x00); cyc += 19;   // 15a0 ld (iy+$00),$00
  g.ix = r16(0x0876); cyc += 20;                          // 15a4 ld ix,($0876)
  cyc += 17;                                              // 15a8 call $15cb
  if (callInner(0x15ab)) { finish(); return; }            // head-call hit -> non-local return

  const bc = r16(0x0870);
  g.b = (bc >> 8) & 0xff; g.c = bc & 0xff; cyc += 20;     // 15ab ld bc,($0870)
  g.a = g.b; cyc += 4;                                    // 15af ld a,b
  g.a = or8(fl, g.a, g.c); cyc += 4;                      // 15b0 or c
  if (fl.Z) { finish(12 + 10); return; }                  // 15b1 jr z,$15ca (taken) ; 15ca ret
  cyc += 7;                                               // 15b1 jr z not taken

  g.ix = bc; cyc += 11 + 14;                              // 15b3 push bc ; 15b4 pop ix
  for (;;) {
    cyc += 17;                                            // 15b6 call $15cb
    if (callInner(0x15b9)) { finish(); return; }          // loop hit -> non-local return
    const ix = g.ix & 0xffff;
    g.h = r8((ix - 0x01) & 0xffff); cyc += 19;            // 15b9 ld h,(ix-$01)
    g.l = r8((ix - 0x02) & 0xffff); cyc += 19;            // 15bc ld l,(ix-$02)
    g.ix = ((g.h << 8) | g.l) & 0xffff; cyc += 11 + 14;   // 15bf push hl ; 15c0 pop ix
    g.a = g.l; cyc += 4;                                  // 15c2 ld a,l
    cp8(fl, g.a, g.c); cyc += 4;                          // 15c3 cp c
    if (!fl.Z) { cyc += 12; continue; }                   // 15c4 jr nz,$15b6 (L != C)
    cyc += 7;                                             // 15c4 jr nz not taken
    g.a = g.h; cyc += 4;                                  // 15c6 ld a,h
    cp8(fl, g.a, g.b); cyc += 4;                          // 15c7 cp b
    if (!fl.Z) { cyc += 12; continue; }                   // 15c8 jr nz,$15b6 (H != B)
    cyc += 7;                                             // 15c8 jr nz not taken
    break;                                                // HL == BC -> done
  }
  finish(10);                                             // 15ca ret
}
