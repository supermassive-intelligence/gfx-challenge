# Phase 6 Deep Trace: Job Scheduler, Evil Otto, Room Transitions, Demo Mode

Traced from `cdoc/berzerk_tunstall.asm` (Tunstall disassembly), verified against
ROM opcodes. All addresses and byte values come from the actual machine code.

---

## Task 1: Job Scheduler Mechanics ($1E22-$1EA8)

This is a cooperative coroutine (green-thread) system. Each "job" is a Z80 stack
frame with a saved continuation point. There is no preemption -- a job must
voluntarily call STOP_JOB to yield control. The scheduler walks a linked list to
find the next runnable job and restores its stack pointer.

### 1.1 Key Data Structures

#### LINKED_LIST_PTR ($0872): 2-byte pointer to head of job linked list.

Each job has a 4-byte header (LINKED_LIST_ITEM) at the top of its stack frame:

```
Offset   Field        Meaning
------   -----        -------
+0       Flags        Bit 0: runnable (1=can execute)
                      Bit 1: active (set by ACTIVATE_HEAD_JOB)
                      Bit 7: set by ACTIVATE_HEAD_JOB ($82 = bits 7+1)
+1       Delay        Frame-delay counter (decremented by frame handler)
+2       SP_lo        Low byte of saved stack pointer (continuation point)
+3       SP_hi        High byte of saved stack pointer
-2       Next_lo      Low byte of pointer to next item in linked list
-1       Next_hi      High byte of pointer to next item in linked list
```

Note the asymmetry: the "next" pointer lives at negative offsets (-2, -1) relative
to the item pointer. This means the item pointer actually points into the middle of
a 6-byte block on the stack:

```
Stack memory (low to high):
  [next_lo] [next_hi] [flags] [delay] [sp_lo] [sp_hi]
                       ^
                       |--- LINKED_LIST_PTR points here
```

### 1.2 CREATE_JOB ($1E22) -- Detailed Trace

```
1E22: E1          pop hl           ; HL = return address (caller's PC after CALL)
1E23: D9          exx              ; switch to alternate register set
1E24: 21 01 00    ld hl,$0001
1E27: E5          push hl          ; push $0001 (2 bytes)
1E28: E5          push hl          ; push $0001 (2 bytes) -- total 4 bytes reserved
1E29: 21 00 00    ld hl,$0000
1E2C: 39          add hl,sp        ; HL = current SP (address of the 4-byte block)
```

At this point the stack has 4 bytes allocated. HL points to the start of these
4 bytes. The initial value $0001 means Flags=01 (runnable), Delay=00.

```
1E2D: 3A 73 08    ld a,($0873)     ; read MSB of LINKED_LIST_PTR
1E30: B7          or a             ; is the list empty? (NULL if MSB = 0)
1E31: 20 06       jr nz,$1E39      ; list not empty, go insert
```

**Case 1: List is empty:**
```
1E33: E5          push hl          ; push 2 more bytes (for next-ptr space)
1E34: 22 72 08    ld ($0872),hl    ; LINKED_LIST_PTR = HL (this item is new head)
1E37: 18 1E       jr $1E57         ; exit
```

**Case 2: List already has a head -- insert HL as new head:**
```
1E39: FD E5       push iy          ; save IY
1E3B: C1          pop bc           ; BC = saved IY
1E3C: FD 2A 72 08 ld iy,($0872)   ; IY = current head
1E40: EB          ex de,hl         ; DE = new item address
1E41: FD 66 FF    ld h,(iy-$01)    ; H = old head's next_hi
1E44: FD 6E FE    ld l,(iy-$02)    ; L = old head's next_lo
                                   ; HL = old head's "next" pointer
1E47: E5          push hl          ; push old next-ptr (becomes new item's next-ptr space)
1E48: F3          di               ; disable interrupts for atomic pointer update
1E49: FD 72 FF    ld (iy-$01),d    ; old head's next_hi = new item high byte
1E4C: FD 73 FE    ld (iy-$02),e    ; old head's next_lo = new item low byte
1E4F: FB          ei
1E50: ED 53 72 08 ld ($0872),de    ; LINKED_LIST_PTR = new item (DE is new head)
1E54: C5          push bc
1E55: FD E1       pop iy           ; restore IY
1E57: D9          exx              ; back to normal register set
1E58: E9          jp (hl)          ; return (HL was return address from $1E22)
```

**Pseudocode:**
```
CREATE_JOB():
    return_addr = pop()            // grab return address
    // switch to alt registers
    push 4 bytes on stack          // [flags=0x01, delay=0x00, sp_lo=0, sp_hi=0]
    new_item = SP
    if LINKED_LIST_PTR is NULL:
        push 2 bytes               // space for next-pointer
        LINKED_LIST_PTR = new_item
    else:
        old_head = LINKED_LIST_PTR
        old_head_next = read(old_head - 2, old_head - 1)
        push old_head_next         // new item's next-pointer = old head's old next
        DI
        write old_head's next-pointer = new_item   // old head now points to new item
        EI
        LINKED_LIST_PTR = new_item                 // new item is now head
    // switch back to normal registers
    jump to return_addr
```

The insertion is at the HEAD of the list. The new job becomes the head, and
the old head becomes the second item. The "next" pointer chain is maintained
at negative offsets below each item.

### 1.3 Allocate Routine ($1E59) -- Stack Frame Allocation

```
1E59: 21 00 00    ld hl,$0000
1E5C: 39          add hl,sp        ; HL = SP
1E5D: EB          ex de,hl         ; DE = SP (save old SP)
1E5E: 21 E8 FF    ld hl,$FFE8      ; HL = -24
1E61: 39          add hl,sp        ; HL = SP - 24
1E62: F9          ld sp,hl         ; SP = SP - 24 (allocate 24 bytes)
1E63: 2A 72 08    ld hl,($0872)    ; HL = head of linked list
1E66: 23          inc hl           ; HL+1 -> offset +1 is Delay, skip to +2
1E67: 23          inc hl           ; HL+2 -> offset +2 is SP_lo
1E68: 73          ld (hl),e        ; write DE (old SP) into SP_lo
1E69: 23          inc hl           ; HL+3 -> SP_hi
1E6A: 72          ld (hl),d        ; write SP_hi
1E6B: FD E9       jp (iy)          ; jump to address in IY
```

**What this does:**
1. Saves the old SP value (before allocation).
2. Allocates 24 bytes on the stack by subtracting 24 from SP.
3. Writes the old SP into the head job's LINKED_LIST_ITEM at offsets +2/+3.
   This is the "saved stack pointer" -- the continuation point.
