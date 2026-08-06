// RESET_JOBS @0x22f1 -- tear down the job/coroutine bookkeeping. A TRUE LEAF (no
// CALL, ends in `ret`): saves IY into its own frame slots, zeroes the job-list head
// ($0870) and the current-job pointer ($0876), clears a 56-byte table at $437B, and
// returns flags from `ld a,($4379); or a`.
//
// Faithful transcription. Notes on the non-data ops:
//   * `push iy; pop hl` just copies IY into HL (HL is then immediately overwritten
//     by `ld hl,$0000`); the push leaves IY on the VRAM-overlapping stack as transient
//     residue (entrySp-1/entrySp-2), replayed live via PORT_META pushes:['iy'].
//   * `di`/`ei` bracket the body. We do NOT model IFF: it is not a compared register
//     and nets to no change (di then ei). The live hook charges the full 1612-cycle
//     window and DECLINES if an interrupt event would split it (src/port-hook.js), so
//     interrupt timing is preserved without modeling the flip-flop.
//   * The bench strips the push/pop/ret stack writes (contiguous run around entrySp),
//     so this port must emit ONLY the data writes: (iy-1),(iy-2), $0870/$0871,
//     $0876/$0877, then the 56-byte $437B clear -- in that order.
//
// Cost is FIXED (single path, djnz count is the immediate $38=56): 1612 T-states,
// hand-summed = the record `cycles` (doubles as a disassembly-completeness check).
import { or8 } from './z80flags.js';

export function RESET_JOBS_22F1(ctx) {
  const { regs, mem } = ctx;
  const f = ctx.flags;
  const iy = regs.iy & 0xffff;

  let h = (iy >> 8) & 0xff, l = iy & 0xff;        // 22f1 push iy / 22f3 pop hl -> hl=iy
  mem.w8((iy - 1) & 0xffff, h);                   // 22f4 ld (iy-$01),h
  mem.w8((iy - 2) & 0xffff, l);                   // 22f7 ld (iy-$02),l
  h = 0; l = 0;                                   // 22fa ld hl,$0000
                                                  // 22fd di  (IFF not modeled; see header)
  mem.w16(0x0870, 0);                             // 22fe ld ($0870),hl
  mem.w16(0x0876, 0);                             // 2301 ld ($0876),hl
  let a = 0;                                      // 2304 xor a
  let hl = 0x437b;                                // 2305 ld hl,$437b
  let b = 0x38;                                   // 2308 ld b,$38
  do {                                            // 230a..230c (hl)=0; inc hl; djnz
    mem.w8(hl, a);
    hl = (hl + 1) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b !== 0);
  a = mem.r8(0x4379);                             // 230e ld a,($4379)
  a = or8(f, a, a);                               // 2311 or a
                                                  // 2312 ei  /  2313 ret
  h = (hl >> 8) & 0xff; l = hl & 0xff;            // hl ends 0x43b3

  regs.a = a & 0xff; regs.b = b & 0xff;
  regs.h = h & 0xff; regs.l = l & 0xff;
  ctx.cycles = 1612;
}
