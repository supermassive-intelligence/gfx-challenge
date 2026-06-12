# Test-plan schema — DRAFT (frozen in Phase 7)

Generated from heavyweight traces (`heavy-trace.md`). One JSONL file per
trace; one record per kept subroutine invocation. Consumed by the JS test
bench (Phase 8): bench mocks memory from `reads`, calls the JS routine,
diffs `regs_out` + `writes`.

```jsonl
{"routine":"name_or_addr","entry_pc":"0x1A2B",
 "regs_in":{...},"reads":[[addr,val],...],
 "regs_out":{...},"writes":[[addr,val],...],"cycles":N,
 "path_id":"<branch-path discriminator>"}
```

Selection policy: dedupe identical invocations; keep N distinct cases per
routine preferring distinct `path_id`s (different branch paths through the
routine). Tests are hermetic — no emulator in the loop.
