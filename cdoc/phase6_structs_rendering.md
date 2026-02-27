# Phase 6: Struct Layouts and Rendering Pipeline

Verified by tracing actual Z80 opcodes in the Berzerk disassembly (berzerk_tunstall.asm).
All offsets, field sizes, and behaviors are derived from instruction-level analysis,
not from comments or labels.

---

## 1. VECTOR Struct Layout (14 bytes)

Each VECTOR is allocated on the stack (7 x `push hl` of $0000 = 14 bytes).
Player VECTOR allocated at MAN_INIT ($1FD4). Robot VECTORs at $200E.
VECTORs are linked: bytes at (VECTOR_BASE - 2) and (VECTOR_BASE - 1) form
a 16-bit pointer to the next VECTOR in the chain (little-endian).

### Field Table

| Offset | Size | Name    | Evidence (routine : opcode at address)                                                                                                  |
|--------|------|---------|-----------------------------------------------------------------------------------------------------------------------------------------|
| +$00   | 1    | Status  | ROBOT $23D3: `ld (ix+$00),$06`; ERASE_PATTERN $2733: `bit 0,(hl)`; $2735: tests ERASE; $274D: `bit 1,(hl)` tests WRITE; $27AC: `bit 2,(hl)` tests MOVE; $242D: `bit 7,(ix+$00)` tests HIT; $15F8: `set 7,(ix+$00)` sets HIT; $1FAF: `set 5,(ix+$00)` sets death-flash |
| +$01   | 1    | Magic   | WRITE_PATTERN $2761: `ld (iy+$01),a` stores magic RAM control byte                                                                     |
| +$02   | 1    | O.A.L   | ERASE_PATTERN $273F: `ld e,(hl)` reads old screen addr low; WRITE_PATTERN $2791: `ld (iy+$02),e` saves it                              |
| +$03   | 1    | O.A.H   | ERASE_PATTERN $2741: `ld d,(hl)` reads old screen addr high; WRITE_PATTERN $2794: `ld (iy+$03),d` saves it                             |
| +$04   | 1    | O.P.L   | ERASE_PATTERN $2743: `ld a,(hl)` reads old pattern ptr low; WRITE_PATTERN $278B: `ld (iy+$04),l` saves it                              |
| +$05   | 1    | O.P.H   | ERASE_PATTERN $2745: `ld h,(hl)` reads old pattern ptr high; WRITE_PATTERN $278E: `ld (iy+$05),h` saves it                             |
| +$06   | 1    | V.X     | FIRE $1F33: `ld (ix+$06),$00` zeros X velocity; SET_VELOCITY $2B4C: `ld (ix+$06),a` sets X delta; MOVE_ANIMATE $27C0: `ld a,(hl)` reads V.X |
| +$07   | 1    | P.X     | ROBOT $23C5: `ld (ix+$07),d` sets X pos; SEEK $23F4: `ld a,(iy+$07)` reads player X; FIRE $1F5B: `ld a,(ix+$07)` reads player X; MAN_INIT $1FFA: `ld (ix+$07),l` |
| +$08   | 1    | V.Y     | FIRE $1F37: `ld (ix+$08),$00` zeros Y velocity; SET_VELOCITY $2B50: `ld (ix+$08),a` sets Y delta; MOVE_ANIMATE $27C5: `ld a,(hl)` reads V.Y |
| +$09   | 1    | P.Y     | ROBOT $23C8: `ld (ix+$09),e` sets Y pos; SEEK $2405: `ld a,(iy+$09)` reads player Y; FIRE $1F60: `ld a,(ix+$09)` reads player Y; MAN_INIT $1FFD: `ld (ix+$09),h` |
| +$0A   | 1    | D.P.L   | FIRE $1F3E: `ld (ix+$0a),a` sets pattern table ptr low; SETPAT $2449: `ld (ix+$0a),a`; WRITE_PATTERN $2765: reads via HL walk          |
| +$0B   | 1    | D.P.H   | FIRE $1F43: `ld (ix+$0b),a` sets pattern table ptr high; SETPAT $244C: `ld (ix+$0b),h`; COLLISION $15D0: `ld h,(ix+$0b)`              |
| +$0C   | 1    | TIME    | ROBOT $23CF: `ld (ix+$0c),$01`; MAN_INIT $2008: `ld (ix+$0c),$01`; MOVE_ANIMATE $27B6: `dec (hl)` decrements timer                   |
| +$0D   | 1    | TPRIME  | MAN_INIT $2004: `ld (ix+$0d),$02`; SETPAT $2453: `ld (ix+$0d),a` loads from ROBOT_SPEED; MOVE_ANIMATE $27B9: `ld a,(hl)` reads reload |

