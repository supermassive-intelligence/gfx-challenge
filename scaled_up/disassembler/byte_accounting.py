"""ROM byte-accounting: classify every ROM byte as code-opcode, code-operand,
or unknown, and prove the partition is complete and non-overlapping.

This is the foundation for the Phase 4 coverage loop (T1.2). The decode oracle
(`oracle/decode_oracle.jsonl`) is a linear sweep of human-verified instruction
decodes. Each row contributes one opcode byte (its first byte) and zero or more
operand bytes (the remainder of its length). Any ROM byte not claimed by an
oracle row is "unknown" -- almost certainly data, but not yet proven so. We do
NOT guess data here; resolving unknown regions is T1.2's job (needs traces).

Accounting is performed over the populated ROM regions only (see ROM_REGIONS in
z80_disasm). The inter-region holes (RAM at 0x0800-0x0FFF, the unpopulated
0x3800-0x3FFF window) are not ROM and are excluded from the address space.

coverage_report.json schema
---------------------------
{
  "total_rom_bytes": int,            # sum of ROM_REGIONS sizes
  "instruction_count": int,          # number of oracle rows consumed
  "classification": {                # byte counts, partition of total_rom_bytes
    "code_opcode": int,
    "code_operand": int,
    "unknown": int
  },
  "per_region": [                    # same breakdown, one entry per ROM region
    {"name": str, "start": int, "end": int, "size": int,
     "code_opcode": int, "code_operand": int, "unknown": int}
  ],
  "unknown_regions": [               # maximal contiguous runs of unknown bytes
    {"start": int, "end": int, "size": int, "region": str}
  ],
  "double_classified": [             # bytes claimed by >1 oracle row (must be [])
    {"addr": int, "first": str, "second": str}
  ]
}

Addresses in the JSON are decimal ints. `end` is exclusive.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SCRIPTS = _HERE.parent.parent / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import z80_disasm as z  # noqa: E402

# Classification labels.
OPCODE = "code_opcode"
OPERAND = "code_operand"
UNKNOWN = "unknown"


def build_coverage_report(
    rom: bytes, oracle_rows: list[dict], rom_regions=None
) -> dict:
    """Classify every ROM byte and return the coverage report dict.

    rom          flat ROM image, addressable by absolute address.
    oracle_rows  decode_oracle rows: each has {addr, len, expected, ...}.
    rom_regions  list of (start, end, name); defaults to z80_disasm.ROM_REGIONS.

    The returned dict matches the schema in this module's docstring. The function
    is pure (no I/O); use write_report() to persist it.
    """
    if rom_regions is None:
        rom_regions = z.ROM_REGIONS

    # Per-address classification, only for addresses inside a ROM region.
    klass: dict[int, str] = {}
    region_of: dict[int, str] = {}
    for start, end, name in rom_regions:
        for addr in range(start, end):
            klass[addr] = UNKNOWN
            region_of[addr] = name

    double_classified: list[dict] = []
    instruction_count = 0

    for row in oracle_rows:
        addr = row["addr"]
        length = row["len"]
        # Skip rows that fall outside the populated ROM regions entirely.
        if addr not in klass:
            continue
        instruction_count += 1
        for i in range(length):
            a = addr + i
            if a not in klass:
                # Instruction byte spilling past a region boundary: leave the
                # in-region bytes as already set; out-of-region bytes are not
                # part of the accounting space.
                continue
            label = OPCODE if i == 0 else OPERAND
            if klass[a] != UNKNOWN:
                double_classified.append(
                    {"addr": a, "first": klass[a], "second": label}
                )
            else:
                klass[a] = label

    # Aggregate counts overall and per region.
    per_region = []
    totals = {OPCODE: 0, OPERAND: 0, UNKNOWN: 0}
    for start, end, name in rom_regions:
        counts = {OPCODE: 0, OPERAND: 0, UNKNOWN: 0}
        for addr in range(start, end):
            counts[klass[addr]] += 1
        for k in totals:
            totals[k] += counts[k]
        per_region.append(
            {
                "name": name,
                "start": start,
                "end": end,
                "size": end - start,
                OPCODE: counts[OPCODE],
                OPERAND: counts[OPERAND],
                UNKNOWN: counts[UNKNOWN],
            }
        )

    # Maximal contiguous runs of unknown bytes.
    unknown_regions = _runs(klass, region_of, UNKNOWN)

    total_rom_bytes = sum(end - start for start, end, _ in rom_regions)
    return {
        "total_rom_bytes": total_rom_bytes,
        "instruction_count": instruction_count,
        "classification": {
            OPCODE: totals[OPCODE],
            OPERAND: totals[OPERAND],
            UNKNOWN: totals[UNKNOWN],
        },
        "per_region": per_region,
        "unknown_regions": unknown_regions,
        "double_classified": double_classified,
    }


def _runs(klass: dict[int, str], region_of: dict[int, str], target: str) -> list[dict]:
    """Maximal contiguous [start, end) runs of addresses classified as target."""
    runs: list[dict] = []
    run_start = None
    prev = None
    for addr in sorted(klass):
        is_target = klass[addr] == target
        # A run breaks on a non-target byte or a non-contiguous address.
        if is_target and (run_start is None or addr == prev + 1):
            if run_start is None:
                run_start = addr
        else:
            if run_start is not None:
                runs.append(_run(run_start, prev, region_of))
                run_start = addr if is_target else None
        prev = addr
    if run_start is not None:
        runs.append(_run(run_start, prev, region_of))
    return runs


def _run(start: int, last: int, region_of: dict[int, str]) -> dict:
    return {
        "start": start,
        "end": last + 1,
        "size": last + 1 - start,
        "region": region_of[start],
    }


def write_report(report: dict, path: Path) -> None:
    """Write the report as pretty-printed JSON."""
    path.write_text(json.dumps(report, indent=2) + "\n")


def _load_oracle(path: Path) -> list[dict]:
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def main() -> int:
    oracle_dir = _HERE / "oracle"
    rom = (oracle_dir / "berzerk_flat.bin").read_bytes()
    rows = _load_oracle(oracle_dir / "decode_oracle.jsonl")
    report = build_coverage_report(rom, rows)
    out = _HERE / "coverage_report.json"
    write_report(report, out)
    c = report["classification"]
    print(
        "byte-accounting: %d ROM bytes -- opcode %d, operand %d, unknown %d "
        "(%d unknown regions, %d double-classified)"
        % (
            report["total_rom_bytes"],
            c[OPCODE],
            c[OPERAND],
            c[UNKNOWN],
            len(report["unknown_regions"]),
            len(report["double_classified"]),
        )
    )
    print("wrote %s" % out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
