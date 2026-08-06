"""Category B: CB-prefix rotates/shifts/bit ops.

Tests instructions with the CB prefix (e.g., rlc, rrc, rl, rr, sla, sra, sll, srl,
bit, res, set). Target: 35 representative cases from the opcode_shapes oracle.
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
        if json.loads(r)["bytes"][0] == 0xCB
    ][:35],
    ids=lambda r: f"cb_{r['addr']:#06x}:{r['expected']}",
)
def test_cb_prefix_decodes_to_reference(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
