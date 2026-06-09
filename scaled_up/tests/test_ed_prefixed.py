"""Category C: ED-prefix decode coverage.

Tests instructions with the ED prefix (e.g., ldir, lddr, neg, im, sbc hl).
Target: 20 tests.
Source: All 16 distinct shapes from opcode_shapes.jsonl, plus 4 samples from decode_oracle.jsonl.
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


def _get_ed_samples():
    # 1. All distinct shapes (16 available)
    shapes = [
        json.loads(r)
        for r in (SCALED_UP / "oracle" / "opcode_shapes.jsonl")
        .open()
        .read()
        .splitlines()
        if json.loads(r)["bytes"][0] == 0xED
    ]

    # 2. Fill to 20 using corpus samples
    if len(shapes) < 20:
        corpus = [
            json.loads(r)
            for r in (SCALED_UP / "oracle" / "decode_oracle.jsonl")
            .open()
            .read()
            .splitlines()
            if json.loads(r)["bytes"][0] == 0xED
        ]
        # Sample every Nth row to get 4 unique-ish instances not already in shapes
        stride = max(1, len(corpus) // 4)
        fill = corpus[::stride][: 20 - len(shapes)]
        shapes.extend(fill)

    return shapes


@pytest.mark.parametrize(
    "row", _get_ed_samples(), ids=lambda r: f"ed_{r['addr']:#06x}:{r['expected']}"
)
def test_ed_prefix_decodes_to_reference(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
