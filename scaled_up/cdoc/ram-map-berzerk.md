# Berzerk RAM variable map (T6.1)

Status: awaiting-human (paired deliverable with
[annotated-asm-berzerk.md](annotated-asm-berzerk.md)).

Derived from the aggregate read/write sets of the **attract** heavy trace
(416,482 invocations / 3085 frames), cross-referenced to `cdoc/hardware-berzerk.md`
and `cdoc/entropy-berzerk.md`. Names are behaviour-derived this session (NOT from
labels.json / published source). Each row's `r/w` counts and `written by` routine
list are emitted directly from the trace, so the mechanism behind every name is
checkable; the higher-level *meaning* is my interpretation.

## Key facts about Berzerk's RAM layout (from the trace)

- The only non-video work RAM is **NVRAM 0x0800-0x0BFF** (1 KB). Most engine
  state lives here as **16-bit word pairs** (consecutive even/odd addresses
  written by the same routines with equal counts -- visible in the table).
- The game also reuses the **low VRAM band 0x4000-0x43FF** as **coroutine stacks**
  (SP is explicitly set to 0x4300 / 0x4400 / 0x0840 / 0x085E / 0x0870) and as a
  block of **scalar game variables** (0x4344-0x437A). These addresses are video
  RAM physically but are never part of the visible-bitmap draw traffic.
