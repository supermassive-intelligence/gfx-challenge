# T6.2 — Annotation accuracy score (trace-driven T6.1 vs published rubric)

Status: awaiting-human (research result; Sudnya ratifies the HIT/PARTIAL/MISS
judgement calls, which are semantic and partly subjective).

## What this measures

How well the **trace-only** annotation method (T6.1 — names derived from the
attract heavy trace WITHOUT consulting source) recovered each routine's meaning,
scored against the published rubric now that we are allowed to open it:
`disassembler/oracle/labels.json` + Scott Tunstall's commented `src/berzerk.asm`
(he converted Frenzy's 8085 source to Z80 and ported its comments). Per the T6.1
method rule, this rubric was OFF-LIMITS during T6.1 and is the grading key here.

Out of scope (would void the measurement): editing T6.1 annotations to match.
The T6.1 docs are left exactly as produced.

## Method

1. Extract my 83 T6.1 names from `cdoc/annotated-asm-berzerk.md`.
2. For each entry PC, find the canonical label at that exact address
   (labels.json + every `LABEL:` in berzerk.asm) or, if none, the enclosing
   labelled routine + Tunstall's comment block.
3. Assign a verdict by semantic judgement:
   - **HIT** — my name semantically matches the canonical meaning (even when the
     canonical label is cryptic, e.g. `C.LOAD`, `RTOAX`, `SR.TAB`, `LTABLE`).
   - **PARTIAL** — correct subsystem + mechanism, wrong specific role/entity/field
     (e.g. player vs robot, credits vs score, erase vs draw).
   - **MISS** — wrong meaning.
   - **NOLABEL** — the rubric has no distinct label at that address (my method
     split the routine finer than the curated set). Judged by behavioural
     consistency with the enclosing label/comment: consistent / partial / wrong.
4. Reproducible: `node machine/tools/t61/score.js` (verdict table is inlined in
   that script and emitted to score_table.md).

## Score

```
rows: 83
--- LABELED routines (rubric gives a distinct name) ---
  HIT 31  PARTIAL 15  MISS 2  (total 48)
  exact-correct 65%; right-subsystem 96%; wrong 4%
--- NOLABEL routines (no distinct rubric label; judged behaviourally) ---
  consistent 19  partial 12  wrong 4  (total 35)
--- ALL 83 (combined) ---
  correct/consistent 50 (60%)  partial 27 (33%)  wrong 6 (7%)

WRONG (miss/wrong) list:
  0x2b39 SET_ANIM_FRAME_MASKED -> SET_VELOCITY (masked entry) :: field is velocity (ix+6/+8), not animation frame
  0x2b3d SET_ANIM_FRAME -> SET_VELOCITY :: field is velocity, not animation frame
  0x25ca DRAW_MAZE_BLOCK_A -> (comment: display player LIFE ICONS) :: life icons, NOT maze
  0x25d4 DRAW_MAZE_BLOCK_B -> (comment: display player LIFE ICONS) :: life icons, NOT maze
  0x264c DRAW_MAZE_ROW -> (life-icon row drawer) :: life-icon row, NOT maze
  0x2662 DRAW_MAZE_COL -> (life-icon col drawer) :: life-icon col, NOT maze
```

Headline: on the 48 routines the rubric names distinctly, **65% exact-correct,
96% landed in the right subsystem, 4% (2 routines) outright wrong**. Across all
83 (including the 35 my method split finer than the rubric): **60% correct,
33% partial, 7% wrong**. The entropy spine (T5.2) was independently 100% correct.

## Notable misses — what trace-only annotation CANNOT recover (the research result)

The 6 wrong calls + the systematic PARTIALs are not random; they cluster into
recoverability limits that generalize to any source-less game:

1. **Slot-field SEMANTICS (the 2 hard MISSes).** `0x2B3D SET_VELOCITY` writes
   VECTOR.X/Y (ix+6/ix+8); I called it `SET_ANIM_FRAME` because the trace shows
   the writes but not what the fields *mean* to downstream consumers — and those
   consumers (movement integration) run only in gameplay, never in attract. A
   trace gives you the access, not the type.

2. **Game-entity identity (player vs robot vs credits vs score).** The attract
   trace never enters credited play (entropy-berzerk.md sec4), so:
   - `0x18E0/0x18CD/0x1908` are CREDITS (`CMOS_CREDITS`), I read them as score.
   - `0x1F91 CHANGE_PLAYER_DIRECTION` is the PLAYER; I said robot (mechanism —
     load pattern from a direction table — was right).
   - `0x287F SHOOT`, `0x25EB` placement — entity unconfirmable from attract.

3. **Identical draw mechanism, different intent (the 4 NOLABEL "wrong").**
   `0x25CA/0x25D4/0x264C/0x2662` draw PLAYER LIFE ICONS, but the magic-RAM blit
   they use is byte-for-byte the same call shape as maze-wall drawing, so I
   labelled them `DRAW_MAZE_*`. Distinguishing "lives" from "walls" needs the
   data-table CONTENT / HUD layout, not the access pattern.

4. **Trigger CONTEXT.** `0x2BE4 TRY_SPEAK_ON_PLAYER_LEAVING_ROOM` — I correctly
   got "random speech generation" but not the trigger ("player leaving room"),
   because the gating branch (0x4371) is never taken in attract (I flagged this
   latent path in T6.1).

## What the method recovered WELL (the positive result)

- **Whole subsystems, correctly:** the bolt engine (`MOVE_AND_DRAW_BOLT`,
  `CHECK_IF_BOLT_OFFSCREEN`, `HANDLE_BOLT_COLLISION`, `COLLISION_DETECTION` — all
  HIT), the magic-RAM draw pipeline (`DRAW_SPRITE`, `CALCULATE_MAGIC_IMAGE_RAM_
  ADDRESS`, `PRINT_CHAR`, `PRINT_DIGITS`), the interrupt structure, sound-effect
  triggers, screen clears, score-pointer selection, job/coroutine creation.
- **Cryptic canonical names where description BEAT the label:** `C.LOAD` (sound
  reg load), `RTOAX`/`CALCULATE_MAGIC_IMAGE_RAM_ADDRESS`, `SR.TAB` (room setup),
  `LTABLE` (language table), `SHOWO`, `CLEAR_CHYRON`. A naive string-match scorer
  would mark these as misses; the trace method recovered the *meaning*.
- **`RANDOM` exact**, LCG verified bit-for-bit; the entropy chain 100%.

## Caveat on the score itself

HIT/PARTIAL/MISS are semantic judgement calls (e.g. is "SETUP_LEVEL" == "SR.TAB"
a HIT or PARTIAL?). A stricter grader who requires the exact canonical token
would score lower; a lenient subsystem-level grader higher. The cluster analysis
(section above) is the durable result; the single percentage is indicative, not
exact. Full per-routine verdicts: the table below.

---

# Per-routine verdict table

| addr | my T6.1 name | rubric / canonical | verdict | note |
|---|---|---|---|---|
| 0x0066 | NMI_HANDLER | (Z80 NMI vector -> 0x1721) | NOLABEL/consistent | NMI entry stub |
| 0x0509 | POST_IRQ_SELFTEST | (self-test region 0x02xx-0x05xx) | NOLABEL/consistent | POST self-test |
| 0x14f3 | UPDATE_ALL_BOLTS | HANDLE_PLAYER_BOLTS | PARTIAL | said all-bolts; canonical = player bolts |
| 0x1505 | UPDATE_BOLT_RANGE | (within HANDLE_PLAYER_BOLTS) | NOLABEL/consistent | bolt-slot loop |
| 0x151a | UPDATE_BOLT_SLOT | (within HANDLE_PLAYER_BOLTS) | NOLABEL/consistent | per-slot bolt update |
| 0x1553 | MOVE_AND_DRAW_BOLT | MOVE_AND_DRAW_BOLT | HIT | exact |
| 0x157e | CHECK_BOLT_BOUNDS | CHECK_IF_BOLT_OFFSCREEN | HIT |  |
| 0x1597 | BOLT_LIMIT_COMPARE | CHECK_IF_ZERO_OR_E | HIT | zero-or-E compare = limit compare |
| 0x15a0 | BOLT_HIT_SCAN | HANDLE_BOLT_COLLISION | HIT |  |
| 0x15cb | BOLT_VS_ACTOR_COLLISION | COLLISION_DETECTION | HIT |  |
| 0x1666 | COLD_START | (game executive @0x1642+) | NOLABEL/consistent | boot/init (di; create job) |
| 0x1685 | START_GAME | (game executive; reseed @0x169a) | NOLABEL/consistent | new-game reseed (matches T5.1 game-start mix) |
| 0x1721 | NMI_SOUND_SERVICE | NMI_HANDLER | HIT | correctly id NMI handler + its sound/speech job |
| 0x1776 | WRITE_SOUND_REGISTERS | C.LOAD | HIT | cryptic canonical; recovered meaning (load sound chip regs) |
| 0x188b | ATTRACT_DEMO_LOOP | (cover DEFAULT_PLAYER_STATE) | NOLABEL/partial | demo/default-player-state area |
| 0x18cd | DRAW_SMALL_FIELD | PRINT_CREDITS | PARTIAL | drew a field; missed = credits |
| 0x18e0 | READ_BCD_PAIR | GET_CREDITS_AS_BCD | PARTIAL | BCD read right; called the var score, it is credits |
| 0x1908 | STEP_SCORE_DIGIT | (credits display; CMOS_CREDITS) | NOLABEL/partial | digit step right; it is credits not score |
| 0x197b | DRAW_SCORE | (credits/demo display region) | NOLABEL/partial | numeric HUD draw; credits vs score |
| 0x1997 | READ_SYSTEM_INPUT_MASK | (credits/demo region) | NOLABEL/partial | reads port 0x49 SYSTEM; mechanism right |
| 0x19ac | DRAW_ATTRACT_SCREEN | (big draw: clear+colour+strings) | NOLABEL/consistent | attract/title compose |
| 0x1a45 | FILL_ROW_FF | WRITE_FF_64_TIMES_HL | HIT |  |
| 0x1a4e | CLEAR_SCREEN_SET_FLIP | CLEAR_SCREEN | HIT | flip detail also correct |
| 0x1a98 | ATTRACT_SCENE_DISPATCH | (attract sequence) | NOLABEL/consistent | attract scene step |
| 0x1add | CLEAR_BOTTOM_STRIP | CLEAR_CHYRON | HIT | chyron = bottom strip |
| 0x1aed | DISPATCH_BY_LANGUAGE | LTABLE | HIT | LTABLE=language table; descriptive name |
| 0x1c6e | CHECK_ROBOT_PROXIMITY | (unlabeled; coord transforms) | NOLABEL/consistent | Sudnya spot-reviewed in T6.1 |
| 0x1ce7 | COORD_TO_MAZECELL | (unlabeled; index 0x435E table) | NOLABEL/consistent | coord->cell quantize |
| 0x1d12 | SOUND_ENGINE_TICK | (unlabeled; uses 0x0885 script ptr) | NOLABEL/consistent | sound sequencer step |
| 0x1d22 | SOUND_SEQ_DISPATCH | (unlabeled; jump table 0x1D31) | NOLABEL/consistent | sound bytecode dispatch |
| 0x1e22 | SPAWN_ACTOR_COROUTINE | CREATE_JOB | HIT | job=coroutine |
| 0x1e59 | COROUTINE_ENTER | (within CREATE_JOB) | NOLABEL/consistent | allocate frame + enter |
| 0x1e6d | ACTOR_YIELD_TYPED | ACTIVATE_HEAD_JOB | PARTIAL | scheduler op; yield vs activate-head |
| 0x1e78 | ACTOR_YIELD | STOP_JOB | PARTIAL | scheduler op; yield vs stop-job |
| 0x1f91 | SET_ROBOT_SPRITE_PTR | CHANGE_PLAYER_DIRECTION | PARTIAL | sprite-pattern mechanism right (loads P.TAB); wrong entity (player not robot), missed velocity part |
| 0x1f94 | SET_ROBOT_SPRITE_PTR_ALT | CDIR | PARTIAL | alt entry; loads player pattern via SET_VELOCITY; wrong entity |
| 0x1fd4 | INIT_COROUTINE_STACK | MAN_INIT | PARTIAL | init stack right; missed it is the player (MAN) |
| 0x200e | LINK_COROUTINE_ALT | (comment: alloc a robot VECTOR on stack) | NOLABEL/partial | stack-alloc right; it is robot-vector specific |
| 0x209d | SETUP_LEVEL | SR.TAB | HIT | SR.TAB = set-room/screen table routine |
| 0x22eb | INIT_GAMEPLAY_STATE | (comment: TREST; returns screen-flip flag) | NOLABEL/partial | reset + flip-test; I framed as init |
| 0x22f1 | INIT_ACTOR_TABLE | (zeros 0x437B table) | NOLABEL/consistent | actor-table zero |
| 0x2314 | DRAW_STATUS_LINE | SHOW_SCORE | PARTIAL | shows score; I said status line |
| 0x2334 | SELECT_SCORE_PTR | GET_PLAYER_SCORE_PTR | HIT | near-exact |
| 0x2341 | ADD_AND_DRAW_SCORE | UPDATE_SCORE | HIT |  |
| 0x2436 | UPDATE_ROBOT_MOVE | SETPAT | PARTIAL | robot area; SETPAT = set sprite pattern specifically |
| 0x24f7 | REMOVE_ACTOR_FROM_LIST | (cover BLAM; unlinks actor) | NOLABEL/consistent | likely the death-cleanup unlink |
| 0x2540 | GENERATE_MAZE_AND_ROBOTS | (room/screen setup) | NOLABEL/partial | broader: also draws lives + HUD |
| 0x25ca | DRAW_MAZE_BLOCK_A | (comment: display player LIFE ICONS) | NOLABEL/wrong | life icons, NOT maze |
| 0x25d4 | DRAW_MAZE_BLOCK_B | (comment: display player LIFE ICONS) | NOLABEL/wrong | life icons, NOT maze |
| 0x25e4 | MAGICADDR_PRESET_10 | (helper for icon draw) | NOLABEL/partial | magic-addr preset; used by life-icon draw |
| 0x25eb | PLACE_ROBOT_RANDOM | (RANDOM x2; near life/HUD draw) | NOLABEL/partial | RANDOM-driven placement; entity uncertain from attract |
| 0x264c | DRAW_MAZE_ROW | (life-icon row drawer) | NOLABEL/wrong | life-icon row, NOT maze |
| 0x2662 | DRAW_MAZE_COL | (life-icon col drawer) | NOLABEL/wrong | life-icon col, NOT maze |
| 0x2678 | RANDOM | RANDOM | HIT | exact + LCG verified |
| 0x26ab | FRAME_IRQ_DISPATCHER | (comment: Interrupt routine) | NOLABEL/consistent | the IM2 interrupt routine |
| 0x272d | DRAW_OBJECT | ERASE_PATTERN | PARTIAL | same sprite pipeline; canonical = erase pass |
| 0x27a9 | UPDATE_OBJECT_MOTION | MOVE_ANIMATE_VECTOR | HIT |  |
| 0x27f5 | TICK_OBJECT_TIMERS | (within MOVE_ANIMATE_VECTOR; 0x0872 list) | NOLABEL/consistent | list timer tick |
| 0x2817 | BLIT_SPRITE_TO_MAGICRAM | DRAW_SPRITE | HIT |  |
| 0x287f | SPAWN_ROBOT_SHOT | SHOOT | PARTIAL | SHOOT right; entity (robot) unconfirmed from attract |
| 0x297b | DRAW_TEXT_RUN | PRINT_STRING_297B | HIT |  |
| 0x29a1 | PIXEL_TO_MAGICRAM_PRESET | RTOAX | HIT | cryptic canonical; recovered meaning |
| 0x29a3 | PIXEL_TO_MAGICRAM_ADDR | CALCULATE_MAGIC_IMAGE_RAM_ADDRESS | HIT | near-exact |
| 0x29db | DRAW_CHARS_MAGICRAM | PRINT_CHAR | HIT |  |
| 0x2a40 | FORMAT_AND_DRAW_DIGITS | PRINT_DIGITS | HIT |  |
| 0x2a4a | FORMAT_AND_DRAW_DIGITS_ALT | SHOWO | HIT | SHOWO=show/output digits |
| 0x2b39 | SET_ANIM_FRAME_MASKED | SET_VELOCITY (masked entry) | MISS | field is velocity (ix+6/+8), not animation frame |
| 0x2b3d | SET_ANIM_FRAME | SET_VELOCITY | MISS | field is velocity, not animation frame |
| 0x2b54 | SPAWN_TYPED_ACTOR | (unlabeled; creates actor type 0x82) | NOLABEL/consistent | actor spawn |
| 0x2bde | QUEUE_SPEECH_A | SAY_INTRUDER_ALERT_INTRUDER_ALERT | HIT | queues a specific speech phrase |
| 0x2be4 | GENERATE_INTRO_SPEECH | TRY_SPEAK_ON_PLAYER_LEAVING_ROOM | PARTIAL | random speech right; trigger (leaving room) not recoverable from attract |
| 0x2c1f | QUEUE_SPEECH_B | SAY_GOT_THE_HUMANOID_GOT_THE_INTRUDER | HIT | queues a specific speech phrase |
| 0x33bd | START_SFX_PRIO0 | SFIRE | HIT | sfx trigger; specific sound (fire) not named |
| 0x3439 | START_SFX_PRIO3 | SFRY | HIT | sfx trigger (fry) |
| 0x348a | START_SFX_PRIO1_A | SBLAM | HIT | sfx trigger (blam) |
| 0x34e7 | START_SFX_PRIO1_B | SRFIRE# | HIT | sfx trigger (robot fire) |
| 0x35af | DRAW_MAZE_WALLS | SET_COLOUR_ATTRS_35AF | PARTIAL | sets colour attrs (the wall colouring) |
| 0x35e7 | DRAW_WALL_GROUP_A | (calls COLOUR_FILL) | NOLABEL/partial | colour-fill group |
| 0x3601 | DRAW_WALL_GROUP_B | (calls COLOUR_FILL) | NOLABEL/partial | colour-fill group |
| 0x364e | CLEAR_MAZE_COLOR | (calls COLOUR_FILL) | NOLABEL/partial | colour fill |
| 0x3657 | DRAW_WALL_SEGMENT | COLOUR_FILL | PARTIAL | generic colour fill; wall-segment is the use |
| 0x369f | RENDER_MAZE_LEVEL | (unlabeled; builds maze colour) | NOLABEL/consistent | maze render |
| 0x3719 | DRAW_PLAYER_SPRITE | UNCOLOUR_MAN | HIT | correct entity (player/MAN) + colour-sprite domain |
