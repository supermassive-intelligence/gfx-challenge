# Heavyweight trace schema — DRAFT (frozen in Phase 4)

Captured on the JS machine by instrumenting CALL/RET dispatch and the memory
object. One JSONL record per subroutine invocation:

```jsonl
{"routine":"0x1A2B","caller":"0x0F10","regs_in":{...},
 "reads":[[addr,val],...], "writes":[[addr,val],...],
 "regs_out":{...},"cycles":N,"frame":F}
```

Key invariants:
- `reads` is ORDERED by read sequence, not a snapshot — live ports/timers may
  be read twice with different values and both must appear.
- Byte-identical output for identical input scripts (determinism gate, Phase 4).
- `caller` chains give the call graph.

Per-instruction tracing is a separate on-demand mode, not this schema.
Finalize field list, register naming, and nested-call attribution in Phase 4.
