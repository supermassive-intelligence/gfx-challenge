// Sound-trigger family @0x33bd/0x348a/0x34e7/0x3439 -- identical shape, differing
// only in (priority, handler-pointer). Each requests a sound effect by priority:
// if the requested priority >= the current sound's priority (0x0889 PC1), it claims
// the channel (disables NMI via port 0x4D, stores priority + a 0x0885 handler ptr),
// then re-enables NMI (port 0x4C) and returns. A lower-priority request is ignored.
// Z80 (Tunstall, e.g. SFIRE 0x33bd):
//   ld hl,$0889; push af; ld a,PRIO; cp (hl); jr c,skip
//     out ($4D),a; ld (hl),a; ld hl,PTR; ld ($0885),hl
//   skip: pop af; out ($4C),a; ret
// `pop af` RESTORES the entry A and F, so regs_out.A = A_in, F = F_in. HL = PTR on
// the play path, else 0x0889. push af must be replayed live (stack overlaps VRAM).
function makeSoundTrigger(prio, ptr) {
  return function (ctx) {
    const { regs, mem, io } = ctx;
    const cur = mem.r8(0x0889);            // current sound priority (PC1)
    const play = prio >= cur;              // cp (hl): carry (skip) when prio < cur
    if (play) {
      io.out(0x4d, prio);                  // nmi_disable
      mem.w8(0x0889, prio);                // claim priority
      mem.w16(0x0885, ptr);                // install handler pointer
      regs.h = (ptr >> 8) & 0xff;
      regs.l = ptr & 0xff;
      ctx.cycles = 117;
    } else {
      regs.h = 0x08;                       // hl still = 0x0889
      regs.l = 0x89;
      ctx.cycles = 78;
    }
    io.out(0x4c, regs.a & 0xff);           // nmi_enable, with entry A (pop af)
    // A and F unchanged: `pop af` restores the values pushed at entry.
  };
}

export const SFIRE   = makeSoundTrigger(0x00, 0x33d3);  // 0x33bd
export const SBLAM   = makeSoundTrigger(0x01, 0x34a0);  // 0x348a
export const SRFIRE  = makeSoundTrigger(0x01, 0x34fd);  // 0x34e7
export const SFRY    = makeSoundTrigger(0x03, 0x344f);  // 0x3439
