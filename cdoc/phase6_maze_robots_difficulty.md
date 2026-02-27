# Phase 6: Maze Generation, Robot Spawning, and Difficulty Tables

Reverse-engineered from the Berzerk RC31A ROM disassembly (cdoc/berzerk_tunstall.asm).
All analysis is based on actual opcodes, not human comments or labels. Byte values
verified against the ROM binary where possible.

---

## 1. Maze Generation Algorithm ($2540-$2677)

### 1.1 Entry Point and Initialization ($2540-$2569)

The maze generator is called from $209D (room entry) and $2209 (scroll entry).

```
2540: 2A 45 43    ld   hl,($4345)       ; HL = ROOM_X (L) | ROOM_Y (H)
2543: 22 5C 43    ld   ($435C),hl       ; RNG_SEED = (ROOM_Y << 8) | ROOM_X
2546: 3A 79 43    ld   a,($4379)        ; A = FLIP (0=upright, 8=cocktail)
2549: B7          or   a
254A: 20 05       jr   nz,$2551         ; if cocktail, goto $2551
254C: 21 6A 5E    ld   hl,$5E6A        ; upright: HL = $5E6A (VRAM address)
254F: 18 03       jr   $2554
2551: 21 4A 44    ld   hl,$444A        ; cocktail: HL = $444A (VRAM address)
2554: 11 14 00    ld   de,$0014        ; DE = 20 (stride = 32 - 12 = 20)
2557: AF          xor  a               ; A = 0
2558: 0E 0C       ld   c,$0C           ; C = 12 (12 rows)
255A: 06 0C       ld   b,$0C           ; B = 12 (12 columns per row)
255C: 77          ld   (hl),a          ; clear byte
255D: 23          inc  hl
255E: 10 FC       djnz $255C           ; loop 12 bytes
2560: 19          add  hl,de           ; skip 20 bytes (stride)
2561: 0D          dec  c
2562: 20 F6       jr   nz,$255A        ; loop 12 rows
```

This clears a 12x12 byte rectangle in VRAM. For upright, the base address is $5E6A.
For cocktail, $444A.

Then the 15-byte wall template is copied to the maze configuration buffer at $435E:

```
2564: 01 0F 00    ld   bc,$000F        ; BC = 15 bytes
2567: 11 5E 43    ld   de,$435E        ; DE = $435E (maze config buffer)
256A: 21 8C 26    ld   hl,$268C        ; HL = $268C (wall template in ROM)
256D: ED B0       ldir                 ; copy 15 bytes from ROM to RAM
```

### 1.2 RNG Seeding

The RNG seed is set to `(ROOM_Y << 8) | ROOM_X` at $2540-$2543. This means
every room with the same (X,Y) coordinates produces the identical maze layout,
which is the canonical Berzerk behavior -- mazes are deterministic per room.

### 1.3 Random Number Generator ($2678)

```
RANDOM:
2678: E5          push hl
2679: 2A 5C 43    ld   hl,($435C)      ; HL = RNG_SEED
267C: 54          ld   d,h
267D: 5D          ld   e,l             ; DE = seed
267E: 29          add  hl,hl           ; HL = seed * 2
267F: 19          add  hl,de           ; HL = seed * 3
2680: 29          add  hl,hl           ; HL = seed * 6
2681: 19          add  hl,de           ; HL = seed * 7
2682: 11 53 31    ld   de,$3153        ; DE = $3153 (12627)
2685: 19          add  hl,de           ; HL = seed * 7 + $3153
2686: 22 5C 43    ld   ($435C),hl      ; RNG_SEED = new seed
2689: 7C          ld   a,h             ; A = high byte of new seed
268A: E1          pop  hl
268B: C9          ret                  ; return A = random byte
```

The RNG is a linear congruential generator:
```
seed = (seed * 7 + 0x3153) & 0xFFFF
return seed >> 8
```

### 1.4 Wall Template at $268C (15 bytes)

Raw bytes read from the disassembly:

| Offset | Addr  | Hex | Purpose           |
|--------|-------|-----|-------------------|
| 0      | $268C | $05 | Column 0 config   |
| 1      | $268D | $04 | Column 1 config   |
| 2      | $268E | $04 | Column 2 config   |
| 3      | $268F | $04 | Column 3 config   |
| 4      | $2690 | $06 | Column 4 config   |
| 5      | $2691 | $01 | Row 0, Col 0      |
| 6      | $2692 | $00 | Row 0, Col 1      |
| 7      | $2693 | $00 | Row 0, Col 2      |
| 8      | $2694 | $00 | Row 0, Col 3      |
| 9      | $2695 | $02 | Row 0, Col 4      |
| 10     | $2696 | $09 | Row 1, Col 0      |
| 11     | $2697 | $08 | Row 1, Col 1      |
| 12     | $2698 | $08 | Row 1, Col 2      |
| 13     | $2699 | $08 | Row 1, Col 3      |
| 14     | $269A | $0A | Row 1, Col 4      |

The template is structured as a 3-row by 5-column grid. Each byte encodes wall
presence using bit flags:

| Bit | Meaning                                    |
|-----|--------------------------------------------|
| 0   | Left-side vertical wall present             |
| 1   | Right-side vertical wall present            |
| 2   | Top-side horizontal wall present            |
| 3   | Bottom-side horizontal wall present         |

The three rows are: top border (bytes 0-4), middle cells (bytes 5-9), bottom
border (bytes 10-14).

Decoded wall flags:

```
Row 0 (border):  $05=LB  $04=B   $04=B   $04=B   $06=RB
Row 1 (cells):   $01=L   $00=--  $00=--  $00=--  $02=R
Row 2 (border):  $09=LT  $08=T   $08=T   $08=T   $0A=RT

L=left(bit0) R=right(bit1) B=bottom(bit2->actually top context) T=top(bit3)
```

This represents the default empty room with border walls on all four sides:
- Left column has bit 0 set (left wall)
- Right column has bit 1 set (right wall)
- Top row has bit 2 set (top wall)
- Bottom row has bit 3 set (bottom wall)
- Corners combine both adjacent wall bits

### 1.5 Border Wall Drawing ($256F-$2596)

After copying the template, the code draws the fixed border walls:

```
256F: 21 08 00    ld   hl,$0008        ; H=Y=$00, L=X=$08
2572: CD D4 25    call $25D4           ; draw horizontal wall at Y=$00, X=$08
2575: 21 08 CC    ld   hl,$CC08        ; H=Y=$CC, L=X=$08
2578: CD D4 25    call $25D4           ; draw horizontal wall at Y=$CC, X=$08
257B: 21 04 00    ld   hl,$0004        ; H=Y=$00, L=X=$04
257E: CD CA 25    call $25CA           ; draw vertical wall at X=$04
2581: 21 F8 00    ld   hl,$00F8        ; H=Y=$00, L=X=$F8
2584: CD CA 25    call $25CA           ; draw vertical wall at X=$F8
```

