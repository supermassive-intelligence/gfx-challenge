"""Category D: IX/IY indexed addressing (DD/FD prefixes).

Tests instructions using IX/IY registers and indexed addressing (e.g., ld (ix+d), a).
Target: 30 tests.
Source: Sample from opcode_shapes.jsonl where bytes[0] in {0xDD, 0xFD}.
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


@pytest.mark.parametrize(
    "row",
    [
        json.loads(r)
        for r in (SCALED_UP / "oracle" / "opcode_shapes.jsonl")
        .open()
        .read()
        .splitlines()
        if json.loads(r)["bytes"][0] in (0xDD, 0xFD)
    ][:30],
    ids=lambda r: f"idx_{r['addr']:#06x}:{r['expected']}",
)
def test_indexed_addressing_decodes_to_reference(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
