// Compact Z80 disassembler, output formatted to match decode_oracle style.
// Validated against decode_oracle.jsonl (same mnemonic at shared boundaries).
export function makeDis(mem){ // mem: (addr)=>byte
  const r8=['b','c','d','e','h','l','(hl)','a'];
  const rp=['bc','de','hl','sp'];
  const rp2=['bc','de','hl','af'];
  const cc=['nz','z','nc','c','po','pe','p','m'];
  const alu=['add a,','adc a,','sub ','sbc a,','and ','xor ','or ','cp '];
  const rot=['rlc','rrc','rl','rr','sla','sra','sll','srl'];
  const hx2=v=>'$'+(v&0xff).toString(16).padStart(2,'0');
  const hx4=v=>'$'+(v&0xffff).toString(16).padStart(4,'0');
  function dis(pc){
    let a=pc, op=mem(a++)&0xff, len, m;
    const nn=()=> (mem(a)&0xff)|((mem(a+1)&0xff)<<8);
    const n =()=> mem(a)&0xff;
    const d =()=> { let x=mem(a)&0xff; return x>=128?x-256:x; };
    const idx=(reg)=>{ // DD/FD prefix
      let o2=mem(a++)&0xff;
      const ireg=reg;
      const disp=()=>{ let x=mem(a)&0xff; x=x>=128?x-256:x; a++; return (x<0?'-$'+(-x).toString(16).padStart(2,'0'):'+$'+x.toString(16).padStart(2,'0')); };
      // handle subset used; fall back generic
      // We implement common DD/FD forms.
      if(o2===0xcb){ let dd=d(); a++; let o3=mem(a++)&0xff; // DDCB
        const bit=(o3>>3)&7, reg2=o3&7; const tgt=`(${ireg}${dd<0?'-$'+(-dd).toString(16).padStart(2,'0'):'+$'+dd.toString(16).padStart(2,'0')})`;
        if(o3<0x40) m=`${rot[(o3>>3)&7]} ${tgt}`;
        else if(o3<0x80) m=`bit ${bit},${tgt}`;
        else if(o3<0xc0) m=`res ${bit},${tgt}`;
        else m=`set ${bit},${tgt}`;
        return {len:a-pc,m};
      }
      // map o2 like main but substitute hl->ireg, (hl)->(ireg+d), h->ixh etc.
      const tbl={
        0x09:`add ${ireg},bc`,0x19:`add ${ireg},de`,0x29:`add ${ireg},${ireg}`,0x39:`add ${ireg},sp`,
        0x21:()=>`ld ${ireg},${hx4(nn())}`,0x22:()=>`ld (${hx4(nn())}),${ireg}`,0x2a:()=>`ld ${ireg},(${hx4(nn())})`,
        0x23:`inc ${ireg}`,0x2b:`dec ${ireg}`,0xe1:`pop ${ireg}`,0xe5:`push ${ireg}`,0xe9:`jp (${ireg})`,0xf9:`ld sp,${ireg}`,
        0xe3:`ex (sp),${ireg}`,
        0x34:()=>`inc (${ireg}${disp()})`,0x35:()=>`dec (${ireg}${disp()})`,0x36:()=>{let s=disp();return `ld (${ireg}${s}),${hx2(n())}`;},
      };
      if(o2===0x36){ let s=disp(); let v=mem(a++)&0xff; return {len:a-pc,m:`ld (${ireg}${s}),${hx2(v)}`}; }
      if(o2===0x34){ let s=disp(); return {len:a-pc,m:`inc (${ireg}${s})`}; }
      if(o2===0x35){ let s=disp(); return {len:a-pc,m:`dec (${ireg}${s})`}; }
      // LD r,(ireg+d) and LD (ireg+d),r
      if((o2&0xc0)===0x40 && (((o2&0x07)===6)||(((o2>>3)&0x07)===6)) && o2!==0x76){
        const dst=(o2>>3)&7, src=o2&7;
        if(src===6){ let s=disp(); return {len:a-pc,m:`ld ${r8[dst]},(${ireg}${s})`}; }
        else { let s=disp(); return {len:a-pc,m:`ld (${ireg}${s}),${r8[src]}`}; }
      }
      // ALU (ireg+d)
      if((o2&0xc0)===0x80 && (o2&0x07)===6){ let s=disp(); return {len:a-pc,m:`${alu[(o2>>3)&7]}(${ireg}${s})`}; }
      if(tbl[o2]!==undefined){ const t=tbl[o2]; return {len:a-pc,m:(typeof t==='function')?t():t}; }
      // fallback: treat prefix as nop-ish; decode o2 as plain (rare) - shouldn't happen in code
      return {len:a-pc,m:`db ${hx2(op)} ; ${ireg}-prefixed ${hx2(o2)}`};
    };
    if(op===0xcb){ let o2=mem(a++)&0xff; const bit=(o2>>3)&7, reg=o2&7;
      if(o2<0x40) m=`${rot[(o2>>3)&7]} ${r8[reg]}`;
      else if(o2<0x80) m=`bit ${bit},${r8[reg]}`;
      else if(o2<0xc0) m=`res ${bit},${r8[reg]}`;
      else m=`set ${bit},${r8[reg]}`;
      return {len:a-pc,m};
    }
    if(op===0xed){ let o2=mem(a++)&0xff;
      const ed={0x44:'neg',0x45:'retn',0x4d:'reti',0x46:'im 0',0x56:'im 1',0x5e:'im 2',
        0x47:'ld i,a',0x4f:'ld r,a',0x57:'ld a,i',0x5f:'ld a,r',0x67:'rrd',0x6f:'rld',
        0xa0:'ldi',0xa1:'cpi',0xa2:'ini',0xa3:'outi',0xa8:'ldd',0xa9:'cpd',0xaa:'ind',0xab:'outd',
        0xb0:'ldir',0xb1:'cpir',0xb2:'inir',0xb3:'otir',0xb8:'lddr',0xb9:'cpdr',0xba:'indr',0xbb:'otdr'};
      if(ed[o2]) return {len:a-pc,m:ed[o2]};
      if((o2&0xc7)===0x40){ return {len:a-pc,m:`in ${r8[(o2>>3)&7]},(c)`}; }
      if((o2&0xc7)===0x41){ return {len:a-pc,m:`out (c),${r8[(o2>>3)&7]}`}; }
      if((o2&0xcf)===0x4b){ let v=nn(); a+=2; return {len:a-pc,m:`ld ${rp[(o2>>4)&3]},(${hx4(v)})`}; }
      if((o2&0xcf)===0x43){ let v=nn(); a+=2; return {len:a-pc,m:`ld (${hx4(v)}),${rp[(o2>>4)&3]}`}; }
      if((o2&0xcf)===0x42){ return {len:a-pc,m:`sbc hl,${rp[(o2>>4)&3]}`}; }
      if((o2&0xcf)===0x4a){ return {len:a-pc,m:`adc hl,${rp[(o2>>4)&3]}`}; }
      return {len:a-pc,m:`db $ed,${hx2(o2)}`};
    }
    if(op===0xdd) return idx('ix');
    if(op===0xfd) return idx('iy');
    // main page
    const main={
      0x00:'nop',0x76:'halt',0xf3:'di',0xfb:'ei',0x07:'rlca',0x0f:'rrca',0x17:'rla',0x1f:'rra',
      0x27:'daa',0x2f:'cpl',0x37:'scf',0x3f:'ccf',0xeb:'ex de,hl',0x08:"ex af,af'",0xd9:'exx',
      0xe3:'ex (sp),hl',0xe9:'jp (hl)',0xf9:'ld sp,hl',0xc9:'ret',
      0x02:'ld (bc),a',0x12:'ld (de),a',0x0a:'ld a,(bc)',0x1a:'ld a,(de)',
    };
    if(main[op]) return {len:a-pc,m:main[op]};
    // ld rp,nn
    if((op&0xcf)===0x01){ let v=nn(); a+=2; return {len:a-pc,m:`ld ${rp[(op>>4)&3]},${hx4(v)}`}; }
    if((op&0xcf)===0x09){ return {len:a-pc,m:`add hl,${rp[(op>>4)&3]}`}; }
    if((op&0xcf)===0x03){ return {len:a-pc,m:`inc ${rp[(op>>4)&3]}`}; }
    if((op&0xcf)===0x0b){ return {len:a-pc,m:`dec ${rp[(op>>4)&3]}`}; }
    if((op&0xc7)===0x04){ return {len:a-pc,m:`inc ${r8[(op>>3)&7]}`}; }
    if((op&0xc7)===0x05){ return {len:a-pc,m:`dec ${r8[(op>>3)&7]}`}; }
    if((op&0xc7)===0x06){ let v=n(); a++; return {len:a-pc,m:`ld ${r8[(op>>3)&7]},${hx2(v)}`}; }
    if(op===0x32){ let v=nn(); a+=2; return {len:a-pc,m:`ld (${hx4(v)}),a`}; }
    if(op===0x3a){ let v=nn(); a+=2; return {len:a-pc,m:`ld a,(${hx4(v)})`}; }
    if(op===0x22){ let v=nn(); a+=2; return {len:a-pc,m:`ld (${hx4(v)}),hl`}; }
    if(op===0x2a){ let v=nn(); a+=2; return {len:a-pc,m:`ld hl,(${hx4(v)})`}; }
    if(op===0x10){ let dd=d(); a++; return {len:a-pc,m:`djnz ${hx4(pc+2+dd)}`}; }
    if(op===0x18){ let dd=d(); a++; return {len:a-pc,m:`jr ${hx4(pc+2+dd)}`}; }
    if((op&0xe7)===0x20){ let dd=d(); a++; return {len:a-pc,m:`jr ${cc[(op>>3)&3]},${hx4(pc+2+dd)}`}; }
    if(op===0xc3){ let v=nn(); a+=2; return {len:a-pc,m:`jp ${hx4(v)}`}; }
    if((op&0xc7)===0xc2){ let v=nn(); a+=2; return {len:a-pc,m:`jp ${cc[(op>>3)&7]},${hx4(v)}`}; }
    if(op===0xcd){ let v=nn(); a+=2; return {len:a-pc,m:`call ${hx4(v)}`}; }
    if((op&0xc7)===0xc4){ let v=nn(); a+=2; return {len:a-pc,m:`call ${cc[(op>>3)&7]},${hx4(v)}`}; }
    if((op&0xc7)===0xc0){ return {len:a-pc,m:`ret ${cc[(op>>3)&7]}`}; }
    if((op&0xc7)===0xc7){ return {len:a-pc,m:`rst ${hx2(op&0x38)}`}; }
    if((op&0xcf)===0xc5){ return {len:a-pc,m:`push ${rp2[(op>>4)&3]}`}; }
    if((op&0xcf)===0xc1){ return {len:a-pc,m:`pop ${rp2[(op>>4)&3]}`}; }
    if((op&0xc0)===0x40){ // ld r,r'
      return {len:a-pc,m:`ld ${r8[(op>>3)&7]},${r8[op&7]}`};
    }
    if((op&0xc0)===0x80){ return {len:a-pc,m:`${alu[(op>>3)&7]}${r8[op&7]}`}; }
    if((op&0xc7)===0xc6){ let v=n(); a++; return {len:a-pc,m:`${alu[(op>>3)&7]}${hx2(v)}`}; }
    if(op===0xd3){ let v=n(); a++; return {len:a-pc,m:`out (${hx2(v)}),a`}; }
    if(op===0xdb){ let v=n(); a++; return {len:a-pc,m:`in a,(${hx2(v)})`}; }
    return {len:a-pc,m:`db ${hx2(op)}`};
  }
  return dis;
}
