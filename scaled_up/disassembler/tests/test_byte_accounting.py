"""T1.1 -- ROM byte-accounting audit.

Prove that every byte of every populated ROM region is classified exactly once
as code-opcode, code-operand, or unknown -- no gaps, no overlaps. Generating the
report (coverage_report.json) is a side effect of running this module so the
artifact stays in lockstep with the oracle.

Resolving the unknown regions is out of scope here (that is T1.2, which needs
Phase 4 traces). This test only guarantees the partition is well-formed and that
unknown bytes are enumerated, never silently dropped.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))
sys.path.insert(0, str(SCALED_UP))

import byte_accounting as ba  # noqa: E402
import z80_disasm as z  # noqa: E402

REPORT_PATH = SCALED_UP / "coverage_report.json"


@pytest.fixture(scope="module")
def report(rom, decode_oracle):
    """Build the report from frozen fixtures and persist coverage_report.json."""
    rep = ba.build_coverage_report(rom, decode_oracle)
    ba.write_report(rep, REPORT_PATH)
    return rep


def test_report_artifact_written(report):
    assert REPORT_PATH.exists()
    on_disk = json.loads(REPORT_PATH.read_text())
    assert on_disk == report


def test_no_byte_double_classified(report):
    # The whole point of the audit: a byte may not be both opcode and operand,
    # nor claimed by two instructions.
    assert report["double_classified"] == []


def test_partition_covers_every_rom_byte(report):
    # No byte missing: opcode + operand + unknown must equal the total ROM size.
    c = report["classification"]
    total = c[ba.OPCODE] + c[ba.OPERAND] + c[ba.UNKNOWN]
    assert total == report["total_rom_bytes"]
    assert report["total_rom_bytes"] == sum(e - s for s, e, _ in z.ROM_REGIONS)


def test_per_region_sums_match_overall(report):
    for region in report["per_region"]:
        rsum = region[ba.OPCODE] + region[ba.OPERAND] + region[ba.UNKNOWN]
        assert rsum == region["size"]
    for key in (ba.OPCODE, ba.OPERAND, ba.UNKNOWN):
        assert (
            sum(r[key] for r in report["per_region"]) == report["classification"][key]
        )


def test_opcode_count_matches_consumed_instructions(report):
    # Every consumed oracle row contributes exactly one opcode byte.
    assert report["classification"][ba.OPCODE] == report["instruction_count"]


def test_unknown_regions_account_for_all_unknown_bytes(report):
    # Unknown bytes are enumerated as contiguous runs, not silently dropped.
    enumerated = sum(r["size"] for r in report["unknown_regions"])
    assert enumerated == report["classification"][ba.UNKNOWN]


def test_unknown_regions_are_disjoint_and_in_rom(report):
    prev_end = None
    for run in sorted(report["unknown_regions"], key=lambda r: r["start"]):
        assert run["size"] == run["end"] - run["start"] > 0
        assert z.is_rom_address(run["start"])
        assert z.is_rom_address(run["end"] - 1)
        if prev_end is not None:
            assert run["start"] >= prev_end  # disjoint, sorted
        prev_end = run["end"]
