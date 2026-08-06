// Registry of ported JS routines, keyed by entry_pc (matches test-plan `entry_pc`).
// Phase 9 grows this bottom-up; the bench (tools/bench.js) runs each port against
// its test-plan cases. Routines without an entry here are reported as "skipped".
import { RANDOM } from './random.js';
import { GET_CREDITS_AS_BCD } from './credits.js';
import { GET_PLAYER_SCORE_PTR } from './score_ptr.js';
import { CHECK_IF_ZERO_OR_E } from './check_zero_or_e.js';
import { SFIRE, SBLAM, SRFIRE, SFRY } from './sound_trigger.js';
import { WRITE_FF_64_TIMES_HL } from './write_ff.js';
import { SET_VELOCITY } from './set_velocity.js';
import { MAYBE_SET_VELOCITY } from './maybe_set_velocity.js';
import { CHECK_IF_BOLT_OFFSCREEN } from './check_bolt_offscreen.js';
import { GET_ENABLED_START_BUTTONS } from './enabled_start_buttons.js';
import { SAY_INTRUDER_ALERT, SAY_GOT_THE_HUMANOID } from './speech_trigger.js';
import { CALCULATE_MAGIC_IMAGE_RAM_ADDRESS, RTOAX } from './magic_image_addr.js';
import { WALK_OBJECT_TIMERS } from './walk_object_timers.js';
import { PRINT_CHAR } from './print_char.js';
import { C_LOAD } from './c_load.js';
import { RESET_JOBS_22F1 } from './reset_jobs_22f1.js';
import { DRAW_SPRITE } from './draw_sprite.js';
import { COORD_TO_MAZECELL } from './coord_to_mazecell.js';
import { BOLT_VS_ACTOR_COLLISION } from './bolt_vs_actor_15cb.js';
import { UPDATE_OBJECT_MOTION } from './update_object_motion_27a9.js';
import { UNCOLOUR_MAN } from './uncolour_man_3719.js';
import { UPDATE_SCORE } from './update_score.js';
import { MOVE_AND_DRAW_BOLT } from './move_and_draw_bolt.js';
import { PRINT_DIGITS } from './print_digits.js';
import { BOLT_HIT_SCAN } from './bolt_hit_scan_15a0.js';
import { DRAW_OBJECT } from './draw_object_272d.js';
import { UPDATE_BOLT_SLOT } from './update_bolt_slot_151a.js';
import { UPDATE_ALL_BOLT_SLOTS } from './update_all_bolts_1505.js';
import { STEP_BOLT_GROUPS } from './step_bolt_groups_14f3.js';
import { SET_OBJECT_IMAGE_1f91, SET_OBJECT_IMAGE_1f94 } from './set_object_image_1f91.js';
import { MAGIC_ADDR_TO_DE } from './magic_addr_de_25e4.js';

export const PORTS = new Map([
  ['0x2678', RANDOM],
  ['0x18e0', GET_CREDITS_AS_BCD],
  ['0x2334', GET_PLAYER_SCORE_PTR],
  ['0x1597', CHECK_IF_ZERO_OR_E],
  ['0x33bd', SFIRE],
  ['0x348a', SBLAM],
  ['0x34e7', SRFIRE],
  ['0x3439', SFRY],
  ['0x1a45', WRITE_FF_64_TIMES_HL],
  ['0x2b3d', SET_VELOCITY],
  ['0x2b39', MAYBE_SET_VELOCITY],
  ['0x157e', CHECK_IF_BOLT_OFFSCREEN],
  ['0x1997', GET_ENABLED_START_BUTTONS],
  ['0x2bde', SAY_INTRUDER_ALERT],
  ['0x2c1f', SAY_GOT_THE_HUMANOID],
  ['0x29a1', RTOAX],
  ['0x29a3', CALCULATE_MAGIC_IMAGE_RAM_ADDRESS],
  ['0x27f5', WALK_OBJECT_TIMERS],
  ['0x29db', PRINT_CHAR],
  ['0x1776', C_LOAD],
  ['0x22f1', RESET_JOBS_22F1],
  ['0x2817', DRAW_SPRITE],
  ['0x1ce7', COORD_TO_MAZECELL],
  ['0x15cb', BOLT_VS_ACTOR_COLLISION],
  ['0x27a9', UPDATE_OBJECT_MOTION],
  ['0x3719', UNCOLOUR_MAN],
  ['0x2341', UPDATE_SCORE],
  ['0x1553', MOVE_AND_DRAW_BOLT],
  ['0x2a40', PRINT_DIGITS],
  ['0x15a0', BOLT_HIT_SCAN],
  ['0x272d', DRAW_OBJECT],
  ['0x151a', UPDATE_BOLT_SLOT],
  ['0x1505', UPDATE_ALL_BOLT_SLOTS],
  ['0x14f3', STEP_BOLT_GROUPS],
  ['0x1f91', SET_OBJECT_IMAGE_1f91],
  ['0x1f94', SET_OBJECT_IMAGE_1f94],
  ['0x25e4', MAGIC_ADDR_TO_DE],
]);

