// UPDATE_SCORE @0x2341 -- add a BCD value (C) to the active player's score at the
// digit selected by B, propagate the BCD carry, then run the bonus-life DIP checks.
//
// Composes GET_PLAYER_SCORE_PTR (0x2334, already ported) twice; no other CALL is on
// the recorded/transparent paths. Real data writes ($436D update flag + the score
// BCD byte), real port reads (F2 DIP $61 from the io FIFO), and `daa`/`sla`/`srl`
// BCD arithmetic -- a genuine, non-degenerate bench bar (unlike the score routines
// whose only captured path is an early-ret guard).
//
// SHADOW-AF SUBTLETY (load-bearing; the bench compares a_p/f_p): the digit-index loop
//   srl b ; ex af,af' ; inc b ; [dec hl ; dec e ; djnz] ; ex af,af'
// preserves the `srl b` carry in the LIVE bank across the loop by parking it in the
// shadow bank. The net effect on the shadow bank is f_p_out = the LAST `dec e` flags
// (a_p is unchanged). We model exactly that: the loop runs on a copy of flags_p and
// the final dec8 result is written back to ctx.flags_p; the live flags stay = srl-b.
//
// BONUS-AWARD TAIL NOT PORTED (throws): when the score crosses a bonus threshold the
// routine sets the XTRAMEN bit via `bit n,(hl)` (WZ-sourced ret flags), `call $3538`
// (un-ported), then `jp $259A` (non-local -- never returns to us). None of the 5
// regression scripts reach it (no record takes it; transparency confirms live). The
// award branches throw so a future script that DID award a life fails loudly here
// rather than diverging silently.
//
// Cost is path-dependent; the port accumulates exact Z80 T-states into ctx.cycles
// (the recorded paths sum to 432 / 497, matching the captured `cycles` -- a
// transcription-completeness check). PORT_META.maxCycles bounds the interrupt-decline
// gate; pushes:[0x2372] replays the last inner `call $2334` return-address residue on
// the VRAM-overlapping stack.
import { cp8, daa8, sla8, srl8, add8, dec8, or8 } from './z80flags.js';
import { GET_PLAYER_SCORE_PTR } from './score_ptr.js';

