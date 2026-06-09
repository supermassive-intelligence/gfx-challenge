"""Category G: 3-byte immediate / absolute operands.

Tests instructions with 3-byte lengths (e.g., ld rr,nn, jp nn, call nn).
Target: 20 tests.
Source: Deterministic sample from decode_oracle.jsonl where len == 3.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent / "scripts"))

sys.path.insert(0, str(SCALED_UP))
import z80_disasm as z  # noqa: E402
from oracle_compare import decode_matches  # noqa: E402


def _get_len3_samples(oracle_path: Path, target_count: int):
    with oracle_path.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]
    l3 = [r for r in rows if r["len"] == 3]
    stride = max(1, len(l3) // target_count)
    return l3[::stride][:target_count]


@pytest.mark.parametrize(
    "row",
    _get_len3_samples(SCALED_UP / "oracle" / "decode_oracle.jsonl", 20),
    ids=lambda r: f"len3_{r['addr']:#06x}:{r['expected']}",
)
def test_three_byte_operands_decode_to_reference(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
