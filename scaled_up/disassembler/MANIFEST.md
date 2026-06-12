# MANIFEST: the test budget (Phase 1 ≈100, Full ≈500)

Each row is one test **file** under `scaled_up/tests/`. Counts = number of
collected tests (parametrized cases each count as one). **Build the Phase 1
column first** (≈100 tests) to validate the loop; the Full column is the later
scale-up target. Targets are achievable from the oracle — "Available" shows the
supply you draw from. Hit each target ±2.

| # | File | Category | Phase 1 | Full | Oracle source | Available |
|---|---|---|--:|--:|---|---|
| A | `test_unprefixed_opcodes.py` | Unprefixed opcode coverage — decode each distinct unprefixed shape at its real address; assert `(mnemonic, len)` == oracle. | 28 | 126 | `opcode_shapes.jsonl` (filter `bytes[0] not in {CB,ED,DD,FD}`) + fill from `decode_oracle.jsonl` | 223 distinct shapes |
| B | `test_cb_prefixed.py` | CB-prefix rotates/shifts/bit ops (`rlc,rr,sla,bit,res,set,...`). | 8 | 35 | `opcode_shapes.jsonl` where `bytes[0]==0xCB` (+ corpus instances) | 59 distinct / 130 instances |
| C | `test_ed_prefixed.py` | ED-prefix (`ldir,lddr,neg,im,in/out (c),sbc hl,...`). | 6 | 20 | `bytes[0]==0xED` | 16 distinct / 70 instances |
| D | `test_ix_iy_indexed.py` | DD/FD (IX/IY) incl. `(ix+d)` / `(iy+d)` and DDCB/FDCB. | 8 | 30 | `bytes[0] in {0xDD,0xFD}` and rows with `(ix`/`(iy` | 35 distinct / 129 indexed instances |
| E | `test_corpus_regions.py` | Differential spot-checks spread across all 6 ROM regions (deterministic stride sample). | 18 | 90 | `decode_oracle.jsonl`, grouped by `get_rom_region(addr)` | 5,288 rows (≈800–970/region) |
| F | `test_relative_branches.py` | `jr` / `djnz` target resolution at real address (the §2 gotcha). | 6 | 30 | `decode_oracle.jsonl` where mnemonic ∈ {`jr`,`djnz`} | 392 instances |
| G | `test_operand_formatting.py` | 3-byte immediate / absolute operands: `ld rr,nn`, `(nn)`, `jp/call nn`. Assert operand text formatting. | 4 | 20 | `decode_oracle.jsonl` where `len==3` | 1,123 instances |
| H | `test_region_helpers.py` | `is_rom_address` + `get_rom_region` at every region boundary and gap (off-by-one edges). | 8 | 20 | `z80_disasm.ROM_REGIONS` (hand-listed boundary table — config, not Z80 semantics) | n/a |
| I | `test_parse_tunstall.py` | `parse_tunstall` on small synthetic fixtures: code line, data line (≥5 bytes), label capture, comment/`< line 529` skipping, addr/hex parsing. | 5 | 15 | synthetic fixtures written in-test (`tmp_path`) | n/a |
| J | `test_normalize_mnemonic.py` | tuple return, lowercasing, `;`-comment stripping, empty operands, whitespace handling. | 4 | 10 | hand-listed input/expected pairs (pure string fn) | n/a |
| K | `test_rom_integrity.py` | ROM image vs oracle bytes; subroutine entry points decode to non-`None`; entry-point bytes match ROM. | 3 | 20 | `decode_oracle.jsonl` + `cdoc/subroutine_entry_points.txt` | 117 entry points |
| L | `test_agreement_margin.py` | **Aggregate margin (§6a):** decode the full unfiltered listing at real addresses (via `decode_matches`); assert match rate **≥ 99.5%** and not regressed from the 99.91% baseline by more than the margin. | 2 | 2 | `tunstall_instructions.jsonl` (all 5,293 rows) | full listing |
| M | `test_skoolkit_witness.py` | **Independent-witness corroboration (§8):** decoder must match the frozen SkoolKit 10 disassembly on rows sampled across all 6 regions. Turns "Claude checking Claude" into corroboration by an outside implementation. **Already implemented & green (50).** | 50 | 50 | `skoolkit_instructions.jsonl` (5,288 third-party rows) | full witness |
| | | **TOTAL** | **150** | **500** | | |

## Notes on categories H, I, J

These three (45 tests) are the only ones whose expected values are **not** pulled
from the JSONL oracle, because they test config/parsing/string logic rather than
Z80 decode semantics. Their expectations are still concrete and non-tautological:

- **H** boundaries come directly from `ROM_REGIONS` (a fixed table in the source).
  Enumerate: each region start, each region last byte (`end-1`), each gap byte,
  `0x3800` (unpopulated), and `0x4000` (out of range).
- **I** uses tiny hand-written `.asm` fixtures (remember the 528-line skip) with
  obvious expected parses.
- **J** uses hand-listed `(mnemonic, operands) -> (lc, lc)` pairs.

Everything in A–G, K and L is anchored to the frozen oracle.

Category **L** is the only test that tolerates mismatch (≥99.5% aggregate, per
SPEC §6a). All A–K tests are exact pass/fail on the clean corpus.

## Build order (cheapest verification first)

J → H → I → L → K → F → C → B → D → G → A → E.
Run the full suite after each file. Stop and re-read SPEC §2 if any A–K test
fails — it's almost always an addressing or normalization mistake, not a real bug.
