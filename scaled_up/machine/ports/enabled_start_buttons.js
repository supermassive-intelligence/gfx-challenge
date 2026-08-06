// GET_ENABLED_START_BUTTONS @0x1997 -- composes GET_CREDITS_AS_BCD (0x18E0) and
// masks the SYSTEM input (port $49) so only the start buttons backed by enough
// credits read as pressed. 0 credits -> no starts; 1 -> 1-player only; >=2 -> both.
// Z80 (Tunstall):
//   call $18E0          ; A = credits as BCD
//   ld l,$00
//   or a; jr z,$19A7    ; 0 credits -> mask $00
//   cp $01; ld l,$01; jr z,$19A7   ; 1 credit -> mask $01
//   ld l,$03            ; >=2 credits -> mask $03
//   19A7: in a,($49)    ; SYSTEM (active-low)
//   cpl                 ; -> active-high
//   and l               ; keep only the enabled start bits
//   ret
// Final flags = `and l`. Composed from the already-ported GET_CREDITS_AS_BCD leaf.
import { GET_CREDITS_AS_BCD } from './credits.js';
import { and8 } from './z80flags.js';

export function GET_ENABLED_START_BUTTONS(ctx) {
  const { regs, flags, io } = ctx;
  GET_CREDITS_AS_BCD(ctx);                  // call $18E0 -> A = credits BCD, C, flags
  const credits = regs.a & 0xff;

  // call(17)+18E0 body(74) = 91; ld l,$00 7; or a 4; the rest is path-dependent.
  let l, cyc;
  if (credits === 0) {                      // jr z taken
    l = 0x00; cyc = 91 + 7 + 4 + 12 + 29;          // 143
  } else if (credits === 1) {               // cp $01; ld l,$01; jr z taken
    l = 0x01; cyc = 91 + 7 + 4 + 7 + 7 + 7 + 12 + 29;   // 164
  } else {                                  // cp $01; ld l,$01; jr z not taken; ld l,$03
    l = 0x03; cyc = 91 + 7 + 4 + 7 + 7 + 7 + 7 + 7 + 29; // 166
  }
  regs.l = l;
  const sys = io.in(0x49) & 0xff;           // in a,($49)
  regs.a = and8(flags, (~sys) & 0xff, l);   // cpl; and l -> A, flags
  ctx.cycles = cyc;                         // 19A7..ret = in 11 + cpl 4 + and 4 + ret 10 = 29
}