4. Jumps to the address in IY -- this is the job's entry point function.

**Critical insight:** The old SP (before the 24-byte allocation) is stored as the
continuation point. When this job is later resumed, SP is restored to this value,
and a RET instruction will pop the return address that was on the stack before
the allocation happened. The 24 bytes are scratch space for the job's local variables.

**Typical calling pattern (from MAN at $1EA9):**
```
1EB0: CD 22 1E    call $1E22       ; CREATE_JOB (pushes 4+2 bytes, inserts in list)
1EB3: C5          push bc          ; push BC onto job's stack
1EB4: FD 21 8B 1E ld iy,$1E8B     ; IY = address of resume-scan routine
1EB8: CD 59 1E    call $1E59       ; allocate 24 bytes, store SP, jump to IY
```

After $1E59 jumps to IY ($1E8B), the job's function is running. The saved SP
points to just above the 24-byte scratch area, where the pushed BC and the CALL
return address to $1EBB sit. When the job is resumed, SP is restored, and the
code effectively returns to $1EBB.

### 1.4 ACTIVATE_HEAD_JOB ($1E6D)

```
1E6D: FD 2A 72 08 ld iy,($0872)   ; IY = head of linked list
1E71: FD 77 01    ld (iy+$01),a    ; head.Delay = A
1E74: FD 36 00 82 ld (iy+$00),$82  ; head.Flags = $82 (bits 7 + 1 set)
```

Falls through into STOP_JOB at $1E78.

**Purpose:** Marks the head job as "active" with a delay value. Flags=$82 means
bit 1 (active) and bit 7 (some higher-priority marker) are set. The delay value
in A determines how many frame ticks the job waits before becoming runnable again.
Then falls through to STOP_JOB to actually yield.

### 1.5 STOP_JOB ($1E78) -- Save State and Find Next Job

```
1E78: FD 2A 72 08 ld iy,($0872)   ; IY = head of linked list
1E7C: 21 00 00    ld hl,$0000
1E7F: 39          add hl,sp        ; HL = current SP
1E80: 31 70 08    ld sp,$0870      ; SP = $0870 (system stack -- above job stacks)
1E83: FD 75 02    ld (iy+$02),l    ; head.SP_lo = L (save continuation SP)
1E86: FD 74 03    ld (iy+$03),h    ; head.SP_hi = H
1E89: 18 04       jr $1E8F         ; jump into the scan loop
```

**The scan loop ($1E8F):**
```
1E8F: FD 66 FF    ld h,(iy-$01)    ; H = next_hi
1E92: FD 6E FE    ld l,(iy-$02)    ; L = next_lo  -- HL = next item in list
1E95: E5          push hl
1E96: FD E1       pop iy           ; IY = HL (advance to next item)
1E98: CB 46       bit 0,(hl)       ; test Flags bit 0 (runnable?)
1E9A: CA 8F 1E    jp z,$1E8F       ; if not runnable, skip to next item
```

**When a runnable job is found:**
```
1E9D: FD 6E 02    ld l,(iy+$02)    ; L = item.SP_lo
1EA0: FD 66 03    ld h,(iy+$03)    ; H = item.SP_hi  -- HL = saved SP
1EA3: FD 22 72 08 ld ($0872),iy    ; LINKED_LIST_PTR = this item (it is new head)
1EA7: F9          ld sp,hl         ; restore SP to saved continuation point
1EA8: C9          ret              ; RET pops return address -> resumes job
```

**Pseudocode:**
```
STOP_JOB():
    head = LINKED_LIST_PTR
    saved_sp = current SP
    SP = $0870                     // switch to system stack
    head.SP = saved_sp             // save continuation point

    // walk linked list looking for a runnable job
    item = head.next
    while item.Flags bit 0 is clear:
        item = item.next

    // found a runnable job
    LINKED_LIST_PTR = item         // make it the new head
    SP = item.SP                   // restore its stack
    RET                            // resume execution at its continuation point
```

### 1.6 How Control Flow Transfers Between Jobs

The complete lifecycle:

1. **Creation**: `CALL CREATE_JOB` allocates a 4-byte header on the current stack,
   inserts it at the head of the linked list.

2. **Setup**: Caller pushes registers, sets IY to the job function, calls $1E59.
   This allocates 24 bytes of scratch space and stores the "return SP" in the
   header. Then JP (IY) enters the job function.

3. **Yielding**: The job calls STOP_JOB (or ACTIVATE_HEAD_JOB which falls through).
   Current SP is saved in the header. The scheduler walks the list for the next
   runnable job and restores that job's SP. A RET instruction resumes the other job
   exactly where it left off.

4. **Resuming**: When this job's Flags indicate it is runnable (bit 0 set), the
   scanner restores its saved SP and RETs into it.

The system stack at $0870 is used as a temporary stack during the context switch
scan. Each job has its own stack region in memory, and the stack pointer itself is
the continuation state.

### 1.7 Relationship: LINKED_LIST_ITEM vs Larger Stack Frame

```
Memory layout for a job (addresses grow upward):

Low address:
  [24 bytes: scratch/local space]      <-- allocated by $1E59
  [pushed registers: BC, IX, etc.]     <-- pushed before $1E59 call
  [CALL return address: 2 bytes]       <-- return address to resume after yield
  [next_lo] [next_hi]                  <-- pushed by CREATE_JOB
  [Flags] [Delay] [SP_lo] [SP_hi]     <-- the 4-byte LINKED_LIST_ITEM
High address:
  ... previous stack contents ...
```

The saved SP (in offsets +2/+3) points to just above the 24-byte scratch area,
meaning when the job resumes, the scratch area is below SP and will be reused.
The return address sitting on the stack at that point is the continuation.

---

## Task 2: Evil Otto Behavior ($2A8E-$2B68)

### 2.1 Otto Initialization ($2A8E)

```
2A8E: C5          push bc          ; preserve BC (contains something from caller)
2A8F: D1          pop de           ; DE = BC
2A90: CD 0E 20    call $200E       ; allocate a VECTOR (14 bytes on stack), IX = ptr
2A93: CD 22 1E    call $1E22       ; CREATE_JOB for Otto
2A96: DD E5       push ix          ; save IX (VECTOR pointer)
2A98: CD 59 1E    call $1E59       ; allocate 24-byte scratch, jump to IY
2A9B: DD E1       pop ix           ; restore IX (VECTOR pointer)
```