The room has four border walls:
- Top horizontal: Y=$00, starting X=$08
- Bottom horizontal: Y=$CC, starting X=$08
- Left vertical: X=$04
- Right vertical: X=$F8

### 1.6 Interior Wall Generation Loop ($2587-$2613)

```
2587: DD 21 5E 43 ld   ix,$435E        ; IX = maze config buffer
258B: 21 38 44    ld   hl,$4438        ; HL = first interior cell VRAM addr
258E: CD EB 25    call $25EB           ; generate walls for top half
2591: 21 38 88    ld   hl,$8838        ; HL = midpoint address (color RAM area?)
2594: CD EB 25    call $25EB           ; generate walls for bottom half
```

The wall generation loop at $25EB:

```
25EB: CD 78 26    call $2678           ; A = RANDOM()
25EE: E5          push hl              ; save VRAM base
25EF: CD 78 26    call $2678           ; A = RANDOM() (second call)
25F2: 01 06 26    ld   bc,$2606        ; push return address $2606
25F5: C5          push bc
25F6: E6 03       and  $03             ; A = random & 3 (0..3)
25F8: CA 30 26    jp   z,$2630         ; case 0: wall extends UP
25FB: 3D          dec  a
25FC: CA 40 26    jp   z,$2640         ; case 1: wall extends DOWN
25FF: 3D          dec  a
2600: CA 14 26    jp   z,$2614         ; case 2: wall extends RIGHT
2603: C3 20 26    jp   $2620           ; case 3: wall extends LEFT
```

After the wall subroutine returns via the pushed $2606:

```
2606: E1          pop  hl              ; restore VRAM base
2607: DD 23       inc  ix              ; advance to next config byte
2609: 3E 30       ld   a,$30           ; $30 = 48 pixels
260B: 85          add  a,l             ; X += 48
260C: 6F          ld   l,a
260D: FE DC       cp   $DC             ; past right edge?
260F: 38 DA       jr   c,$25EB         ; if not, do next column
2611: DD 23       inc  ix              ; skip right border byte
2613: C9          ret                  ; done with this row
```

This iterates through columns at 48-pixel ($30) intervals. The X coordinate
starts at the base in L and advances by $30 each step. The loop terminates
when X+$30 >= $DC (220 decimal).

### 1.7 The Four Wall Segment Types

Two random numbers are generated per cell. The first (at $25EB) is discarded (its
high byte is used for the first RANDOM call's state advancement but the result is
not directly consumed -- the value in A when $25F6 executes comes from the second
RANDOM call at $25EF). The low 2 bits select the wall type:

| Value | Address | Wall Type         | Description                     |
|-------|---------|-------------------|---------------------------------|
| 0     | $2630   | Extends UP        | Draw vertical wall upward       |
| 1     | $2640   | Extends DOWN      | Draw vertical wall downward     |
| 2     | $2614   | Extends RIGHT     | Draw horizontal wall rightward  |
| 3     | $2620   | Extends LEFT      | Draw horizontal wall leftward   |

#### Case 0: Wall Extends UP ($2630)

```
2630: 7C          ld   a,h             ; A = Y coordinate
2631: D6 44       sub  $44             ; A = Y - $44 (subtract 68)
2633: 67          ld   h,a             ; H = new Y
2634: CD 62 26    call $2662           ; draw vertical wall segment
2637: DD CB 00 CE set  1,(ix+$00)      ; set bit 1 in config byte [ix+0]
263B: DD CB 01 C6 set  0,(ix+$01)      ; set bit 0 in config byte [ix+1]
263F: C9          ret
```

#### Case 1: Wall Extends DOWN ($2640)

```
2640: CD 62 26    call $2662           ; draw vertical wall segment
2643: DD CB 05 CE set  1,(ix+$05)      ; set bit 1 in config byte [ix+5]
2647: DD CB 06 C6 set  0,(ix+$06)      ; set bit 0 in config byte [ix+6]
264B: C9          ret
```

#### Case 2: Wall Extends RIGHT ($2614)

```
2614: CD 4C 26    call $264C           ; draw horizontal wall segment
2617: DD CB 01 DE set  3,(ix+$01)      ; set bit 3 in config byte [ix+1]
261B: DD CB 06 D6 set  2,(ix+$06)      ; set bit 2 in config byte [ix+6]
261F: C9          ret
```

#### Case 3: Wall Extends LEFT ($2620)

```
2620: 7D          ld   a,l             ; A = X coordinate
2621: D6 30       sub  $30             ; A = X - $30 (subtract 48)
2623: 6F          ld   l,a             ; L = new X
2624: CD 4C 26    call $264C           ; draw horizontal wall segment
2627: DD CB 00 DE set  3,(ix+$00)      ; set bit 3 in config byte [ix+0]
262B: DD CB 05 D6 set  2,(ix+$05)      ; set bit 2 in config byte [ix+5]
262F: C9          ret
```

### 1.8 Wall Drawing Subroutines

#### Horizontal Wall Segment ($264C)

```
264C: 06 0C       ld   b,$0C           ; B = 12 tiles
264E: C5          push bc
264F: E5          push hl
2650: CD E4 25    call $25E4           ; convert (H,L) to magic RAM address
2653: 21 9B 26    ld   hl,$269B        ; HL = wall sprite data at $269B
2656: CD 17 28    call $2817           ; call DRAW_SPRITE
2659: E1          pop  hl
265A: C1          pop  bc
265B: 3E 04       ld   a,$04           ; 4 pixels per tile
265D: 85          add  a,l             ; X += 4
265E: 6F          ld   l,a
265F: 10 ED       djnz $264E           ; loop 12 times
2661: C9          ret
```

Draws 12 tiles horizontally, each 4 pixels wide. Total width = 48 pixels.

#### Vertical Wall Segment ($2662)

```
2662: 06 12       ld   b,$12           ; B = 18 tiles
2664: C5          push bc
2665: E5          push hl
2666: CD E4 25    call $25E4           ; convert (H,L) to magic RAM address
2669: 21 9B 26    ld   hl,$269B        ; HL = wall sprite data
266C: CD 17 28    call $2817           ; call DRAW_SPRITE
266F: E1          pop  hl
2670: C1          pop  bc
2671: 3E 04       ld   a,$04           ; 4 pixels per tile
2673: 84          add  a,h             ; Y += 4
2674: 67          ld   h,a
2675: 10 ED       djnz $2664           ; loop 18 times
2677: C9          ret
```

Draws 18 tiles vertically, each 4 pixels tall. Total height = 72 pixels.

#### Coordinate-to-Magic-RAM Conversion ($25E4)

```
25E4: 06 10       ld   b,$10           ; B = $10 (magic RAM control = XOR write, shift 0)
25E6: CD A3 29    call $29A3           ; CALCULATE_MAGIC_IMAGE_RAM_ADDRESS
25E9: EB          ex   de,hl           ; DE = magic RAM address
25EA: C9          ret
```

