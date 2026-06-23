// Speech-trigger leaves -- set VOICE_PC (0x0898) so the NMI speech handler starts
// reading a fixed speech-data pointer. Two straight-line entries share the TALK tail.
//
// SAY_INTRUDER_ALERT_INTRUDER_ALERT @0x2BDE:
//   ld hl,$2C4A; jp $2C1B (TALK)
//   TALK: ld ($0898),hl; ret
//   -> writes VOICE_PC only; A and flags unchanged.
//
// SAY_GOT_THE_HUMANOID_GOT_THE_INTRUDER @0x2C1F:
//   ld hl,$2C40; xor a; jr $2C18
//   2C18: ld ($089A),a   ; IS_CHICKEN = 0
//   2C1B: ld ($0898),hl  ; VOICE_PC
//   ret
//   -> A = 0 (xor a flags), writes IS_CHICKEN then VOICE_PC.
import { xor8 } from './z80flags.js';

const VOICE_PC = 0x0898;
const IS_CHICKEN = 0x089a;

export function SAY_INTRUDER_ALERT(ctx) {           // 0x2BDE
  const { regs, mem } = ctx;
  regs.h = 0x2c; regs.l = 0x4a;                     // ld hl,$2C4A
  mem.w16(VOICE_PC, 0x2c4a);                        // TALK: ld ($0898),hl
  ctx.cycles = 10 + 10 + 16 + 10;                   // ld hl + jp + ld(nn),hl + ret = 46
}

export function SAY_GOT_THE_HUMANOID(ctx) {         // 0x2C1F
  const { regs, flags, mem } = ctx;
  regs.h = 0x2c; regs.l = 0x40;                     // ld hl,$2C40
  regs.a = xor8(flags, regs.a, regs.a);            // xor a -> A=0, flags
  mem.w8(IS_CHICKEN, regs.a);                       // 2C18: ld ($089A),a
  mem.w16(VOICE_PC, 0x2c40);                        // 2C1B: ld ($0898),hl
  ctx.cycles = 10 + 4 + 12 + 13 + 16 + 10;          // ld hl + xor a + jr + ld(nn),a + ld(nn),hl + ret = 65
}
