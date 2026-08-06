// CHECK_IF_BOLT_OFFSCREEN @0x157E -- straight-line, composes CHECK_IF_ZERO_OR_E
// (0x1597) twice to clear the bolt's DURL direction bits when it leaves the screen.
// Z80 (Tunstall):
//   ld a,(iy+$02)   ; A = BOLT.PX
//   ld b,(iy+$00)   ; B = BOLT.Direction (DURL bits)
//   ld de,$03FF     ; E = $FF  -> clear B if PX == 0 or PX == $FF (left/right edge)
//   call $1597      ; CHECK_IF_ZERO_OR_E
//   ld a,(iy+$03)   ; A = BOLT.Y
//   ld de,$0CD0     ; E = $D0  -> clear B if Y == 0 or Y == $D0 (top/bottom edge)
//   call $1597      ; CHECK_IF_ZERO_OR_E
//   ld (iy+$00),b   ; BOLT.Direction = B
//   ret
// Final flags = the SECOND `call $1597`'s flags (a `cp` of BOLT.Y vs $D0 / $00).
// Composed from the already-ported CHECK_IF_ZERO_OR_E leaf (bottom-up).
import { CHECK_IF_ZERO_OR_E } from './check_zero_or_e.js';

export function CHECK_IF_BOLT_OFFSCREEN(ctx) {
  const { regs, mem } = ctx;
  const iy = regs.iy & 0xffff;

  regs.a = mem.r8((iy + 2) & 0xffff);       // ld a,(iy+2)  BOLT.PX
  regs.b = mem.r8(iy);                       // ld b,(iy+0)  BOLT.Direction
  regs.d = 0x03; regs.e = 0xff;              // ld de,$03FF
  CHECK_IF_ZERO_OR_E(ctx);                   // call $1597 (sets ctx.cycles to its path)
  const inner1 = ctx.cycles;

  regs.a = mem.r8((iy + 3) & 0xffff);       // ld a,(iy+3)  BOLT.Y
  regs.d = 0x0c; regs.e = 0xd0;              // ld de,$0CD0
  CHECK_IF_ZERO_OR_E(ctx);                   // call $1597
  const inner2 = ctx.cycles;

  mem.w8(iy, regs.b & 0xff);                 // ld (iy+0),b

  // ld a,(iy+d)19 + ld b,(iy+d)19 + ld de 10 + ld a,(iy+d)19 + ld de 10
  //   + ld (iy+d),b 19 + ret 10 = 106 fixed; + two `call`s (17 each) + inner bodies.
  ctx.cycles = 106 + 17 + 17 + inner1 + inner2;
}