#### Vertical Wall with Gap ($25CA)

```
25CA: CD 62 26    call $2662           ; draw 18 tiles vertically (72 pixels)
25CD: 3E 40       ld   a,$40           ; add $40 (64) to Y
25CF: 84          add  a,h
25D0: 67          ld   h,a
25D1: C3 62 26    jp   $2662           ; draw 18 more tiles
```

Draws two 72-pixel vertical segments with a 64-pixel gap between them (the doorway).
Total wall: 72 + 64 gap + 72 = 208 pixels vertical.

#### Horizontal Wall with Gap ($25D4)

```
25D4: CD 4C 26    call $264C           ; draw 12 tiles (48 pixels)
25D7: CD 4C 26    call $264C           ; draw 12 more tiles (48 pixels)
25DA: 3E 30       ld   a,$30           ; add $30 (48) to X
25DC: 85          add  a,l
25DD: 6F          ld   l,a
25DE: CD 4C 26    call $264C           ; draw 12 tiles (48 pixels)
25E1: C3 4C 26    jp   $264C           ; draw 12 tiles (48 pixels)
```

Draws four 48-pixel horizontal segments with a 48-pixel gap in the middle.
Total: 48 + 48 + 48 gap + 48 + 48 = 240 pixels. The gap (doorway) is after
the first two segments.

### 1.9 Wall Sprite Data at $269B

Two sprite definitions follow the template data:

**Sprite 1 ($269B) -- 1-byte wide, 4 rows:**
```
269B: 01          width = 1 byte (8 pixels)
269C: 04          height = 4 rows
269D: F0          row 0: 11110000
269E: F0          row 1: 11110000
269F: F0          row 2: 11110000
26A0: F0          row 3: 11110000
```

This is a 4x4 pixel solid block (left half of a byte).

**Sprite 2 ($26A1) -- 2 bytes wide, 4 rows:**
```
26A1: 02          width = 2 bytes (16 pixels)
26A2: 04          height = 4 rows
26A3: FF F0       row 0: 11111111 11110000
26A5: FF F0       row 1: 11111111 11110000
26A7: FF F0       row 2: 11111111 11110000
26A9: FF F0       row 3: 11111111 11110000
```

The wall sprite used by both horizontal and vertical drawing is at $269B -- it
is 1 byte wide (but only 4 pixels are set, the left half `F0`) and 4 pixels tall.

### 1.10 Complete Pseudocode

```cpp
// Reproduce the Berzerk maze for a given room coordinate
void generate_maze(uint8_t room_x, uint8_t room_y) {
    // 1. Seed RNG from room coordinates
    uint16_t rng_seed = (room_y << 8) | room_x;

    // RNG function (call this whenever RANDOM is invoked)
    auto random = [&]() -> uint8_t {
        rng_seed = (rng_seed * 7 + 0x3153) & 0xFFFF;
        return rng_seed >> 8;
    };

    // 2. Copy wall template to config buffer
    uint8_t config[15] = {
        0x05, 0x04, 0x04, 0x04, 0x06,  // row 0 (top border)
        0x01, 0x00, 0x00, 0x00, 0x02,  // row 1 (middle cells)
        0x09, 0x08, 0x08, 0x08, 0x0A   // row 2 (bottom border)
    };

    // 3. Clear 12x12 rectangle in VRAM (upright: base $5E6A)
    // (omitted -- just zero a region of VRAM)

    // 4. Draw border walls (these have doorways = gaps)
    draw_horizontal_wall_with_gap(0x00, 0x08);  // top wall
    draw_horizontal_wall_with_gap(0xCC, 0x08);  // bottom wall
    draw_vertical_wall_with_gap(0x00, 0x04);    // left wall
    draw_vertical_wall_with_gap(0x00, 0xF8);    // right wall

    // 5. Generate interior walls
    // Two passes: top half (base $4438) and bottom half (base $8838)
    int ix_offset = 0;  // index into config[]

    for (int half = 0; half < 2; half++) {
        uint8_t base_y = (half == 0) ? 0x44 : 0x88;
        uint8_t base_x = 0x38;

        uint8_t x = base_x;
        while (true) {
            random();   // first RANDOM call (advances state, result unused for dispatch)
            uint8_t r = random();  // second RANDOM call
            uint8_t wall_type = r & 0x03;

            switch (wall_type) {
            case 0:  // extend UP
                draw_vertical_segment(base_y - 0x44, x);
                config[ix_offset] |= 0x02;      // bit 1
                config[ix_offset + 1] |= 0x01;  // bit 0
                break;
            case 1:  // extend DOWN
                draw_vertical_segment(base_y, x);
                config[ix_offset + 5] |= 0x02;  // bit 1
                config[ix_offset + 6] |= 0x01;  // bit 0
                break;
            case 2:  // extend RIGHT
                draw_horizontal_segment(base_y, x);
                config[ix_offset + 1] |= 0x08;  // bit 3
                config[ix_offset + 6] |= 0x04;  // bit 2
                break;
            case 3:  // extend LEFT
                draw_horizontal_segment(base_y, x - 0x30);
                config[ix_offset] |= 0x08;      // bit 3
                config[ix_offset + 5] |= 0x04;  // bit 2
                break;
            }

            ix_offset++;
            x += 0x30;  // advance 48 pixels
            if (x >= 0xDC) {
                ix_offset++;  // skip right border byte
                break;
            }
        }
    }

    // 6. Call difficulty/color setup ($369F)
    apply_difficulty_and_colors();
}

// Horizontal wall segment: 12 tiles of 4px each = 48px
void draw_horizontal_segment(uint8_t y, uint8_t x) {
    for (int i = 0; i < 12; i++) {
        draw_wall_tile(y, x);
        x += 4;
    }
}

// Vertical wall segment: 18 tiles of 4px each = 72px
void draw_vertical_segment(uint8_t y, uint8_t x) {
    for (int i = 0; i < 18; i++) {
        draw_wall_tile(y, x);
        y += 4;
    }
}

// Horizontal border wall: 48+48 + 48gap + 48+48 = 240px
void draw_horizontal_wall_with_gap(uint8_t y, uint8_t x) {
    draw_horizontal_segment(y, x); x += 48;
    draw_horizontal_segment(y, x); x += 48;
    x += 48;  // gap (doorway)
    draw_horizontal_segment(y, x); x += 48;
    draw_horizontal_segment(y, x);
}

// Vertical border wall: 72 + 64gap + 72
void draw_vertical_wall_with_gap(uint8_t y, uint8_t x) {
    draw_vertical_segment(y, x);
    y += 72 + 64;  // 72 pixels of wall + 64 pixel gap
    draw_vertical_segment(y, x);
}

// Wall tile: 4x4 solid block via Magic RAM XOR write
void draw_wall_tile(uint8_t y, uint8_t x) {
    // Convert (y,x) to magic RAM address using CALCULATE_MAGIC_IMAGE_RAM_ADDRESS
    // Set magic RAM control = $10 (XOR write, no shift, no mirror)
    // Write sprite data: 4 rows of $F0
}
```

