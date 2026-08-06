# Input script schema — FROZEN (by T3.1)

Neutral, deterministic input recording replayable on both the JS machine and
MAME (via Lua injection). MAME INP files cannot replay outside MAME; this
format is the cross-platform substitute.

## Format (JSONL)
Header record, then one record per input *change* (not per frame):

```jsonl
{"type":"header","game":"berzerk","version":1,"dips":{"<PortName.FieldName>":"<settingName>"},"frames":<total>}
{"type":"input","frame":123,"port":"P1","field":"UP","value":1}
```

- `frame`: 0-based vblank count at which the change is applied.
- `port`/`field`: canonical names from `cdoc/hardware-berzerk.md` Section 6.
  These must match MAME driver field names exactly so the Lua injector (T3.2)
  can resolve them without a translation table.
- `value`: 1 = pressed/active, 0 = released/inactive. For DIP fields, value
  is the setting name string (matching `settings` keys in `input.js`).
- `frames` in the header: total frame count; used by the player to detect
  truncated scripts (no frames beyond this value will be delivered).
- `dips` in the header: map of `"PortName.FieldName"` to setting name.
  Applied once at construction, before frame 0. Absent fields default to
  factory settings (same as `new Input()` with no overrides).
- Determinism contract: same script + same ROM => bit-identical machine
  execution. No wall-clock anywhere.

## Resolved design decisions

**Initial state: cold boot from reset.**
Every script starts from a hardware reset. There is no snapshot/resume
support. This keeps the format self-contained and removes any dependency on
a machine state file.

**Frame-0 convention: inputs at `frame:0` apply before any CPU cycles run.**
The VBlank hook fires at the start of each frame boundary. Frame 0 inputs
are applied before the first slice of CPU execution, giving the ROM a chance
to sample them during the POST.

**DIP overrides go in the header, not in per-frame records.**
DIPs don't change during play. Centralizing them in the header makes the
replay sequence easier to reason about and simpler to inject via Lua.

**Application timing: VBlank boundary (start of frame).**
The script player is invoked via the scheduler's vblankCallback. All pending
records for `frame == scheduler.frameCount` are applied there. The CPU sees
the new values from the first instruction of that frame onward.

**Multi-player ports: explicit `port` field, no alias.**
`P1.LEFT` and `P2.LEFT` are distinct records. No shorthand aliases.