export function UPDATE_SCORE(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  const w8 = (a, v) => ctx.mem.w8(a & 0xffff, v & 0xff);
  const HL = () => ((g.h << 8) | g.l) & 0xffff;
  const setHL = (v) => { g.h = (v >> 8) & 0xff; g.l = v & 0xff; };
  const BC = () => ((g.b << 8) | g.c) & 0xffff;
  const setBC = (v) => { g.b = (v >> 8) & 0xff; g.c = v & 0xff; };
  const setDE = (v) => { g.d = (v >> 8) & 0xff; g.e = v & 0xff; };
  let cyc = 0;

  // Shadow bank: a_p stays put; f_p ends as the last `dec e` flags (see header).
  const fS = { ...ctx.flags_p };
  const finish = () => { Object.assign(ctx.flags_p, fS); ctx.cycles = cyc; };

  g.a = 0xff; cyc += 7;                           // 2341 ld a,$ff
  w8(0x436d, g.a); cyc += 13;                     // 2343 ld ($436d),a  UPDATE flag
  g.e = 0x04; cyc += 7;                           // 2346 ld e,$04
  GET_PLAYER_SCORE_PTR(ctx); cyc += 17 + ctx.cycles; // 2348 call $2334 -> hl=score ptr
  setHL((HL() + 1) & 0xffff); cyc += 6;           // 234b inc hl
  setHL((HL() + 1) & 0xffff); cyc += 6;           // 234c inc hl
  setHL((HL() + 1) & 0xffff); cyc += 6;           // 234d inc hl

  g.b = srl8(fl, g.b); cyc += 8;                  // 234e srl b  (carry = old bit0)
  const carry = fl.C;                             //   preserved across the loop
  cyc += 4;                                       // 2350 ex af,af'
  g.b = (g.b + 1) & 0xff; cyc += 4;               // 2351 inc b   (ensures B >= 1)
  do {                                            // 2352 loop body, B times
    setHL((HL() - 1) & 0xffff); cyc += 6;         // 2352 dec hl
    g.e = dec8(fS, g.e); cyc += 4;                // 2353 dec e  (shadow bank)
    g.b = (g.b - 1) & 0xff;
    cyc += (g.b !== 0) ? 13 : 8;                  // 2354 djnz
  } while (g.b !== 0);
  cyc += 4;                                       // 2356 ex af,af'  (live = srl-b flags)

  if (carry) {                                    // 2357 jr nc,$2361 -- NOT taken (B odd)
    cyc += 7;
    g.c = sla8(fl, g.c); cyc += 8;                // 2359 sla c
    g.c = sla8(fl, g.c); cyc += 8;                // 235b sla c
    g.c = sla8(fl, g.c); cyc += 8;                // 235d sla c
    g.c = sla8(fl, g.c); cyc += 8;                // 235f sla c
  } else {
    cyc += 12;                                    // 2357 jr nc taken (B even)
  }

  for (;;) {                                      // 2361 add/daa/carry loop
    g.a = g.c; cyc += 4;                          // 2361 ld a,c
    g.a = add8(fl, g.a, r8(HL())); cyc += 7;      // 2362 add a,(hl)
    g.a = daa8(fl, g.a); cyc += 4;                // 2363 daa
    w8(HL(), g.a); cyc += 7;                      // 2364 ld (hl),a  (score byte)
    if (!fl.C) { cyc += 12; break; }              // 2365 jr nc,$236f  done
    cyc += 7;
    setHL((HL() - 1) & 0xffff); cyc += 6;         // 2367 dec hl
    g.e = dec8(fl, g.e); cyc += 4;                // 2368 dec e
    if (fl.Z) { cyc += 12; break; }               // 2369 jr z,$236f  done (ran out of digits)
    cyc += 7;
    g.c = 0x01; cyc += 7;                         // 236b ld c,$01  (carry the 1)
    cyc += 12;                                    // 236d jr $2361
  }

  GET_PLAYER_SCORE_PTR(ctx); cyc += 17 + ctx.cycles; // 236f call $2334 -> hl=score ptr
  g.b = g.h; cyc += 4;                            // 2372 ld b,h
  g.c = g.l; cyc += 4;                            // 2373 ld c,l   BC = score ptr
  setHL(0x434f); cyc += 10;                       // 2374 ld hl,$434f  XTRAMEN
  setDE(0x4349); cyc += 10;                       // 2377 ld de,$4349  DEATHS

  g.a = ctx.io.in(0x61) & 0xff; cyc += 11;        // 237a in a,($61)  F2 DIP
  cyc += 8;                                       // 237c bit 7,a  (bonus at 10000?)
  if (g.a & 0x80) {                               // 237e jr z,$2391 -- bit7 set, NOT taken
    cyc += 7;
    g.a = r8(BC()); cyc += 7;                     // 2380 ld a,(bc)  score high digits
    or8(fl, g.a, g.a); cyc += 4;                  // 2381 or a
    if (g.a !== 0) {                              // 2382 jr z,$2391 -- nonzero: award path
      throw new Error('UPDATE_SCORE 0x2341: bonus-at-10000 award path not ported '
        + '(bit (hl) WZ ret / call $3538 / jp $259a)');
    }
    cyc += 12;                                    // 2382 jr z taken (score < 10000)
  } else {
    cyc += 12;                                    // 237e jr z taken (bit7 clear)
  }

  g.a = ctx.io.in(0x61) & 0xff; cyc += 11;        // 2391 in a,($61)
  // 2393 bit 6,a (register bit op: X/Y from the operand). Flags are live at the
  // `ret z` below, so set them exactly.
  {
    const bit = (g.a >> 6) & 1;
    fl.Z = bit ? 0 : 1; fl.P = fl.Z; fl.H = 1; fl.N = 0; fl.S = 0;
    fl.Y = (g.a >> 5) & 1; fl.X = (g.a >> 3) & 1;  // C preserved
  }
  cyc += 8;
  if (fl.Z) { cyc += 11; finish(); return; }      // 2395 ret z  (bonus-at-5000 DIP off)
  cyc += 5;
  setBC((BC() + 1) & 0xffff); cyc += 6;           // 2396 inc bc  -> thousands/hundreds
  g.a = r8(BC()); cyc += 7;                        // 2397 ld a,(bc)
  cp8(fl, g.a, 0x50); cyc += 7;                    // 2398 cp $50
  if (fl.C) { cyc += 11; finish(); return; }       // 239a ret c  (score < 5000)
  cyc += 5;
  // 239b bit 0,(hl); ret nz; set 0,(hl); jr $2389 -> award (un-ported tail)
  throw new Error('UPDATE_SCORE 0x2341: bonus-at-5000 award path not ported '
    + '(bit (hl) WZ ret / call $3538 / jp $259a)');
}
