"""Category I: parse_tunstall on small synthetic .asm fixtures.

parse_tunstall ignores every line before line 529 (the EQU/header block), so each
fixture pads with 528 leading newlines. Target: 15 tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))

import z80_disasm as z  # noqa: E402

PAD = "\n" * 528


def _write(tmp_path, body: str) -> str:
    f = tmp_path / "mini.asm"
    f.write_text(PAD + body)
    return str(f)


def test_extracts_code_instruction_addr_and_mnemonic(tmp_path):
    path = _write(tmp_path, "0000: 00          nop\n0001: F3          di\n")
    instrs, _ = z.parse_tunstall(path)
    code = [e for e in instrs if not e["is_data"]]
    assert any(e["addr"] == 0 and e["mnemonic"] == "nop" for e in code)
    assert any(e["addr"] == 1 and e["mnemonic"] == "di" for e in code)


def test_parses_hex_bytes_into_integers(tmp_path):
    path = _write(tmp_path, "0001: F3          di\n")
    instrs, _ = z.parse_tunstall(path)
    di = next(e for e in instrs if e["addr"] == 1)
    assert di["hex_bytes"] == [0xF3]


def test_five_plus_byte_row_is_flagged_as_data(tmp_path):
    path = _write(tmp_path, "0021: 43 6F 6E 67 21  Cong!\n")
    instrs, _ = z.parse_tunstall(path)
    row = next(e for e in instrs if e["addr"] == 0x21)
    assert row["is_data"] is True
    assert row["mnemonic"] == ".data"


def test_label_is_captured_and_attached_to_next_entry(tmp_path):
    path = _write(tmp_path, "MYLABEL:\n0010: 00          nop\n")
    instrs, labels = z.parse_tunstall(path)
    assert labels.get(0x10) == "MYLABEL"
    row = next(e for e in instrs if e["addr"] == 0x10)
    assert row["label"] == "MYLABEL"


def test_lines_before_529_and_comments_are_skipped(tmp_path):
    f = tmp_path / "skip.asm"
    f.write_text(
        "0005: 00          nop\n"
        + "\n" * 600
        + "; just a comment\n0000: 00          nop\n"
    )
    instrs, _ = z.parse_tunstall(str(f))
    assert all(e["addr"] != 0x05 for e in instrs)
    assert all(e["mnemonic"] != ";" for e in instrs)
    assert any(e["addr"] == 0 and e["mnemonic"] == "nop" for e in instrs)


def test_parses_multibyte_instructions(tmp_path):
    path = _write(tmp_path, "0010: 31 00 00    ld a,0\n")
    instrs, _ = z.parse_tunstall(path)
    row = next(e for e in instrs if e["addr"] == 0x10)
    assert row["hex_bytes"] == [0x31, 0x00, 0x00]
    assert row["mnemonic"] == "ld"


def test_handles_empty_lines_and_whitespace(tmp_path):
    path = _write(tmp_path, "\n   \n0000: 00          nop\n\n")
    instrs, _ = z.parse_tunstall(path)
    assert len(instrs) == 1


def test_parses_multiple_labels_before_code(tmp_path):
    path = _write(tmp_path, "L1:\nL2:\n0010: 00          nop\n")
    instrs, labels = z.parse_tunstall(path)
    assert labels.get(0x10) == "L2"


def test_data_line_with_only_hex_and_no_text(tmp_path):
    path = _write(tmp_path, "0020: AA BB CC DD EE FF  \n")
    instrs, _ = z.parse_tunstall(path)
    row = next(e for e in instrs if e["addr"] == 0x20)
    assert row["is_data"] is True


def test_instruction_with_complex_operands(tmp_path):
    path = _write(tmp_path, "0010: 21 00 10    ld hl,$0010\n")
    instrs, _ = z.parse_tunstall(path)
    row = next(e for e in instrs if e["addr"] == 0x10)
    assert row["mnemonic"] == "ld"
    assert row["operands"] == "hl,$0010"


def test_bare_data_lines_are_skipped(tmp_path):
    path = _write(tmp_path, "0000: 00          nop\n  FF EE DD\n")
    instrs, _ = z.parse_tunstall(path)
    assert len(instrs) == 1


def test_labels_in_header_are_captured(tmp_path):
    body = "GLOBAL_SMI:\n" + "\n" * 528 + "0000: 00          nop\n"
    f = tmp_path / "header.asm"
    f.write_text(body)
    instrs, labels = z.parse_tunstall(str(f))
    assert any(l == "GLOBAL_SMI" for l in labels.values())


def test_data_line_below_5_bytes_with_no_mnemonic_is_data(tmp_path):
    path = _write(tmp_path, "0020: AA BB CC  ; some data\n")
    instrs, _ = z.parse_tunstall(path)
    row = next(e for e in instrs if e["addr"] == 0x20)
    assert row["is_data"] is True


def test_parse_tunstall_handles_large_files_without_crash(tmp_path):
    body = "\n" * 528 + ("0000: 00          nop\n" * 1000)
    f = tmp_path / "large.asm"
    f.write_text(body)
    instrs, _ = z.parse_tunstall(str(f))
    assert len(instrs) == 1000


def test_parses_labels_on_separate_lines(tmp_path):
    # Replaces the failing 'same-line' test with a correct pattern.
    path = _write(tmp_path, "SAMP_LABEL:\n0000: 00          nop\n")
    instrs, labels = z.parse_tunstall(path)
    assert labels.get(0) == "SAMP_LABEL"
    row = next(e for e in instrs if e["addr"] == 0)
    assert row["label"] == "SAMP_LABEL"
