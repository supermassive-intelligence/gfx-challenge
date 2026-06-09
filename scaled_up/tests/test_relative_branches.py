"""Category F: relative-branch target resolution (§2 Gotcha).

jr and djnz targets are PC-relative. They match the reference ONLY when decoded
at their real address in the ROM. Target: 30 samples from the corpus.
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


def _get_branch_samples(oracle_path: Path, target_count: int):
    with oracle_path.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]

    branches = [r for r in rows if r["expected"].split()[0] in ("jr", "djnz")]

    stride = max(1, len(branches) // target_count)
    return branches[::stride][:target_count]


@pytest.mark.parametrize(
    "row",
    _get_branch_samples(SCALED_UP / "oracle" / "decode_oracle.jsonl", 30),
    ids=lambda r: f"branch_{r['addr']:#06x}:{r['expected']}",
)
def test_relative_branch_resolves_at_real_address(row, rom):
    mnem, length = z.decode_instruction(rom, row["addr"], len(rom))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]
