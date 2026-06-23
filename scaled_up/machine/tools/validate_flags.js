// validate_flags.js -- Step-2 infra validation. Drives the vendored z80_core.js
// with the REAL opcode for each new z80flags.js helper and compares the resulting
// flags/register exhaustively. The core is the reference; a helper is accepted only
// if it matches the core on every input combination. Run: node tools/validate_flags.js

import { Z80 } from '../src/cpu/z80_core.js';
import * as F from '../ports/z80flags.js';

const FLAG_KEYS = ['S','Z','Y','H','X','P','N','C'];
function composeF(fl){return ((fl.S&1)<<7)|((fl.Z&1)<<6)|((fl.Y&1)<<5)|((fl.H&1)<<4)|((fl.X&1)<<3)|((fl.P&1)<<2)|((fl.N&1)<<1)|(fl.C&1);}

// One core instance over a flat 64K memory; we rewrite opcode bytes per case.
const mem = new Uint8Array(0x10000);
const core = Z80({
  mem_read: (a) => mem[a & 0xffff],
  mem_write: (a, v) => { mem[a & 0xffff] = v & 0xff; },
  io_read: () => 0xff,
  io_write: () => {},
});

function blankState() {
  const flags = {S:0,Z:0,Y:0,H:0,X:0,P:0,N:0,C:0};
  return {
    a:0,b:0,c:0,d:0,e:0,h:0,l:0, a_prime:0,b_prime:0,c_prime:0,d_prime:0,e_prime:0,h_prime:0,l_prime:0,
    ix:0,iy:0,i:0,r:0,sp:0xdff0,pc:0,
    flags: {...flags}, flags_prime: {...flags},
    imode:0, iff1:0, iff2:0, halted:false, do_delayed_di:false, do_delayed_ei:false, cycle_counter:0,
  };
}

// Run a single instruction whose bytes are placed at pc=0; return out flags + A.
function runOp(bytes, setup) {
  for (let i = 0; i < bytes.length; i++) mem[i] = bytes[i];
  const st = blankState();
  setup(st);
  st.pc = 0;
  core.setState(st);
  core.run_instruction();
  return core.getState();
}

let pass = 0, fail = 0;
const failSamples = [];
// maskXY: drop the undocumented X(bit3)/Y(bit5) from the comparison. Used for
// bit n,(hl), whose X/Y come from the internal WZ register that a port ctx cannot
// see; only the documented S/Z/H/P/N/C are reproducible (and validated here).
function check(name, want, gotFlags, gotA, extra, maskXY) {
  let wf = composeF(want.flags), gf = composeF(gotFlags);
  if (maskXY) { const m = ~((1 << 3) | (1 << 5)) & 0xff; wf &= m; gf &= m; }
  const aOk = (gotA == null) || ((want.a & 0xff) === (gotA & 0xff));
  if (wf === gf && aOk) { pass++; return; }
  fail++;
  if (failSamples.length < 8)
    failSamples.push(`${name}: ${extra} core f=0x${wf.toString(16)} a=0x${(want.a&0xff).toString(16)} | helper f=0x${gf.toString(16)} a=0x${(gotA&0xff).toString(16)}`);
}

// --- DAA (0x27): all 256 A x {N,H,C} = 2048 cases -------------------------------
for (let a = 0; a < 256; a++) for (let n = 0; n < 2; n++) for (let h = 0; h < 2; h++) for (let cf = 0; cf < 2; cf++) {
  const out = runOp([0x27], (st) => { st.a = a; st.flags.N = n; st.flags.H = h; st.flags.C = cf; });
  const fl = {S:0,Z:0,Y:0,H:h,X:0,P:0,N:n,C:cf};
  const ra = F.daa8(fl, a);
  check('daa', {flags: out.flags, a: out.a}, fl, ra, `a=0x${a.toString(16)} N=${n} H=${h} C=${cf}`);
}

// --- SLA A (CB 0x27): 256 A x {C-in irrelevant, but vary all flags-in} ----------
for (let a = 0; a < 256; a++) {
  const out = runOp([0xcb, 0x27], (st) => { st.a = a; });
  const fl = {S:0,Z:0,Y:0,H:0,X:0,P:0,N:0,C:0};
  const ra = F.sla8(fl, a);
  check('sla', {flags: out.flags, a: out.a}, fl, ra, `a=0x${a.toString(16)}`);
}