### 1.11 Room Grid Structure

The maze area is organized as a grid of cells. Each cell is 48 pixels wide
(horizontal) and approximately 68-72 pixels tall (vertical). Interior walls
connect adjacent cells. The border walls define the outer boundary with
doorways for room exits.

The maze config buffer at $435E encodes which walls exist around each cell
as bit flags. This is used later for collision detection and robot pathfinding.

---

## 2. Robot Spawning Logic ($2117-$2154)

### 2.1 Pre-Spawn Setup ($20D8-$2116)

Before the spawn loop begins:

```
20D8: 3A 4A 43    ld   a,($434A)       ; A = difficulty threshold (BCD)
20DB: C6 60       add  a,$60           ; A += $60
20DD: 27          daa                  ; BCD adjust
20DE: 32 4A 43    ld   ($434A),a       ; store back

20E1: 3A 4C 43    ld   a,($434C)       ; A = ROBOT_SPEED
20E4: FE 01       cp   $01
20E6: 28 04       jr   z,$20EC         ; if already 1 (fastest), skip
20E8: 3D          dec  a               ; ROBOT_SPEED--
20E9: 32 4C 43    ld   ($434C),a       ; store back

20EC: AF          xor  a               ; A = 0
20ED: 32 71 43    ld   ($4371),a       ; RCOUNT = 0 (reset live robot count)
20F0: FD 2A 72 08 ld   iy,($0872)      ; IY = LINKED_LIST_PTR
20F4: FD 77 01    ld   (iy+$01),a      ; clear delay on list head

20F7: 3A 4D 43    ld   a,($434D)       ; A = RWAIT (robot firing holdoff)
20FA: FE 14       cp   $14             ; compare to 20 decimal
20FC: 38 05       jr   c,$2103         ; if < 20, skip subtraction
20FE: D6 0A       sub  $0A             ; RWAIT -= 10
2100: 32 4D 43    ld   ($434D),a       ; store back
```

**Difficulty threshold ($434A) update**: The value at $434A is BCD. Adding $60
with DAA means adding 60 in BCD. Since DAA produces a valid BCD result, the
effect is:
- $434A starts at $00 for the first room
- After each room: $00 -> $60 -> $20 (carried) -> $80 -> $40 -> $00 (wrapped) -> $60...
- Actually: $00+$60=$60, $60+$60=$20 (carry sets), $20+$60=$80, $80+$60=$40 (carry), $40+$60=$00...
- Pattern: $00, $60, $20, $80, $40, $00, $60, $20, $80, $40, ...

Wait -- BCD arithmetic with DAA: $60 + $60 = $C0, DAA adjusts to $20 with carry set.
Then $20 + $60 = $80. $80 + $60 = $E0, DAA adjusts to $40 with carry. $40 + $60 = $A0,
DAA adjusts to $00 with carry. So the repeating cycle is:
$00, $60, $20, $80, $40, $00, $60, ...

This value is used as the spawn probability threshold -- higher values make more
robots spawn because `RANDOM() < threshold` is more likely to pass.

**Robot speed**: Decremented by 1 each room (min 1). Lower = faster.

**RWAIT**: If >= 20, subtract 10. This reduces the firing holdoff timer each room.

### 2.2 The Spawn Loop ($2117-$2154)

The spawn loop is entered via a coroutine mechanism (the job scheduler). The
effective loop is:

```
2117: 3E 16       ld   a,$16           ; A = 22 (= 11 positions * 2 bytes)
2119: 32 00 43    ld   ($4300),a       ; store loop counter
211C: 4F          ld   c,a             ; C = counter (used as index)

211D: 3A 4A 43    ld   a,($434A)       ; A = difficulty threshold (BCD)
2120: 47          ld   b,a             ; B = threshold
2121: CD 78 26    call $2678           ; A = RANDOM()
2124: B8          cp   b               ; compare random vs threshold
2125: 38 1E       jr   c,$2145         ; if random < threshold: SKIP (no spawn)

2127: 21 A0 23    ld   hl,$23A0        ; HL = spawn position table
212A: 06 00       ld   b,$00           ; BC = index
212C: 09          add  hl,bc           ; HL += index
212D: 46          ld   b,(hl)          ; B = base X
212E: 23          inc  hl
212F: 4E          ld   c,(hl)          ; C = base Y
2130: CD 78 26    call $2678           ; A = RANDOM()
2133: E6 1F       and  $1F             ; A = random & $1F (0..31)
2135: 80          add  a,b             ; A += base X
2136: 47          ld   b,a             ; B = final X
2137: CD 78 26    call $2678           ; A = RANDOM()
213A: E6 1F       and  $1F             ; A = random & $1F (0..31)
213C: 81          add  a,c             ; A += base Y
213D: 4F          ld   c,a             ; C = final Y
213E: FD 21 45 21 ld   iy,$2145        ; return to $2145 after ROBOT
2142: C3 B8 23    jp   $23B8           ; jump to ROBOT (create robot)

; Skip/continue:
2145: 3A 00 43    ld   a,($4300)       ; A = counter
2148: 3D          dec  a               ; counter -= 2
2149: 3D          dec  a
214A: 32 00 43    ld   ($4300),a       ; store
214D: 4F          ld   c,a             ; C = new counter
214E: 20 CD       jr   nz,$211D        ; if counter != 0, loop

; All spawn slots exhausted, spawn Evil Otto
2150: FD 21 A9 1E ld   iy,$1EA9        ; return address for Otto
2154: C3 8E 2A    jp   $2A8E           ; jump to Evil Otto init
```

### 2.3 Spawn Count

The counter starts at $16 (22 decimal) and decrements by 2 each iteration.
This gives 11 iterations (positions 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20).

**Maximum robots: 11** (one attempt per spawn position).

Whether a robot actually spawns depends on the random check: `RANDOM() >= threshold`.
When `threshold = $00`, every random value >= 0 passes, so all 11 robots spawn.
When `threshold = $80`, roughly half the random values pass.

### 2.4 Spawn Position Table ($23A2-$23B7)

The table starts at $23A0 but the first two bytes ($23A0: $18 $E7) are actually
the tail of a `JR $2389` instruction. The actual spawn data begins at $23A2:

| Index | Addr  | X_base | Y_base | Position Description        |
|-------|-------|--------|--------|-----------------------------|
| 0     | $23A2 | $0C    | $0C    | Top-left                    |
| 1     | $23A4 | $40    | $0C    | Top-center-left             |
| 2     | $23A6 | $A0    | $0C    | Top-center-right            |
| 3     | $23A8 | $CE    | $0C    | Top-right                   |
| 4     | $23AA | $40    | $50    | Middle-left                 |
| 5     | $23AC | $70    | $50    | Middle-center               |
| 6     | $23AE | $9E    | $50    | Middle-right                |
| 7     | $23B0 | $0C    | $96    | Bottom-left                 |
| 8     | $23B2 | $40    | $96    | Bottom-center-left          |
| 9     | $23B4 | $A0    | $96    | Bottom-center-right         |
| 10    | $23B6 | $CE    | $96    | Bottom-right                |

