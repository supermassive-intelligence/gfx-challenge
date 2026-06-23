// MOVE_AND_DRAW_BOLT @0x1553 -- step a laser bolt one pixel along its DURL
// direction, plot it into Magic RAM (XOR), and return carry = collision.
//
// This is the FIRST NON-LEAF gameplay-engine body ported (it is excluded from the
// hermetic test plan BY DESIGN -- the leaf-first self-validation drops any invocation
// with an effectful sub-call, and this one does `call $29A1`). It is validated by the
// LIVE hooked==un-hooked transparency regression, which already exercises it: Berzerk's
// attract mode runs a demo game, so 0x1553 executes under attract-only (first at frame
// 977). Its callee RTOAX (0x29a1) is already ported, so this is a clean composition --
// the same bottom-up methodology as 0x2341, extended past the leaf set.
//
// Z80 (Tunstall), entry A = BOLT.Direction (DURL bits), IY = BOLT struct:
//   rrca / jp nc -> if LEFT (bit0):  dec (iy+$02)   ; BOLT.PX--
//   rrca / jp nc -> if RIGHT(bit1):  inc (iy+$02)   ; BOLT.PX++
//   rrca / jp nc -> if UP   (bit2):  dec (iy+$03)   ; BOLT.Y--
//   rrca / jp nc -> if DOWN (bit3):  inc (iy+$03)   ; BOLT.Y++
//   ld h,(iy+$03) ; ld l,(iy+$02)   ; HL = (Y,PX)
//   call $29A1                       ; RTOAX: HL -> Magic-image addr, latch $4B (XOR)
//   ld (hl),$80                      ; plot one pixel through the Magic-RAM ALU
//   in a,($4E) ; rlca                ; CARRY = intercept flop = collision (caller's
//                                    ;   `call c,$15A0` HANDLE_BOLT_COLLISION uses it)
//   ret
//
// DEAD INTERMEDIATE STATE (why the rrca's are not reproduced faithfully): the four
// `rrca`s rotate A and set C/H/N/X/Y, but A is overwritten by `in a,($4E)` and the
// flags are re-established by RTOAX (ends on `add hl,bc`) then the final `rlca`. So
// only the four bit-tests (movement) and the (iy+d) read-modify-writes are observable;
// the rotate flag/A side effects never reach memory or a branch. S/Z/P at return come
// from RTOAX's last `rr l`; the final `rlca` sets C(=collision)/H=0/N=0/X/Y.
//
// V256 HAZARD IS BENIGN: port 0x4E = ((intercept^1)<<7) | (v256 & 0x7f). The hook runs
// the port atomically at the CALL site, so io.in(0x4E) samples v256 at a slightly
// different beam position than the real `in` at 0x157A -- but that only perturbs bits
// 0-6 of A, which are dead. Bit7 (the collision the caller branches on) is the intercept
// flop, set by THIS routine's Magic write and independent of v256. RTOAX's io.out(0x4B)
// and the Magic write both hit live hardware, so the flop is hardware-accurate.
//
// STACK RESIDUE: the inner `call $29A1` (at 0x1575) pushes its return address 0x1578
// onto the VRAM-overlapping stack; the port elides the call, so PORT_META replays the
// 0x1578 residue. RTOAX itself is a leaf (no pushes).
import { rlca8 } from './z80flags.js';
import { RTOAX } from './magic_image_addr.js';

export function MOVE_AND_DRAW_BOLT(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  const iy = g.iy & 0xffff;
  const dir = g.a & 0xff;                       // A = BOLT.Direction (DURL)
  let cyc = 0;

  // Each block: rrca(4) + jp nc(10) = 14, then a taken dec/inc (iy+d) = 23.
  cyc += 14; if (dir & 0x01) { w8(iy + 2, (r8(iy + 2) - 1) & 0xff); cyc += 23; } // LEFT  dec (iy+2)
  cyc += 14; if (dir & 0x02) { w8(iy + 2, (r8(iy + 2) + 1) & 0xff); cyc += 23; } // RIGHT inc (iy+2)
  cyc += 14; if (dir & 0x04) { w8(iy + 3, (r8(iy + 3) - 1) & 0xff); cyc += 23; } // UP    dec (iy+3)
  cyc += 14; if (dir & 0x08) { w8(iy + 3, (r8(iy + 3) + 1) & 0xff); cyc += 23; } // DOWN  inc (iy+3)

  g.h = r8(iy + 3); cyc += 19;                  // 156F ld h,(iy+3)  BOLT.Y
  g.l = r8(iy + 2); cyc += 19;                  // 1572 ld l,(iy+2)  BOLT.PX
  RTOAX(ctx); cyc += 17 + ctx.cycles;           // 1575 call $29A1 -> HL = magic addr, $4B latched
  w8(((g.h << 8) | g.l) & 0xffff, 0x80); cyc += 10; // 1578 ld (hl),$80  plot pixel (XOR)
  g.a = ctx.io.in(0x4e) & 0xff; cyc += 11;      // 157A in a,($4e)  intercept + v256
  g.a = rlca8(fl, g.a); cyc += 4;               // 157C rlca  -> C = collision (bit7)
  cyc += 10;                                    // 157D ret
  ctx.cycles = cyc;
}