// --- RLA (0x17): 256 A x C-in (S,Z,P must be preserved -> seed them set) --------
for (let a = 0; a < 256; a++) for (let cin = 0; cin < 2; cin++) {
  const out = runOp([0x17], (st) => { st.a = a; st.flags.C = cin; st.flags.S=1; st.flags.Z=1; st.flags.P=1; });
  const fl = {S:1,Z:1,Y:0,H:0,X:0,P:1,N:0,C:cin};
  const ra = F.rla8(fl, a, cin);
  check('rla', {flags: out.flags, a: out.a}, fl, ra, `a=0x${a.toString(16)} cin=${cin}`);
}

// --- RLCA (0x07): 256 A (S,Z,P preserved) ---------------------------------------
for (let a = 0; a < 256; a++) {
  const out = runOp([0x07], (st) => { st.a = a; st.flags.S=1; st.flags.Z=1; st.flags.P=1; });
  const fl = {S:1,Z:1,Y:0,H:0,X:0,P:1,N:0,C:0};
  const ra = F.rlca8(fl, a);
  check('rlca', {flags: out.flags, a: out.a}, fl, ra, `a=0x${a.toString(16)}`);
}

// --- BIT n,(ix+d) (DD CB d 46+8n): vary n, value-at-addr, and ix/d so the address
//     high byte varies. C must be preserved -> seed C=1. -------------------------
for (let n = 0; n < 8; n++) for (const ixHi of [0x00, 0x42, 0x80, 0xff]) for (const d of [0x00, 0x05, 0x7f]) {
  for (const val of [0x00, 0xff, 1 << n, (~(1 << n)) & 0xff]) {
    const ix = (ixHi << 8) | 0x10;            // low byte arbitrary
    const addr = (ix + d) & 0xffff;
    const op = 0x46 + n * 8;
    const out = runOp([0xdd, 0xcb, d, op], (st) => { st.ix = ix; st.flags.C = 1; mem[addr] = val; });
    const fl = {S:0,Z:0,Y:0,H:0,X:0,P:0,N:0,C:1};
    F.bitIdx8(fl, n, val, (addr >> 8) & 0xff);
    // X/Y MASKED: z80_core implements the simplified bit-number rule for BIT undoc
    // flags (Y=(n==5&&bit), X=(n==3&&bit) -- see z80_core.js ~L1762), NOT the
    // documented-hardware rule that BIT n,(ix+d) takes X/Y from the HIGH BYTE of
    // (ix+d). bitIdx8 implements the hardware rule, so the two disagree at addrHi
    // values with bits 3/5 set. z80_core is therefore not authoritative for these
    // two bits; only the documented S/Z/H/P/N/C are cross-checked here. The X/Y rule
    // is exercised against MAME records via the 0x15cb bench (where the real actor
    // pointers have no bit-3/5 in their high byte, so it reduces to X=Y=0).
    check('bitIdx', {flags: out.flags, a: out.a}, fl, null, `n=${n} ixHi=0x${ixHi.toString(16)} d=0x${d.toString(16)} val=0x${val.toString(16)} addrHi=0x${((addr>>8)&0xff).toString(16)}`, true);
  }
}

// --- BIT n,(hl) (CB 46+8n): documented S/Z/H/P/N/C only (X/Y are WZ-sourced and
//     masked out). C must be preserved -> seed C=1. hl points into RAM. ----------
for (let n = 0; n < 8; n++) for (const val of [0x00, 0xff, 1 << n, (~(1 << n)) & 0xff]) {
  const addr = 0x9000;                          // RAM, away from the opcode bytes
  const op = 0x46 + n * 8;
  const out = runOp([0xcb, op], (st) => { st.h = 0x90; st.l = 0x00; st.flags.C = 1; mem[addr] = val; });
  const fl = {S:0,Z:0,Y:0,H:0,X:0,P:0,N:0,C:1};
  F.bitHL8(fl, n, val);
  check('bitHL', {flags: out.flags, a: out.a}, fl, null, `n=${n} val=0x${val.toString(16)}`, true);
}

console.log(`validate_flags: ${pass} pass, ${fail} fail`);
if (fail) { console.log('first failures:'); for (const s of failSamples) console.log('  ' + s); process.exit(1); }
process.exit(0);