At this point Otto's job is running as a coroutine. IX points to Otto's VECTOR.

### 2.2 Otto Spawn Position ($2A9D-$2AB9)

Otto spawns at the player's current position, with clamping:

```
2A9D: 2A 47 43    ld hl,($4347)    ; L = MAN_X, H = MAN_Y
2AA0: 7D          ld a,l           ; A = MAN_X
2AA1: FE 18       cp $18           ; is X < 24?
2AA3: 30 04       jr nc,$2AA9      ; no, skip
2AA5: 2E 02       ld l,$02         ; yes, clamp Otto X to 2
2AA7: 18 06       jr $2AAF

2AA9: FE E6       cp $E6           ; is X >= 230?
2AAB: 38 02       jr c,$2AAF       ; no, skip
2AAD: 2E F8       ld l,$F8         ; yes, clamp Otto X to 248

2AAF: 7C          ld a,h           ; A = MAN_Y
2AB0: FE B4       cp $B4           ; is Y >= 180?
2AB2: 38 02       jr c,$2AB6       ; no, skip
2AB4: 26 A0       ld h,$A0         ; yes, clamp Otto Y to 160

2AB6: DD 75 07    ld (ix+$07),l    ; VECTOR.P.X = clamped X
2AB9: DD 74 09    ld (ix+$09),h    ; VECTOR.P.Y = clamped Y
```

**Otto spawn position logic:**
| Player X   | Otto X |
|------------|--------|
| X < $18    | $02    |
| $18 <= X < $E6 | same as player |
| X >= $E6   | $F8    |

| Player Y   | Otto Y |
|------------|--------|
| Y < $B4    | same as player |
| Y >= $B4   | $A0    |

Otto spawns on top of the player (or near the player with clamping at edges).
This means Otto appears where the player is standing, not from a fixed location.

### 2.3 OTTO_TIME Computation ($2ABC-$2AC9)

```
2ABC: 3A 4C 43    ld a,($434C)     ; A = ROBOT_SPEED
2ABF: 47          ld b,a           ; B = ROBOT_SPEED
2AC0: 3A 72 43    ld a,($4372)     ; A = RSAVED (number of robots in room at start)
2AC3: 80          add a,b          ; A = RSAVED + ROBOT_SPEED
2AC4: 47          ld b,a           ; B = RSAVED + ROBOT_SPEED
2AC5: 3A 4B 43    ld a,($434B)     ; A = RBOLTS (max robot bolts on screen)
2AC8: 80          add a,b          ; A = RBOLTS + RSAVED + ROBOT_SPEED
2AC9: 32 4E 43    ld ($434E),a     ; OTTO_TIME = A
```

**Formula:**
```
OTTO_TIME = ROBOT_SPEED + RSAVED + RBOLTS
```

This is a countdown timer. Higher values = longer delay before Otto appears.
Harder rooms (more robots, faster speed, more bolts) paradoxically give the player
MORE time before Otto shows up, because OTTO_TIME is larger. This may be a balance
mechanism -- rooms with many fast-shooting robots are already dangerous enough.

### 2.4 Otto Countdown Loop ($2ACC-$2AD9)

```
2ACC: DD E5       push ix
2ACE: 3E 28       ld a,$28         ; delay = 40 ticks
2AD0: CD 6D 1E    call $1E6D       ; ACTIVATE_HEAD_JOB (yield for 40 ticks)
2AD3: DD E1       pop ix
2AD5: 21 4E 43    ld hl,$434E      ; HL = &OTTO_TIME
2AD8: 35          dec (hl)         ; OTTO_TIME--
2AD9: 20 F1       jr nz,$2ACC      ; loop until OTTO_TIME reaches 0
```

Each tick of the countdown yields for $28 (40) frame-ticks. So the total delay
before Otto appears is approximately `OTTO_TIME * 40` ticks. With
OTTO_TIME = ROBOT_SPEED + RSAVED + RBOLTS, and typical early-game values of
ROBOT_SPEED=3, RSAVED=6, RBOLTS=1, that gives OTTO_TIME=10, or 400 frame-ticks.

Additionally, when a robot is killed ($2486-$248A):
```
2486: 21 4E 43    ld hl,$434E
2489: 34          inc (hl)         ; OTTO_TIME++
248A: 34          inc (hl)         ; OTTO_TIME++ (add 2 for each robot kill)
```
Killing robots delays Otto by 2 additional ticks each time.

### 2.5 Otto Appearance ($2ADB-$2AF4)

```
2ADB: CD DE 2B    call $2BDE       ; say "INTRUDER ALERT! INTRUDER ALERT!"
2ADE: 21 0B 12    ld hl,$120B      ; Otto's sprite data address
2AE1: DD 75 0A    ld (ix+$0a),l    ; VECTOR.D.P.L = sprite pointer low
2AE4: DD 74 0B    ld (ix+$0b),h    ; VECTOR.D.P.H = sprite pointer high
2AE7: DD 36 0C 01 ld (ix+$0c),$01  ; VECTOR.TIME = 1 (animate immediately)
2AEB: DD 36 0D 02 ld (ix+$0d),$02  ; VECTOR.TPRIME = 2
2AEF: DD 36 00 06 ld (ix+$00),$06  ; VECTOR.Status = $06 (WRITE + MOVE bits)
2AF3: AF          xor a            ; A = 0 (direction = no movement initially)
2AF4: CD 39 2B    call $2B39       ; call SET_VELOCITY with A=0
```

Otto uses sprite data at ROM address $120B. TPRIME=2 means Otto moves every
2 ticks (quite fast). Status=$06 = bits 1 (WRITE) + 2 (MOVE).

### 2.6 Otto Movement Loop ($2AF7-$2B36) -- Player Tracking

