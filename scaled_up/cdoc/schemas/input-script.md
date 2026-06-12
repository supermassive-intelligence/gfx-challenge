# Input script schema — DRAFT (frozen by T3.1)

Neutral, deterministic input recording replayable on both the JS machine and
MAME (via Lua injection). MAME INP files cannot replay outside MAME; this
format is the cross-platform substitute.

## Format (JSONL)
Header record, then one record per input *change* (not per frame):

```jsonl
{"type":"header","game":"berzerk","version":1,"dips":{"<switch>":"<value>"},"frames":<total>}
{"type":"input","frame":123,"port":"P1","field":"UP","value":1}
```

- `frame`: 0-based vblank count at which the change applies.
- `port`/`field`: names as defined in `cdoc/hardware-berzerk.md` (must match
  MAME driver field names so the Lua injector can resolve them).
- Determinism contract: same script + same ROM ⇒ bit-identical machine
  execution. No wall-clock anywhere.

Open questions to resolve in T3.1: initial-state record (cold boot vs state
snapshot), frame-0 convention, multi-player ports.
