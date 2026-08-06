// T6.2 scoring: my T6.1 names vs the rubric (labels.json + berzerk.asm canonical
// labels/comments). Verdicts assigned by semantic judgement (this session).
// V = HIT (semantic match) | PARTIAL (right subsystem+mechanism, wrong specific
//   role/entity/field) | MISS (wrong meaning) | NOLABEL (rubric has no distinct
//   label at this addr; sub2 = behavioural consistency with enclosing label/comment)
const ROWS=[
// pc, my_name, canonical(or comment), verdict, sub2(for NOLABEL), note
[0x14f3,'UPDATE_ALL_BOLTS','HANDLE_PLAYER_BOLTS','PARTIAL','','said all-bolts; canonical = player bolts'],
[0x1553,'MOVE_AND_DRAW_BOLT','MOVE_AND_DRAW_BOLT','HIT','','exact'],
[0x157e,'CHECK_BOLT_BOUNDS','CHECK_IF_BOLT_OFFSCREEN','HIT','',''],
[0x1597,'BOLT_LIMIT_COMPARE','CHECK_IF_ZERO_OR_E','HIT','','zero-or-E compare = limit compare'],
[0x15a0,'BOLT_HIT_SCAN','HANDLE_BOLT_COLLISION','HIT','',''],
[0x15cb,'BOLT_VS_ACTOR_COLLISION','COLLISION_DETECTION','HIT','',''],
[0x1721,'NMI_SOUND_SERVICE','NMI_HANDLER','HIT','','correctly id NMI handler + its sound/speech job'],
[0x1776,'WRITE_SOUND_REGISTERS','C.LOAD','HIT','','cryptic canonical; recovered meaning (load sound chip regs)'],
[0x18cd,'DRAW_SMALL_FIELD','PRINT_CREDITS','PARTIAL','','drew a field; missed = credits'],
[0x18e0,'READ_BCD_PAIR','GET_CREDITS_AS_BCD','PARTIAL','','BCD read right; called the var score, it is credits'],
[0x1a45,'FILL_ROW_FF','WRITE_FF_64_TIMES_HL','HIT','',''],
[0x1a4e,'CLEAR_SCREEN_SET_FLIP','CLEAR_SCREEN','HIT','','flip detail also correct'],
[0x1add,'CLEAR_BOTTOM_STRIP','CLEAR_CHYRON','HIT','','chyron = bottom strip'],
[0x1aed,'DISPATCH_BY_LANGUAGE','LTABLE','HIT','','LTABLE=language table; descriptive name'],
[0x1e22,'SPAWN_ACTOR_COROUTINE','CREATE_JOB','HIT','','job=coroutine'],
[0x1e6d,'ACTOR_YIELD_TYPED','ACTIVATE_HEAD_JOB','PARTIAL','','scheduler op; yield vs activate-head'],
[0x1e78,'ACTOR_YIELD','STOP_JOB','PARTIAL','','scheduler op; yield vs stop-job'],
[0x1f91,'SET_ROBOT_SPRITE_PTR','CHANGE_PLAYER_DIRECTION','PARTIAL','','sprite-pattern mechanism right (loads P.TAB); wrong entity (player not robot), missed velocity part'],
[0x1f94,'SET_ROBOT_SPRITE_PTR_ALT','CDIR','PARTIAL','','alt entry; loads player pattern via SET_VELOCITY; wrong entity'],
[0x1fd4,'INIT_COROUTINE_STACK','MAN_INIT','PARTIAL','','init stack right; missed it is the player (MAN)'],
[0x209d,'SETUP_LEVEL','SR.TAB','HIT','','SR.TAB = set-room/screen table routine'],
[0x2314,'DRAW_STATUS_LINE','SHOW_SCORE','PARTIAL','','shows score; I said status line'],
[0x2334,'SELECT_SCORE_PTR','GET_PLAYER_SCORE_PTR','HIT','','near-exact'],
[0x2341,'ADD_AND_DRAW_SCORE','UPDATE_SCORE','HIT','',''],
[0x2436,'UPDATE_ROBOT_MOVE','SETPAT','PARTIAL','','robot area; SETPAT = set sprite pattern specifically'],
[0x2678,'RANDOM','RANDOM','HIT','','exact + LCG verified'],
[0x272d,'DRAW_OBJECT','ERASE_PATTERN','PARTIAL','','same sprite pipeline; canonical = erase pass'],
[0x27a9,'UPDATE_OBJECT_MOTION','MOVE_ANIMATE_VECTOR','HIT','',''],
[0x2817,'BLIT_SPRITE_TO_MAGICRAM','DRAW_SPRITE','HIT','',''],
[0x287f,'SPAWN_ROBOT_SHOT','SHOOT','PARTIAL','','SHOOT right; entity (robot) unconfirmed from attract'],
[0x297b,'DRAW_TEXT_RUN','PRINT_STRING_297B','HIT','',''],
[0x29a1,'PIXEL_TO_MAGICRAM_PRESET','RTOAX','HIT','','cryptic canonical; recovered meaning'],
[0x29a3,'PIXEL_TO_MAGICRAM_ADDR','CALCULATE_MAGIC_IMAGE_RAM_ADDRESS','HIT','','near-exact'],
[0x29db,'DRAW_CHARS_MAGICRAM','PRINT_CHAR','HIT','',''],
[0x2a40,'FORMAT_AND_DRAW_DIGITS','PRINT_DIGITS','HIT','',''],
[0x2a4a,'FORMAT_AND_DRAW_DIGITS_ALT','SHOWO','HIT','','SHOWO=show/output digits'],
[0x2b39,'SET_ANIM_FRAME_MASKED','SET_VELOCITY (masked entry)','MISS','','field is velocity (ix+6/+8), not animation frame'],
[0x2b3d,'SET_ANIM_FRAME','SET_VELOCITY','MISS','','field is velocity, not animation frame'],
[0x2bde,'QUEUE_SPEECH_A','SAY_INTRUDER_ALERT_INTRUDER_ALERT','HIT','','queues a specific speech phrase'],
[0x2be4,'GENERATE_INTRO_SPEECH','TRY_SPEAK_ON_PLAYER_LEAVING_ROOM','PARTIAL','','random speech right; trigger (leaving room) not recoverable from attract'],
[0x2c1f,'QUEUE_SPEECH_B','SAY_GOT_THE_HUMANOID_GOT_THE_INTRUDER','HIT','','queues a specific speech phrase'],
[0x33bd,'START_SFX_PRIO0','SFIRE','HIT','','sfx trigger; specific sound (fire) not named'],
[0x3439,'START_SFX_PRIO3','SFRY','HIT','','sfx trigger (fry)'],
[0x348a,'START_SFX_PRIO1_A','SBLAM','HIT','','sfx trigger (blam)'],
[0x34e7,'START_SFX_PRIO1_B','SRFIRE#','HIT','','sfx trigger (robot fire)'],
[0x35af,'DRAW_MAZE_WALLS','SET_COLOUR_ATTRS_35AF','PARTIAL','','sets colour attrs (the wall colouring)'],
[0x3657,'DRAW_WALL_SEGMENT','COLOUR_FILL','PARTIAL','','generic colour fill; wall-segment is the use'],
[0x3719,'DRAW_PLAYER_SPRITE','UNCOLOUR_MAN','HIT','','correct entity (player/MAN) + colour-sprite domain'],
// ---- NOLABEL: rubric has no distinct label at this addr ----
[0x0066,'NMI_HANDLER','(Z80 NMI vector -> 0x1721)','NOLABEL','consistent','NMI entry stub'],
[0x0509,'POST_IRQ_SELFTEST','(self-test region 0x02xx-0x05xx)','NOLABEL','consistent','POST self-test'],
[0x1505,'UPDATE_BOLT_RANGE','(within HANDLE_PLAYER_BOLTS)','NOLABEL','consistent','bolt-slot loop'],
[0x151a,'UPDATE_BOLT_SLOT','(within HANDLE_PLAYER_BOLTS)','NOLABEL','consistent','per-slot bolt update'],
[0x1666,'COLD_START','(game executive @0x1642+)','NOLABEL','consistent','boot/init (di; create job)'],
[0x1685,'START_GAME','(game executive; reseed @0x169a)','NOLABEL','consistent','new-game reseed (matches T5.1 game-start mix)'],
[0x188b,'ATTRACT_DEMO_LOOP','(cover DEFAULT_PLAYER_STATE)','NOLABEL','partial','demo/default-player-state area'],
[0x1908,'STEP_SCORE_DIGIT','(credits display; CMOS_CREDITS)','NOLABEL','partial','digit step right; it is credits not score'],
[0x197b,'DRAW_SCORE','(credits/demo display region)','NOLABEL','partial','numeric HUD draw; credits vs score'],
[0x1997,'READ_SYSTEM_INPUT_MASK','(credits/demo region)','NOLABEL','partial','reads port 0x49 SYSTEM; mechanism right'],
[0x19ac,'DRAW_ATTRACT_SCREEN','(big draw: clear+colour+strings)','NOLABEL','consistent','attract/title compose'],
[0x1a98,'ATTRACT_SCENE_DISPATCH','(attract sequence)','NOLABEL','consistent','attract scene step'],
[0x1c6e,'CHECK_ROBOT_PROXIMITY','(unlabeled; coord transforms)','NOLABEL','consistent','Sudnya spot-reviewed in T6.1'],
[0x1ce7,'COORD_TO_MAZECELL','(unlabeled; index 0x435E table)','NOLABEL','consistent','coord->cell quantize'],
[0x1d12,'SOUND_ENGINE_TICK','(unlabeled; uses 0x0885 script ptr)','NOLABEL','consistent','sound sequencer step'],
[0x1d22,'SOUND_SEQ_DISPATCH','(unlabeled; jump table 0x1D31)','NOLABEL','consistent','sound bytecode dispatch'],
[0x1e59,'COROUTINE_ENTER','(within CREATE_JOB)','NOLABEL','consistent','allocate frame + enter'],
[0x200e,'LINK_COROUTINE_ALT','(comment: alloc a robot VECTOR on stack)','NOLABEL','partial','stack-alloc right; it is robot-vector specific'],
[0x22eb,'INIT_GAMEPLAY_STATE','(comment: TREST; returns screen-flip flag)','NOLABEL','partial','reset + flip-test; I framed as init'],
[0x22f1,'INIT_ACTOR_TABLE','(zeros 0x437B table)','NOLABEL','consistent','actor-table zero'],
[0x24f7,'REMOVE_ACTOR_FROM_LIST','(cover BLAM; unlinks actor)','NOLABEL','consistent','likely the death-cleanup unlink'],
[0x2540,'GENERATE_MAZE_AND_ROBOTS','(room/screen setup)','NOLABEL','partial','broader: also draws lives + HUD'],
[0x25ca,'DRAW_MAZE_BLOCK_A','(comment: display player LIFE ICONS)','NOLABEL','wrong','life icons, NOT maze'],
[0x25d4,'DRAW_MAZE_BLOCK_B','(comment: display player LIFE ICONS)','NOLABEL','wrong','life icons, NOT maze'],
[0x25e4,'MAGICADDR_PRESET_10','(helper for icon draw)','NOLABEL','partial','magic-addr preset; used by life-icon draw'],
[0x25eb,'PLACE_ROBOT_RANDOM','(RANDOM x2; near life/HUD draw)','NOLABEL','partial','RANDOM-driven placement; entity uncertain from attract'],
[0x264c,'DRAW_MAZE_ROW','(life-icon row drawer)','NOLABEL','wrong','life-icon row, NOT maze'],
[0x2662,'DRAW_MAZE_COL','(life-icon col drawer)','NOLABEL','wrong','life-icon col, NOT maze'],
[0x26ab,'FRAME_IRQ_DISPATCHER','(comment: Interrupt routine)','NOLABEL','consistent','the IM2 interrupt routine'],
[0x27f5,'TICK_OBJECT_TIMERS','(within MOVE_ANIMATE_VECTOR; 0x0872 list)','NOLABEL','consistent','list timer tick'],
[0x2b54,'SPAWN_TYPED_ACTOR','(unlabeled; creates actor type 0x82)','NOLABEL','consistent','actor spawn'],
[0x35e7,'DRAW_WALL_GROUP_A','(calls COLOUR_FILL)','NOLABEL','partial','colour-fill group'],
[0x3601,'DRAW_WALL_GROUP_B','(calls COLOUR_FILL)','NOLABEL','partial','colour-fill group'],
[0x364e,'CLEAR_MAZE_COLOR','(calls COLOUR_FILL)','NOLABEL','partial','colour fill'],
[0x369f,'RENDER_MAZE_LEVEL','(unlabeled; builds maze colour)','NOLABEL','consistent','maze render'],
];
const hx=x=>'0x'+x.toString(16).padStart(4,'0');
// counts
let lab={HIT:0,PARTIAL:0,MISS:0}, nol={consistent:0,partial:0,wrong:0};
for(const r of ROWS){ if(r[3]==='NOLABEL') nol[r[4]]++; else lab[r[3]]++; }
const labTot=lab.HIT+lab.PARTIAL+lab.MISS;
const nolTot=nol.consistent+nol.partial+nol.wrong;
const allHit=lab.HIT+nol.consistent, allPart=lab.PARTIAL+nol.partial, allMiss=lab.MISS+nol.wrong;
const tot=labTot+nolTot;
const pct=(a,b)=>(100*a/b).toFixed(0)+'%';
console.log('rows:',ROWS.length);
console.log('--- LABELED routines (rubric gives a distinct name) ---');
console.log(`  HIT ${lab.HIT}  PARTIAL ${lab.PARTIAL}  MISS ${lab.MISS}  (total ${labTot})`);
console.log(`  exact-correct ${pct(lab.HIT,labTot)}; right-subsystem ${pct(lab.HIT+lab.PARTIAL,labTot)}; wrong ${pct(lab.MISS,labTot)}`);
console.log('--- NOLABEL routines (no distinct rubric label; judged behaviourally) ---');
console.log(`  consistent ${nol.consistent}  partial ${nol.partial}  wrong ${nol.wrong}  (total ${nolTot})`);
console.log('--- ALL 83 (combined) ---');
console.log(`  correct/consistent ${allHit} (${pct(allHit,tot)})  partial ${allPart} (${pct(allPart,tot)})  wrong ${allMiss} (${pct(allMiss,tot)})`);
console.log('\nWRONG (miss/wrong) list:');
for(const r of ROWS) if(r[3]==='MISS'||r[4]==='wrong') console.log('  '+hx(r[0]),r[1],'->',r[2],'::',r[5]);
// emit markdown table
let md='| addr | my T6.1 name | rubric / canonical | verdict | note |\n|---|---|---|---|---|\n';
for(const r of ROWS.sort((a,b)=>a[0]-b[0])){ const v=r[3]==='NOLABEL'?('NOLABEL/'+r[4]):r[3]; md+=`| ${hx(r[0])} | ${r[1]} | ${r[2]} | ${v} | ${r[5]} |\n`; }
require('fs').writeFileSync('/tmp/t61/score_table.md',md);
