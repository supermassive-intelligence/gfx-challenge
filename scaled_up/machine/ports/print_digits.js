// PRINT_DIGITS @0x2a40 -- print a B-digit BCD number at a screen position, via the
// digit-blitter loop. Non-leaf composite: composes CALCULATE_MAGIC_IMAGE_RAM_ADDRESS
// (0x29a3, ported) once and PRINT_CHAR (0x29db, ported) once per printed digit.
//
// Entry: DE = packed screen coords, HL = pointer to the BCD number (most-significant
// byte), B = digit count, C bit0 = pad flag (reset at entry). BCD packs two digits per
// byte; even loop-index reads the upper nibble (stays on the byte), odd reads the lower
// nibble (advances HL). Leading zeros print as spaces until the first nonzero digit (or
// the last digit), then padding is disabled.
//
// MAGIC-BYTE CARRY (ex af,af'): 0x29a3 returns the magic-image control byte in A; 2A48
// parks it in the SHADOW bank, and each iteration swaps it to live A only for the
// PRINT_CHAR call (2A7A) then parks it back (2A7E). PRINT_CHAR restores live A=ctrl /
// F=29a3-flags (its pop af) and clobbers the shadow bank (its own row counter), so after
// 2A7E the shadow again holds (ctrl byte, 29a3 flags) -- which is a_p_out / f_p_out at
// `ret` (nothing else touches the shadow). We model the swaps via ctx so this falls out.
//
// VALIDATION: bench against its inclusive composite record (traces/test-plans/
// composites-inclusive.jsonl) -- the hermetic bar restored by T9.2 Option 2.
//
// LIVE BEHAVIOUR: this routine is ~8800 T-states (6 digits x ~1300), far longer than the
// inter-interrupt gap (~4000 T), so the T9.1 interrupt-decline gate (maxCycles) ALWAYS
// declines it -- the Z80 core runs it, byte-identically by construction. It is therefore
// NOT fast-path-validated like a short port (0x1553); its live transparency is the core's,
// and the VRAM-stack residue never has to be replayed (the hook only replays residue on a
// fast-path, which never happens here). Registration gives the bench coverage + makes the
// port ready for the T10 native target (which drops the core and runs this directly).
import { CALCULATE_MAGIC_IMAGE_RAM_ADDRESS } from './magic_image_addr.js';
import { PRINT_CHAR } from './print_char.js';

const FLAG_KEYS = ['S', 'Z', 'Y', 'H', 'X', 'P', 'N', 'C'];

