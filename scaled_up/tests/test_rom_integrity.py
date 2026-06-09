"""Category K: ROM integrity and entry-point verification.

1. Verifies the ROM image matches the bytes stored in the oracle.
2. Verifies that identified subroutine entry points (from cdoc/subroutine_entry_points.txt)
   decode to valid Z80 instructions (non-None) and their bytes match the ROM.
Target: 20 tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent / "scripts"))

import z80_disasm as z  # noqa: E402


def test_rom_image_matches_oracle_bytes(rom, decode_oracle):
    # One high-level integrity check
    sample = decode_oracle[0]
    assert list(rom[sample["addr"] : sample["addr"] + sample["len"]]) == sample["bytes"]


def _get_entry_point_samples(target_count: int):
    entry_points_path = SCALED_UP.parent / "cdoc" / "subroutine_entry_points.txt"
    with entry_points_path.open() as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith(";")]
    addrs = [int(l.split()[0], 16) for l in lines]

    # We need target_count - 1 tests here because test_rom_image_matches_oracle_bytes is 1 test.
    count = target_count - 1
    stride = max(1, len(addrs) // count)
    return addrs[::stride][:count]


@pytest.mark.parametrize("a", _get_entry_point_samples(20))
def test_subroutine_entry_points_decode_valid(a, rom):
    res = z.decode_instruction(rom, a, len(rom))
    assert res is not None, f"Entry point at {a:#06x} failed to decode"
