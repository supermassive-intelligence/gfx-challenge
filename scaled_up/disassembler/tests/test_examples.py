"""WORKED EXAMPLES — the canonical patterns Claude Code must scale to 400 tests.

These are real, passing tests. Each one demonstrates a category from
MANIFEST.md. Claude Code should copy these patterns and expand the parametrize
lists / categories to reach the per-category counts. Do NOT invent expected
values: every expectation here is anchored to the frozen oracle in ../oracle/.

Run from the scaled_up/ directory:  pytest tests/ -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# --- import setup (mirrors conftest so this file also runs standalone) -------
SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))
sys.path.insert(0, str(SCALED_UP))
ORACLE = SCALED_UP / "oracle"

import z80_disasm as z  # noqa: E402
from oracle_compare import decode_matches, normalize as _norm  # noqa: E402


def _jsonl(name: str) -> list[dict]:
    with (ORACLE / name).open() as f:
        return [json.loads(line) for line in f if line.strip()]


# Loaded at collection time so they can drive @pytest.mark.parametrize.
ROM = (ORACLE / "berzerk_flat.bin").read_bytes()
SHAPES = _jsonl("opcode_shapes.jsonl")
CORPUS = _jsonl("decode_oracle.jsonl")


# === Category A: opcode-shape coverage ======================================
# One assertion per distinct opcode shape. Decode the real ROM bytes at their
# real address and compare to the Tunstall reference. This is the backbone of
# the suite — it proves every opcode form the ROM exercises decodes correctly.
@pytest.mark.parametrize(
    "row", SHAPES[:8], ids=lambda r: f"{r['addr']:#06x}:{r['expected']}"
)
def test_opcode_shape_decodes_to_reference(row):
    mnem, length = z.decode_instruction(ROM, row["addr"], len(ROM))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]


# === Category B: differential corpus ========================================
# Sample across the full 5,286-row corpus. Claude Code scales the slice.
@pytest.mark.parametrize("row", CORPUS[100:108], ids=lambda r: f"{r['addr']:#06x}")
def test_corpus_instruction_matches_reference(row):
    mnem, length = z.decode_instruction(ROM, row["addr"], len(ROM))
    assert decode_matches(mnem, row["expected"])
    assert length == row["len"]


# === Category C: relative-branch addressing (the gotcha) ====================
# jr / djnz targets are PC-relative. They ONLY match the reference when decoded
# at the instruction's real address inside the full ROM image. Decoding the
# same bytes at pc=0 yields the wrong target. This test documents the rule.
def test_relative_jump_resolves_against_real_address():
    branches = [
        r
        for r in CORPUS
        if r["expected"].startswith(
            ("jr ", "jr,", "djnz", "jr nz", "jr z", "jr nc", "jr c")
        )
    ]
    assert branches, "expected relative branches in corpus"
    row = branches[0]
    # correct: decode at real address
    mnem, _ = z.decode_instruction(ROM, row["addr"], len(ROM))
    assert decode_matches(mnem, row["expected"])


# === Category D: ROM region helpers =========================================
@pytest.mark.parametrize(
    "addr,expected",
    [
        (0x0000, True),  # ROM0 start
        (0x07FF, True),  # ROM0 last byte
        (0x0800, False),  # RAM gap
        (0x0FFF, False),  # still gap
        (0x1000, True),  # ROM1 start
        (0x37FF, True),  # ROM5 last byte
        (0x3800, False),  # unpopulated
    ],
)
def test_is_rom_address_boundaries(addr, expected):
    assert z.is_rom_address(addr) is expected


@pytest.mark.parametrize(
    "addr,region",
    [(0x0000, "ROM0"), (0x1000, "ROM1"), (0x1800, "ROM2"), (0x3800, None)],
)
def test_get_rom_region(addr, region):
    assert z.get_rom_region(addr) == region


# === Category E: normalize_mnemonic =========================================
def test_normalize_mnemonic_lowercases_and_returns_tuple():
    assert z.normalize_mnemonic("LD", "A,B") == ("ld", "a,b")


def test_normalize_mnemonic_strips_trailing_comment():
    assert z.normalize_mnemonic("jp", "$1234   ; jump") == ("jp", "$1234")


# === Category F: parse_tunstall on a synthetic fixture ======================
# parse_tunstall skips lines before 529, so a fixture needs padding. This proves
# the parser extracts (addr, hex_bytes, mnemonic) and labels correctly.
def test_parse_tunstall_extracts_instruction(tmp_path):
    body = "\n" * 528 + "0000: 00          nop\n0001: F3          di\n"
    f = tmp_path / "mini.asm"
    f.write_text(body)
    instrs, _labels = z.parse_tunstall(str(f))
    code = [e for e in instrs if not e["is_data"]]
    assert any(e["addr"] == 0 and e["mnemonic"] == "nop" for e in code)
    assert any(e["addr"] == 1 and e["mnemonic"] == "di" for e in code)


# === Category L: aggregate real-world agreement margin ======================
# The ONLY test that tolerates mismatch. Decodes the FULL unfiltered listing at
# real addresses and asserts the agreement rate stays within the 0.5% margin.
# This honestly measures the disassembler vs Tunstall (baseline 99.87%).
RAW = _jsonl("tunstall_instructions.jsonl")


def test_full_listing_agreement_within_margin():
    matched = total = 0
    for r in RAW:
        a = r["addr"]
        if list(ROM[a : a + len(r["bytes"])]) != r["bytes"]:
            continue  # data region / non-ROM line
        total += 1
        res = z.decode_instruction(ROM, a, len(ROM))
        if res is None:
            continue
        ref = _norm((r["mnemonic"] + " " + r["operands"]).strip())
        # numeric-aware: counts "cp -2" == "cp $fe" as a match (correctness, not formatting)
        if decode_matches(res[0], ref) and res[1] == len(r["bytes"]):
            matched += 1
    rate = matched / total
    # Numeric-aware baseline is 99.91% (5288/5293). Margin floor 99.5%.
    assert rate >= 0.995, f"agreement {rate:.4%} fell below 99.5% margin"
    assert (
        rate >= 0.9991 - 0.005
    ), f"agreement {rate:.4%} regressed from 99.91% baseline"


# === Sanity: ROM image is consistent with the oracle ========================
def test_rom_image_matches_oracle_bytes():
    sample = CORPUS[0]
    assert list(ROM[sample["addr"] : sample["addr"] + sample["len"]]) == sample["bytes"]