### VECTOR Linked List

VECTORs are threaded via two bytes immediately below each VECTOR on the stack:

| Offset   | Name       | Purpose                                         |
|----------|------------|-------------------------------------------------|
| BASE - 2 | Next.L     | Low byte of pointer to next VECTOR in chain     |
| BASE - 1 | Next.H     | High byte of pointer to next VECTOR in chain    |

V.PTR ($0870) points to the head of this chain. The BOTTOM_OF_SCREEN_INTERRUPT
walks it by reading `(V.PTR - 1)` as high byte and `(V.PTR - 2)` as low byte
of the next VECTOR (see $2708-$270C).

### Status Bits (verified against actual bit tests)

| Bit | Value | Name   | Evidence                                                      |
|-----|-------|--------|---------------------------------------------------------------|
| 0   | $01   | ERASE  | $2733: `bit 0,(hl)` in ERASE_PATTERN; $273A: `res 0,(hl)`    |
| 1   | $02   | WRITE  | $274D: `bit 1,(hl)` in WRITE_PATTERN; $2750: `res 1,(hl)`    |
| 2   | $04   | MOVE   | $27AC: `bit 2,(hl)` in MOVE_ANIMATE; $15CB: `bit 2,(ix+$00)` |
| 3   | $08   | BLANK  | $3719: `bit 3,(hl)` in UNCOLOUR_MAN; $373F: `set 3,(hl)`     |
| 4   | $10   | COLOR  | $373C: `bit 4,(hl)` in COLOUR_MAN                            |
| 5   | $20   | DYING  | $1FAF: `set 5,(ix+$00)` in PLAYER_DEAD; $27E6: `bit 5,(iy+$00)` triggers color flash |
| 7   | $80   | HIT    | $15F8: `set 7,(ix+$00)` on collision; $242D: `bit 7,(ix+$00)` tests robot hit |

Bit 6 is not observed in any traced routine.