Raw hex pairs: `0C 0C, 40 0C, A0 0C, CE 0C, 40 50, 70 50, 9E 50, 0C 96, 40 96, A0 96, CE 96`

The 11 positions form a 4-3-4 grid across the room:
- Row 1 (Y=$0C): 4 positions across the top
- Row 2 (Y=$50): 3 positions in the middle
- Row 3 (Y=$96): 4 positions across the bottom

### 2.5 Position Randomization

Each base position is randomized by adding `RANDOM() & $1F` (0-31 pixels) to
both X and Y:

```
final_x = base_x + (RANDOM() & 0x1F)
final_y = base_y + (RANDOM() & 0x1F)
```

This adds up to 31 pixels of jitter in both axes, preventing robots from spawning
in perfectly grid-aligned positions.

### 2.6 Robot Creation ($23B8)

After determining spawn coordinates (B=X, C=Y), the code jumps to ROBOT at $23B8:

```
23B8: C5          push bc
23B9: D1          pop  de              ; DE = BC (D=X, E=Y)
23BA: 21 71 43    ld   hl,$4371        ; HL -> RCOUNT
23BD: 34          inc  (hl)            ; RCOUNT++
23BE: 7E          ld   a,(hl)
23BF: 32 72 43    ld   ($4372),a       ; RSAVED = RCOUNT

23C2: CD 0E 20    call $200E           ; allocate VECTOR for robot -> IX
23C5: DD 72 07    ld   (ix+$07),d      ; VECTOR.P.X = X
23C8: DD 73 09    ld   (ix+$09),e      ; VECTOR.P.Y = Y
23CB: AF          xor  a
23CC: CD 36 24    call $2436           ; SETPAT (set sprite pattern for direction=0)
23CF: DD 36 0C 01 ld   (ix+$0c),$01   ; VECTOR.TIME = 1
23D3: DD 36 00 06 ld   (ix+$00),$06   ; VECTOR.Status = WRITE|MOVE (bits 1+2)
23D7: CD 22 1E    call $1E22           ; CREATE_JOB

23DF: 3A 4D 43    ld   a,($434D)       ; A = RWAIT
23E2: FE 1E       cp   $1E             ; compare to 30
23E4: 30 02       jr   nc,$23E8        ; if >= 30, use RWAIT
23E6: 3E 1E       ld   a,$1E           ; else clamp to 30 minimum
23E8: CD 6D 1E    call $1E6D           ; ACTIVATE_HEAD_JOB with delay A
```

### 2.7 Evil Otto Init ($2A8E)

After all 11 spawn slots are processed, the code jumps to $2A8E:

```
2A8E: C5          push bc
2A8F: D1          pop  de              ; DE = BC
2A90: CD 0E 20    call $200E           ; allocate VECTOR for Otto
2A93: CD 22 1E    call $1E22           ; CREATE_JOB
2A96: DD E5       push ix
2A98: CD 59 1E    call $1E59           ; yield to scheduler
2A9B: DD E1       pop  ix
2A9D: 2A 47 43    ld   hl,($4347)      ; HL = MAN_X (L) | MAN_Y (H)
```

Otto's spawn position is then calculated relative to the player's position
($2A9D onward).

### 2.8 Complete Robot Spawning Pseudocode

```cpp
void spawn_robots(uint8_t difficulty_threshold) {
    // difficulty_threshold = value at $434A (BCD)

    static const uint8_t spawn_table[11][2] = {
        {0x0C, 0x0C}, {0x40, 0x0C}, {0xA0, 0x0C}, {0xCE, 0x0C},
        {0x40, 0x50}, {0x70, 0x50}, {0x9E, 0x50},
        {0x0C, 0x96}, {0x40, 0x96}, {0xA0, 0x96}, {0xCE, 0x96}
    };

    int rcount = 0;

    for (int i = 0; i < 11; i++) {
        uint8_t r = random();
        if (r < difficulty_threshold) {
            continue;  // skip this spawn slot
        }

        uint8_t base_x = spawn_table[i][0];
        uint8_t base_y = spawn_table[i][1];
        uint8_t final_x = base_x + (random() & 0x1F);
        uint8_t final_y = base_y + (random() & 0x1F);

        create_robot(final_x, final_y);
        rcount++;
    }

    // RSAVED = rcount (for room clearance bonus)
    spawn_evil_otto();
}
```

Note: the comparison at $2124 is `CP B` (compare A with B). The `JR C` at $2125
branches when A < B (random < threshold). When the branch is taken, the robot
is NOT spawned. So higher threshold values mean FEWER robots spawn. This is
counterintuitive -- at game start ($434A = $00), ALL slots produce robots.

Correction on the BCD cycling: with $434A starting at $00 and incrementing by
$60 BCD each room, the threshold rises, causing fewer robots to spawn in later
rooms. But the difficulty table ($3794) also adjusts robot parameters. The
interaction is: $434A controls spawn density, while the difficulty table at
$3794 controls robot behavior (bolt count, speed, firing delay).

---

## 3. Difficulty Tables at $3794-$37FF

### 3.1 Difficulty Lookup Code ($369F-$3718)

The difficulty routine is called at $2597 during maze setup.

```
369F: CD 57 36    call $3657           ; COLOUR_FILL with inline params:
36A2: 80 06 04 20 77                   ; offset=$0680, lines=$04, width=$20, color=$77

36A7: CD E7 35    call $35E7           ; additional colour fills (maze area colors)

36AA: CD 34 23    call $2334           ; GET_PLAYER_SCORE_PTR -> HL = score address
36AD: EB          ex   de,hl           ; DE = score address
36AE: 01 05 00    ld   bc,$0005        ; BC = 5 (entry size for difficulty table)
36B1: 13          inc  de              ; DE points to score byte 1 (thousands/hundreds)
36B2: 1A          ld   a,(de)          ; A = score[1] (thousands/hundreds BCD)
36B3: 08          ex   af,af'          ; save in AF'
36B4: 1B          dec  de              ; DE points to score byte 0 (ten-thousands/hundred-thousands)
36B5: 1A          ld   a,(de)          ; A = score[0] (hundred-thousands/ten-thousands BCD)
36B6: B7          or   a               ; test if score >= 10000
36B7: 21 94 37    ld   hl,$3794        ; HL = upright difficulty table
36BA: 28 0F       jr   z,$36CB         ; if score < 10000, use upright table

; Score >= 10000: use cocktail table
36BC: E6 0F       and  $0F             ; A = ten-thousands digit
36BE: 67          ld   h,a             ; H = ten-thousands digit
36BF: 08          ex   af,af'          ; A = thousands/hundreds
36C0: E6 F0       and  $F0             ; A = thousands digit (upper nibble)
36C2: B4          or   h               ; A = (ten-thousands << 0) | (thousands << 4)
36C3: 07          rlca                 ; rotate left 4 times to get:
36C4: 07          rlca                 ; A = (thousands) | (ten-thousands << 4)
36C5: 07          rlca                 ; Wait -- 4 RLCAs swap nibbles:
36C6: 07          rlca                 ; A was (10k_digit | 1k_digit<<4), becomes (1k_digit | 10k_digit<<4)
36C7: 21 BC 37    ld   hl,$37BC        ; HL = cocktail difficulty table
36CA: 08          ex   af,af'          ; restore AF' (score[1])
```

