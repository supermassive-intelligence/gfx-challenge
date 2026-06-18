"""Category J: normalize_mnemonic — pure string logic.

normalize_mnemonic(mnemonic, operands) returns a TUPLE (mnemonic_lc, operands_lc),
lowercasing both, stripping a trailing ';' comment from operands, and NOT collapsing
internal whitespace. Target: 10 tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))

import z80_disasm as z  # noqa: E402


def test_returns_tuple_and_lowercases():
    result = z.normalize_mnemonic("LD", "A,B")
    assert isinstance(result, tuple)
    assert result == ("ld", "a,b")


def test_strips_trailing_semicolon_comment():
    assert z.normalize_mnemonic("JP", "$1234   ; jump there") == ("jp", "$1234")


def test_empty_operands_return_empty_string():
    assert z.normalize_mnemonic("NOP", "") == ("nop", "")


def test_internal_whitespace_is_not_collapsed():
    # The function only .strip()s the ends; interior spacing is preserved.
    assert z.normalize_mnemonic("LD", "A , B") == ("ld", "a , b")


def test_mixed_case_operands():
    assert z.normalize_mnemonic("LD", "Hl, Bp") == ("ld", "hl, bp")


def test_comment_only_operands_stripped():
    # If operands is just a comment, it should be stripped to empty
    assert z.normalize_mnemonic("NOP", "; just a comment") == ("nop", "")


def test_no_operands_provided():
    assert z.normalize_mnemonic("RET", None) == ("ret", "")


def test_operands_with_internal_comments():
    # Only strips a TRAILING comment. Internal ';' are not stripped.
    # (Actually, z80_disasm.py does ops[: ops.index(";")].strip())
    assert z.normalize_mnemonic("LD", "A,B ; comment") == ("ld", "a,b")


def test_operands_with_leading_whitespace():
    assert z.normalize_mnemonic("LD", "   A,B   ") == ("ld", "a,b")


def test_mnemonic_with_trailing_whitespace():
    assert z.normalize_mnemonic("  LD  ", "A,B") == ("ld", "a,b")
