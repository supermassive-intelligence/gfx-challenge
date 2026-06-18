"""Category E: Differential spot-checks across ROM regions.

Deterministic sample across all 6 ROM regions from decode_oracle.jsonl.
Target: 90 tests (15 per region).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))

sys.path.insert(0, str(SCALED_UP))
import z80_disasm as z  # noqa: E402
from oracle_compare import decode_matches  # noqa: E402


def _get_regional_samples(oracle_path: Path, target_count: int):
    with oracle_path.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]

    # Group by region
    regions = {}
    for r in rows:
        reg = z.get_rom_region(r["addr"])
        if reg:
            regions.setdefault(reg, []).append(r)

    samples = []
    # distribute target_count across the 6 regions
    # 90 / 6 = 15 per region
    per_region = target_count // 6
    for reg in sorted(regions.keys()):
        reg_rows = regions[reg]
        stride = max(1, len(reg_rows) // per_region)
        samples.extend(reg_rows[::stride][:per_region])

    return samples[:target_count]


@pytest.mark.parametrize(
    "row",
    _get_regional_samples(SCALED_UP / "oracle" / "decode_oracle.jsonl", 90),
    ids=lambda r: f"reg_{r['addr']:#06x}:{r['expected']}",
)
def test_regional_corpus_matches_reference(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