Actually, let me re-read this more carefully. Score is stored as BCD in 3 bytes:
- `score[0]` = hundred-thousands and ten-thousands digits
- `score[1]` = thousands and hundreds digits
- `score[2]` = tens and units digits

At $36B5: A = score[0]. If score[0] == 0, score < 10000, use upright table at $3794.

If score >= 10000:
```
36BC: E6 0F       and  $0F             ; A = lower nibble of score[0] = ten-thousands digit
36BE: 67          ld   h,a             ; H = ten-thousands digit
36BF: 08          ex   af,af'          ; A = score[1] (thousands/hundreds)
36C0: E6 F0       and  $F0             ; A = upper nibble = thousands digit shifted
36C2: B4          or   h               ; A = (thousands_digit << 4) | ten-thousands_digit
36C3-36C6: 4x rlca                     ; swap nibbles: A = (ten-thousands_digit << 4) | thousands_digit
36C7: 21 BC 37    ld   hl,$37BC        ; use cocktail table
36CA: 08          ex   af,af'          ; A' still has score[1]
```

The lookup key is `(ten_thousands_digit << 4) | thousands_digit`. This is the
BCD value of the score in units of 1000, e.g., score 23000 -> key = $23.

The table scan at $36CB:

```
36CB: 08          ex   af,af'          ; A = lookup key
36CC: BE          cp   (hl)            ; compare key with table threshold
36CD: 38 06       jr   c,$36D5         ; if key < threshold, use THIS entry
36CF: 08          ex   af,af'          ; save key back
36D0: 09          add  hl,bc           ; HL += 5 (advance to next entry)
36D1: 7E          ld   a,(hl)          ; A = next threshold
36D2: B7          or   a               ; if threshold == 0, end of table
36D3: 20 F6       jr   nz,$36CB        ; if not end, continue scanning
```

The scan walks the table 5 bytes at a time. Each entry is 5 bytes:
```
Byte 0: score threshold (BCD thousands, or 0 = end sentinel)
Byte 1: RBOLTS value (max robot bolts on screen)
Byte 2: value written to $437A
Byte 3: RWAIT value (firing holdoff timer)
Byte 4: color attribute byte
```

After finding the matching entry:

```
36D5: 23          inc  hl              ; skip threshold byte
36D6: 7E          ld   a,(hl)          ; A = RBOLTS
36D7: 23          inc  hl
36D8: 32 4B 43    ld   ($434B),a       ; set RBOLTS
36DB: 7E          ld   a,(hl)          ; A = $437A value
36DC: 23          inc  hl
36DD: 32 7A 43    ld   ($437A),a       ; set $437A
36E0: 7E          ld   a,(hl)          ; A = RWAIT
36E1: 23          inc  hl
36E2: 32 4D 43    ld   ($434D),a       ; set RWAIT
36E5: 4E          ld   c,(hl)          ; C = color attribute byte
```

### 3.2 Colour Application ($36E6-$3718)

After loading difficulty parameters, the maze wall colors are applied:

```
36E6: 3A 79 43    ld   a,($4379)       ; A = FLIP
36E9: B7          or   a
36EA: DD 21 00 81 ld   ix,$8100        ; upright: color RAM base
36EE: 21 00 44    ld   hl,$4400        ; upright: VRAM base
36F1: 28 07       jr   z,$36FA

; cocktail cabinet
36F3: DD 21 80 81 ld   ix,$8180
36F7: 21 00 46    ld   hl,$4600

; both
36FA: 3E 34       ld   a,$34           ; A = 52 (number of rows to process)
36FC: 08          ex   af,af'          ; save row counter
36FD: 06 20       ld   b,$20           ; B = 32 (bytes per row)
36FF: 7E          ld   a,(hl)          ; A = VRAM byte
3700: 23          inc  hl
3701: 5F          ld   e,a             ; E = VRAM byte
3702: E6 44       and  $44             ; A = VRAM & $44 (keep bits 2 and 6)
3704: 57          ld   d,a             ; D = preserved bits
3705: 7B          ld   a,e             ; A = VRAM byte again
3706: 2F          cpl                  ; A = ~VRAM
3707: A1          and  c               ; A = ~VRAM & color_attribute
3708: B2          or   d               ; A = (~VRAM & color) | (VRAM & $44)
3709: DD 77 00    ld   (ix+$00),a      ; write to color RAM
370C: DD 23       inc  ix
370E: 10 EF       djnz $36FF           ; loop 32 bytes per row
3710: 11 60 00    ld   de,$0060        ; skip $60 (96) bytes
3713: 19          add  hl,de           ; advance VRAM pointer
3714: 08          ex   af,af'          ; restore row counter
3715: 3D          dec  a
3716: 20 E4       jr   nz,$36FC        ; loop 52 rows
3718: C9          ret
```

The color application logic for each VRAM byte:
- Where VRAM pixels are set (wall pixels): keep bits 2 and 6 of the VRAM data as color
- Where VRAM pixels are clear (empty space): apply the difficulty color attribute
- Formula: `color_ram = (~vram & color_byte) | (vram & 0x44)`

This means wall pixels retain a specific color pattern (bits 2,6 = $44 masked),
while empty areas get the difficulty-selected background color.

### 3.3 Upright Difficulty Table ($3794-$37BB)

Raw hex bytes extracted from the disassembly:

```
3794: 03 00 00 50 33
3799: 15 01 00 50 99
379E: 30 02 00 14 66
37A3: 45 03 00 0A AA
37A8: 60 04 00 0A 55
37AD: 75 05 00 0F BB
37B2: 90 01 01 3C FF
37B7: 00 01 01 32 FF
```

Decoded entries:

| # | Threshold (BCD) | Score Range     | RBOLTS | $437A | RWAIT | Color |
|---|----------------|-----------------|--------|-------|-------|-------|
| 0 | $03            | 0 - 2,999       | $00    | $00   | $50   | $33   |
| 1 | $15            | 3,000 - 14,999  | $01    | $00   | $50   | $99   |
| 2 | $30            | 15,000 - 29,999 | $02    | $00   | $14   | $66   |
| 3 | $45            | 30,000 - 44,999 | $03    | $00   | $0A   | $AA   |
| 4 | $60            | 45,000 - 59,999 | $04    | $00   | $0A   | $55   |
| 5 | $75            | 60,000 - 74,999 | $05    | $00   | $0F   | $BB   |
| 6 | $90            | 75,000 - 89,999 | $01    | $01   | $3C   | $FF   |
| 7 | $00 (end)      | 90,000+         | $01    | $01   | $32   | $FF   |