export function PRINT_DIGITS(ctx) {
  const g = ctx.regs, fl = ctx.flags;
  const r8 = (a) => ctx.mem.r8(a & 0xffff) & 0xff;
  let cyc = 0;

  const swapAF = () => {
    const ta = g.a; g.a = g.a_p; g.a_p = ta;
    for (const k of FLAG_KEYS) { const tv = fl[k]; fl[k] = ctx.flags_p[k]; ctx.flags_p[k] = tv; }
  };
  const exDEHL = () => { const d = g.d, e = g.e; g.d = g.h; g.e = g.l; g.h = d; g.l = e; };
  const HL = () => ((g.h << 8) | g.l) & 0xffff;
  const setHL = (v) => { g.h = (v >> 8) & 0xff; g.l = v & 0xff; };
  const DE = () => ((g.d << 8) | g.e) & 0xffff;
  const setDE = (v) => { g.d = (v >> 8) & 0xff; g.e = v & 0xff; };

  cyc += 11;                                       // 2A40 push bc
  const savB = g.b & 0xff, savC = g.c & 0xff;
  g.b = 0x00; cyc += 7;                            // 2A41 ld b,$00
  exDEHL(); cyc += 4;                              // 2A43 ex de,hl   HL = coords
  CALCULATE_MAGIC_IMAGE_RAM_ADDRESS(ctx); cyc += 17 + ctx.cycles; // 2A44 call $29A3 -> HL=addr, A=ctrl
  exDEHL(); cyc += 4;                              // 2A47 ex de,hl   DE=addr, HL=BCD ptr
  swapAF(); cyc += 4;                              // 2A48 ex af,af'  park ctrl byte
  g.b = savB; g.c = savC; cyc += 10;              // 2A49 pop bc
  g.c &= ~0x01; cyc += 8;                          // 2A4A res 0,c

  do {
    cyc += 4;                                      // 2A4C ld a,b
    const isLast = ((g.b - 1) & 0xff) === 0;       // 2A4D dec a -> Z when B==1
    cyc += 4;
    if (isLast) { cyc += 7; g.c |= 0x01; cyc += 8; } // 2A4E jr nz (not taken) ; 2A50 set 0,c
    else { cyc += 12; }                            // 2A4E jr nz taken
    let a = r8(HL()); cyc += 7;                    // 2A52 ld a,(hl)
    cyc += 8;                                       // 2A53 bit 0,b
    if (g.b & 0x01) {                              // 2A55 jr nz,$2A60 (odd index: lower nibble)
      cyc += 12;
      setHL((HL() + 1) & 0xffff); cyc += 6;        // 2A60 inc hl  (advance to next byte)
    } else {                                       // even index: upper nibble
      cyc += 7;
      a = (a >> 4) & 0x0f; cyc += 32;              // 2A57-2A5D srl a x4
      setHL((HL() - 1) & 0xffff); cyc += 6;        // 2A5F dec hl
      setHL((HL() + 1) & 0xffff); cyc += 6;        // 2A60 inc hl  (net unchanged)
    }
    a &= 0x0f; cyc += 7;                           // 2A61 and $0F
    let ch;
    if (a !== 0) {                                 // 2A63 jr nz,$2A6D
      cyc += 12;
      g.c |= 0x01; cyc += 8;                       // 2A6D set 0,c
      ch = (a + 0x30) & 0xff; cyc += 7;            // 2A6F add a,$30
      cyc += 7;                                    // 2A71 cp $3A
      if (ch < 0x3a) { cyc += 12; }                // 2A73 jr c (digit 0-9)
      else { cyc += 7; ch = (ch + 0x07) & 0xff; cyc += 7; } // 2A75 add a,$07 (A-F)
    } else {                                       // nibble == 0
      cyc += 7;
      cyc += 8;                                    // 2A65 bit 0,c
      if (g.c & 0x01) {                            // 2A67 jr nz,$2A6F (padding disabled -> print '0')
        cyc += 12;
        ch = (0x00 + 0x30) & 0xff; cyc += 7;       // 2A6F add a,$30 -> '0'
        cyc += 7;                                  // 2A71 cp $3A
        cyc += 12;                                 // 2A73 jr c
      } else {                                     // leading: print space
        cyc += 7;
        ch = 0x20; cyc += 7;                       // 2A69 ld a,$20
        cyc += 12;                                 // 2A6B jr $2A77
      }
    }

    // 2A77 push hl ; 2A78 push bc ; 2A79 ld c,a ; 2A7A ex af,af' ; call PRINT_CHAR
    cyc += 11 + 11;
    const pHL = HL(), pB = g.b, pC = g.c;
    g.c = ch & 0xff; cyc += 4;                     // 2A79 ld c,a  (char ordinal)
    swapAF(); cyc += 4;                            // 2A7A ex af,af' (ctrl byte -> live A)
    PRINT_CHAR(ctx); cyc += 17 + ctx.cycles;       // 2A7B call $29DB
    swapAF(); cyc += 4;                            // 2A7E ex af,af'
    g.b = pB; g.c = pC; cyc += 10;                 // 2A7F pop bc
    setHL(pHL); cyc += 10;                         // 2A80 pop hl

    g.a = r8(0x4379); cyc += 13;                   // 2A81 ld a,($4379) FLIP
    const flip = g.a !== 0;                        // 2A84 or a
    fl.Z = g.a === 0 ? 1 : 0; fl.S = (g.a >> 7) & 1; fl.N = 0; fl.H = 0;
    fl.C = 0; fl.P = parity8(g.a); fl.Y = (g.a >> 5) & 1; fl.X = (g.a >> 3) & 1;
    cyc += 4;
    if (flip) { cyc += 12; setDE((DE() - 1) & 0xffff); cyc += 6; } // 2A85 jr nz ; 2A8A dec de
    else { cyc += 7; setDE((DE() + 1) & 0xffff); cyc += 6; cyc += 12; } // 2A87 inc de ; 2A88 jr
    g.b = (g.b - 1) & 0xff;                         // 2A8B djnz
    cyc += (g.b !== 0) ? 13 : 8;
  } while (g.b !== 0);

  cyc += 10;                                       // 2A8D ret
  ctx.cycles = cyc;
}

function parity8(v) { let p = 1; for (let i = 0; i < 8; i++) p ^= (v >> i) & 1; return p; }