```
2AF7: DD E5       push ix          ; save Otto's VECTOR pointer
2AF9: C5          push bc
2AFA: 3E 28       ld a,$28         ; delay = 40 ticks
2AFC: CD 6D 1E    call $1E6D       ; yield (ACTIVATE_HEAD_JOB)
2AFF: C1          pop bc
2B00: DD E1       pop ix           ; restore Otto's VECTOR pointer

; read player position and compute direction to track
2B02: FD 2A 76 08 ld iy,($0876)   ; IY = MAN_PTR (player's VECTOR)
2B06: C5          push bc

; --- X tracking ---
2B07: FD 7E 07    ld a,(iy+$07)   ; A = player's P.X
2B0A: C6 02       add a,$02       ; A = player_x + 2 (center offset)
2B0C: DD 96 07    sub (ix+$07)    ; A = (player_x + 2) - otto_x
2B0F: 57          ld d,a          ; D = X difference
2B10: 06 00       ld b,$00        ; B = 0 (no horizontal direction)
2B12: 28 06       jr z,$2B1A      ; if equal, skip (no X movement needed)
2B14: 06 01       ld b,$01        ; B = 1 (LEFT direction bit)
2B16: 38 02       jr c,$2B1A      ; if otto_x > player_x, go left
2B18: 06 02       ld b,$02        ; B = 2 (RIGHT direction bit)

; --- Y tracking ---
2B1A: FD 7E 09    ld a,(iy+$09)   ; A = player's P.Y
2B1D: DD 96 09    sub (ix+$09)    ; A = player_y - otto_y
2B20: 5F          ld e,a          ; E = Y difference
2B21: 0E 00       ld c,$00        ; C = 0 (no vertical direction)
2B23: 28 06       jr z,$2B2B      ; if equal, skip
2B25: 0E 04       ld c,$04        ; C = 4 (UP direction bit)
2B27: 38 02       jr c,$2B2B      ; if otto_y > player_y, go up
2B29: 0E 08       ld c,$08        ; C = 8 (DOWN direction bit)

; combine directions
2B2B: 78          ld a,b          ; A = horizontal direction
2B2C: 81          add a,c         ; A = combined DURL direction
2B2D: C1          pop bc
2B2E: CD 39 2B    call $2B39      ; call SET_VELOCITY wrapper
2B31: 3E 04       ld a,$04        ; delay = 4 ticks
2B33: CD 54 2B    call $2B54      ; yield and check if player is dead
2B36: C3 02 2B    jp $2B02        ; loop back to track player again
```

**Otto tracking pseudocode:**
```
loop forever:
    yield for 40 ticks

    player = MAN_PTR
    dx = (player.X + 2) - otto.X
    dy = player.Y - otto.Y

    direction = 0
    if dx < 0:    direction |= LEFT (1)
    elif dx > 0:  direction |= RIGHT (2)
    if dy < 0:    direction |= UP (4)
    elif dy > 0:  direction |= DOWN (8)

    SET_VELOCITY(direction)
    yield for 4 ticks, check player death
    goto loop
```

Otto always moves directly toward the player. The +2 offset on the X axis
centers the tracking on the player sprite.

### 2.7 SET_VELOCITY ($2B3D-$2B53) -- Velocity Lookup

```
2B3D: 4F          ld c,a           ; C = DURL direction
2B3E: 06 00       ld b,$00         ; BC = direction index
2B40: 50          ld d,b           ; D = 0
2B41: 21 42 20    ld hl,$2042      ; HL = D.TAB base address
2B44: 09          add hl,bc        ; HL = &D.TAB[direction]
2B45: 5E          ld e,(hl)        ; E = offset from D.TAB
2B46: 21 19 25    ld hl,$2519      ; HL = M.TAB base address
2B49: 19          add hl,de        ; HL = &M.TAB[offset]
2B4A: 7E          ld a,(hl)        ; A = X velocity
2B4B: 23          inc hl
2B4C: DD 77 06    ld (ix+$06),a    ; VECTOR.V.X = X velocity
2B4F: 7E          ld a,(hl)        ; A = Y velocity
2B50: DD 77 08    ld (ix+$08),a    ; VECTOR.V.Y = Y velocity
2B53: C9          ret
```

**D.TAB ($2042):** direction-to-offset lookup (16 entries):
```
Index   Direction       Offset
0       none            $00
1       left            $0C
2       right           $04
3       -               $00
4       up              $10
5       up+left         $0E
6       up+right        $02
7       up default      $10
8       down            $08
9       down+left       $0A
10      down+right      $06
11      down default    $08
```

**M.TAB ($2519):** offset-to-velocity pairs (XDelta, YDelta):
```
Offset  XDelta  YDelta  Direction
$00     $00     $00     none
$02     $01     $FF     up-right (x+1, y-1)
$04     $01     $00     right (x+1, y+0)
$06     $01     $01     down-right (x+1, y+1)
$08     $00     $01     down (x+0, y+1)
$0A     $FF     $01     down-left (x-1, y+1)
$0C     $FF     $00     left (x-1, y+0)
$0E     $FF     $FF     up-left (x-1, y-1)
$10     $00     $FF     up (x+0, y-1)
```

Otto always moves at velocity magnitude 1 per tick. With TPRIME=2, Otto moves
every 2 frames. Since Otto tracks every iteration of the loop (every ~44 ticks),
it relentlessly homes in on the player.

### 2.8 Yield-and-Check Routine ($2B54)

```
2B54: 2A 72 08    ld hl,($0872)    ; HL = head of linked list
2B57: 36 82       ld (hl),$82      ; head.Flags = $82 (active + bit 7)
2B59: 23          inc hl
2B5A: 77          ld (hl),a        ; head.Delay = A
2B5B: DD E5       push ix
2B5D: E5          push hl
2B5E: C5          push bc
2B5F: CD 78 1E    call $1E78       ; STOP_JOB (yield)
2B62: C1          pop bc
2B63: E1          pop hl
2B64: DD E1       pop ix
2B66: DD CB 00 7E bit 7,(ix+$00)   ; test STATUS_BIT_HIT on Otto's VECTOR
2B6A: C9          ret              ; return (Z flag indicates hit status)
```

This is essentially "yield for A ticks, then check if Otto has been hit."
The bit 7 test checks if something collided with Otto's sprite (via Magic RAM
intercept mechanism). The Z flag result is checked by the caller.

### 2.9 Can Otto Kill Robots?

Otto does NOT have explicit robot collision checks. However, the Magic RAM
collision detection system operates on all sprites written through it. When Otto's
sprite is drawn over a robot's pixels, the intercept flip-flop fires. The game's
collision resolution code at the VECTOR rendering layer handles this.

In practice, in the original Berzerk, Otto CAN kill robots by passing through them.
The collision is detected via the Magic RAM hardware, not explicit coordinate checks.

### 2.10 Can Otto Be Killed?

The bit 7 check at $2B66 (`bit 7,(ix+$00)`) tests STATUS_BIT_HIT on Otto's VECTOR.
If something writes over Otto's pixels (like a player bolt), the intercept flags it.
However, in the original Berzerk game, Otto is INVULNERABLE to player shots. The
game logic at the VECTOR processing level does not destroy Otto even if the hit bit
is set -- Otto simply ignores it and continues tracking.