For scores below 10,000 (score[0] == 0), the scan uses score[1] directly
(thousands/hundreds BCD). The threshold $03 means score < $0300 = 300 hundreds,
which is score < 3,000.

Wait -- let me reconsider. When score < 10000, the code at $36BA jumps to $36CB
with A' containing score[1]. The `EX AF,AF'` at $36CB loads A with score[1].
Score[1] = thousands_digit << 4 | hundreds_digit. The threshold $03 in BCD means
$03 = 03 hundreds = 300. But score[1] is the BCD of thousands+hundreds, so $03
means "score thousands/hundreds < $03" which is "score < 300". That seems too low.

Actually, looking again at the table scan: `CP (HL)` does `A - threshold`. `JR C`
branches when A < threshold (carry set). So the first entry with threshold > score
is selected. For the upright table at $3794:
- Threshold $03: score[1] < $03, meaning score < 300 (in hundreds)

Hmm, but score[1] represents thousands and hundreds digits in BCD. $03 = 0 thousands,
3 hundreds = 300. $15 = 1 thousand 5 hundreds = 1500.

Actually wait -- score[0] was zero for < 10000 path. So score[1] ranges from $00 to $99
BCD (representing 00 to 9900 in the thousands+hundreds position). The thresholds in the
upright table ($03, $15, $30, $45, $60, $75, $90) represent hundreds of points (BCD
encoded):

| Threshold | BCD Value | Score Range |
|-----------|-----------|-------------|
| $03       | 03        | < 300       |
| $15       | 15        | < 1,500     |
| $30       | 30        | < 3,000     |
| $45       | 45        | < 4,500     |
| $60       | 60        | < 6,000     |
| $75       | 75        | < 7,500     |
| $90       | 90        | < 9,000     |
| $00       | end       | >= 9,000    |

Revised table:

| # | Threshold | Score Range   | RBOLTS | $437A | RWAIT | Color | Notes              |
|---|-----------|---------------|--------|-------|-------|-------|--------------------|
| 0 | $03       | 0-299         | 0      | 0     | 80    | $33   | No robot shots     |
| 1 | $15       | 300-1499      | 1      | 0     | 80    | $99   | 1 bolt, slow       |
| 2 | $30       | 1500-2999     | 2      | 0     | 20    | $66   | 2 bolts, faster    |
| 3 | $45       | 3000-4499     | 3      | 0     | 10    | $AA   | 3 bolts, fast      |
| 4 | $60       | 4500-5999     | 4      | 0     | 10    | $55   | 4 bolts, fast      |
| 5 | $75       | 6000-7499     | 5      | 0     | 15    | $BB   | 5 bolts, medium    |
| 6 | $90       | 7500-8999     | 1      | 1     | 60    | $FF   | 1 bolt but $437A=1 |
| 7 | $00 (end) | 9000+         | 1      | 1     | 50    | $FF   | Hardest standard   |

RWAIT is decimal (not BCD): $50 = 80 frames, $14 = 20, $0A = 10, $0F = 15, $3C = 60, $32 = 50.

Color values represent RGBI nibble pairs (high nibble = left 4px color, low nibble = right 4px color):
- $33 = cyan/cyan
- $99 = bright cyan / bright cyan
- $66 = bright yellow / bright yellow
- $AA = bright green / bright green
- $55 = bright magenta / bright magenta
- $BB = bright cyan / bright cyan (high intensity)
- $FF = white / white

### 3.4 Cocktail Difficulty Table ($37BC-$37FF)

Raw hex bytes:

```
37BC: 10 01 01 2D FF
37C1: 11 02 02 23 66
37C6: 13 03 03 19 DD
37CB: 15 04 04 14 77
37D0: 17 05 05 0F 33
37D5: 19 05 05 0A 99
37DA: 00 05 05 05 EE

