# scaled_up — review before handing to Claude Code

Sudnya: read this first. It's the human-facing summary of what's in this folder,
why, and exactly how to hand it off. ~5 min read.

## What you asked for

400 unit tests for the Berzerk Z80 work, written by Claude Code, without it
burning tokens or going off the rails. The risk with "go write 400 tests" is that
Claude Code invents Z80 semantics, writes tautological tests (asserting the
disassembler agrees with itself), pads to hit the number, and re-explores the
repo on every run. The fix is to do the thinking up front and hand it a closed,
verified package.

## Confirmed setup

- **Unit under test = our custom verifier/disassembler** `scripts/z80_disasm.py`
  (the hand-coded Python Z80 decoder, not a third-party tool).
- **Oracle = Scott Tunstall's hand-annotated disassembly** `cdoc/berzerk_tunstall.asm`,
  cross-checked against the real `rom/berzerk/*` bytes.
- Decisions locked in from review:
  - **Phase 1 = ≈100 tests** to validate the loop, then scale to ≈400.
  - **0.5% margin** is applied as a single aggregate test on the full listing
    (≥99.5% agreement); the discrete unit tests stay exact on the clean corpus.

## What's in this folder

| File | Purpose |
|---|---|
| `SPEC.md` | The implementation spec for Claude Code: functions under test, the gotchas, hard rules, conventions, verification loop. |
| `MANIFEST.md` | The 400-test budget — 11 files, exact counts, and which oracle each draws from. This is what stops it padding or drifting. |
| `oracle/` | **Frozen, verified ground-truth data** (see below). Read-only test data. |
| `tests/test_examples.py` | 32 real, passing example tests — one per category. Claude Code expands these patterns; it doesn't invent structure. |
| `conftest.py` | Makes the disassembler importable and exposes the oracle as fixtures. Removes import-path thrashing. |
| `FINDINGS.md` | (Created by Claude Code if it finds a real decoder bug. Should stay empty.) |

## The oracle — why this is the key artifact

Instead of letting Claude Code guess what each opcode disassembles to, I extracted
ground truth from the repo's own verified material:

- Reused `z80_disasm.parse_tunstall` on `cdoc/berzerk_tunstall.asm` to pull
  **5,293** instruction lines (addr + raw bytes + human's mnemonic).
- Built the flat 16 KB ROM image from `rom/berzerk/*.rom*` and confirmed **all
  5,293** byte ranges match the real ROM.
- Ran the disassembler over every row *at its real address*: **99.91%** agreement
  (numeric-aware — see below). The 5 residual non-matches are all parser/reference
  artifacts or one data byte, catalogued in `FINDINGS.md` — **zero** decoder bugs
  on real instructions.
- Froze the **5,288** clean, doubly-verified rows as `oracle/decode_oracle.jsonl`,
  plus one representative per distinct opcode shape (333) as `opcode_shapes.jsonl`.

> **Formatting-vs-correctness fix (later pass):** the first cut reported 99.87%
> because `cp -2` and `cp $fe` (identical 8-bit values) were counted as a mismatch
> on notation alone. `oracle_compare.decode_matches` now compares numbers
> width-aware, so the rate measures correctness. All decoder-vs-oracle assertions
> use `decode_matches`, not `==`. Verified by a mutation test: breaking one opcode
> turns the suite red; restoring it returns 432 green.

So every assertion Claude Code writes traces back to a human's reverse
engineering, double-checked against silicon. Tests can't be tautological and
expected values can't be hallucinated — they're already on disk.

Useful thing this surfaced: the disassembler is essentially **100% correct**
against the reference once you decode at real addresses. The one trap (decoding
relative `jr`/`djnz` at `pc=0` gives wrong targets) is documented in SPEC §2 so
Claude Code won't waste a loop rediscovering it.

## The allocation (summary)

| Bucket | Phase 1 | Full |
|---|--:|--:|
| Unprefixed opcode coverage | 28 | 120 |
| Differential spot-checks across all 6 ROM regions | 18 | 78 |
| CB / ED / DD-FD (IX-IY) prefixed opcodes | 22 | 85 |
| Relative-branch addressing | 6 | 30 |
| 3-byte immediate/absolute operand formatting | 4 | 20 |
| ROM region helpers (boundaries) | 8 | 20 |
| ROM integrity + entry points decode | 3 | 20 |
| `parse_tunstall` behaviors | 5 | 15 |
| `normalize_mnemonic` | 4 | 10 |
| Aggregate agreement margin (≥99.5%) | 2 | 2 |
| **Total** | **100** | **400** |

Full breakdown with per-file counts and sources in `MANIFEST.md`. Build Phase 1
first.

## How to hand this to Claude Code

In Claude Code, in this repo, point it at the spec:

> Implement the **Phase 1** test suite described in `scaled_up/SPEC.md` following
> the Phase 1 column of `scaled_up/MANIFEST.md` (≈100 tests). The oracle in
> `scaled_up/oracle/` is frozen ground truth — read it, don't regenerate it.
> Expand the patterns in `scaled_up/tests/test_examples.py`. Run
> `cd scaled_up && python3 -m pytest tests/ -q` after each file and don't stop
> until all ≈100 tests pass and only `scaled_up/` is touched.

Because the spec carries the success criteria and verification loop, Code can run
the goal-driven loop on its own (matches your CLAUDE.md §4).

## When it's done (step 3 of your loop, back in Cowork)

Bring me the result and I'll review the diff at a high level, generate release
notes from the git log, and summarize coverage for non-technical stakeholders.

## Resolved (from review)

1. Unit under test = `scripts/z80_disasm.py` (our verifier). ✓
2. Phase 1 ≈100, then scale to ≈400. ✓
3. 0.5% margin = aggregate test (≥99.5%) on the full listing; discrete unit tests
   stay exact, and a discrete failure fails the build (genuine regression). ✓
