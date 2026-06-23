// WALK_OBJECT_TIMERS @0x27f5.
//
// Walks the circular object list (head pointer at 0x0872) and, for each node,
// decrements its bit1 countdown timer; when the timer expires it flips the
// node's state bits (res 1 / set 0). The list is circular: the walk follows the
// back-link stored in the two bytes just BELOW each node base (P-2 = low,
// P-1 = high) and stops when it returns to the head.
//
// Per node (base P = HL at the loop top):
//   bit 1,(P)                       ; test the "timer active" bit
//   if set:
//     dec (P+1)                     ; tick the countdown
//     if it reached 0:
//       res 1,(P) ; set 0,(P)       ; expire: clear bit1, set bit0
//   next = (mem[P-1] << 8) | mem[P-2]
//   stop when next == head, else P = next and repeat
//
// Return F comes from `or l` (empty list, early ret) or `cp e` (loop exit when
// the walk wraps back to the head) -- both fully-defined ALU ops. The mid-loop
// `bit 1,(hl)` only drives a branch; it never reaches a ret, so its WZ-driven
// undocumented X/Y flags are not observed (which is why this routine is
// portable while 0x3719/0x27a9 -- which ret straight after bit n,(hl) -- are not).
//
// Cycle cost is path-dependent (list length x per-node branch); the port
// accumulates exact Z80 T-states into ctx.cycles. The empty-list early-ret path
// (head == 0) is never taken by the captured records (all lists are non-empty);
// it is implemented from the disassembly but bench-unexercised.
import { or8, cp8 } from './z80flags.js';

const HEAD = 0x0872;

export function WALK_OBJECT_TIMERS(ctx) {
  const { regs, flags, mem } = ctx;

  let cyc = 16;                                  // ld hl,($0872)
  let hl = mem.r16(HEAD) & 0xffff;
  let a = (hl >> 8) & 0xff;                       // ld a,h
  cyc += 4;
  a = or8(flags, a, hl & 0xff);                   // or l
  cyc += 4;
  if (a === 0) {                                  // ret z (empty list)
    cyc += 11;
    regs.a = 0; regs.h = 0; regs.l = 0;
    ctx.cycles = cyc;
    return;
  }
  cyc += 5;                                       // ret z not taken

  const d = (hl >> 8) & 0xff;                      // ld d,h
  const e = hl & 0xff;                             // ld e,l
  cyc += 8;

  for (;;) {
    let p = hl & 0xffff;
    const node0 = mem.r8(p) & 0xff;
    cyc += 12;                                     // bit 1,(hl)
    if ((node0 >> 1) & 1) {                        // jr z NOT taken
      cyc += 7 + 6;                                // jr z(nt) ; inc hl
      const v = mem.r8((p + 1) & 0xffff) & 0xff;
      const nv = (v - 1) & 0xff;
      mem.w8((p + 1) & 0xffff, nv);                // dec (hl)
      cyc += 11 + 6;                               // dec (hl) ; dec hl
      if (nv !== 0) {
        cyc += 12;                                 // jr nz taken
      } else {
        cyc += 7;                                  // jr nz not taken
        let n = mem.r8(p) & 0xff;
        n &= ~0x02; mem.w8(p, n & 0xff);           // res 1,(hl)
        n |= 0x01;  mem.w8(p, n & 0xff);           // set 0,(hl)
        cyc += 15 + 15;
      }
    } else {
      cyc += 12;                                   // jr z taken
    }

    // 280a: pointer chase to the next node (back-link at P-2/P-1)
    const hi = mem.r8((p - 1) & 0xffff) & 0xff;     // ld a,(hl) after dec hl
    const lo = mem.r8((p - 2) & 0xffff) & 0xff;     // ld l,(hl) after dec hl
    cyc += 6 + 7 + 6 + 7 + 4;                       // dec hl;ld a,(hl);dec hl;ld l,(hl);ld h,a
    const nh = hi, nl = lo;                          // HL = next node
    a = nh;                                          // a == h here (ld h,a)

    cp8(flags, a, d);                               // cp d
    cyc += 4;
    if (a !== d) {                                  // jr nz taken -> loop
      cyc += 12;
      hl = ((nh << 8) | nl) & 0xffff;
      continue;
    }
    cyc += 7;                                        // jr nz not taken
    a = nl;                                          // ld a,l
    cp8(flags, a, e);                               // cp e
    cyc += 4 + 4;                                    // ld a,l ; cp e
    if (a !== e) {                                   // jr nz taken -> loop
      cyc += 12;
      hl = ((nh << 8) | nl) & 0xffff;
      continue;
    }
    cyc += 7 + 10;                                   // jr nz not taken ; ret
    hl = ((nh << 8) | nl) & 0xffff;                  // HL == head
    break;
  }

  regs.a = a & 0xff;
  regs.d = d; regs.e = e;
  regs.h = (hl >> 8) & 0xff;
  regs.l = hl & 0xff;
  ctx.cycles = cyc;
}
