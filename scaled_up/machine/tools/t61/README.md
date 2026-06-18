# T6.1 annotation evidence-generators

Reproduce the trace-driven annotation (cdoc/annotated-asm-berzerk.md +
cdoc/ram-map-berzerk.md). All derive from the attract heavy trace; none consult
labels.json / published source (T6.2 rubric).

Run order (from repo root; intermediates land in /tmp/t61):

```
mkdir -p /tmp/t61
node machine/tools/t61/analyze.js     # -> /tmp/t61/routines.json   (per-routine aggregate + call graph)
node machine/tools/t61/rammap.js      # (optional) global RAM histogram -> /tmp/t61/ram_hist.json
node machine/tools/t61/disasm.js      # -> /tmp/t61/disasm.json      (CFG-walked disasm via z80dis.js)
node machine/tools/t61/report.js      # -> /tmp/t61/report.txt       (human-readable evidence per routine)
node machine/tools/t61/annotate.js    # -> /tmp/t61/annotations_body.md
node machine/tools/t61/rammapgen.js   # -> /tmp/t61/rammap_body.md
```

`z80dis.js` is a Z80 disassembler validated against
disassembler/oracle/decode_oracle.jsonl (5286/5288 instructions identical; the 2
diffs are the oracle's signed-decimal `cp -2`/`cp -4` vs canonical `cp $fe`/`$fc`).

`rammap.js` was used to find variable clusters; copy it from the session if
regenerating ram_hist.json (it instruments the same capture path as analyze.js).
