"""Category H: ROM region helpers — is_rom_address / get_rom_region.

Boundaries come directly from z80_disasm.ROM_REGIONS (a fixed config table, not
Z80 semantics). Target: 20 tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))

import z80_disasm as z  # noqa: E402


@pytest.mark.parametrize(
    "addr,expected",
    [
        (0x0000, True),  # ROM0 start
        (0x07FF, True),  # ROM0 last byte
        (0x0800, False),  # RAM gap start
        (0x0FFF, False),  # RAM gap last byte
        (0x1000, True),  # ROM1 start
        (0x37FF, True),  # ROM5 last byte
        (0x3800, False),  # unpopulated start
        (0x4000, False),  # out of range
        (-1, False),  # negative
        (0x0801, False),  # inside RAM gap
    ],
    ids=lambda v: hex(v) if isinstance(v, int) else str(v),
)
def test_is_rom_address_at_boundaries(addr, expected):
    assert z.is_rom_address(addr) is expected


@pytest.mark.parametrize(
    "addr,region",
    [
        (0x0000, "ROM0"),
        (0x1000, "ROM1"),
        (0x1800, "ROM2"),
        (0x2000, "ROM3"),
        (0x2800, "ROM4"),
        (0x3000, "ROM5"),
        (0x0800, None),
        (0x3800, None),
        (0x4000, None),
        (0x0801, None),
    ],
    ids=lambda v: hex(v) if isinstance(v, int) else str(v),
)
def test_get_rom_region_at_boundaries(addr, region):
    assert z.get_rom_region(addr) == region
