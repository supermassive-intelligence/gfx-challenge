import fs from 'node:fs';
const routines=JSON.parse(fs.readFileSync('/tmp/t61/routines.json'));
const disasm=JSON.parse(fs.readFileSync('/tmp/t61/disasm.json'));
const R=new Map(routines.map(r=>[r.pc,r]));
const hx=x=>'0x'+x.toString(16).padStart(4,'0');
const hb=x=>x.toString(16).padStart(2,'0');

// entropy site definitions (from entropy-berzerk.md)
const ENTROPY_PORT_SITE={0x26B4:'V256 bit0 (interrupt-path selector)'};
const ENTROPY_MEM=new Set([0x089f,0x08a0,0x435c]);
const RANDOM=0x2678;

// call-graph depth (longest path to a leaf), with cycle guard
const depthMemo=new Map();
function depth(pc,stack=new Set()){
  if(depthMemo.has(pc))return depthMemo.get(pc);
  if(stack.has(pc))return 0; stack.add(pc);
  const r=R.get(pc); let d=0;
  if(r) for(const c of r.children){ if(c!==pc) d=Math.max(d,1+depth(c,stack)); }
  stack.delete(pc); depthMemo.set(pc,d); return d;
}
const order=[...routines].sort((a,b)=> depth(a.pc)-depth(b.pc) || a.pc-b.pc);

function region(a){
  if(a<=0x07ff)return'ROM0'; if(a<=0x0bff)return'NVRAM'; if(a<=0x0fff)return'NVRAM~';
  if(a<=0x37ff)return'ROM1-5'; if(a<=0x3fff)return'ROM6e';
  if(a<=0x5fff)return'VRAM'; if(a<=0x7fff)return'MAGIC'; if(a<=0x87ff)return'COLOR'; return'?';
}
function regsum(addrs){ // summarize an address list by region with ranges
  const byreg={};
  for(const a of addrs){const g=region(a);(byreg[g]=byreg[g]||[]).push(a);}
  const parts=[];
  for(const g of ['ROM0','NVRAM','NVRAM~','ROM1-5','ROM6e','VRAM','MAGIC','COLOR','?']){
    if(!byreg[g])continue; const xs=byreg[g];
    // compress to ranges
    let s='',start=xs[0],prev=xs[0];
    const ranges=[];
    for(let i=1;i<xs.length;i++){ if(xs[i]===prev+1){prev=xs[i];continue;} ranges.push([start,prev]); start=prev=xs[i]; }
    ranges.push([start,prev]);
    const rs=ranges.map(([a,b])=>a===b?hx(a):hx(a)+'-'+hx(b));
    const shown = rs.length>10 ? rs.slice(0,10).join(' ')+` ...(+${rs.length-10} ranges, last ${rs[rs.length-1]})` : rs.join(' ');
    parts.push(`${g}{${xs.length}}: `+shown);
  }
  return parts;
}

let out='';
for(const r of order){
  const d=disasm[r.pc];
  out+=`\n========== ${hx(r.pc)}  (depth ${depth(r.pc)}, calls=${r.count}${r.isr?', ISR x'+r.isr:''}) ==========\n`;
  out+=`callers(site): ${r.callerPCs.map(hx).join(' ')||'(none / ISR/root)'}\n`;
  out+=`parent routines: ${r.parents.map(hx).join(' ')||'(root)'}\n`;
  out+=`child routines:  ${r.children.map(hx).join(' ')||'(LEAF)'}\n`;
  // ports (mask 16-bit bus addr -> real port = low byte; high byte was A or B)
  const rmap=new Map(); for(const [p] of r.rio){const lp=p&0xff;rmap.set(lp,(rmap.get(lp)||0)+1);}
  const wmap=new Map(); for(const [p,v] of r.wio){const lp=p&0xff;let s=wmap.get(lp)||new Set();s.add(v);wmap.set(lp,s);}
  const rio=[...rmap.keys()].sort((a,b)=>a-b).map(p=>hb(p)).join(' ');
  const wio=[...wmap.keys()].sort((a,b)=>a-b).map(p=>`${hb(p)}<=[${[...wmap.get(p)].sort((a,b)=>a-b).map(hb).join(',')}]`).join('  ');
  out+=`ports read:  ${rio||'-'}\n`;
  out+=`ports write: ${wio||'-'}\n`;
  // entropy flags
  const ent=[];
  for(const s in ENTROPY_PORT_SITE){} // handled below by checking read PCs not available; use port+children
  if(r.rio.some(([p])=>(p&0xff)===0x4e)) ent.push('reads port 0x4E');
  if(r.rmem.some(a=>ENTROPY_MEM.has(a))||r.wmem.some(a=>ENTROPY_MEM.has(a))) ent.push('touches 0x089F/0x08A0/0x435C');
  if(r.children.includes(RANDOM)||r.pc===RANDOM) ent.push('RANDOM(0x2678) '+(r.pc===RANDOM?'IS':'caller'));
  out+=`ENTROPY: ${ent.join('; ')||'none'}\n`;
  // RAM read/write summaries (skip ROM reads to reduce noise; show NVRAM/VRAM/MAGIC/COLOR)
  const wr=r.wmem.filter(a=>a>=0x0800);
  const rd=r.rmem.filter(a=>a>=0x0800&&!(a>=0x1000&&a<=0x3fff)); // drop ROM1-5 const reads
  out+='writes -> '+(regsum(wr).join(' | ')||'(none)')+'\n';
  out+='reads  <- '+(regsum(rd).join(' | ')||'(none)')+'\n';
  // register deltas
  const chg=Object.entries(r.regChg).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(' ');
  out+=`reg-changed(freq): ${chg||'(none)'}\n`;
  // disasm
  out+=`--- disasm (${d.insns.length} insn, span ${hx(d.lo)}-${hx(d.hi)}) ---\n`;
  for(const i of d.insns){ out+=`  ${hx(i.addr)}: ${i.m}\n`; }
}
fs.writeFileSync('/tmp/t61/report.txt',out);
console.error('wrote report.txt, routines:',order.length,'bytes:',out.length);
// also emit a compact index of depth ordering
let idx='depth | pc | calls | leaf? | ports\n';
for(const r of order){ const rp=[...new Set(r.rio.map(([p])=>p&0xff))].sort((a,b)=>a-b).map(hb); const wp=[...new Set(r.wio.map(([p])=>p&0xff))].sort((a,b)=>a-b).map(hb); idx+=`${depth(r.pc)} ${hx(r.pc)} calls=${r.count} ${r.children.length?'':'LEAF'} rio:${rp.join(',')} wio:${wp.join(',')}\n`; }
fs.writeFileSync('/tmp/t61/index.txt',idx);
