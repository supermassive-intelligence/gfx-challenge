// T6.1 analyzer: instrument a fresh attract run, aggregate per-routine behavior
// and reconstruct the call graph (parent/child in routine terms).
// Method rule: derive everything from observed behavior. We do NOT read the
// "label" field of decode_oracle (that is the T6.2 rubric); only bytes/mnemonic.
import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/machine.js';
import { assembleRoms, ROM_FILES } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/roms.js';
import { ScriptPlayer, parseScript } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/script-player.js';

const ROMDIR = '/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const romRead = (name) => new Uint8Array(fs.readFileSync(path.join(ROMDIR, name)));
const scriptText = fs.readFileSync('/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/traces/scripts/attract-only.jsonl','utf8');

const CALL_OPCODES = new Set([0xcd,0xc4,0xcc,0xd4,0xdc,0xe4,0xec,0xf4,0xfc,0xc7,0xcf,0xd7,0xdf,0xe7,0xef,0xf7,0xff]);

const { header, records } = parseScript(scriptText);
const machine = new Machine();
machine.loadRoms(assembleRoms(romRead));
machine.reset();
const player = new ScriptPlayer(machine.input, header, records);

// per-routine aggregate keyed by entryPC
const R = new Map();
function rget(pc){ let r=R.get(pc); if(!r){ r={pc,count:0,isr:0,
  callerPCs:new Set(), parents:new Set(), children:new Set(),
  rmem:new Map(), wmem:new Map(), rio:new Map(), wio:new Map(),
  // register change frequency: how often regs_out differs from regs_in
  regChg:{}, sampleIn:null, sampleOut:null };
  R.set(pc,r);} return r; }
const REGS=['a','f','b','c','d','e','h','l','ix','iy','sp','i'];

const frames=[]; // {entryPC, callerPC, isISR, entrySP, rmem,wmem,rio,wio, regs_in}
let prev=null, pendingISR=null, totalCycles=0;
function curFrame(){return frames.length?frames[frames.length-1]:null;}

function snap(){ const s=machine.cpu.getState(); const f=s.flags;
  const fc=((f.S&1)<<7)|((f.Z&1)<<6)|((f.Y&1)<<5)|((f.H&1)<<4)|((f.X&1)<<3)|((f.P&1)<<2)|((f.N&1)<<1)|(f.C&1);
  return {a:s.a,f:fc,b:s.b,c:s.c,d:s.d,e:s.e,h:s.h,l:s.l,ix:s.ix,iy:s.iy,sp:s.sp,i:s.i};
}

const cb=machine.cpu.callbacks;
const oRB=cb.readByte,oWB=cb.writeByte,oRP=cb.readPort,oWP=cb.writePort;
let peek=null;
cb.readByte=(addr)=>{ const v=oRB(addr)&0xff; addr&=0xffff;
  if(peek&&!peek.used&&addr===peek.pc){peek.used=true;return v;}
  const fr=curFrame(); if(fr) fr.rmem.set(addr,v); return v; };
cb.writeByte=(addr,v)=>{ const fr=curFrame(); if(fr) fr.wmem.set(addr&0xffff,v&0xff); return oWB(addr,v); };
cb.readPort=(p)=>{ const v=oRP(p)&0xff; const fr=curFrame(); if(fr) fr.rio.set(p&0xffff,v); return v; };
cb.writePort=(p,v)=>{ const fr=curFrame(); if(fr) fr.wio.set(p&0xffff,v&0xff); return oWP(p,v); };

const oStep=machine.cpu.step.bind(machine.cpu);
machine.cpu.step=()=>{const c=oStep();totalCycles+=c;return c;};
const oInt=machine.cpu.interrupt.bind(machine.cpu);
machine.cpu.interrupt=(nm,data)=>{const callerPC=machine.cpu.getState().pc;const r=oInt(nm,data);pendingISR={callerPC};return r;};

function openFrame(entryPC,callerPC,sp,isISR){
  const parent=curFrame();
  frames.push({entryPC,callerPC,isISR,entrySP:sp,
    rmem:new Map(),wmem:new Map(),rio:new Map(),wio:new Map(),
    regs_in:snap(),parentEntry: parent?parent.entryPC:null});
}
function closeFrame(){
  const f=frames.pop();
  const out=snap();
  const r=rget(f.entryPC);
  r.count++; if(f.isISR) r.isr++;
  if(f.callerPC!=null) r.callerPCs.add(f.callerPC);
  if(f.parentEntry!=null) r.parents.add(f.parentEntry);
  // register children: this frame's parent gets us as child
  if(f.parentEntry!=null){ rget(f.parentEntry).children.add(f.entryPC); }
  for(const [a,v] of f.rmem){ if(!r.rmem.has(a)) r.rmem.set(a,v); }
  for(const [a,v] of f.wmem){ r.wmem.set(a,v); }
  for(const [a,v] of f.rio){ if(!r.rio.has(a)) r.rio.set(a,v); }
  for(const [a,v] of f.wio){ r.wio.set(a,v); }
  // register-change tracking
  for(const k of REGS){ if(f.regs_in[k]!==out[k]) r.regChg[k]=(r.regChg[k]||0)+1; }
  if(!r.sampleIn){ r.sampleIn=f.regs_in; r.sampleOut=out; }
}

machine.scheduler.onStep=()=>{
  const st=machine.cpu.getState(); const pc=st.pc, sp=st.sp;
  while(frames.length && sp>frames[frames.length-1].entrySP) closeFrame();
  if(pendingISR){ openFrame(pc,pendingISR.callerPC,sp,true); pendingISR=null; }
  else if(prev && CALL_OPCODES.has(prev.opcode) && sp===((prev.sp-2)&0xffff)){ openFrame(pc,prev.pc,sp,false); }
  prev={pc,sp,opcode:machine.memory.read8(pc)&0xff};
  peek={pc,used:false};
};

const total=header.frames||0;
for(let f=0;f<total;f++){ player.applyFrame(f); machine.runFrame(); }
while(frames.length) closeFrame();

// serialize compact
const out=[];
for(const [pc,r] of [...R.entries()].sort((a,b)=>a[0]-b[0])){
  out.push({
    pc, count:r.count, isr:r.isr,
    callerPCs:[...r.callerPCs].sort((a,b)=>a-b),
    parents:[...r.parents].sort((a,b)=>a-b),
    children:[...r.children].sort((a,b)=>a-b),
    rmem:[...r.rmem.keys()].sort((a,b)=>a-b),
    wmem:[...r.wmem.keys()].sort((a,b)=>a-b),
    rio:[...r.rio.entries()].sort((a,b)=>a[0]-b[0]),
    wio:[...r.wio.entries()].sort((a,b)=>a[0]-b[0]),
    regChg:r.regChg, sampleIn:r.sampleIn, sampleOut:r.sampleOut,
  });
}
fs.writeFileSync('/tmp/t61/routines.json', JSON.stringify(out,null,1));
console.error(`routines: ${out.length}`);
