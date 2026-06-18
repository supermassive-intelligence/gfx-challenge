// Per-routine disassembly via bounded CFG walk using the validated z80 disassembler.
import fs from 'node:fs';
import { makeDis } from '/tmp/t61/z80dis.js';
const bin=new Uint8Array(fs.readFileSync('/Users/sudnya/checkout/smi/gfx-challenge/scaled_up/disassembler/oracle/berzerk_flat.bin'));
const dis=makeDis(a=>bin[a]||0);
const routines=JSON.parse(fs.readFileSync('/tmp/t61/routines.json'));
const entrySet=new Set(routines.map(r=>r.pc));
function target(m){ const mm=m.match(/\$([0-9a-fA-F]{4})\b/); return mm?parseInt(mm[1],16):null; }
function isUncondJump(m){ return /^jp \$/.test(m)||/^jr \$/.test(m)||/^jp \(/.test(m); }
function isCondJump(m){ return /^jp (n?z|n?c|po|pe|p|m),/.test(m)||/^jr (n?z|n?c),/.test(m)||/^djnz /.test(m); }
function isRet(m){ return m==='ret'||m==='reti'||m==='retn'; }
function walk(entry){
  const seen=new Set(); const blocks=[entry]; const insns=new Map(); let lo=entry,hi=entry;
  while(blocks.length){ let a=blocks.pop();
    while(true){ if(seen.has(a))break; if(a<0||a>0x37ff)break;
      const o=dis(a); seen.add(a); insns.set(a,o); if(a<lo)lo=a; if(a+o.len>hi)hi=a+o.len;
      const m=o.m;
      if(isRet(m))break;
      if(isCondJump(m)){ const t=target(m); if(t!=null&&t>=entry&&t<entry+0x300&&!(entrySet.has(t)&&t!==entry))blocks.push(t); a+=o.len; continue; }
      if(isUncondJump(m)){ const t=target(m); if(t!=null&&t>=entry&&t<entry+0x300&&!(entrySet.has(t)&&t!==entry))blocks.push(t); break; }
      a+=o.len;
    }
  }
  return {insns:[...insns.entries()].sort((x,y)=>x[0]-y[0]).map(([addr,o])=>({addr,m:o.m,len:o.len})),lo,hi};
}
const out={};
for(const r of routines) out[r.pc]=walk(r.pc);
fs.writeFileSync('/tmp/t61/disasm.json',JSON.stringify(out));
let tot=0,bad=[]; for(const k in out){tot+=out[k].insns.length; if(out[k].insns.length===0)bad.push(k);}
console.error('routines:',Object.keys(out).length,'insns:',tot,'zero-insn:',bad);
