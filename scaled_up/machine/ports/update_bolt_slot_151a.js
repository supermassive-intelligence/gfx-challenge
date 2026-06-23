// UPDATE_BOLT_SLOT @0x151a -- per-slot bolt state machine. Composes MOVE_AND_DRAW_BOLT
// (0x1553, ported), BOLT_HIT_SCAN (0x15a0, ported), and CHECK_IF_BOLT_OFFSCREEN
// (0x157e, ported).
//
// TIER MOVE (Tier-3 -> Tier-2), flagged for Sudnya: 0x151a was bucketed Tier-3 with the
// reason "un-benched callees / coroutine". Re-reading the ROM: there is NO stack switch
// (`ld sp`), NO computed jump (`jp (hl)`), NO `halt`, NO coroutine continuation -- it is a
// plain per-slot update with iy-relative state and ordinary early `ret`/`ret nz`/`ret z`.
// Its three callees (0x1553, 0x15a0, 0x157e) are ALL now ported, which was the actual
// blocker. So the Tier-3 reason was a dependency-block, now cleared -- not an intrinsic
// hazard. All three callees preserve the IY register (verified), which 0x151a relies on
// across the calls. Sudnya can veto this move; until then it is validated to the full
// Tier-2 bar (bench + transparency).
//
// NON-LOCAL RETURN: 0x1553 sets carry = collision; `call c,$15a0` then runs BOLT_HIT_SCAN
// only on a hit. 0x15a0 already ABSORBS its inner 0x15cb non-local return (it returns to
// its own caller with framesToDrop=0), so composed here it just returns normally to the
// 0x1529 continuation -- nothing escapes 0x151a. 0x151a's own exits are all normal rets.
//
// COST: 88..2753 T over the 5 scripts (76067 invocations); 2753 < the inter-interrupt gap
// (~4000) -> FAST-PATHS. SP in work RAM (0x0826/0x0828) on every invocation -> inner-call
// residue outside the rendered window, no pushes.
//
// Disasm (entry .. ret):
//   151a ld a,(iy+$00)   1529 call $157e      153e or (iy+$00)
//   151d or a            152c ld bc,$0004      1541 jp z,$154a
//   151e jr z,$152c      152f add iy,bc        1544 call $1553
//   1520 inc (iy+$01)    1531 dec (iy+$01)     1547 call $157e
//   1523 call $1553      1534 ret nz           154a dec (iy-$03)
//   1526 call c,$15a0    1535 inc (iy+$01)     154d ret nz
//                        1538 xor a            154e ld (iy+$00),$00
//                        1539 or (iy-$03)      1552 ret
//                        153c ret z
import { or8, dec8, inc8, addHL16 } from './z80flags.js';
import { MOVE_AND_DRAW_BOLT } from './move_and_draw_bolt.js';
import { BOLT_HIT_SCAN } from './bolt_hit_scan_15a0.js';
import { CHECK_IF_BOLT_OFFSCREEN } from './check_bolt_offscreen.js';

export function UPDATE_BOLT_SLOT(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  let cyc = 0;
  const iy = () => g.iy & 0xffff;
  const inner = (fn, callCost) => { cyc += callCost; ctx.cycles = 0; fn(ctx); cyc += ctx.cycles; };

  g.a = r8(iy() + 0x00); cyc += 19;                 // 151a ld a,(iy+$00)
  g.a = or8(fl, g.a, g.a); cyc += 4;                // 151d or a
  if (fl.Z) { cyc += 12; }                          // 151e jr z,$152c (inactive slot)
  else {
    cyc += 7;                                       // 151e jr z not taken
    w8(iy() + 0x01, inc8(fl, r8(iy() + 0x01))); cyc += 23;  // 1520 inc (iy+$01)
    inner(MOVE_AND_DRAW_BOLT, 17);                  // 1523 call $1553 (sets C=collision)
    if (fl.C) { inner(BOLT_HIT_SCAN, 17); }         // 1526 call c,$15a0 (taken)
    else { cyc += 10; }                             // 1526 call c not taken
    inner(CHECK_IF_BOLT_OFFSCREEN, 17);             // 1529 call $157e
  }

  g.b = 0x00; g.c = 0x04; cyc += 10;                // 152c ld bc,$0004
  g.iy = addHL16(fl, iy(), 0x0004); cyc += 15;      // 152f add iy,bc (sets C/H/N/Y/X)
  w8(iy() + 0x01, dec8(fl, r8(iy() + 0x01))); cyc += 23;    // 1531 dec (iy+$01)
  if (!fl.Z) { ctx.cycles = cyc + 11; return; }     // 1534 ret nz (taken) -- F = dec flags
  cyc += 5;                                          // 1534 ret nz not taken
  w8(iy() + 0x01, inc8(fl, r8(iy() + 0x01))); cyc += 23;    // 1535 inc (iy+$01)
  g.a = 0x00; cyc += 4;                              // 1538 xor a
  g.a = or8(fl, g.a, r8(iy() - 0x03 & 0xffff)); cyc += 19;  // 1539 or (iy-$03)
  if (fl.Z) { ctx.cycles = cyc + 11; return; }      // 153c ret z (taken) -- F = or flags
  cyc += 5;                                          // 153c ret z not taken
  g.a = 0x00; cyc += 4;                              // 153d xor a
  g.a = or8(fl, g.a, r8(iy() + 0x00)); cyc += 19;   // 153e or (iy+$00)
  if (fl.Z) { cyc += 10; }                           // 1541 jp z,$154a (taken)
  else {
    cyc += 10;                                       // 1541 jp z not taken
    inner(MOVE_AND_DRAW_BOLT, 17);                   // 1544 call $1553
    inner(CHECK_IF_BOLT_OFFSCREEN, 17);              // 1547 call $157e
  }
  w8(iy() - 0x03 & 0xffff, dec8(fl, r8(iy() - 0x03 & 0xffff))); cyc += 23;  // 154a dec (iy-$03)
  if (!fl.Z) { ctx.cycles = cyc + 11; return; }     // 154d ret nz (taken) -- F = dec flags
  cyc += 5;                                          // 154d ret nz not taken
  w8(iy() + 0x00, 0x00); cyc += 19;                 // 154e ld (iy+$00),$00
  ctx.cycles = cyc + 10;                            // 1552 ret
}
