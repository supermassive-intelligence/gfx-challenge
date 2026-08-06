"""Category M: independent-witness corroboration.

Asserts our decoder agrees with SkoolKit 10's Z80 disassembler (skoolkit.ca) —
a mature, third-party, non-Claude implementation — on instructions sampled across
all six ROM regions. This is what makes the suite more than "Claude checking
Claude": a regression now has to fool an outside implementation too.

The witness is frozen in oracle/skoolkit_instructions.jsonl (generated once by
Cowork; tests never invoke skoolkit). Compared with decode_matches so notation
differences (hex vs signed-decimal) don't masquerade as disagreements.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))
sys.path.insert(0, str(SCALED_UP))
ORACLE = SCALED_UP / "oracle"

import z80_disasm as z  # noqa: E402
from oracle_compare import decode_matches  # noqa: E402

_WITNESS = [
    json.loads(line)
    for line in (ORACLE / "skoolkit_instructions.jsonl").read_text().splitlines()
    if line.strip()
]

# Deterministic stride sample across the address-ordered witness (spans all
# regions). 50 rows -> stride = len // 50.
_STRIDE = max(1, len(_WITNESS) // 50)
_SAMPLE = _WITNESS[::_STRIDE][:50]


@pytest.mark.parametrize(
    "row", _SAMPLE, ids=lambda r: f"skool_{r['addr']:#06x}:{r['skoolkit']}"
)
def test_decoder_matches_skoolkit(row, rom):
    """Decoder output must equal the independent SkoolKit disassembly."""
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(
        mnem, row["skoolkit"]
    ), f"{row['addr']:#06x}: decoder={mnem!r} vs skoolkit={row['skoolkit']!r}"
    assert length == row["len"]
