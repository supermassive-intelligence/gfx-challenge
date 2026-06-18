// T6.1 annotation DB + generator. Names/purpose are behavior-derived (this session,
// from the heavy trace + disassembly + hardware contract + entropy catalog).
// Contract fields (ports/RAM/entropy/callgraph) are pulled from the machine-extracted
// routines.json so every claim is evidence-backed.
import fs from 'node:fs';
const R=JSON.parse(fs.readFileSync('/tmp/t61/routines.json'));
const D=JSON.parse(fs.readFileSync('/tmp/t61/disasm.json'));
const M=new Map(R.map(x=>[x.pc,x]));
const hx=x=>'0x'+x.toString(16).padStart(4,'0');
const hb=x=>x.toString(16).padStart(2,'0');

// confidence: H high, M medium, L low(flagged "uncertain")
// fields: name, conf, purpose, notes(optional)
const A={
 // ---- interrupts ----
 0x0066:{name:'NMI_HANDLER',conf:'H',purpose:'Z80 NMI entry: disable NMI, abort to POST-fail (0x051d) if boot flag 0x4000!=0, else tail-jump to the NMI service body 0x1721.'},
 0x1721:{name:'NMI_SOUND_SERVICE',conf:'H',purpose:'Per-NMI service on a private stack at 0x085E: poll SW2 bit7 (bookkeeping), tick the SFX engine (0x1d12) and push the 6840 register image (0x1776), then drain the speech queue 0x0898 to the S14001A (port 0x44).'},
 0x26ab:{name:'FRAME_IRQ_DISPATCHER',conf:'H',purpose:'IM2 frame interrupt. Reads port 0x4E bit0 (V256): mid-frame IRQs advance the 2-byte interrupt-phase entropy counter 0x089F/0x08A0 (mixing port 0x49); the vblank IRQ runs a full game frame -- draw robots (0x272d), draw player (0x3719), move/draw bolts (0x14f3), tick object lists (0x27a9/0x27f5) -- then rearms IM2 (I=0x37) and re-enables IRQ (port 0x4F).',notes:'THE load-bearing entropy read (port 0x4E @0x26B4); see entropy-berzerk.md sec3.'},
 0x0509:{name:'POST_IRQ_SELFTEST',conf:'H',purpose:'Power-on self-test IRQ handler: validates the interrupt/V256 phasing (in 0x4E; rl b; xor 0x55 / xor 0x20) and enables IRQ (port 0x4F); spins (jr $) on mismatch. Runs only at boot.'},

 // ---- sound effect engine ----
 0x1776:{name:'WRITE_SOUND_REGISTERS',conf:'H',purpose:'Push the current SFX register image (NVRAM 0x0878-0x0884) out to the 6840 timer + SFX-control ports 0x40-0x47. Pure output stage of the sound chain.'},
 0x1d12:{name:'SOUND_ENGINE_TICK',conf:'M',purpose:'Advance the active SFX sequencer one step: read sequencer state 0x0852/0x0853, run the bytecode dispatcher (0x1d22), and store updated pointers (0x0850/0x0851, 0x0885/0x0886).'},
 0x1d22:{name:'SOUND_SEQ_DISPATCH',conf:'M',purpose:'SFX-sequencer opcode dispatcher: fetch a byte from the (BC) script stream and jump through the 2-byte jump table at 0x1D31.'},

 // ---- bolt / projectile engine (table 0x437B-0x43B2) ----
 0x14f3:{name:'UPDATE_ALL_BOLTS',conf:'M',purpose:'Top of the bolt/laser engine: tick the 2 player-bolt slots, then 7 robot-bolt slots (base 0x437A) of the projectile table 0x437B-0x43B2 via 0x1505/0x151a.'},
 0x1505:{name:'UPDATE_BOLT_RANGE',conf:'M',purpose:'Iterate B projectile-table slots (stride 8 from 0x437B) calling the per-slot updater 0x151a.',notes:'Shared tail of 0x14F3 (alternate entry point).'},
 0x151a:{name:'UPDATE_BOLT_SLOT',conf:'M',purpose:'Per-slot bolt update: if slot active, advance its anim counter and call move+draw (0x1553), edge test (0x157E), and hit scan (0x15A0); expire on counter underflow.'},
 0x1553:{name:'MOVE_AND_DRAW_BOLT',conf:'H',purpose:'Move a bolt one step from its 4-bit direction nibble (dec/inc the slot X/Y at iy+2/iy+3), compute the magic-RAM byte address (0x29A1), draw the pixel (write 0x80), and sample the draw-collision flop (port 0x4E bit7).',notes:'Reads port 0x4E bit7 = collision flop (deterministic given the draw, NOT beam entropy; entropy-berzerk.md classifies 0x157A here as collision).'},
 0x157e:{name:'CHECK_BOLT_BOUNDS',conf:'M',purpose:'Test whether a bolt has reached the play-field limits: compare slot X against 0x03FF and Y against 0x0CD0 via the limit-compare helper 0x1597.'},
 0x1597:{name:'BOLT_LIMIT_COMPARE',conf:'M',purpose:'Limit/zero comparator helper: returns B=0 (flag "at boundary") when the coordinate equals 0 or the supplied limit low-byte; used by bolt expiry.'},
 0x15a0:{name:'BOLT_HIT_SCAN',conf:'M',purpose:'Scan the actor list (head 0x0876, link 0x0870) calling the bolt-vs-actor overlap test 0x15CB for each, to find a bolt/actor collision.'},
 0x15cb:{name:'BOLT_VS_ACTOR_COLLISION',conf:'M',purpose:'Bounding-box overlap test between a bolt and an actor (player at iy, actor at ix): gated by actor bit2; on overlap sets actor hit flags (bit7, and bit0 of ix-6).'},
 0x29a1:{name:'PIXEL_TO_MAGICRAM_PRESET',conf:'H',purpose:'Set up a magic-RAM write for a single pixel/byte: program port 0x4B (ALU function 0x9x + shift = x&7), handle the cocktail flip (0x4379), and return HL = the 0x6400-based magic-window address. Enters with B=0x90.'},
 0x29a3:{name:'PIXEL_TO_MAGICRAM_ADDR',conf:'H',purpose:'As 0x29A1 but with the ALU/control high-nibble passed in B; computes the magic-RAM window address for a glyph/sprite byte at pixel coords HL, flipping for cocktail mode.',notes:'Alternate entry point sharing the body of 0x29A1.'},

 // ---- actor coroutine scheduler ----
 0x1666:{name:'COLD_START',conf:'M',purpose:'Boot entry after RST chain: disable interrupts, stash the return address at 0x4400, set the boot stack to 0x4300, and spawn the first coroutine (0x1E22).'},
 0x1e22:{name:'SPAWN_ACTOR_COROUTINE',conf:'M',purpose:'Create a coroutine/actor: pop the body address, build a fresh actor stack frame, and link it into the actor list (0x0872/0x0873 head, 0x0870 tail).',notes:'Stack-discipline-defeating (pop+jp); traces best-effort per heavy-trace.md.'},
 0x1fd4:{name:'INIT_COROUTINE_STACK',conf:'M',purpose:'Initialize a fresh coroutine stack: pop IY (frame base) and push 7 zero words as the initial saved-register frame.',notes:'Stack-swap routine; trace nesting is best-effort.'},
 0x200e:{name:'LINK_COROUTINE_ALT',conf:'L',purpose:'Variant coroutine creator/linker using list vars 0x0870/0x0871 (parallels 0x1E22).',notes:'Uncertain: coroutine plumbing, stack-swap; trace unreliable.'},
 0x1e59:{name:'COROUTINE_ENTER',conf:'M',purpose:'Allocate an actor stack frame (reserve 0x18 bytes below SP, record the frame pointer in the 0x0872 list) and enter the body via jp (iy).'},
 0x1e6d:{name:'ACTOR_YIELD_TYPED',conf:'M',purpose:'Mark the current actor type (0x82) and yield: walk the 0x0872 actor list to the next ready coroutine (bit0 set) and switch to its stack.',notes:'Falls through into 0x1E78; coroutine scheduler core, trace best-effort.'},
 0x1e78:{name:'ACTOR_YIELD',conf:'M',purpose:'Coroutine yield/scheduler: save the current actor SP into its 0x0872 frame, walk the list to the next ready actor (bit0), and switch SP to it.',notes:'Alternate (no-type-set) entry into 0x1E6D body; the actor scheduler.'},
 0x22eb:{name:'INIT_GAMEPLAY_STATE',conf:'M',purpose:'Reset gameplay state for a new round: queue the intro speech path (0x2BE4), clear the maze color buffer (0x364E), then zero the actor table.'},
 0x22f1:{name:'INIT_ACTOR_TABLE',conf:'M',purpose:'Zero the actor/bolt table 0x437B-0x43B2 (0x38 bytes) and clear the actor-list heads 0x0870/0x0876.',notes:'Shared tail of 0x22EB (alternate entry).'},
 0x24f7:{name:'REMOVE_ACTOR_FROM_LIST',conf:'M',purpose:'Unlink an actor (at IX) from the 0x0872 doubly-linked actor list by finding its predecessor and splicing the back-link, under DI.'},

 // ---- object motion / drawing (IRQ-time) ----
 0x27a9:{name:'UPDATE_OBJECT_MOTION',conf:'M',purpose:'Per-object motion/timer update: gated by bit2, decrement the object timer (slot+0x0C), accumulate position deltas into the slot, advance the list pointer 0x0870, and toggle the animation bit 0x4378.'},
 0x27f5:{name:'TICK_OBJECT_TIMERS',conf:'M',purpose:'Walk the object list (head 0x0872) decrementing each object\'s bit1 countdown timer; on expiry flip its bit1/bit0 state.'},
 0x272d:{name:'DRAW_OBJECT',conf:'H',purpose:'Render one actor sprite: if its draw-flag bit0 set, program the magic-RAM control and blit (0x2817); compute mirrored screen coords for cocktail (0x4379) via 0x29A3, blit, then read the collision flop (port 0x4E bit7) and set the actor hit flag on overlap.',notes:'Reads port 0x4E bit7 (collision, deterministic).'},
 0x2817:{name:'BLIT_SPRITE_TO_MAGICRAM',conf:'H',purpose:'The sprite blitter: copy sprite rows into the magic-RAM window 0x6400-0x7E00 (row stride +0x1E/+0x1F/+0x20), walking forward or backward per the cocktail flip 0x4379. The 74181 ALU + shift in port 0x4B do the actual pixel merge.',notes:'Magic-window writes record the CPU byte, not the post-ALU VRAM (heavy-trace.md note #3).'},
 0x29db:{name:'DRAW_CHARS_MAGICRAM',conf:'M',purpose:'Render a run of glyph/character bytes into the magic-RAM window: per-character set port 0x4B control (0x90/0x94) and emit the masked byte, stepping by 0x1F rows, direction from 0x4379.'},
 0x2a40:{name:'FORMAT_AND_DRAW_DIGITS',conf:'M',purpose:'Convert a packed value to ASCII/hex digit codes (nibble extract, +0x30 with A-F adjust, leading-space blanking) and draw each via 0x29DB.'},
 0x2a4a:{name:'FORMAT_AND_DRAW_DIGITS_ALT',conf:'L',purpose:'Alternate entry into the digit formatter 0x2A40 (skips the leading 0x29A3 address preset).',notes:'Shared tail; uncertain exact caller contract.'},
 0x3719:{name:'DRAW_PLAYER_SPRITE',conf:'M',purpose:'Update/redraw the player sprite into color RAM (0x8100 base) and the 0x0940 shadow buffer: bit3 erases the old image, bit4 computes the new color-RAM address from player coords (flip via 0x4379) and copies the 5x2 sprite cells.'},

 // ---- score / digit display (NMI/attract) ----
 0x18e0:{name:'READ_BCD_PAIR',conf:'M',purpose:'Read a packed BCD digit pair from the score/counter words 0x08A4/0x08A5 and merge the selected nibbles into A.'},
 0x1908:{name:'STEP_SCORE_DIGIT',conf:'L',purpose:'Advance/draw one score or demo counter digit: decrement a count, index a digit table (0x195B), BCD-add with daa and saturate at 0x99, then draw via 0x18F7.',notes:'Uncertain: also performs an in a,(c) read (variable port) in the demo path; exact role of 0x089C-0x089E vs 0x08A4 not fully pinned.'},
 0x197b:{name:'DRAW_SCORE',conf:'M',purpose:'Draw the 3-byte score/counter at 0x089C by stepping 3 digit groups (0x1908) and the high pair (0x18E0).'},
 0x1997:{name:'READ_SYSTEM_INPUT_MASK',conf:'M',purpose:'Read SYSTEM port 0x49 (active-low, inverted) masked to a movement/credit subset chosen by a packed-digit lookup; used by the attract/demo control path.'},
 0x188b:{name:'ATTRACT_DEMO_LOOP',conf:'L',purpose:'Attract-mode driver: set the demo actor, poll SW2 (port 0x65) free-game bit, run score draw (0x197B) and input read (0x1997), and on a credit/start branch set the game-mode selector 0x4376.',notes:'Uncertain higher-level orchestration; coroutine-bodied.'},
 0x18cd:{name:'DRAW_SMALL_FIELD',conf:'L',purpose:'Draw a small 2-digit on-screen field: fetch a value (0x18E0) and format/draw it (0x2A40) from ROM digit data at 0xD578.',notes:'Uncertain exact field meaning.'},

 // ---- screen / maze rendering ----
 0x1a4e:{name:'CLEAR_SCREEN_SET_FLIP',conf:'H',purpose:'Clear color RAM 0x8100-0x87FF and blank VRAM (push 0x000 words through the magic window from SP=0x6000), then read the cabinet DIP (port 0x4A bit7) and player state (0x4344) to set the cocktail screen-flip flag 0x4379 (0 or 8).'},
 0x1a45:{name:'FILL_ROW_FF',conf:'M',purpose:'Fill 0x40 consecutive bytes from HL with 0xFF (draw a solid wall/border row in VRAM).',notes:'Shared tail of 0x19AC.'},
 0x1add:{name:'CLEAR_BOTTOM_STRIP',conf:'M',purpose:'Zero the VRAM region 0x5BC0-0x5D7F (0x2C0 bytes), clearing the bottom screen strip.'},
 0x35af:{name:'DRAW_MAZE_WALLS',conf:'M',purpose:'Clear color RAM then draw the maze wall layout by feeding wall-segment descriptor tables (inlined after each call) to the segment drawer 0x3657; sets flip 0x4379=0.'},
 0x3657:{name:'DRAW_WALL_SEGMENT',conf:'M',purpose:'Draw one wall segment into color RAM: pop the inline descriptor pointer, read length/value, and fill a horizontal or vertical run of color cells from base 0x8100/0x87FF, direction per flip 0x4379.'},
 0x35e7:{name:'DRAW_WALL_GROUP_A',conf:'L',purpose:'Draw a fixed group of wall/door segments via 0x3657 from an inline descriptor list (writes color rows 0x8780-0x87FF region).',notes:'Uncertain which maze feature; descriptor-table driven.'},
 0x3601:{name:'DRAW_WALL_GROUP_B',conf:'L',purpose:'Draw a fixed wall-segment group via 0x3657 (color rows 0x86E0-0x875F).',notes:'Uncertain which maze feature.'},
 0x364e:{name:'CLEAR_MAZE_COLOR',conf:'L',purpose:'Fill the maze color area 0x8100-0x877F via the 0x3657 segment filler (clears prior maze coloring).',notes:'Uncertain exact extent semantics.'},
 0x369f:{name:'RENDER_MAZE_LEVEL',conf:'M',purpose:'Build and color the maze for the level: pick robot count/speed/type from a difficulty table (writes 0x434B/0x437A/0x434D), expand the maze bitmap from buffer 0x4400/0x4600 into color RAM (0x8100/0x8180), and draw walls via 0x35E7/0x3657.'},
 0x297b:{name:'DRAW_TEXT_RUN',conf:'L',purpose:'Draw a labelled text/graphic run: pop an inline descriptor (count + source ptr), compute the magic address (0x29A3) and emit characters (0x29DB) along a row.',notes:'Uncertain exact content.'},
 0x19ac:{name:'DRAW_ATTRACT_SCREEN',conf:'L',purpose:'Compose an attract/title screen: clear (0x1A4E), draw maze walls (0x35AF), draw text runs (0x297B), and fill a BCD-indexed grid of cells (0x2A40/0x29DB) plus border rows (0x1A45).',notes:'Uncertain high-level layout; large inline descriptor data.'},
 0x1a98:{name:'ATTRACT_SCENE_DISPATCH',conf:'L',purpose:'Step the attract sequence: clear bottom strip, branch on the demo-phase counter (0x18E0) to draw one of several scenes (0x3601/0x3613/0x360A) and queue the matching speech pointer into 0x0898.',notes:'Uncertain; reads language DIP (port 0x60) via 0x1AED.'},
 0x1aed:{name:'DISPATCH_BY_LANGUAGE',conf:'H',purpose:'Language-indexed jump table: read the F3 language DIP (port 0x60 bits6-7), index a table 8 bytes past the inline base, and jp (hl) to the localized handler.',notes:'pop+jp dispatcher; alternate language strings.'},

 // ---- level setup / robot placement ----
 0x1685:{name:'START_GAME',conf:'H',purpose:'Start a game/level: save the live score pointer (0x433E->0x4373), reseed the LCG (push 0x435C, run 0x209D, then rewrite 0x435C and call RANDOM), copy the 12-byte game-config block from ROM 0x16CD to 0x4344-0x434F, and set the game-active flag 0x436E=0xFF.',notes:'ENTROPY: reseeds LCG seed 0x435C (entropy-berzerk.md sec3 game-start mix).'},
 0x209d:{name:'SETUP_LEVEL',conf:'M',purpose:'Build a playable level: clear screen (0x1A4E), generate the maze+robots (0x2540), spawn robot actors via the coroutine system (0x1E6D), and update difficulty/bonus counters (0x434A/0x434C/0x434D).'},
 0x2540:{name:'GENERATE_MAZE_AND_ROBOTS',conf:'M',purpose:'Maze + robot placement: seed RANDOM from 0x4345, clear the maze build buffer (0x5E6A/0x444A), copy the placement seed table ROM 0x268C->0x435E, place robots at random quadrant positions (0x25CA/0x25D4/0x25EB), and render the maze (0x369F).',notes:'ENTROPY: writes LCG seed 0x435C and the 0x435E placement buffer.'},
 0x25eb:{name:'PLACE_ROBOT_RANDOM',conf:'M',purpose:'Place one robot at a random position: call RANDOM twice, and on (result & 3) select one of four edge/quadrant placement routines, setting the robot cell flags.',notes:'ENTROPY: RANDOM (0x2678) consumer (entropy-berzerk.md sec7).'},
 0x264c:{name:'DRAW_MAZE_ROW',conf:'L',purpose:'Draw a row of 0x0C maze wall cells: preset magic address (0x25E4) and blit each cell (0x2817), stepping X by 4.',notes:'Uncertain row-vs-column orientation.'},
 0x2662:{name:'DRAW_MAZE_COL',conf:'L',purpose:'Draw a column of 0x12 maze wall cells (preset 0x25E4, blit 0x2817), stepping Y by 4.',notes:'Uncertain orientation.'},
 0x25ca:{name:'DRAW_MAZE_BLOCK_A',conf:'L',purpose:'Draw a maze wall block by two column passes (0x2662) offset by 0x40.',notes:'Uncertain.'},
 0x25d4:{name:'DRAW_MAZE_BLOCK_B',conf:'L',purpose:'Draw a maze wall block via four row passes (0x264C) offset by 0x30.',notes:'Uncertain.'},
 0x25e4:{name:'MAGICADDR_PRESET_10',conf:'L',purpose:'Thin wrapper: preset magic-RAM control nibble B=0x10 and compute the window address (0x29A3), returning it in DE.'},
 0x2314:{name:'DRAW_STATUS_LINE',conf:'L',purpose:'Draw the score/status line: format and blit two 6-digit fields from ROM digit data (0xD500/0xD5B0) via 0x2A40, keyed by the 2-player selector 0x4376.',notes:'Uncertain exact fields.'},
 0x2341:{name:'ADD_AND_DRAW_SCORE',conf:'L',purpose:'BCD-add a points value into a score field and redraw it, with a language/credit read (port 0x61) and bonus-life handling; tails into the maze status redraw.',notes:'Uncertain; my CFG walk over-runs into 0x259A (status redraw) -- the routine proper ends near 0x23A0.'},
 0x2334:{name:'SELECT_SCORE_PTR',conf:'M',purpose:'Select the active score base pointer: return HL=0x4341 when current-player word 0x4344==2 (player 2), else HL=0x433E (player 1).'},

 // ---- robot AI / animation ----
 0x2436:{name:'UPDATE_ROBOT_MOVE',conf:'L',purpose:'Update a robot\'s movement/animation: mask the desired direction nibble, run the proximity/line check (0x1C6E), look up the animation frame (0x2B3D), and store the new sprite-data pointer into the actor (ix+0x0A/0x0B).',notes:'Uncertain; my CFG span over-runs (entered as alt-entry context).'},
 0x1c6e:{name:'CHECK_ROBOT_PROXIMITY',conf:'L',purpose:'Compute a robot-vs-player relationship mask: transform both actors\' coords to maze cells (0x1CE7) at several offsets and combine bit tests into a direction/contact mask (used for chase + collision).',notes:'Uncertain whether line-of-fire vs adjacency.'},
 0x1ce7:{name:'COORD_TO_MAZECELL',conf:'M',purpose:'Map a pixel coordinate (H,L) to a maze-cell attribute byte: quantize X/Y into cell indices and read the cell table based at 0x435E.'},
 0x2b39:{name:'SET_ANIM_FRAME_MASKED',conf:'M',purpose:'Set an actor\'s animation frame: mask the frame index, and if it changed, look up the frame\'s sprite-data pointer (tables 0x2042/0x2519) into the actor (ix+6/ix+8).'},
 0x2b3d:{name:'SET_ANIM_FRAME',conf:'M',purpose:'Look up a frame index in the sprite tables 0x2042->0x2519 and store the sprite-data pointer into the actor (ix+6/ix+8).',notes:'Alternate entry into 0x2B39 (no mask/compare).'},
 0x287f:{name:'SPAWN_ROBOT_SHOT',conf:'L',purpose:'When a robot fires: bounds-check the target delta, choose a firing direction, allocate a shot actor (0x34E7 + coroutine 0x1E6D), and seed its sprite/move data from the 0x434B/0x434D robot params.',notes:'Uncertain; coroutine-spawning.'},
 0x1f91:{name:'SET_ROBOT_SPRITE_PTR',conf:'L',purpose:'Resolve a robot sprite-data pointer from the animation table 0x2053 (via 0x2B3D) and store it into the actor (ix+0x0A/0x0B) under DI.'},
 0x1f94:{name:'SET_ROBOT_SPRITE_PTR_ALT',conf:'L',purpose:'Alternate entry into 0x1F91 that skips the initial nibble mask.',notes:'Shared tail.'},
 0x2b54:{name:'SPAWN_TYPED_ACTOR',conf:'L',purpose:'Create a type-0x82 actor at the 0x0872 list head, set its parameter byte, run it (0x1E78), and return its bit7 status.',notes:'Uncertain.'},

 // ---- speech ----
 0x2be4:{name:'GENERATE_INTRO_SPEECH',conf:'M',purpose:'Build the intro/taunt speech: gated by 0x4371 -- when clear, pick a random word (RANDOM->0x0918 buffer), assemble a sentence into the speech buffer (0x2B6B), and set the speech pointer 0x0898/flag 0x089A.',notes:'Contains RANDOM call site 0x2BED; in the attract trace the 0x4371 gate was NOT taken, so RANDOM was not reached here (latent path).'},
 0x2bde:{name:'QUEUE_SPEECH_A',conf:'L',purpose:'Queue a fixed speech sequence: load HL=0x2C4A and store it as the active speech pointer 0x0898.'},
 0x2c1f:{name:'QUEUE_SPEECH_B',conf:'L',purpose:'Queue a fixed speech sequence (HL=0x2C40) into the speech pointer 0x0898, clearing the speech flag 0x089A.'},

 // ---- priority-gated SFX triggers (share the 0x0889 priority + 0x0885 sequencer ptr) ----
 0x33bd:{name:'START_SFX_PRIO0',conf:'M',purpose:'Priority-gated sound-effect trigger: if the requested priority (0x00) outranks the current 0x0889, preempt -- disable NMI (port 0x4D), set priority 0x0889, point the SFX sequencer 0x0885 at script 0x33D3 -- then restore NMI (port 0x4C). One specific sound.'},
 0x3439:{name:'START_SFX_PRIO3',conf:'M',purpose:'Priority-gated SFX trigger (priority 0x03, script 0x344F); same preempt/restore protocol around the NMI ports as 0x33BD.'},
 0x348a:{name:'START_SFX_PRIO1_A',conf:'M',purpose:'Priority-gated SFX trigger (priority 0x01, script 0x34A0); preempts the sound sequencer if it outranks 0x0889.'},
 0x34e7:{name:'START_SFX_PRIO1_B',conf:'M',purpose:'Priority-gated SFX trigger (priority 0x01, script 0x34FD); a distinct sound from 0x348A using the same protocol.'},

 // ---- LCG ----
 0x2678:{name:'RANDOM',conf:'H',purpose:'LCG pseudo-random generator: seed = 0x435C; seed = 7*seed + 0x3153; store back; return A = high byte. Deterministic in its seed (which is entropy-derived at game start).',notes:'ENTROPY: reads/writes seed 0x435C; the 13-consumer RNG (entropy-berzerk.md sec7).'},
};