Common status values:
- $06 = WRITE + MOVE (robot init at $23D3, Otto at $2AEF)
- $16 = WRITE + MOVE + COLOR (player at $1EAC)
- $1B = ERASE + WRITE + BLANK + COLOR (OR'd into status by MOVE_ANIMATE at $27E0)

---

## 2. BOLT Struct Layout (8 bytes)

PLAYER_BOLT_1 is at $437B, PLAYER_BOLT_2 at $4383 (8 bytes apart).
ROBOT_BOLTS start at $438F. The HANDLE_PLAYER_BOLTS loop at $1509
advances IY by 8 between bolts: `ld de,$0008; add iy,de`.

### Field Table

| Offset | Size | Name          | Evidence (routine : opcode at address)                                                                                |
|--------|------|---------------|-----------------------------------------------------------------------------------------------------------------------|
| +$00   | 1    | Direction     | $151A: `ld a,(iy+$00)` reads DURL bits; $1F72: `ld (iy+$00),d` sets direction; $15A0: `ld (iy+$00),$00` deactivates |
| +$01   | 1    | Length        | $1520: `inc (iy+$01)` increments on each step; $1F75: `ld (iy+$01),$00` initializes to 0                             |
| +$02   | 1    | X             | $1557: `dec (iy+$02)` moves left; $155E: `inc (iy+$02)` moves right; $1F65: `ld (iy+$02),l` init; $15E8: `ld a,(iy+$02)` for collision |
| +$03   | 1    | Y             | $1565: `dec (iy+$03)` moves up; $156C: `inc (iy+$03)` moves down; $1F68: `ld (iy+$03),h` init; $15DE: `ld a,(iy+$03)` for collision |
| +$04   | 1    | LastDirection | $1F79: `ld (iy+$04),d` set to same DURL as Direction; $1F0C: `or (iy+$04)` tests if bolt slot is in use              |
| +$05   | 1    | MaxLength     | $1F7C: `ld (iy+$05),$08` sets max length to 8 pixels                                                                  |
| +$06   | 1    | TailX         | $1F6B: `ld (iy+$06),l` init to same X as head                                                                         |
| +$07   | 1    | TailY         | $1F6E: `ld (iy+$07),h` init to same Y as head                                                                         |

### Head/Tail Dual Processing

The HANDLE_PLAYER_BOLTS routine processes each bolt in two phases:

1. **Head phase** (IY = bolt base): Moves the head pixel, increments Length, draws,
   checks collision and offscreen.

2. **Tail phase** (IY = bolt base + 4): After `add iy,bc` with BC=$0004 at $152F,
   IY now points 4 bytes into the struct. The tail half mirrors the head layout:

| Tail IY Offset | Actual Struct Offset | Field         | Usage                                        |
|----------------|----------------------|---------------|----------------------------------------------|
| +$00           | +$04                 | LastDirection | `or (iy+$00)` at $153E tests if active       |
| +$01           | +$05                 | MaxLength     | `dec (iy+$01)` at $1531 counts tail lifetime  |
| -$03           | +$01                 | Length        | `or (iy-$03)` at $1539; `dec (iy-$03)` at $154A |

The tail reuses MOVE_AND_DRAW_BOLT with the tail's Direction/X/Y fields,
effectively erasing the tail pixel and advancing it. When the head hits
something or goes offscreen, Direction ($00) is zeroed, and the tail
continues erasing until Length counts down to zero.

### Bolt "In Use" Check

TRY_FIRE at $1F0C checks `or (iy+$04)` (LastDirection). A nonzero LastDirection
means the bolt slot is busy (either the head is active or the tail is still
being erased). This is why LastDirection is only zeroed when the tail
finishes at $154E: `ld (iy+$00),$00` (with IY pointing at the tail base,
so actual offset +$04 in the original struct is cleared -- but actually
the code at $154E is reached from the tail phase where IY is at base+4,
so `(iy+$00)` = actual offset +$04 = LastDirection. This confirms the
slot is freed only when the tail is fully erased.)

Wait -- re-checking. At $154E, IY has been advanced by 4. So `(iy+$00)` at
this point is struct offset +$04 = LastDirection. But looking again at $1518-$1519:
the routine returns after the tail processing, then the outer loop at $1509
restores IY from the push at $150A. So yes, the `ld (iy+$00),$00` at $154E
clears LastDirection, which is what TRY_FIRE checks.

Correction: Actually at $1518 the `ret` returns from the call at $150C. Then the
outer loop pops IY (original bolt base) at $150F and advances it by 8 at $1515.
The $154E store with IY at base+4 writes to struct+$04 = LastDirection. Confirmed.

---

## 3. Sprite/Pattern Data Format

### Pattern Table (Animation Sequence)

D.P.L/D.P.H in the VECTOR point to a **pattern table** (also called an
animation table). Each pattern table is a variable-length array of 16-bit
pointers, terminated by a $00 sentinel byte followed by a 16-bit loop-back
pointer.

Format:
```
pattern_table:
    dw  frame_0_addr     ; pointer to sprite frame 0
    dw  frame_1_addr     ; pointer to sprite frame 1
    ...
    dw  frame_N_addr     ; pointer to sprite frame N
    db  $00              ; sentinel: end of sequence
    dw  loop_addr        ; pointer back to pattern_table (for looping)
```

Example -- robot standing still ($1000):
```
1000: 10 D1   -> frame 0 at $10D1
      10 DE   -> frame 1 at $10DE
      10 EB   -> frame 2 at $10EB
      10 F8   -> frame 3 at $10F8
      10 F8   -> frame 4 at $10F8 (same as 3)
      10 F8   -> frame 5 at $10F8 (same as 3)
      11 05   -> frame 6 at $1105
      11 12   -> frame 7 at $1112
      00      -> sentinel
      00 10   -> loop back to $1000
```

Example -- player standing still ($1046):
```
1046: 10 BF   -> frame 0 at $10BF (single frame)
      00      -> sentinel
      46 10   -> loop back to $1046
```

### Frame Data (Sprite Pixel Data)

Each frame is a width/height/data block:

```
frame_data:
    db  width      ; width in bytes (1 = 8 pixels wide, 2 = 16 pixels wide)
    db  height     ; height in scan lines (pixel rows)
    db  row_0[width], row_1[width], ...  ; pixel data, 1 bit per pixel
```

Examples from ROM:
```
$10BF: 01 10    ; 1 byte wide (8 px), 16 rows tall -- player standing
       18 18 00 3C 5A 5A 5A 18 18 18 18 18 18 18 1C 10

$10D1: 01 0B    ; 1 byte wide (8 px), 11 rows tall -- robot
       3C 66 FF BD BD BD 3C 24 24 24 66
```

For 2-byte-wide sprites (16 pixels), each row is 2 bytes. The robot
explosion frames use this wider format.

### Indirection in WRITE_PATTERN ($2765-$276C)

The dereferencing of D.P.L/D.P.H in WRITE_PATTERN follows this chain:

```
ptr1 = VECTOR.D.P (2 bytes at offset +$0A/+$0B)
ptr2 = mem[ptr1] (read 16-bit value from pattern table)
data = mem[ptr2] (actual frame width/height/pixels)
```

So D.P points into the pattern table; the pattern table entry points
to the frame data. This double indirection enables animation: advancing
D.P by 2 moves to the next frame pointer.

### Cocktail/Upright Offset Adjustment

If the first byte of the frame data has bit 7 set, WRITE_PATTERN at $276D
interprets it as a position offset header:

```
if (data[0] & 0x80):
    offset_rows = data[0] & 0x7F
    offset_cols = data[1]
    BC = (offset_rows << 8) | offset_cols
    if FLIP == 0:  DE += BC   (upright: add offset to screen address)
    else:          DE -= BC   (cocktail: subtract)
    actual_frame_data starts at data[2]
```

If bit 7 is clear, the frame data is used directly (width byte, then height, then pixels).

### Animation Cycling in MOVE_ANIMATE_VECTOR ($27C9-$27DD)

After moving the VECTOR (adding velocities to positions), the animation
pointer is advanced:

```pseudocode
// HL points to VECTOR.D.P.L at this point (offset +$0A)
ptr = read_word(HL)       // current frame pointer in pattern table
ptr += 2                  // advance to next entry in pattern table
frame_addr = read_word(ptr) // but actually: read first byte
if mem[ptr] == 0:
    // End of animation sequence (sentinel)
    ptr = ptr + 1
    loop_back = read_word(ptr)  // read the loop-back address
    ptr = loop_back
// Store updated pointer back to D.P.L/D.P.H
write_word(HL, ptr)
```

More precisely, the Z80 code at $27C9-$27DD:
```
27C9: inc  hl            ; HL -> VECTOR.D.P.L
27CA: ld   e,(hl)        ; E = D.P.L
27CB: inc  hl            ; HL -> VECTOR.D.P.H
27CC: ld   d,(hl)        ; D = D.P.H  (DE = current animation pointer)
27CD: inc  de            ; DE += 2 (advance to next pattern table entry)
27CE: inc  de
27CF: ex   de,hl         ; HL = new animation pointer, DE = addr of D.P.H in VECTOR
27D0: ld   a,(hl)        ; read first byte of pattern table entry
27D1: or   a             ; is it zero (sentinel)?
27D2: jp   nz,$27DA      ; no: use this entry
27D5: inc  hl            ; yes: skip sentinel byte
27D6: ld   a,(hl)        ; read loop-back address low
27D7: inc  hl
27D8: ld   h,(hl)        ; read loop-back address high
27D9: ld   l,a           ; HL = loop-back address
27DA: ex   de,hl         ; DE = animation pointer, HL = addr of D.P.H
27DB: ld   (hl),d        ; write D.P.H
27DC: dec  hl            ; HL -> D.P.L
27DD: ld   (hl),e        ; write D.P.L
```

The sentinel check reads the first byte of what would be the next pattern
table entry. If that byte is $00, the following two bytes are the loop-back
address (typically pointing to the start of the same pattern table).

After updating D.P, the code OR's $1B into Status at $27E0:
```
27DE: ld   a,$1B         ; bits 0,1,3,4 = ERASE + WRITE + BLANK + COLOR
27E0: or   (iy+$00)      ; merge with existing status
27E3: ld   (iy+$00),a    ; store back
```

This ensures the interrupt will erase the old sprite and draw the new one.

If bit 5 (DYING) is set in Status, MOVE_ANIMATE also toggles the player
color ($27EB-$27F4) producing the electrocution flash effect.

---

## 4. DRAW_SPRITE Routine ($2817)

### Entry

- HL = pointer to frame data (width, height, pixel bytes)
- DE = pointer to Magic Image RAM destination

### Algorithm

```pseudocode
width = mem[HL++]
if width == 1:
    goto DRAW_1_BYTE_WIDE
// width == 2 (only two widths supported)
height = mem[HL++]
// For upright cabinet:
BC = $001E  // 30 = 32 bytes per row - 2 bytes written
swap DE, HL  // DE = pattern data, HL = magic RAM address
for row in 0..height-1:
    mem[HL] = mem[DE]; HL++; DE++    // write byte 0
    mem[HL] = mem[DE]; HL++; DE++    // write byte 1
    mem[HL] = 0                       // flush magic RAM shifter
    HL += BC                          // advance to next row (32 bytes per row)
```

For 1-byte-wide sprites:
```pseudocode
height = mem[HL++]
BC = $001F  // 31 = 32 bytes per row - 1 byte written
swap DE, HL
for row in 0..height-1:
    mem[HL] = mem[DE]; HL++; DE++    // write 1 byte
    mem[HL] = 0                       // flush shifter
    HL += BC                          // next row
```

The "flush shifter" write of $00 after the last data byte is required by
the Magic RAM hardware barrel shifter to complete the shift operation.

For cocktail cabinet mode, the row stride is negative ($FFE2 for 2-wide,
$FFE1 for 1-wide) and HL decrements instead of increments within each row.

### Screen Memory Layout

- Each row of the screen is 32 bytes (256 pixels / 8 bits per byte).
- Writing 1 byte covers 8 horizontal pixels.
- Writing 2 bytes covers 16 horizontal pixels.
- After writing N bytes, 1 flush byte, then advance by (32 - N - 1) to reach
  the next row at the same X position.

---

## 5. Interrupt-Driven Rendering Pipeline

### Interrupt Entry Point ($26AB)

The interrupt handler begins at $26AB:
```
26AB: di
26AC: ld   ($0874),sp     ; save SP to STACK_PTR
26B0: ld   sp,$0840        ; switch to interrupt stack
26B3: push af
26B4: in   a,($4E)         ; read screen status register
26B6: rra                   ; bit 0 -> carry
26B7: jr   c,$26D9          ; carry set = bottom of screen
```

If carry is CLEAR, this is the **top-of-screen interrupt**.
If carry is SET, this is the **bottom-of-screen interrupt**.

### Top-of-Screen Path ($26B8, carry clear)

```
26B9: push hl
26BA: push bc
26BB: ld   hl,$089F
26BE: ld   a,(hl)          ; read previous SYSTEM port snapshot
26BF: inc  hl
26C0: ld   b,(hl)          ; B = current snapshot
26C1: xor  b               ; A = bits that changed
26C2: ld   c,a             ; C = changed bits
26C3: in   a,($49)         ; read SYSTEM port (coin switches, start buttons)
26C5: cpl                  ; invert (active low inputs)
26C6: ld   (hl),a          ; store as new current snapshot
26C7: dec  hl
26C8: ld   (hl),b          ; store previous as old snapshot
26C9: and  c               ; A = newly activated bits (edge detection)
26CA: and  $E0             ; mask to bits 5,6,7 only (coin switches)
```

Then a loop at $26CC-$26D3 counts the newly detected coin edges:
```
26CC: dec  hl              ; HL now points to $089D (coin counter area)
26CD: add  a,a             ; shift next coin bit into carry
26CE: jr   nc,$26D3        ; if no coin edge, skip
26D0: inc  (hl)            ; increment coin counter for this slot
26D1: jr   $26CC           ; continue checking
26D3: jr   nz,$26CC        ; more bits to check
26D5: pop  bc
26D6: pop  hl
26D7: jr   $271C           ; jump to common exit
```

Summary: The top-of-screen interrupt performs edge detection on the SYSTEM
port (coin switches at bits 5-7). It compares the current reading against
the previous snapshot, identifies newly-pressed coin inputs, and increments
per-slot coin counters at $089D and below. No rendering occurs.

### Bottom-of-Screen Path: BOTTOM_OF_SCREEN_INTERRUPT ($26D9)

This is the main rendering interrupt. Pseudocode of the complete sequence:

```pseudocode
// --- Save registers ---
push IY, IX, HL, DE, BC, AF'
saved_v_ptr = V.PTR                     // $26E2: ld hl,($0870)
push saved_v_ptr

// --- Step 1: Erase player sprite ---
HL = MAN_PTR                            // $26E6: ld hl,($0876)
call ERASE_PATTERN(HL)                  // $26E9: erases old player sprite via Magic RAM

// --- Step 2: Uncolour/colour player ---
call UNCOLOUR_MAN                       // $26EC: restores color attributes under player

// --- Step 3: Erase first robot sprite ---
HL = saved_v_ptr (restored from stack)  // $26EF: pop hl; push hl
call ERASE_PATTERN(HL)                  // $26F1: erases old robot sprite

// --- Step 4: Handle player bolts ---
call HANDLE_PLAYER_BOLTS                // $26F4: moves/draws/erases all bolt pixels

// --- Step 5: Move and animate player ---
HL = MAN_PTR                            // $26F7: ld hl,($0876)
call MOVE_ANIMATE_VECTOR(HL)            // $26FA: updates position, advances animation,
                                        //        sets ERASE+WRITE+BLANK+COLOR in status,
                                        //        then WRITE_PATTERN draws new sprite

// --- Step 6: Move and animate first robot ---
HL = saved_v_ptr (restored from stack)  // $26FD: pop hl
call MOVE_ANIMATE_VECTOR(HL)            // $26FE: same as above for robot

// --- Step 7: Walk VECTOR linked list ---
HL = V.PTR                              // $2701: ld hl,($0870)
if HL != 0:
    next_high = mem[HL - 1]             // $2709: ld d,(hl) after dec hl
    next_low  = mem[HL - 2]             // $270B: ld e,(hl) after dec hl
    V.PTR = next                        // $270C: ld ($0870),de

// --- Step 8: Process job linked list ---
call $27F5                              // walks LINKED_LIST via LINKED_LIST_PTR ($0872)
                                        // decrements Delay counters on active jobs
                                        // when Delay reaches 0: clears bit 1, sets bit 0
                                        // (transitions job from "waiting" to "ready")

// --- Step 9: Restore and return ---
pop AF', BC, DE, HL, IX, IY
ld   a,$01
out  ($4F),a                            // re-enable NMI
ld   a,$37
ld   i,a                                // set I register for IM2 vector table at $3700
im   2
pop  af
ld   sp,($0874)                         // restore original SP from STACK_PTR
ei
ret                                     // return to interrupted code
```

### Detailed Erase/Draw Sequence

**ERASE_PATTERN ($272D):**
1. Sets V.PTR = HL (saves current VECTOR pointer)
2. IY = HL (for indexed access)
3. Tests bit 0 (ERASE) of Status
4. If ERASE not set, falls through to WRITE_PATTERN
5. If ERASE set:
   - Clears ERASE bit
   - Reads Magic control byte from offset +$01
   - Outputs it to port $4B (Magic RAM control)
   - Reads old screen address from O.A.L/O.A.H (offsets +$02/+$03)
   - Reads old pattern pointer from O.P.L/O.P.H (offsets +$04/+$05)
   - Calls DRAW_SPRITE to XOR the old sprite back (erasing it)
   - Falls through to WRITE_PATTERN

**WRITE_PATTERN ($274D):**
1. Tests bit 1 (WRITE) of Status
2. If not set, returns
3. If set:
   - Clears WRITE bit
   - Reads P.X from offset +$07 and P.Y from offset +$09
   - Calls CALCULATE_MAGIC_IMAGE_RAM_ADDRESS with $90 (XOR mode)
   - Saves magic control byte to Magic (offset +$01)
   - Dereferences D.P.L/D.P.H (double indirection through pattern table)
   - If first byte of frame has bit 7 set: applies position offset
   - Saves current pattern pointer to O.P.L/O.P.H for future erasure
   - Saves screen address to O.A.L/O.A.H for future erasure
   - Calls DRAW_SPRITE to XOR the new sprite onto screen
   - Checks collision register (port $4E bit 7)
   - If collision detected: sets HIT bit (bit 7) in Status

### The $27F5 Job List Walker

```pseudocode
function process_job_list():
    HL = LINKED_LIST_PTR ($0872)
    if HL == 0: return
    DE = HL                          // save start pointer for cycle detection
    loop:
        if bit 1 of (HL) is set:    // job is "active/waiting"
            decrement (HL+1)         // decrement Delay counter
            if Delay == 0:
                clear bit 1 of (HL)  // no longer waiting
                set bit 0 of (HL)    // mark as ready
        // Follow the linked list
        next_high = mem[HL - 1]
        next_low  = mem[HL - 2]
        HL = (next_high << 8) | next_low
        // Cycle detection: stop if we've returned to start
        if HL == DE: return
        goto loop
```

### V.PTR Walking

The VECTOR linked list is walked one node per interrupt. Each interrupt:
1. Erases and redraws the VECTOR pointed to by V.PTR
2. Advances V.PTR to the next VECTOR via the (BASE-2, BASE-1) link

This means with N robots, it takes N+1 interrupts to process all VECTORs
(player is always processed, plus one robot per interrupt via V.PTR).

### Complete Per-Frame Rendering Order

1. Erase player sprite (XOR old data at old position)
2. Restore color attributes under player (UNCOLOUR_MAN)
3. Erase current robot sprite (XOR old data at old position)
4. Move and draw player bolt pixels (up to 2 player bolts)
5. Move player VECTOR (add velocity, advance animation frame)
6. Draw player sprite at new position (XOR new data)
7. Apply player color attributes (COLOUR_MAN)
8. Move current robot VECTOR (add velocity, advance animation frame)
9. Draw robot sprite at new position (XOR new data)
10. Advance V.PTR to next robot in chain
11. Tick job timers in linked list

---

## 6. Key RAM Locations

| Address | Name              | Purpose                                         |
|---------|-------------------|-------------------------------------------------|
| $0870   | V.PTR             | Current VECTOR in linked list being processed   |
| $0872   | LINKED_LIST_PTR   | Head of job/task linked list                    |
| $0874   | STACK_PTR         | Saved SP during interrupt                       |
| $0876   | MAN_PTR           | Pointer to player's VECTOR                      |
| $089D   | Coin counters     | Per-slot coin counters (decremented from $089F) |
| $089F   | SYSTEM snapshot   | Previous reading of SYSTEM port ($49)           |
| $08A0   | SYSTEM current    | Current reading of SYSTEM port                  |
| $437B   | PLAYER_BOLT_1     | First player bolt (8 bytes)                     |
| $4383   | PLAYER_BOLT_2     | Second player bolt (8 bytes)                    |
| $438F   | ROBOT_BOLTS       | Robot bolt array                                |

---

## 7. Summary of Double Indirection in Pattern Rendering

```
VECTOR.D.P  -->  Pattern Table  -->  Frame Data
(offset +0A)     (array of ptrs)     (width, height, pixels)

Example:
  VECTOR.D.P = $1046
  mem[$1046] = $10, mem[$1047] = $BF  =>  frame at $10BF
  mem[$10BF] = $01 (width=1), mem[$10C0] = $10 (height=16)
  mem[$10C1..] = pixel data (16 bytes)
```

The animation system advances D.P by 2 each frame. When it hits the $00
sentinel, it reads the following 2-byte address and loops back.
