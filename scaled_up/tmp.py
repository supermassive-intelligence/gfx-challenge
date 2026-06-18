import json

rnd = [
    r for r in (json.loads(l) for l in open("/tmp/js.jsonl")) if r["entryPC"] == 0x2678
]
print("RANDOM invocations:", len(rnd))


def lo_hi(pairs):  # pull seed bytes from 0x435C/0x435D
    lo = hi = None
    for x in pairs:
        if x["addr"] == 0x435C and lo is None:
            lo = x["val"]
        if x["addr"] == 0x435D and hi is None:
            hi = x["val"]
    return None if None in (lo, hi) else (hi << 8) | lo


for r in rnd[:8]:
    o = lo_hi([x for x in r["read_set"] if x["type"] == "mem"])
    n = lo_hi(r["write_set"])
    if None in (o, n):
        continue
    pred = (7 * o + 0x3153) & 0xFFFF
    print(
        f"in 0x{o:04X} -> out 0x{n:04X}  predicted 0x{pred:04X}  {'OK' if pred==n else 'BAD'}"
    )