// generate the annotated-asm markdown
const ENTROPY_MEM=new Set([0x089f,0x08a0,0x435c]);
function portList(set,wantWrite){ const m=new Map();
  for(const [p,v] of (wantWrite?set:set)){ const lp=p&0xff; if(!m.has(lp))m.set(lp,new Set()); m.get(lp).add(v); }
  return [...m.keys()].sort((a,b)=>a-b).map(p=>wantWrite?`${hb(p)}<=[${[...m.get(p)].sort((a,b)=>a-b).map(hb).join(',')}]`:hb(p));
}
function regionsOf(addrs){ const reg=a=> a<=0x07ff?'ROM0':a<=0x0bff?'NVRAM':a<=0x0fff?'NVRAM~':a<=0x37ff?'ROM1-5':a<=0x3fff?'ROM6':a<=0x43ff?'VAR/STK(VRAM)':a<=0x5fff?'VRAM-bitmap':a<=0x7fff?'MAGIC':'COLOR';
  const by={}; for(const a of addrs){const g=reg(a);(by[g]=by[g]||[]).push(a);}
  const out=[]; for(const g of ['ROM0','NVRAM','NVRAM~','ROM1-5','ROM6','VAR/STK(VRAM)','VRAM-bitmap','MAGIC','COLOR']){ if(by[g])out.push(`${g} x${by[g].length}`); }
  return out.join(', ');
}
let md='';
const depthMemo=new Map();
function depth(pc,st=new Set()){ if(depthMemo.has(pc))return depthMemo.get(pc); if(st.has(pc))return 0; st.add(pc);
  const r=M.get(pc); let d=0; if(r)for(const c of r.children){if(c!==pc)d=Math.max(d,1+depth(c,st));} st.delete(pc); depthMemo.set(pc,d); return d; }