Otto also ignores walls entirely. There is no wall collision check in Otto's
movement loop. Otto passes through walls without obstruction.

### 2.11 What Happens When Otto Reaches the Player?

When Otto's sprite overlaps the player's sprite, the Magic RAM intercept fires.
The player's VECTOR gets STATUS_BIT_HIT set (bit 7). This is checked in the MAN
routine at $1EC0:

```
1EC0: DD CB 00 7E bit 7,(ix+$00)   ; test STATUS_BIT_HIT
1EC4: C2 A7 1F    jp nz,$1FA7      ; if hit, goto PLAYER_DEAD
```

Otto kills the player on contact.

---

## Task 3: Room Transition Logic ($2157-$2313)

### 3.1 Player Position Checking ($2157-$218A)

The main game loop reads the player's position and checks for edge exits:

```
2157: DD 2A 76 08 ld ix,($0876)    ; IX = MAN_PTR
215B: DD CB 00 56 bit 2,(ix+$00)   ; test STATUS_BIT_MOVE
215F: C8          ret z             ; if not moving, return

2160: DD 7E 09    ld a,(ix+$09)    ; A = player Y position
2163: 32 48 43    ld ($4348),a     ; MAN_Y = A
2166: 47          ld b,a           ; B = Y
2167: DD 7E 07    ld a,(ix+$07)    ; A = player X position
216A: 32 47 43    ld ($4347),a     ; MAN_X = A

216D: DD CB 00 7E bit 7,(ix+$00)   ; test STATUS_BIT_HIT
2171: C2 8D 21    jp nz,$218D      ; if hit, skip to score/delay handling

; --- X boundary checks ---
2174: B7          or a             ; test A (player X)
2175: F2 82 21    jp p,$2182       ; if X >= 0 (positive), check Y
2178: FE FC       cp $FC           ; is X >= $FC (252)? (signed: -4)
217A: D2 AC 22    jp nc,$22AC      ; yes -> EXIT LEFT
217D: FE F6       cp $F6           ; is X >= $F6 (246)? (signed: -10)
217F: D2 5D 22    jp nc,$225D      ; yes -> EXIT RIGHT (note: $F6 = wrapped from right)

; --- Y boundary checks ---
2182: 78          ld a,b           ; A = player Y
2183: FE 02       cp $02           ; is Y < 2?
2185: DA 20 22    jp c,$2220       ; yes -> EXIT TOP (scroll down / enter room above)
2188: FE BE       cp $BE           ; is Y >= $BE (190)?
218A: D2 CF 21    jp nc,$21CF      ; yes -> EXIT BOTTOM (scroll up / enter room below)
```

**Correction on the X checks:** The signed interpretation matters. The player X is
stored as an unsigned byte 0-255. When the player moves left past X=0, it wraps to
$FF, $FE, $FD, $FC. When the player moves right past X=$EF or so, it wraps into
high values like $F6-$FF. The two CP checks discriminate:

- `cp $FC` / `jp nc` at $2178: X >= $FC means X is in {$FC..$FF} -- player exited LEFT
- `cp $F6` / `jp nc` at $217D: X >= $F6 means X is in {$F6..$FB} -- player exited RIGHT

Wait -- let me re-examine. The `jp p` at $2175 jumps if bit 7 is clear (X in $00-$7F).
If X has bit 7 set ($80-$FF), we fall through to the boundary checks. But the comment
says $FC -> exit left and $F6 -> exit right. Let me look at where these jump to.

$22AC is labeled "Player has exited left side of room" (confirmed by comment at line 4976).
$225D sets MAN_X = $08 and increments ROOM_X (going right).

So the actual interpretation: when X >= $FC ($FC,$FD,$FE,$FF), the player went LEFT
off screen. When X is in range $F6-$FB, the player went RIGHT through the right edge
(these are values just below $FC but above $F5).

Actually, re-reading more carefully: X values $F6 and above but below $FC would be
the right exit. But $225D increments ROOM_X (moving right in the maze) and sets
MAN_X=$08, which is near the left edge -- consistent with entering a new room from the
left after exiting right.

### 3.2 Trigger Conditions Summary

| Exit Direction | Condition          | New Room        | New Player Position |
|----------------|--------------------|-----------------|--------------------|
| LEFT           | MAN_X >= $FC       | ROOM_X--        | MAN_X = $E6        |
| RIGHT          | MAN_X >= $F6 and MAN_X < $FC | ROOM_X++ | MAN_X = $08    |
| TOP            | MAN_Y < $02        | ROOM_Y--        | MAN_Y = $B9        |
| BOTTOM         | MAN_Y >= $BE       | ROOM_Y++        | MAN_Y = $06        |

### 3.3 Exit Left ($22AC)

```
22AC: 3E E6       ld a,$E6
22AE: 32 47 43    ld ($4347),a     ; MAN_X = $E6 (near right edge of new room)
22B1: 21 45 43    ld hl,$4345      ; HL = &ROOM_X
22B4: 35          dec (hl)         ; ROOM_X--
22B5: CD EB 22    call $22EB       ; cleanup + check FLIP
22B8: 28 09       jr z,$22C3       ; if upright, goto SCROLL_RIGHT
; cocktail cabinet
22BA: 21 00 4F    ld hl,$4F00
22BD: 11 00 46    ld de,$4600
22C0: C3 7A 22    jp $227A         ; jump to S.L (scroll left for cocktail)
```

### 3.4 Exit Right ($225D)

```
225D: 3E 08       ld a,$08
225F: 32 47 43    ld ($4347),a     ; MAN_X = $08 (near left edge of new room)
2262: 21 45 43    ld hl,$4345      ; HL = &ROOM_X
2265: 34          inc (hl)         ; ROOM_X++
2266: CD EB 22    call $22EB       ; cleanup
2269: 28 09       jr z,$2274       ; if upright, goto SCROLL_LEFT
; cocktail
226B: 21 1F 4F    ld hl,$4F1F
226E: 11 E0 5F    ld de,$5FE0
2271: C3 C9 22    jp $22C9         ; scroll right for cocktail
```

### 3.5 Exit Top ($2220)

```
2220: 3E B9       ld a,$B9
2222: 32 48 43    ld ($4348),a     ; MAN_Y = $B9 (near bottom of new room)
2225: 21 46 43    ld hl,$4346      ; HL = &ROOM_Y
2228: 35          dec (hl)         ; ROOM_Y--
2229: CD EB 22    call $22EB       ; cleanup
222C: 28 09       jr z,$2237       ; if upright, goto SCROLL_DOWN
; cocktail
222E: 21 2D 46    ld hl,$462D
2231: 11 00 46    ld de,$4600
2234: C3 EC 21    jp $21EC         ; S.U for cocktail
```