- **Entropy variables** (replay, do not recompute -- heavy-trace.md rule #1):
  `entropy_phase_counter` 0x089F/0x08A0 and `lcg_seed` 0x435C/0x435D. See
  entropy-berzerk.md sec3/sec6.

## The interesting NVRAM word-pair structure

Equal r/w counts on consecutive addresses = a 16-bit variable. e.g.
0x0872/0x0873 (actor_list_head, r=48961 each), 0x089F/0x08A0
(entropy_phase_counter, r=w=2512 each, written only by the IRQ 0x26AB).

---

# Variable table

#### NVRAM 0x0800-0x0BFF (battery-backed work RAM; cleared at cold boot)

| addr | name | meaning | r/w (attract) | written by |
|---|---|---|---|---|
| 0x081e-0x081f | `sfx_misc_a` | SFX scratch word (NMI-written). | r=101 w=101 | 0066 |
| 0x0820-0x0827 | `bolt_draw_scratch` | Bolt-engine working coords/limits (per-bolt temp X/Y and limit compares; written by 0x1553/0x157E/0x1597/0x15A0/0x29A1). | r=232 w=232 | 0066 1553 157e 1597 15a0 15cb 29a1 |
| 0x0828-0x082d | `bolt_engine_state` | Bolt-engine per-pass counters/pointers (0x14F3/0x1505/0x151A and the IRQ 0x26AB). | r=28791 w=28791 | 0066 14f3 1505 151a 26ab |
| 0x082a-0x082b | `blit_scratch` | Blitter scratch (shared with 0x2817/0x29A3). | r=29970 w=29970 | 0066 14f3 1505 26ab 272d 27a9 2817 29a3 3719 |
| 0x082e-0x0831 | `object_motion_scratch` | Object-motion accumulator (0x27A9/0x27F5). | r=15054 w=15055 | 0066 26ab 27a9 27f5 |
| 0x0832-0x083f | `irq_object_scratch` | IM2-IRQ object/draw scratch (only written by 0x26AB). | r=2612 w=2613 | 0066 26ab |
| 0x0850-0x0853 | `sfx_seq_ptr` | Active SFX-sequencer stream pointers (0x1D12/0x1D22). | r=2965 w=2965 | 1d12 |
| 0x0852-0x0853 | `sfx_seq_cursor` | SFX-sequencer read cursor. | r=23057 w=23057 | 0066 1721 26ab |
| 0x0854-0x085d | `nmi_regsave` | NMI/IRQ saved-register & sound-state block (0x0066/0x1721/0x1721). | r=20092 w=20092 | 0066 1721 26ab |
| 0x085e-0x085f | `nmi_saved_sp` | Saved SP for the NMI private stack (0x1721 ld (085e),sp). | r=20092 w=20092 | 0066 1721 |
| 0x086a-0x086d | `sfx_misc_b` | SFX scratch (NMI). | r=227 w=227 | 0066 |
| 0x086c-0x086f | `actor_link_tmp` | Actor-list temp link words (coroutine scheduler 0x1E6D/0x1E78/0x2B54). | r=2406 w=2406 | 0066 1e6d 1e78 |
| 0x086e-0x086f | `actor_sched_cur` | Scheduler current-frame pointer. | r=82576 w=82575 | 1e6d 1e78 26ab 2b54 |
| 0x0870-0x0871 | `actor_list_tail` | Actor/object list tail pointer (IRQ object walk 0x26AB/0x272D/0x27A9; updated 0x24F7). | r=9943 w=11995 | 1e59 22eb 22f1 24f7 26ab 272d 27a9 |
| 0x0872-0x0873 | `actor_list_head` | Actor/coroutine list head (the active actor frame pointer; coroutine scheduler). | r=48961 w=20009 | 1e59 1e6d 1e78 2b54 |
| 0x0874-0x0875 | `irq_saved_sp` | Saved SP for the IM2-IRQ private stack (0x26AB ld (0874),sp). | r=5019 w=5020 | 26ab |
| 0x0876-0x0877 | `player_actor_ptr` | Player actor pointer (read 27k x; head used by hit-scan 0x15A0 and draw 0x1C6E/0x272D). | r=26989 w=5 | 1e59 22eb 22f1 |
| 0x0878-0x0884 | `sound_register_image` | 6840/SFX register shadow image pushed to ports 0x40-0x47 (read-only by 0x1776; set elsewhere). Never written in attract -> stays at boot value. | r=20092 w=0 | (boot only) |
| 0x0885-0x0886 | `sfx_script_ptr` | Sound-sequencer script pointer (set by the SFX triggers 0x33BD/0x3439/0x348A/0x34E7 and 0x1D12). | r=2965 w=2991 | 1d12 1e78 33bd 3439 348a 34e7 |
| 0x0887-0x088a | `sfx_dispatch_tmp` | SFX dispatch scratch (0x1D22). | r=0 w=2965 | 1d22 |
| 0x0889 | `sfx_priority` | Current sound-effect priority level; a new START_SFX preempts only if it outranks this. | r=37 w=2991 | 1d22 1e78 33bd 3439 348a 34e7 |
| 0x0898-0x0899 | `speech_queue_ptr` | Speech phrase pointer consumed by the NMI speech driver (0x1721 -> S14001A port 0x44). | r=2965 w=20097 | 0066 1721 1a98 26ab 2bde 2be4 2c1f |
| 0x089a | `speech_flag` | Speech active/abort flag. | r=0 w=2 | 2be4 2c1f |
| 0x089c-0x089e | `score_or_demo_counter` | 3-byte BCD score/demo counter drawn by 0x197B/0x1908. | r=23575 w=0 | (boot only) |
| 0x089f-0x08a0 | `entropy_phase_counter` | ENTROPY: 2-byte interrupt-phase counter advanced every non-vblank IRQ (mixes port 0x49); the value the LCG seed is derived from. Written ONLY by 0x26AB. | r=2512 w=2512 | 26ab |
| 0x08a4-0x08a5 | `bcd_score_word` | Packed-BCD score/counter word read by digit formatter 0x18E0. | r=70730 w=0 | (boot only) |
| 0x0940-0x094b | `player_sprite_shadow` | Player sprite working/erase buffer (0x3719 player draw, 0x26AB). | r=1944 w=1946 | 26ab 3719 |

#### VRAM low band 0x4000-0x43FF -- used as STACKS and GAME VARIABLES (not bitmap)

| addr | name | meaning | r/w (attract) | written by |
|---|---|---|---|---|
| 0x4000 | `boot_post_flag` | Boot/POST-incomplete flag; NMI 0x0066 aborts to POST if nonzero. | r=20105 w=0 | (boot only) |
| 0x40d4-0x43b2 | `actor_stacks_and_table` | Coroutine stacks (SP set to 0x4300/0x4400) and per-actor slot data live through here; reads/writes at +0x32 strides are actor-frame return-address pops (heavy-trace.md known-limitation). | r=1 w=1 | 1e59 |
| 0x4300-0x4301 | `stack_save_buildctr` | Dual-use scratch: saved SP during magic-window stack-fills (0x1A4E/0x1E59/0x1E78) and a BCD row counter during maze build (0x19EC). | r=24 w=28 | 1a4e 1e59 1e78 |
| 0x433e-0x4340 | `score_ptr_p1` | Player-1 score pointer/value base (saved/restored around reseed in 0x1685; selected by 0x2334). | r=53 w=1 | 1685 |
| 0x4341-0x4343 | `score_ptr_p2` | Player-2 score base (selected when 0x4344==2). | (untouched) | (boot only) |
| 0x4344 | `current_player` | Current player / player-count selector (==2 chooses P2 paths; copied from ROM config at game start). | r=42 w=1 | 1685 |
| 0x4344-0x434f | `game_config_block` | 12-byte per-game config copied by 0x1685 from ROM 0x16CD: 0x434A bonus/score param, 0x434B robot count (read 9700x), 0x434C level/difficulty counter, 0x434D robot speed/type, 0x434E misc. | r=42 w=1 | 1685 |
| 0x435c-0x435d | `lcg_seed` | ENTROPY: LCG seed for RANDOM (0x2678); reseeded at game start (0x1685) and per maze (0x2540) from the entropy phase counter. | r=117 w=118 | 2540 25eb 2678 |
| 0x435e-0x436c | `robot_placement_buf` | 15-byte robot-placement / maze-cell working buffer (copied from ROM 0x268C by 0x2540; read by 0x1CE7 coord-to-cell and the blitter). | r=688 w=3 | 2540 25eb |
| 0x436d | `score_draw_flag` | Score-redraw carry/dirty flag (0x2314/0x2341). | r=0 w=34 | 1e78 2314 2341 |
| 0x436e | `game_active_flag` | Game-active vs attract flag (0xFF in game; set by 0x1685, read 40k x). Gates sound, drawing, input paths. | r=40253 w=1 | 1685 |
| 0x436f-0x4370 | `mainloop_resume_ptr` | Main-loop/coroutine resume address (0x1685 sets 0x16D9; updated by scheduler). | r=67 w=68 | 1685 1e6d 1e78 |
| 0x4371 | `speech_gate` | Intro-speech gate (0x2BE4 skips the RANDOM speech path when nonzero). | r=41 w=26 | 1e59 1e78 |
| 0x4373-0x4375 | `score_ptr_save` | Saved score pointer across the game-start reseed (0x1685). | r=0 w=1 | 1685 |
| 0x4376 | `num_players_sel` | 1-/2-player selector set by the attract/credit path (0x188B); read by status draw. | r=16 w=0 | (boot only) |
| 0x4378 | `anim_phase` | Animation/twinkle phase byte (rlca^0x11 each object pass; 0x27A9/0x3719). | r=1969 w=25 | 1e59 27a9 |
| 0x4379 | `screen_flip` | Cocktail screen/sprite FLIP flag (0=normal, 8=flipped). Set from cabinet DIP (port 0x4A b7) + player in 0x1A4E; read by every draw/blit routine to mirror coords & magic-RAM shift. | r=13246 w=2 | 35af |
| 0x437a | `bolt_color_phase` | Bolt color/parameter cycle index (0x14F3 base, set by 0x369F). | r=2507 w=2 | 369f |
| 0x437b-0x43b2 | `bolt_actor_table` | Projectile/spark table: up to 8 slots x 8 bytes (slot+0 type/flags, +1 timer, +2/+3 X/Y, +4..7 draw state). Processed every IRQ by the bolt engine 0x14F3; zeroed by 0x22F1. | r=8168 w=673 | 157e 15a0 1e78 22eb 22f1 26ab |
| 0x43fb-0x43fc | `nmi_scratch` | NMI scratch word (0x0066 path). | r=0 w=14 | 0066 |

#### Bulk graphics memory (not variables)

| addr | name | meaning | r/w (attract) | written by |
|---|---|---|---|---|
| 0x4400-0x5bbf | `vram_bitmap` | Visible bitmap VRAM (32 bytes/line). Written directly and via the magic window. | r=2 w=0 | (boot only) |
| 0x5bc0-0x5fff | `vram_bottom_scratch` | Bottom VRAM strip / off-screen scratch (cleared by 0x1ADD; also maze build buffers 0x5E6A+). | r=0 w=1 | 1add |
| 0x6000-0x7fff | `magic_window` | Magic-RAM ALU write window (aliases VRAM at addr-0x2000); writes trigger the 74181 blit. Control via port 0x4B. | (untouched) | (boot only) |
| 0x8100-0x87ff | `color_ram` | Color RAM (4x4 attribute blocks); maze walls + sprite colors. Cleared/filled by 0x1A4E/0x35AF/0x3657/0x369F/0x3719. | r=0 w=8 | 1a4e 35af 364e 369f |
