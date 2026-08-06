// Build a global RAM access histogram to separate "variables" from bitmap/draw.
// Re-run with per-address read/write counts and the set of routines touching each.
import fs from 'node:fs';
import path from 'node:path';
import { Machine } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/machine.js';
import { assembleRoms, ROM_FILES } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/roms.js';
import { ScriptPlayer, parseScript } from '/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/machine/src/script-player.js';
const ROMDIR='/Users/sudnya/checkout/smi/gfx-challenge/rom/berzerk';
const romRead=(n)=>new Uint8Array(fs.readFileSync(path.join(ROMDIR,n)));
const scriptText=fs.readFileSync('/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/traces/scripts/attract-only.jsonl','utf8');
const CALL=new Set([0xcd,0xc4,0xcc,0xd4,0xdc,0xe4,0xec,0xf4,0xfc,0xc7,0xcf,0xd7,0xdf,0xe7,0xef,0xf7,0xff]);
const {header,records}=parseScript(scriptText);
const m=new Machine(); m.loadRoms(assembleRoms(romRead)); m.reset();
const player=new ScriptPlayer(m.input,header,records);
// histogram: addr -> {r,w, routines:Set}
const H=new Map();
function hg(a){let h=H.get(a);if(!h){h={r:0,w:0,rt:new Set(),wt:new Set()};H.set(a,h);}return h;}
const frames=[]; let prev=null,pend=null;
function cur(){return frames.length?frames[frames.length-1]:null;}
const cb=m.cpu.callbacks; const oRB=cb.readByte,oWB=cb.writeByte;
let peek=null;
cb.readByte=(addr)=>{const v=oRB(addr)&0xff;addr&=0xffff;
  if(peek&&!peek.used&&addr===peek.pc){peek.used=true;return v;}
  const fr=cur(); if(fr){const h=hg(addr);h.r++;h.rt.add(fr);} return v;};
cb.writeByte=(addr,v)=>{const fr=cur();if(fr){const h=hg(addr&0xffff);h.w++;h.wt.add(fr);}return oWB(addr,v);};
const oInt=m.cpu.interrupt.bind(m.cpu);
m.cpu.interrupt=(nm,d)=>{const pc=m.cpu.getState().pc;const r=oInt(nm,d);pend={pc};return r;};
m.scheduler.onStep=()=>{const st=m.cpu.getState();const pc=st.pc,sp=st.sp;
  while(frames.length&&sp>frames[frames.length-1].sp) frames.pop();
  if(pend){frames.push({e:pc,sp});pend=null;}
  else if(prev&&CALL.has(prev.op)&&sp===((prev.sp-2)&0xffff)){frames.push({e:pc,sp});}
  prev={pc,sp,op:m.memory.read8(pc)&0xff}; peek={pc,used:false};
};
const total=header.frames||0;
for(let f=0;f<total;f++){player.applyFrame(f);m.runFrame();}
// Note: frames carry routine entry as .e; rt/wt store frame OBJECTS; convert to entry set
function entries(set){const s=new Set();for(const fr of set)s.add(fr.e);return [...s].sort((a,b)=>a-b);}
// Only care about RAM regions (writable): 0x0800-0x0BFF, 0x4000-0x7FFF, 0x8000-0x87FF
const rows=[];
for(const [a,h] of [...H.entries()].sort((x,y)=>x[0]-y[0])){
  const ram = (a>=0x0800&&a<=0x0fff)||(a>=0x4000&&a<=0x87ff);
  if(!ram) continue;
  rows.push({a,r:h.r,w:h.w,rt:entries(h.rt),wt:entries(h.wt)});
}
fs.writeFileSync('/tmp/t61/ram_hist.json',JSON.stringify(rows));
// Summary by region with write counts
const reg=(a)=> a<=0x0bff?'NVRAM':a<=0x0fff?'NVRAM(mir)':a<=0x5fff?'VRAM':a<=0x7fff?'MAGIC':'COLOR';
const agg={};
for(const row of rows){const g=reg(row.a);agg[g]=agg[g]||{addrs:0,w:0,r:0};agg[g].addrs++;agg[g].w+=row.w;agg[g].r+=row.r;}
console.error(JSON.stringify(agg,null,1));
// NVRAM detail (likely all variables)
const nv=rows.filter(r=>r.a>=0x0800&&r.a<=0x0bff);
console.error('NVRAM distinct addrs touched:',nv.length);
