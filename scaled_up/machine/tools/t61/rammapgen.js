import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync('/tmp/t61/ram_hist.json'));
const hx=x=>'0x'+x.toString(16).padStart(4,'0');
const H=new Map(rows.map(r=>[r.a,r]));
const wt=a=>{const r=H.get(a);return r?r.wt.map(x=>x.toString(16).padStart(4,'0')).join(' '):'';};
const rwt=a=>{const r=H.get(a);return r?`r=${r.r} w=${r.w}`:'(untouched)';};

// derived variable map: [addrLo, addrHi, name, meaning]
const VARS=[
 // NVRAM 0x0800-0x0BFF (work RAM)
 ['NVRAM 0x0800-0x0BFF (battery-backed work RAM; cleared at cold boot)'],
 [0x081e,0x081f,'sfx_misc_a','SFX scratch word (NMI-written).'],
 [0x0820,0x0827,'bolt_draw_scratch','Bolt-engine working coords/limits (per-bolt temp X/Y and limit compares; written by 0x1553/0x157E/0x1597/0x15A0/0x29A1).'],
 [0x0828,0x082d,'bolt_engine_state','Bolt-engine per-pass counters/pointers (0x14F3/0x1505/0x151A and the IRQ 0x26AB).'],
 [0x082a,0x082b,'blit_scratch','Blitter scratch (shared with 0x2817/0x29A3).'],
 [0x082e,0x0831,'object_motion_scratch','Object-motion accumulator (0x27A9/0x27F5).'],
 [0x0832,0x083f,'irq_object_scratch','IM2-IRQ object/draw scratch (only written by 0x26AB).'],
 [0x0850,0x0853,'sfx_seq_ptr','Active SFX-sequencer stream pointers (0x1D12/0x1D22).'],
 [0x0852,0x0853,'sfx_seq_cursor','SFX-sequencer read cursor.'],
 [0x0854,0x085d,'nmi_regsave','NMI/IRQ saved-register & sound-state block (0x0066/0x1721/0x1721).'],
 [0x085e,0x085f,'nmi_saved_sp','Saved SP for the NMI private stack (0x1721 ld (085e),sp).'],
 [0x086a,0x086d,'sfx_misc_b','SFX scratch (NMI).'],
 [0x086c,0x086f,'actor_link_tmp','Actor-list temp link words (coroutine scheduler 0x1E6D/0x1E78/0x2B54).'],
 [0x086e,0x086f,'actor_sched_cur','Scheduler current-frame pointer.'],
 [0x0870,0x0871,'actor_list_tail','Actor/object list tail pointer (IRQ object walk 0x26AB/0x272D/0x27A9; updated 0x24F7).'],
 [0x0872,0x0873,'actor_list_head','Actor/coroutine list head (the active actor frame pointer; coroutine scheduler).'],
 [0x0874,0x0875,'irq_saved_sp','Saved SP for the IM2-IRQ private stack (0x26AB ld (0874),sp).'],
 [0x0876,0x0877,'player_actor_ptr','Player actor pointer (read 27k x; head used by hit-scan 0x15A0 and draw 0x1C6E/0x272D).'],
 [0x0878,0x0884,'sound_register_image','6840/SFX register shadow image pushed to ports 0x40-0x47 (read-only by 0x1776; set elsewhere). Never written in attract -> stays at boot value.'],
 [0x0885,0x0886,'sfx_script_ptr','Sound-sequencer script pointer (set by the SFX triggers 0x33BD/0x3439/0x348A/0x34E7 and 0x1D12).'],
 [0x0887,0x088a,'sfx_dispatch_tmp','SFX dispatch scratch (0x1D22).'],
 [0x0889,0x0889,'sfx_priority','Current sound-effect priority level; a new START_SFX preempts only if it outranks this.'],
 [0x0898,0x0899,'speech_queue_ptr','Speech phrase pointer consumed by the NMI speech driver (0x1721 -> S14001A port 0x44).'],
 [0x089a,0x089a,'speech_flag','Speech active/abort flag.'],
 [0x089c,0x089e,'score_or_demo_counter','3-byte BCD score/demo counter drawn by 0x197B/0x1908.'],
 [0x089f,0x08a0,'entropy_phase_counter','ENTROPY: 2-byte interrupt-phase counter advanced every non-vblank IRQ (mixes port 0x49); the value the LCG seed is derived from. Written ONLY by 0x26AB.'],
 [0x08a4,0x08a5,'bcd_score_word','Packed-BCD score/counter word read by digit formatter 0x18E0.'],
 [0x0940,0x094b,'player_sprite_shadow','Player sprite working/erase buffer (0x3719 player draw, 0x26AB).'],

 // VRAM low band 0x4000-0x43FF used as variables + stacks (NOT visible bitmap traffic)
 ['VRAM low band 0x4000-0x43FF -- used as STACKS and GAME VARIABLES (not bitmap)'],
 [0x4000,0x4000,'boot_post_flag','Boot/POST-incomplete flag; NMI 0x0066 aborts to POST if nonzero.'],
 [0x40d4,0x43b2,'actor_stacks_and_table','Coroutine stacks (SP set to 0x4300/0x4400) and per-actor slot data live through here; reads/writes at +0x32 strides are actor-frame return-address pops (heavy-trace.md known-limitation).'],
 [0x4300,0x4301,'stack_save_buildctr','Dual-use scratch: saved SP during magic-window stack-fills (0x1A4E/0x1E59/0x1E78) and a BCD row counter during maze build (0x19EC).'],
 [0x433e,0x4340,'score_ptr_p1','Player-1 score pointer/value base (saved/restored around reseed in 0x1685; selected by 0x2334).'],
 [0x4341,0x4343,'score_ptr_p2','Player-2 score base (selected when 0x4344==2).'],
 [0x4344,0x4344,'current_player','Current player / player-count selector (==2 chooses P2 paths; copied from ROM config at game start).'],
 [0x4344,0x434f,'game_config_block','12-byte per-game config copied by 0x1685 from ROM 0x16CD: 0x434A bonus/score param, 0x434B robot count (read 9700x), 0x434C level/difficulty counter, 0x434D robot speed/type, 0x434E misc.'],
 [0x435c,0x435d,'lcg_seed','ENTROPY: LCG seed for RANDOM (0x2678); reseeded at game start (0x1685) and per maze (0x2540) from the entropy phase counter.'],
 [0x435e,0x436c,'robot_placement_buf','15-byte robot-placement / maze-cell working buffer (copied from ROM 0x268C by 0x2540; read by 0x1CE7 coord-to-cell and the blitter).'],
 [0x436d,0x436d,'score_draw_flag','Score-redraw carry/dirty flag (0x2314/0x2341).'],
 [0x436e,0x436e,'game_active_flag','Game-active vs attract flag (0xFF in game; set by 0x1685, read 40k x). Gates sound, drawing, input paths.'],
 [0x436f,0x4370,'mainloop_resume_ptr','Main-loop/coroutine resume address (0x1685 sets 0x16D9; updated by scheduler).'],
 [0x4371,0x4371,'speech_gate','Intro-speech gate (0x2BE4 skips the RANDOM speech path when nonzero).'],
 [0x4373,0x4375,'score_ptr_save','Saved score pointer across the game-start reseed (0x1685).'],
 [0x4376,0x4376,'num_players_sel','1-/2-player selector set by the attract/credit path (0x188B); read by status draw.'],
 [0x4378,0x4378,'anim_phase','Animation/twinkle phase byte (rlca^0x11 each object pass; 0x27A9/0x3719).'],
 [0x4379,0x4379,'screen_flip','Cocktail screen/sprite FLIP flag (0=normal, 8=flipped). Set from cabinet DIP (port 0x4A b7) + player in 0x1A4E; read by every draw/blit routine to mirror coords & magic-RAM shift.'],
 [0x437a,0x437a,'bolt_color_phase','Bolt color/parameter cycle index (0x14F3 base, set by 0x369F).'],
 [0x437b,0x43b2,'bolt_actor_table','Projectile/spark table: up to 8 slots x 8 bytes (slot+0 type/flags, +1 timer, +2/+3 X/Y, +4..7 draw state). Processed every IRQ by the bolt engine 0x14F3; zeroed by 0x22F1.'],
 [0x43fb,0x43fc,'nmi_scratch','NMI scratch word (0x0066 path).'],

 // bitmap + color (bulk, summarized)
 ['Bulk graphics memory (not variables)'],
 [0x4400,0x5bbf,'vram_bitmap','Visible bitmap VRAM (32 bytes/line). Written directly and via the magic window.'],
 [0x5bc0,0x5fff,'vram_bottom_scratch','Bottom VRAM strip / off-screen scratch (cleared by 0x1ADD; also maze build buffers 0x5E6A+).'],
 [0x6000,0x7fff,'magic_window','Magic-RAM ALU write window (aliases VRAM at addr-0x2000); writes trigger the 74181 blit. Control via port 0x4B.'],
 [0x8100,0x87ff,'color_ram','Color RAM (4x4 attribute blocks); maze walls + sprite colors. Cleared/filled by 0x1A4E/0x35AF/0x3657/0x369F/0x3719.'],
];

let md='';
for(const v of VARS){
  if(v.length===1){ md+=`\n#### ${v[0]}\n\n| addr | name | meaning | r/w (attract) | written by |\n|---|---|---|---|---|\n`; continue; }
  const [lo,hi,name,meaning]=v;
  const range = lo===hi?hx(lo):`${hx(lo)}-${hx(hi)}`;
  // pick a representative writer set + counts from lo
  let writers=wt(lo)||wt(hi); let rw=rwt(lo);
  md+=`| ${range} | \`${name}\` | ${meaning} | ${rw} | ${writers||'(boot only)'} |\n`;
}
fs.writeFileSync('/tmp/t61/rammap_body.md',md);
console.error('ram map rows written');