// Live-machine dispatch metadata (T9.1), parallel to PORTS. The bench does NOT
// use this (it strips stack scaffolding and ignores timing); only the live port
// hook does. Each entry:
//   cycles -- the displaced Z80 routine's own cycle cost (heavy-trace cycle_count,
//             entry..ret inclusive). Charged to the scheduler so interrupt cadence
//             is preserved (the V256/entropy phase is timing-locked; see T5.2).
//   pushes -- the stack writes the routine makes that PERSIST as residue on the
//             VRAM-overlapping stack (0x4000-0x5FFF), in descending (push) order.
//             Two kinds, both modeled the same way:
//               * a register name ('hl','af',...) -- an ENTRY push, e.g. RANDOM does
//                 `push hl ... pop hl; ret`.
//               * a NUMBER -- the residue left by an INNER `call` the port elides:
//                 the real routine's `call X` pushes its return address onto the
//                 stack (VRAM), and although the matching `ret` pops sp back, the
//                 two bytes it wrote stay on screen as transient noise. A
//                 register-only port skips that call, so we replay the residue
//                 (the LAST inner call's return address at the call-site sp).
//             The hook must replay these because in Berzerk the stack overlaps VRAM:
//             a `push`/`call` scribbles screen memory, transient noise the real
//             machine (and MAME) produce. A port that omits it diverges from
//             un-hooked by exactly those bytes. See the stack-overlaps-VRAM hazard
//             in tasks/P9/T9.1. NOTE: 0x157e passed transparency WITHOUT its residue
//             by luck (the bytes fell outside the rendered window); declared anyway
//             so it matches the real machine deterministically, not coincidentally.
// `cycles`    -- straight-line/base cost charged when the port reports no path cost.
// `maxCycles` -- worst-case cost over all paths; the interrupt-decline gate uses it
//                for branching routines (the port sets ctx.cycles to the actual
//                taken-path cost). Omit when cost is path-independent.
export const PORT_META = new Map([
  ['0x2678', { cycles: 140, pushes: ['hl'] }],
  ['0x18e0', { cycles: 74, pushes: [] }],                  // straight-line
  ['0x2334', { cycles: 41, maxCycles: 55, pushes: [] }],   // ret z: 41 taken / 55 not
  ['0x1597', { cycles: 29, maxCycles: 40, pushes: [] }],   // 29/36/40 by path
  // Sound-trigger family: push af (stack overlaps VRAM -> replay). 117 play / 78 skip.
  ['0x33bd', { cycles: 117, maxCycles: 117, pushes: ['af'] }],
  ['0x348a', { cycles: 117, maxCycles: 117, pushes: ['af'] }],
  ['0x34e7', { cycles: 117, maxCycles: 117, pushes: ['af'] }],
  ['0x3439', { cycles: 117, maxCycles: 117, pushes: ['af'] }],
  ['0x1a45', { cycles: 1683, pushes: [] }],                 // memset 64x0xFF, straight-line
  ['0x2b3d', { cycles: 132, pushes: [] }],                  // straight-line
  ['0x2b39', { cycles: 22, maxCycles: 148, pushes: [] }],   // ret z 22 / fall-into-SET_VELOCITY 148
  // composes CHECK_IF_ZERO_OR_E x2: 140 + inner1 + inner2 (each 29/36/40). max 220.
  // Inner `call $1597`s leave residue; the last (at 0x1590) pushes ret addr 0x1593.
  ['0x157e', { cycles: 198, maxCycles: 220, pushes: [0x1593] }],
  // composes GET_CREDITS_AS_BCD; path 143/164/166 by credit count. The inner
  // `call $18E0` (0x1997) pushes ret addr 0x199A onto the VRAM stack -> replay it.
  ['0x1997', { cycles: 143, maxCycles: 166, pushes: [0x199a] }],
  ['0x2bde', { cycles: 46, pushes: [] }],                   // ld hl; jp TALK; ld(nn),hl; ret
  ['0x2c1f', { cycles: 65, pushes: [] }],                   // straight-line (xor a; 2 stores)
  // Magic-image address calc (leaf, out $4B, no pushes). FLIP==0 path 129/136;
  // FLIP!=0 (cocktail) path 158/165 (bench-unexercised). 0x29a1 = 0x29a3 + `ld b,$90`.
  ['0x29a1', { cycles: 136, maxCycles: 165, pushes: [] }],
  ['0x29a3', { cycles: 129, maxCycles: 158, pushes: [] }],
  // Circular object-list walk; cost is list-length dependent (no inner call/push,
  // no stack residue). Port sets ctx.cycles to the exact taken-path T-states; the
  // decline gate uses maxCycles = observed worst case over the 5 scripts (the same
  // scripts the live regression replays, so actual <= maxCycles there).
  ['0x27f5', { cycles: 127, maxCycles: 1242, pushes: [] }],
  // PRINT_CHAR: leaf glyph blit. push hl/de/af residue on the VRAM stack -> replay.
  // The `af` residue F-byte is f_out (push af follows the ADD HL chain); the hook
  // captures push residue from the OUTPUT bank so a balanced push/pop replays the
  // push-time value. Cost path-dependent (9-row loop fixed; +sign and +flip branches);
  // port sets ctx.cycles. maxCycles = flip+negative-sign worst case (1302).
  ['0x29db', { cycles: 1276, maxCycles: 1302, pushes: ['hl', 'de', 'af'] }],
  // C_LOAD: leaf 6840/sound-register loader. Fixed path (both djnz counts are
  // immediates, no data-dependent branch) -> 642 T-states, path-independent. No
  // push/call -> no VRAM-stack residue.
  ['0x1776', { cycles: 642, pushes: [] }],
  // RESET_JOBS @0x22f1: leaf job/coroutine teardown. Single fixed path (djnz count
  // is the immediate $38) -> 1612 T-states. `push iy ... pop hl` leaves IY residue on
  // the VRAM-overlapping stack (IY unchanged, so output==input bank) -> pushes:['iy'].
  ['0x22f1', { cycles: 1612, pushes: ['iy'] }],
  // DRAW_SPRITE: true leaf blitter, no inner call / no push -> no VRAM-stack residue.
  // Cost is row-count dependent (port accumulates exact T-states into ctx.cycles).
  // maxCycles = observed worst over the 5 regression scripts (set after measurement);
  // the decline gate uses it so live actual <= maxCycles there (same scripts replayed).
  ['0x2817', { cycles: 362, maxCycles: 1846, pushes: [] }],
  // COORD_TO_MAZECELL: clean leaf (no inner call/push -> no VRAM-stack residue). Cost
  // is loop-iteration dependent; the port sets exact ctx.cycles. maxCycles = the worst
  // path (longest L-band prologue + 5 full H-loop iterations + epilogue ~ 373) rounded
  // up for the interrupt-decline gate.
  ['0x1ce7', { cycles: 140, maxCycles: 380, pushes: [] }],
  // BOLT_VS_ACTOR_COLLISION: leaf box-overlap test (no inner call/push -> no residue).
  // Path-dependent cost (port sets exact ctx.cycles); maxCycles = the full hit path
  // rounded up for the decline gate. Success path uses framesToDrop=1. Registered under
  // the T2.3 X/Y-flag tolerance (its bit-2 ret-z opener X/Y are MAME-vs-core divergent).
  ['0x15cb', { cycles: 31, maxCycles: 340, pushes: [] }],
  // UPDATE_OBJECT_MOTION: leaf object-motion stepper. `push hl; pop iy` pushes the entry
  // object-pointer onto the VRAM-overlapping stack; the `pop iy` lands it in IY (which the
  // port leaves unmodified) so IY_out == the push residue and pushes:['iy'] replays it. This
  // residue IS visible: in attract the stack sits in the 0x42xx VRAM window (the transparency
  // localizer flagged byte 0x42ec). Path-dependent cost (port sets ctx.cycles). Registered
  // under the T2.3 X/Y-flag tolerance (its `bit 2,(hl); ret z` X/Y are MAME-vs-core div.).
  ['0x27a9', { cycles: 47, maxCycles: 470, pushes: ['iy'] }],
  // UNCOLOUR_MAN: leaf sprite-erase/restore. Both `push hl` (3720, 3741) push the object
  // pointer P at the entry SP; the matching `pop hl`s restore it, so hl_out == P and the
  // post-port output-bank capture replays the residue correctly with pushes:['hl']. This
  // residue IS visible: in player-death the stack sits in the 0x42xx VRAM window (found by
  // the transparency localizer at byte 0x42ec). Path-dependent cost (port sets ctx.cycles).
  // maxCycles bounds the gate: the combined RESTORE+BLANK path measures 1833T live (worst
  // over the 5 scripts, 6933 invocations); the bench/script-unexercised FLIP (cocktail,
  // 0x4379!=0) path adds ~33T, so 1900 is a safe ceiling >= every path's true cost.
  // Registered under the T2.3 X/Y tolerance (`bit 4,(hl); ret z` X/Y are MAME-vs-core div.).
  ['0x3719', { cycles: 60, maxCycles: 1900, pushes: ['hl'] }],
  // UPDATE_SCORE @0x2341: BCD score-add + bonus-life DIP checks. Composes 0x2334 twice;
  // the last inner `call $2334` (0x236f) leaves return-address residue 0x2372 on the
  // VRAM-overlapping stack. Path-dependent cost (port sets exact ctx.cycles; recorded
  // paths 432/497). maxCycles bounds the decline gate above every ret-path (the longer
  // bonus-award paths throw, so they are never the live cost). Registered alongside the
  // existing X/Y-flag tolerance (no observed bit n,(hl) ret on the transparent paths).
  ['0x2341', { cycles: 432, maxCycles: 560, pushes: [0x2372] }],
  // MOVE_AND_DRAW_BOLT @0x1553: FIRST non-leaf engine body (no test-plan record by
  // design -- it does `call $29A1`). Composes RTOAX; validated by live transparency
  // (attract runs the demo bolt at frame 977+). Path-dependent cost (port sets exact
  // ctx.cycles: 4x rrca/jp + dir-gated dec/inc(iy+d) + ld h,l + RTOAX + plot + in/rlca).
  // maxCycles bounds the decline gate above the worst path (all 4 DURL bits + the
  // cocktail/flipped RTOAX path ~403). The inner `call $29A1` pushes return addr 0x1578
  // onto the VRAM-overlapping stack -> replay it.
  ['0x1553', { cycles: 305, maxCycles: 410, pushes: [0x1578] }],
  // PRINT_DIGITS @0x2a40: looping composite (CALCULATE_MAGIC_IMAGE_RAM_ADDRESS once +
  // PRINT_CHAR per digit). Path-dependent cost (port sets exact ctx.cycles); a 6-digit
  // score is ~8800 T. maxCycles bounds the decline gate above the worst path. The routine
  // is LONGER than the inter-interrupt gap (~4000 T), so it mostly DECLINES (core runs it)
  // -- it fast-paths only on frames with no interrupt in its window, where the residue
  // must be exact. Residue is the last digit's deepest frame, supplied at RUNTIME via
  // ctx.pushWords (PORT_META.pushes left empty -- the output-bank model can't express the
  // intermediate last-iteration values).
  ['0x2a40', { cycles: 8800, maxCycles: 9600, pushes: [] }],
  // BOLT_HIT_SCAN @0x15a0: actor-list scan composing 0x15cb per actor (head + circular
  // list). Path-dependent cost (port sets exact ctx.cycles); maxCycles = observed worst
  // over the 5 scripts (2579) rounded up -- the decline gate uses it, and live actual <=
  // it there (same scripts replayed). 2579 < the inter-interrupt gap (~4000), so it
  // genuinely fast-paths. SP is in work RAM (0x082x) on every invocation, so the inner
  // calls' return-address residue lands outside the rendered window -> no pushes needed
  // (invisible by stack placement; see the port header). The 0x15cb hit path returns
  // non-locally to 0x15a0's caller, but the hooked 0x15a0 never pushed the inner frame,
  // so 0x15a0's own return is a normal single ret (framesToDrop=0).
  ['0x15a0', { cycles: 186, maxCycles: 2600, pushes: [] }],
  // DRAW_OBJECT @0x272d: per-actor render composing DRAW_SPRITE (0x2817) up to 2x +
  // CALCULATE_MAGIC_IMAGE_RAM_ADDRESS (0x29a3) 1x. Path-dependent cost (port sets exact
  // ctx.cycles); maxCycles = observed worst over the 5 scripts (3152) rounded up; 3152 <
  // the inter-interrupt gap (~4000) so it genuinely fast-paths. SP in work RAM (0x082e)
  // on every invocation -> push/inner-call residue outside the rendered window, no pushes.
  ['0x272d', { cycles: 86, maxCycles: 3300, pushes: [] }],
  // UPDATE_BOLT_SLOT @0x151a: per-slot bolt state machine composing 0x1553 + 0x15a0
  // (gated on collision carry) + 0x157e. TIER MOVE Tier-3->Tier-2 (callees now ported;
  // no intrinsic hazard -- see port header + decisions.md 2026-06-22; Sudnya may veto).
  // Path-dependent cost (port sets exact ctx.cycles); maxCycles = observed worst (2753)
  // rounded up; 2753 < ~4000 gap -> fast-paths. SP in work RAM (0x082x) -> no pushes.
  ['0x151a', { cycles: 88, maxCycles: 2850, pushes: [] }],
  // UPDATE_ALL_BOLT_SLOTS @0x1505: djnz loop over B (input) bolt slots composing 0x151a.
  // Path-dependent cost; maxCycles = observed worst (2845) rounded up; 2845 < ~4000 gap
  // -> fast-paths. SP in work RAM (0x082c) -> no pushes.
  ['0x1505', { cycles: 124, maxCycles: 2950, pushes: [] }],
  // STEP_BOLT_GROUPS @0x14f3: composes 0x1505 x3 (last via fall-through tail). Worst own
  // path ~4095 >= ~4000 gap -> ALWAYS-DECLINES (bench-only live). SP work RAM -> no pushes.
  ['0x14f3', { cycles: 174, maxCycles: 4200, pushes: [] }],
  // SET_OBJECT_IMAGE @0x1f91/0x1f94: compose SET_VELOCITY then store an image ptr. STRAIGHT-
  // LINE -> fixed own cost (257 / 246). maxCycles = own cost so it fast-paths. SP in VRAM,
  // so the `call $2b3d` return-addr residue 0x1F97 is visible -> pushes:[0x1f97].
  ['0x1f91', { cycles: 257, maxCycles: 257, pushes: [0x1f97] }],
  ['0x1f94', { cycles: 246, maxCycles: 246, pushes: [0x1f97] }],
  // MAGIC_ADDR_TO_DE @0x25e4: ld b,$10; call $29a3; ex de,hl; ret. Straight-line, fixed
  // own cost 167 (FLIP=0) / 196 (cocktail). maxCycles=196 so it fast-paths. SP in VRAM ->
  // the call return-addr residue 0x25E9 is visible -> pushes:[0x25e9].
  ['0x25e4', { cycles: 167, maxCycles: 196, pushes: [0x25e9] }],
]);