### 3.6 Exit Bottom ($21CF)

```
21CF: 3E 06       ld a,$06
21D1: 32 48 43    ld ($4348),a     ; MAN_Y = $06 (near top of new room)
21D4: 21 46 43    ld hl,$4346      ; HL = &ROOM_Y
21D7: 34          inc (hl)         ; ROOM_Y++
21D8: CD EB 22    call $22EB       ; cleanup
21DB: 28 09       jr z,$21E6       ; if upright, goto SCROLL_UP
; cocktail
21DD: 21 AD 5F    ld hl,$5FAD
21E0: 11 DF 5F    ld de,$5FDF
21E3: C3 3D 22    jp $223D         ; S.D for cocktail
```

### 3.7 Scroll Routines

Each scroll routine moves VRAM data using block copy instructions (LDIR/LDDR),
then clears the newly exposed strip. The scroll is applied to the screen image
RAM in the $4400-$5FFF region.

**SCROLL_UP ($21E6):** Copies VRAM from $442D upward 27 ($1B) times, each time
moving $1900 bytes via LDIR, then clearing $100 bytes. This scrolls the screen
content upward one row at a time.

**SCROLL_DOWN ($2237):** Similar but uses LDDR to copy downward from $5DAD.

**SCROLL_LEFT ($2274):** Copies with LDIR, 32 ($20) iterations, clearing vertical
strips on the right.

**SCROLL_RIGHT ($22C3):** Uses LDDR, 32 iterations, clearing vertical strips on
the left.

### 3.8 FLIP (Cocktail) Effect

The FLIP flag ($4379) determines upright vs cocktail cabinet. When FLIP is non-zero
(cocktail), the scroll direction is reversed and the VRAM source/destination addresses
target the second player's screen region ($4600-$5FFF area). The zero flag from
`call $22EB` (which reads FLIP and does `or a`) determines which path is taken.

For each exit:
- Upright (FLIP=0): scroll in the natural direction
- Cocktail (FLIP!=0): scroll in the opposite direction, using the P2 screen memory

### 3.9 Post-Scroll Cleanup ($22EB-$2313)

```
22EB: CD E4 2B    call $2BE4       ; TRY_SPEAK_ON_PLAYER_LEAVING_ROOM
22EE: CD 4E 36    call $364E       ; (likely colour attribute setup for new room)
22F1: FD E5       push iy
22F3: E1          pop hl           ; HL = IY
22F4: FD 74 FF    ld (iy-$01),h    ; save IY into its own next-pointer (self-link?)
22F7: FD 75 FE    ld (iy-$02),l
22FA: 21 00 00    ld hl,$0000
22FD: F3          di
22FE: 22 70 08    ld ($0870),hl    ; V.PTR = NULL (clear VECTOR linked list)
2301: 22 76 08    ld ($0876),hl    ; MAN_PTR = NULL (clear player pointer)
2304: AF          xor a
2305: 21 7B 43    ld hl,$437B      ; HL = &PLAYER_BOLTS
2308: 06 38       ld b,$38         ; 56 bytes to clear
230A: 77          ld (hl),a        ; write 0
230B: 23          inc hl
230C: 10 FC       djnz $230A       ; loop
230E: 3A 79 43    ld a,($4379)     ; A = FLIP
2311: B7          or a             ; set Z flag (Z=1 if upright)
2312: FB          ei
2313: C9          ret
```

**State reset on room transition:**
1. Robot speech trigger: calls $2BE4 (say something as player leaves)
2. Colour attributes: calls $364E (set up colour for new room)
3. V.PTR ($0870) = NULL -- destroys the entire VECTOR linked list (all robots/Otto gone)
4. MAN_PTR ($0876) = NULL -- player VECTOR cleared (will be reallocated in new room)
5. PLAYER_BOLTS: 56 bytes zeroed at $437B-$43B2 (both bolt structures cleared)
6. Returns Z flag based on FLIP for upright/cocktail scroll direction

After this cleanup, the caller ($20D7) re-enters the room setup loop which:
- Resets RCOUNT to 0
- Reactivates the scheduler head job
- Decrements RWAIT if above threshold
- Spawns new robots and eventually spawns Otto again

### 3.10 The Full Room Transition Flow

```
1. Player position exceeds boundary
2. Set new MAN_X/MAN_Y (exit position in new room)
3. Increment/decrement ROOM_X or ROOM_Y
4. Call $22EB (cleanup):
   a. Robot speech
   b. Colour setup
   c. NULL out V.PTR and MAN_PTR
   d. Zero all bolt structures
5. Check FLIP for scroll direction
6. Execute LDIR/LDDR scroll of screen memory
7. Call $2540 (further screen setup)
8. Draw wall barriers at room edges
9. Jump to $20D7 (main room entry):
   a. Enable interrupts
   b. Update $434A (add $60 with DAA)
   c. Decrement ROBOT_SPEED if > 1
   d. Zero RCOUNT
   e. Reset scheduler delay
   f. Decrement RWAIT if >= $14
   g. Spawn robots
   h. Spawn Otto
   i. Enter main game loop at $2157
```

---

## Task 4: Demo Mode ($1685 area + $436E-$436F)

### 4.1 Attract Mode Loop ($164B-$16CC)

The main attract loop lives at $164B:

```
164B: CD 66 16    call $1666       ; save context (DI, pop HL, save to $4400, set SP=$4300, CREATE_JOB)
164E: CD AC 19    call $19AC       ; display title screen (copyright, scores)
1651: CD 8B 18    call $188B       ; wait for coin + check start buttons (3 loops of $3C ticks)
1654: CD 98 1A    call $1A98       ; display credits prompt ("Push start button")
1657: CD 8B 18    call $188B       ; wait again
165A: CD 85 16    call $1685       ; run demo mode
165D: CA 4B 16    jp z,$164B       ; if demo ended without credits, loop back
1660: CD 66 16    call $1666       ; save context again
1663: CD B2 18    call $18B2       ; handle credit insertion -> start game
```

**Attract sequence:**
1. Display title screen ("1980 STERN Electronics, Inc." + high scores)
2. Wait ~3 seconds for coin input ($188B loops 3 times with $3C tick delay)
3. Display credit prompt ("Push 1 or 2 player start button")
4. Wait again
5. Run demo mode ($1685)
6. If no credits inserted during demo, go back to step 1
7. If credits inserted, start real game ($18B2 handles credit decrement + game init)

