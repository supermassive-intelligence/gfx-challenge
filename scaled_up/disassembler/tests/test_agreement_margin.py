"""Category L: aggregate real-world agreement margin (SPEC SS6a).

Decodes the FULL unfiltered listing (`tunstall_instructions.jsonl`, 5,293 rows)
at real addresses, comparing with `decode_matches` (numeric-aware: signed-decimal
and hex renderings of the same value count as equal). Asserts the match rate is
>= 99.5% and has not regressed from the 99.91% baseline by more than 0.5%.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import z80_disasm as z  # noqa: E402
from oracle_compare import decode_matches  # noqa: E402

SCALED_UP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCALED_UP.parent.parent / "scripts"))
sys.path.insert(0, str(SCALED_UP))


def test_full_listing_agreement_within_margin(rom):
    # Full unfiltered provenance listing.
    oracle_path = SCALED_UP / "oracle" / "tunstall_instructions.jsonl"
    raw_listing = [json.loads(line) for line in oracle_path.open() if line.strip()]

    matched = total = 0
    for r in raw_listing:
        a = r["addr"]
        # Only score rows whose ROM bytes match the reference (skip data lines).
        bytes_ref = r["bytes"]
        if list(rom[a : a + len(bytes_ref)]) != bytes_ref:
            continue

        total += 1
        res = z.decode_instruction(rom, a, len(rom))
        if res is None:
            continue

        ref_mnem = (r["mnemonic"] + " " + r["operands"]).strip()
        if decode_matches(res[0], ref_mnem) and res[1] == len(bytes_ref):
            matched += 1

    rate = matched / total
    # 0.5% margin lives here and nowhere else (SPEC SS6a).
    assert rate >= 0.995, f"Agreement {rate:.4%} fell below 99.5% margin"

    # Numeric-aware baseline is 99.91%; a real regression drops more than the margin.
    baseline = 0.9991
    assert rate >= (
        baseline - 0.005
    ), f"Agreement {rate:.4%} regressed too far from baseline {baseline:.4%}"