(Additional bytes for higher score ranges:)
37DF: 81 94 0C 02 AD
37E4: 20 75 7A 0D 5F
37E9: 40 93 D5 67 8A
37EE: 49 14 F5 74 CF
37F3: 80 21 2B CA CC
37F8: 2B 3C 04 FB AB
37FD: 26 F8 00
```

Wait, I need to reconsider this. The cocktail table is used when score >= 10000.
The lookup key is `(10k_digit << 4) | 1k_digit`. So threshold $10 means score
key < $10, i.e., score in range 10,000-10,999 (ten-thousands=1, thousands=0).

First 7 entries of cocktail table:

| # | Threshold | Key Meaning       | RBOLTS | $437A | RWAIT | Color |
|---|-----------|-------------------|--------|-------|-------|-------|
| 0 | $10       | < 10,000          | $01    | $01   | $2D   | $FF   |
| 1 | $11       | 10,000-10,999     | $02    | $02   | $23   | $66   |
| 2 | $13       | 11,000-12,999     | $03    | $03   | $19   | $DD   |
| 3 | $15       | 13,000-14,999     | $04    | $04   | $14   | $77   |
| 4 | $17       | 15,000-16,999     | $05    | $05   | $0F   | $33   |
| 5 | $19       | 17,000-18,999     | $05    | $05   | $0A   | $99   |
| 6 | $00 (end) | 19,000+           | $05    | $05   | $05   | $EE   |

However, the bytes after $37DA look suspicious -- they may actually extend the
table further or be data for a different purpose. The $00 at $37DA position 0
would be the end sentinel, making 7 entries total for the cocktail table.

Actually, looking more carefully: the cocktail table starts at $37BC. The loop
at $36CB-$36D3 checks if the threshold byte is zero as an end sentinel. So the
table ends at the first entry with threshold $00. That is entry 6 at $37DA.

The bytes from $37DF onward ($81 94 0C 02 AD 20 75 7A...) are likely unrelated
data or part of another lookup table. They fall within ROM5 ($3000-$37FF).

Corrected cocktail table with RWAIT as decimal:

| # | Threshold | Score Range       | RBOLTS | $437A | RWAIT (dec) | Color |
|---|-----------|-------------------|--------|-------|-------------|-------|
| 0 | $10       | 0-9,999           | 1      | 1     | 45          | $FF   |
| 1 | $11       | 10,000-10,999     | 2      | 2     | 35          | $66   |
| 2 | $13       | 11,000-12,999     | 3      | 3     | 25          | $DD   |
| 3 | $15       | 13,000-14,999     | 4      | 4     | 20          | $77   |
| 4 | $17       | 15,000-16,999     | 5      | 5     | 15          | $33   |
| 5 | $19       | 17,000-18,999     | 5      | 5     | 10          | $99   |
| 6 | $00 (end) | 19,000+           | 5      | 5     | 5           | $EE   |

The cocktail table is much more aggressive than the upright table: it reaches
5 simultaneous robot bolts at only 15,000 points (vs 6,000 for upright), and
the minimum RWAIT drops to 5 frames (vs 50 for upright).

The $437A field appears to track a secondary difficulty parameter. In the upright
table it is 0 until 7,500+ points (then 1). In the cocktail table it ramps from
1 to 5.

### 3.5 Summary of Difficulty Parameters

- **RBOLTS ($434B)**: Maximum number of robot laser bolts allowed on screen simultaneously. Range 0-5.
- **$437A**: Secondary difficulty parameter (exact effect requires tracing consumers). Possibly robot shot accuracy or aggression.
- **RWAIT ($434D)**: Initial delay (in frames) before robots begin shooting after spawning. Also reduced by 10 each room at $20FE (minimum 20 frames, then further clamped to 30 minimum at $23E6).
- **Color attribute (byte 4)**: Applied to maze walls via the colour routine at $36E6. The room color changes with difficulty, giving the player a visual cue of the current danger level.

---

## 4. Magic RAM Control Register -- 74181 ALU Function Select

### 4.1 Control Register Format (Port $4B)

```
Bits 7-4: S3-S0 -- 74181 ALU function select
Bit 3:    Mirror flag (1 = reverse bits of shifted data)
Bits 2-0: Shift count (0-7 positions right)
```

### 4.2 Magic RAM Write Pipeline

As implemented in MAME (berzerk.cpp magicram_w):

1. **Shift register**: `combined = (last_shift_data << 8) | write_data`; `shifted = combined >> shift_count`
2. **Mirror** (if bit 3 set): reverse all 8 bits of shifted output
3. **Collision detect**: if `shifted & current_vram != 0`, set intercept flag
4. **74181 ALU**: operate on shifted data (A input) and current VRAM (B input) using select S3-S0
5. **Invert output**: `result = alu_output XOR $FF` (active-low 74181 outputs)
6. **Store**: `vram[offset] = result`
7. **Latch**: `last_shift_data = write_data & $7F`

### 4.3 74181 ALU Function Table (Logic Mode, M=1)

The 74181 operates in logic mode only on the Berzerk hardware (mode pin M is
tied high). In this mode, the carry chain is disabled and each bit is computed
independently.

The gate-level equations per bit i:

```
P_i = NOT( A_i OR (B_i AND S0) OR (S1 AND NOT(B_i)) )
G_i = NOT( (NOT(B_i) AND S2 AND A_i) OR (A_i AND B_i AND S3) )
F_i = 1 XOR (NOT(P_i) AND G_i)     [logic mode: carry term = 1]
```

After the 74181, MAME applies `F XOR $FF` (active-low inversion).

The full truth table for all 16 select values (S3-S0), showing the final result
written to VRAM after the XOR $FF inversion:

| S3210 | Hex | 74181 F (active-high) | VRAM = F XOR $FF | Boolean (A=shifted, B=vram) |
|-------|-----|-----------------------|------------------|-----------------------------|
| 0000  | $0  | NOT A                 | A                | A (pass-through shifted)    |
| 0001  | $1  | NOT(A OR B)           | A OR B           | A OR B                      |
| 0010  | $2  | NOT(A) AND B          | A OR NOT(B)      | A OR NOT B                  |
| 0011  | $3  | 0                     | $FF              | All ones                    |
| 0100  | $4  | NOT(A AND B)          | A AND B          | A AND B                     |
| 0101  | $5  | NOT B                 | B                | B (pass-through VRAM)       |
| 0110  | $6  | A XOR B               | NOT(A XOR B)     | XNOR                        |
| 0111  | $7  | A AND NOT(B)          | NOT(A) OR B      | NOT A OR B                  |
| 1000  | $8  | NOT(A) OR B           | A AND NOT(B)     | A AND NOT B                 |
| 1001  | $9  | NOT(A XOR B)          | A XOR B          | XOR                         |
| 1010  | $A  | B                     | NOT B            | NOT B (invert VRAM)         |
| 1011  | $B  | A AND B               | NOT(A AND B)     | NAND                        |
| 1100  | $C  | 1                     | $00              | All zeros                   |
| 1101  | $D  | A OR NOT(B)           | NOT(A) AND B     | NOT A AND B                 |
| 1110  | $E  | A OR B                | NOT(A OR B)      | NOR                         |
| 1111  | $F  | A                     | NOT A            | NOT A (invert shifted)      |

### 4.4 Common ALU Modes Used by Berzerk

From analysis of the ROM code:

| Control Byte | S3210 | Shift | Mirror | Effect                              | Usage                       |
|--------------|-------|-------|--------|-------------------------------------|-----------------------------|
| $00          | 0     | 0     | No     | VRAM = shifted_data                 | Direct write                |
| $10          | 1     | 0     | No     | VRAM = shifted OR vram              | OR draw (wall drawing)      |
| $90          | 9     | 0     | No     | VRAM = shifted XOR vram             | XOR draw (sprite toggle)    |
| $C0          | C     | 0     | No     | VRAM = $00                          | Clear VRAM                  |

The wall drawing at $25E4 uses B=$10 (OR write, no shift, no mirror).
The sprite drawing uses B=$90 (XOR write) per the WRITE_PATTERN code at $275B.
The ERASE_PATTERN reads the stored magic byte from the VECTOR structure.

### 4.5 Reference: MAME berzerk.cpp magicram_w

```cpp
void berzerk_state::magicram_w(offs_t offset, uint8_t data)
{
    uint8_t alu_output;
    uint8_t current_video_data = m_videoram[offset];

    uint8_t shift_flop_output = (((uint16_t)m_last_shift_data << 8) | data)
                                >> (m_magicram_control & 0x07);

    if (m_magicram_control & 0x08)
        shift_flop_output = bitswap<8>(shift_flop_output, 0,1,2,3,4,5,6,7);

    if (shift_flop_output & current_video_data)
        m_intercept = 0;

    m_ls181_12c->input_a_w(shift_flop_output >> 0);
    m_ls181_10c->input_a_w(shift_flop_output >> 4);
    m_ls181_12c->input_b_w(current_video_data >> 0);
    m_ls181_10c->input_b_w(current_video_data >> 4);
    m_ls181_12c->select_w(m_magicram_control >> 4);
    m_ls181_10c->select_w(m_magicram_control >> 4);

    alu_output = m_ls181_10c->function_r() << 4
               | m_ls181_12c->function_r();

    m_videoram[offset] = alu_output ^ 0xff;

    m_last_shift_data = data & 0x7f;
}
```

The two 74181 chips handle the low 4 bits (12C) and high 4 bits (10C)
independently. Both receive the same select lines from bits 7-4 of the
control register.