### 4.2 Demo Mode Setup ($1685-$16CC)

```
1685: 2A 3E 43    ld hl,($433E)    ; save P1 score
1688: 22 73 43    ld ($4373),hl
168B: 3A 40 43    ld a,($4340)
168E: 32 75 43    ld ($4375),a
1691: 21 00 00    ld hl,$0000
1694: 22 3E 43    ld ($433E),hl    ; zero P1 score (demo plays with 0 score)
1697: 22 3F 43    ld ($433F),hl
169A: 2A 5C 43    ld hl,($435C)    ; save RNG seed
169D: E5          push hl

169E: 21 D9 16    ld hl,$16D9      ; <-- DEMO DATA POINTER
16A1: 22 6F 43    ld ($436F),hl    ; DEMO_PTR = $16D9

16A4: 3E FF       ld a,$FF
16A6: 32 6E 43    ld ($436E),a     ; IS_DEMO_MODE = $FF (nonzero = demo active)

16A9: 01 0C 00    ld bc,$000C      ; 12 bytes
16AC: 11 44 43    ld de,$4344      ; destination: player state area
16AF: 21 CD 16    ld hl,$16CD      ; source: demo player state defaults
16B2: ED B0       ldir             ; copy 12 bytes of default state

16B4: CD 9D 20    call $209D       ; run game loop (same as real game, but IS_DEMO_MODE is set)

; on return from game loop:
16B7: E1          pop hl           ; restore RNG seed
16B8: F5          push af
16B9: 22 5C 43    ld ($435C),hl
16BC: CD 78 26    call $2678       ; advance RNG
16BF: 2A 73 43    ld hl,($4373)    ; restore P1 score
16C2: 22 3E 43    ld ($433E),hl
16C5: 2A 74 43    ld hl,($4374)
16C8: 22 3F 43    ld ($433F),hl
16CB: F1          pop af
16CC: C9          ret
```

### 4.3 Demo Player State Defaults ($16CD)

The 12 bytes at $16CD are copied to $4344 (CURRENT_PLAYER through the difficulty fields):

```
Address  Hex Bytes               Fields
$16CD:   01 02 02 1E 64 03 60   CURRENT_PLAYER=1, ROOM_X=2, ROOM_Y=2,
         00 05 5A 00 00          MAN_X=$1E, (padding)=$64, DEATHS=3,
                                 ROBOT_SPEED=$60(?), ...
```

More precisely, mapping to the known RAM layout:
```
$4344: $01  CURRENT_PLAYER = 1
$4345: $02  ROOM_X = 2
$4346: $02  ROOM_Y = 2
$4347: $1E  MAN_X = $1E (30 decimal)
$4348: $64  MAN_Y = $64 (100 decimal)
$4349: $03  DEATHS = 3 (lives)
$434A: $60  (unknown, likely difficulty-related)
$434B: $00  RBOLTS = 0 (robots don't shoot in demo)
$434C: $05  ROBOT_SPEED = 5
$434D: $5A  RWAIT = $5A
$434E: $00  OTTO_TIME = 0
$434F: $00  XTRAMEN = 0
```

### 4.4 Demo Movement Data ($16D9)

DEMO_PTR is set to $16D9. The demo data format is:

```
$16D9: 0A 8F 12 8F 14 8F 19 8F 02 9F 19 8F 06 8F 18 8F
       02 FF 00 FF 02 FF BF 08 AF 09 BF 01 BF 09 FF 09
       C1 12 8F 00 FF 14 8F 14 8F 14 8F 14 8F 00 FF FF
```

**Format:** Each byte is a DURL direction code OR a delay marker:
- If bit 7 is clear: the byte is a DURL direction (0-$0F). The player moves in that
  direction for one frame.
- If bit 7 is set: the byte is a delay. Bits 0-6 are passed to ACTIVATE_HEAD_JOB
  as the delay count. The job yields for that many ticks.

**Decoding the demo data at $16D9:**

The MAN routine at $1ECD-$1EDF handles this:
```
1ECD: 2A 6F 43    ld hl,($436F)    ; HL = DEMO_PTR
1ED0: 7E          ld a,(hl)        ; read next byte
1ED1: 23          inc hl           ; advance pointer
1ED2: 22 6F 43    ld ($436F),hl    ; save updated pointer
1ED5: CB 7F       bit 7,a          ; test bit 7
1ED7: 28 16       jr z,$1EEF       ; bit 7 clear -> A is DURL direction, move player
1ED9: CB BF       res 7,a          ; clear bit 7 to get delay value
1EDB: C5          push bc
1EDC: CD 6D 1E    call $1E6D       ; ACTIVATE_HEAD_JOB with delay = A & $7F
1EDF: 18 DA       jr $1EBB         ; loop back to read next byte
```

**Pseudocode:**
```
while True:
    byte = ROM[DEMO_PTR++]
    if byte & 0x80 == 0:
        // direction byte: move player in this direction
        move_player(byte & 0x0F)
    else:
        // delay byte: yield for (byte & 0x7F) ticks
        yield(byte & 0x7F)
```

**Example decode of first bytes:**
```
$0A = direction $0A = down+left (bits 3+1)
$8F = delay $0F (15 ticks)
$12 = direction $12 ... wait, $12 > $0F, but bit 7 is clear
```

Actually $12 = 0001_0010 = direction bits: bit 4 (fire) + bit 1 (right).
The fire bit is checked separately at $1EEF:
```
1EEF: CB 67       bit 4,a          ; test fire button bit
```

So the demo data encodes both movement and firing:
- Bits 0-3: DURL direction
- Bit 4: fire button
- Bit 7: delay marker

### 4.5 How IS_DEMO_MODE Affects Gameplay

IS_DEMO_MODE ($436E) is checked at multiple points:

1. **MAN routine ($1EC7):** If demo mode, read from DEMO_PTR instead of joystick.
2. **Room setup ($20A3):** If demo mode, skip player blink animation at room start.
3. **Main loop ($2196):** If demo mode, call $197B/$1997 to check for coin insertion.
   If a coin is detected, exit demo immediately.
4. **NMI handler ($1735):** If demo mode, skip the $1D12 call (coin sound processing?).
5. **NMI voice ($173F):** If demo mode, skip speech synthesis (robots are silent in demo).
6. **Score time update ($21BA):** If demo mode, skip incrementing CMOS play time counter.
7. **Various collision/scoring:** IS_DEMO_MODE checked at $25BF to suppress scoring.