const order=[...R].sort((a,b)=>depth(a.pc)-depth(b.pc)||a.pc-b.pc);

for(const r of order){
  const a=A[r.pc]||{name:'UNNAMED_'+hx(r.pc).slice(2),conf:'L',purpose:'NOT YET CONFIDENTLY NAMED -- flagged for review.'};
  md+=`\n### ${hx(r.pc)}  ${a.name}   _(conf ${a.conf})_\n`;
  md+=`- **Purpose:** ${a.purpose}\n`;
  // contract
  const rd=r.rmem.filter(x=>!(x>=0x1000&&x<=0x3fff)&&x>0x07ff); // drop ROM1-5 const reads + ROM0
  const wr=r.wmem;
  md+=`- **Inputs (read):** regs in; mem regions: ${regionsOf(rd)||'(none non-ROM)'}`;
  const rp=portList(r.rio,false); if(rp.length)md+=`; ports ${rp.join(' ')}`;
  md+=`\n`;
  md+=`- **Outputs (written):** regs out [${Object.entries(r.regChg).sort((x,y)=>y[1]-x[1]).slice(0,6).map(([k])=>k).join(',')||'-'}]; mem regions: ${regionsOf(wr)||'(none)'}`;
  const wp=portList(r.wio,true); if(wp.length)md+=`; ports ${wp.join('  ')}`;
  md+=`\n`;
  // entropy
  const ent=[];
  if(r.rio.some(([p])=>(p&0xff)===0x4e))ent.push('reads port 0x4E');
  const entRd=[...new Set(rd.filter(x=>ENTROPY_MEM.has(x)))];
  const entWr=[...new Set(wr.filter(x=>ENTROPY_MEM.has(x)))];
  const touched=[...new Set([...entRd,...entWr])].sort((a,b)=>a-b);
  if(touched.length){ const lbl=touched.map(x=>{const rw=(entRd.includes(x)?'r':'')+(entWr.includes(x)?'w':''); return hx(x).toUpperCase().replace('0X','0x')+'('+rw+')';}).join(', ');
    ent.push('touches entropy var '+lbl); }
  if(r.pc===0x2678)ent.push('is RANDOM itself');
  else if(r.children.includes(0x2678))ent.push('calls RANDOM(0x2678)');
  md+=`- **Side-effects / entropy:** ${ent.length?'**'+ent.join('; ')+'**':'none observed'}\n`;
  // call graph
  md+=`- **Call graph:** depth ${depth(r.pc)}, invoked ${r.count}x${r.isr?' (ISR)':''}; callers ${r.parents.map(hx).join(' ')||'(root/ISR)'}; callees ${r.children.filter(c=>c!==r.pc).map(hx).join(' ')||'(leaf)'}\n`;
  if(a.notes)md+=`- **Notes:** ${a.notes}\n`;
  // disassembly listing (from the validated disassembler; CFG-walked, may include
  // sibling blocks for shared-tail/over-running spans -- noted where relevant)
  md+=`\n  <details><summary>disasm (${D[r.pc].insns.length} insn)</summary>\n\n  \`\`\`\n`;
  for(const i of D[r.pc].insns) md+=`  ${hx(i.addr).slice(2)}  ${i.m}\n`;
  md+=`  \`\`\`\n  </details>\n`;
}
fs.writeFileSync('/tmp/t61/annotations_body.md',md);
console.error('annotated routines:',order.length,'unnamed:',order.filter(r=>!A[r.pc]).length);