### 4.6 Exiting Demo Mode

Demo mode can end in two ways:
1. Player dies all 3 lives (normal game over).
2. Coin inserted during demo -- detected at $219C-$21A2:
   ```
   219C: CD 7B 19    call $197B       ; check coin switches
   219F: CD 97 19    call $1997       ; get credit count, return NZ if credits > 0
   21A2: C0          ret nz           ; if credits available, return immediately
   ```
   The $1997 routine reads credits and returns NZ if credits > 0. The `ret nz`
   at $21A2 exits the game loop, which unwinds back to $16B4 and eventually to
   the attract loop at $165D.

When a real game starts ($17B8), IS_DEMO_MODE is cleared:
```
17E0: 32 6E 43    ld ($436E),a     ; clear IS_DEMO_MODE (A=0 from xor a at $17DF)
```

---

## Unknown RAM Variables

### $434A: Difficulty Progression Counter

Every access:
1. **$20D8-$20DE** (room entry, $20D7 block):
   ```
   20D8: 3A 4A 43    ld a,($434A)
   20DB: C6 60       add a,$60
   20DD: 27          daa
   20DE: 32 4A 43    ld ($434A),a
   ```
   On each room entry, adds $60 using BCD arithmetic (DAA). So this increments
   by 60 in BCD each room: $00, $60, $20 (with carry), $80, $40, $00 (wraps), etc.

2. **$211D** (robot spawn loop):
   ```
   211D: 3A 4A 43    ld a,($434A)
   2120: 47          ld b,a
   2121: CD 78 26    call $2678       ; RANDOM
   2124: B8          cp b
   2125: 38 1E       jr c,$2145       ; if RANDOM < $434A, skip robot spawn
   ```
   Used as a threshold for robot spawning. The higher $434A is, the more likely
   robots spawn (random must be >= $434A to spawn). Since $434A increases each room,
   fewer robots are skipped in later rooms.

3. **Demo init ($16CD+6):** Set to $60 in demo default state.
4. **Default player state ($187F+6):** Set to $00 at game start.

**Conclusion:** $434A is a BCD difficulty progression counter. It increases by $60 (BCD)
each room. It acts as a probability threshold controlling how many robots spawn. At
$00 (first room), almost all robot slots are filled. As it increases and wraps through
BCD values, the threshold varies the robot density.

**Proposed label: DIFFICULTY or ROBOT_PROBABILITY**

### $4300: Multi-Purpose Temporary / Stack Base

$4300 serves dual purposes:

1. **Stack pointer base:** SP is set to $4300 at multiple points:
   ```
   060A: 31 00 43    ld sp,$4300      ; bookkeeping mode
   1603: 31 00 43    ld sp,$4300      ; boot init
   166E: 31 00 43    ld sp,$4300      ; attract mode context switch
   ```
   The job scheduler stacks grow downward from $4300 into the work RAM area.

2. **CLEAR_SCREEN saves/restores SP:**
   ```
   1A5D: ED 73 00 43 ld ($4300),sp    ; save SP before using SP for fast screen clear
   1A7B: ED 7B 00 43 ld sp,($4300)    ; restore SP after screen clear
   ```

3. **Robot spawn counter ($2117-$214E):**
   ```
   2119: 32 00 43    ld ($4300),a     ; store robot count (initial value $16 = 22)
   2145: 3A 00 43    ld a,($4300)     ; read count
   2148: 3D          dec a
   2149: 3D          dec a            ; subtract 2
   214A: 32 00 43    ld ($4300),a     ; save decremented count
   214E: 20 CD       jr nz,$211D      ; loop until zero
   ```
   Here $4300 is used as a loop counter controlling how many robots to attempt
   spawning. Starts at $16 (22 decimal), decremented by 2 each iteration, so
   up to 11 robots can be spawned.

4. **High score display counter ($19EC-$1A33):**
   ```
   19EC: 32 00 43    ld ($4300),a     ; store rank counter (starts at 1)
   1A28: 3A 00 43    ld a,($4300)     ; read rank
   1A2E: 32 00 43    ld ($4300),a     ; increment rank (BCD add 1 + daa)
   1A31: FE 11       cp $11           ; done when rank reaches 11 (BCD)
   ```
   Used as a BCD counter 01-10 for displaying high score ranks.

5. **Bolt storage ($24BF):** `ld ($4300),hl` -- saves an HL value temporarily.

**Conclusion:** $4300 is NOT a single-purpose variable. It is the base of the system
stack AND a reusable scratch location. Different routines use it as a temporary
counter, knowing they own the context. This works because the job scheduler and
attract mode each reset SP to $4300 before using it.

**Proposed label: STACK_BASE / SCRATCH_TEMP**

### $4066: Unknown

The only reference in the entire disassembly is the EQU declaration:
```
???                         EQU $4066
```

$4066 falls in the VRAM address space ($4000-$5FFF is screen image RAM). Address
$4066 maps to: scanline = ($4066 - $4000) / $20 = $66 / $20 = 3 remainder 6,
so scanline 3, byte 6. This is near the top of the screen.

With only the EQU and no code references, $4066 may be:
- A VRAM address used as a flag/semaphore (writing a pixel pattern to indicate state)
- An address referenced only through pointer arithmetic (HL pointing into VRAM)
- A remnant from development that was not used in the final ROM

**Without any code references, its purpose cannot be determined from this disassembly.**

---

## Summary of Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| OTTO TPRIME | $02 | Otto moves every 2 ticks |
| OTTO initial delay | $28 (40) per countdown tick | 40 ticks between each OTTO_TIME decrement |
| OTTO movement delay | $28 (40) then $04 (4) | Retargets every 40+4 ticks |
| Room exit X left | >= $FC | Player X wraps past left edge |
| Room exit X right | >= $F6, < $FC | Player X wraps past right edge |
| Room exit Y top | < $02 | Player Y near top |
| Room exit Y bottom | >= $BE | Player Y near bottom |
| Demo data address | $16D9 | ROM address of demo movement bytes |
| Demo player state | $16CD | ROM address of demo initial state (12 bytes) |
| Job flags $82 | bits 7+1 | Active + high-priority job marker |
| Job scratch space | 24 bytes | Allocated by $1E59 on each job's stack |
| Robot spawn slots | 11 max | Counter starts at $16, decrements by 2 |
| $434A BCD increment | +$60/room | Difficulty ramp via BCD arithmetic |
