# SPEC: 400 unit tests for the Berzerk Z80 disassembler

**Audience:** Claude Code (implementation), reviewed by Sudnya.
**Status:** ready to implement.
**Read this whole file before writing any test. Then read `MANIFEST.md` for the exact per-file counts.**

---

## 1. Goal

Produce a passing pytest unit-test suite for the Z80 disassembler (our own
custom verifier) in `scripts/z80_disasm.py`, living under `scaled_up/tests/`.
Every test must assert against the **frozen, human-verified oracle** in
`scaled_up/oracle/` — never against the disassembler's own live output, and never
against values you invent.

**Current target: the `MANIFEST.md` "Full" column (≈500 tests).** Earlier passes
(Phase 1 ≈100, then ≈400) are already implemented and green. Two things remain to
reach 500, both small:

1. **Bump two existing files** to their new Full counts by adding more cases from
   the same frozen oracle (don't rewrite, just grow the parametrize lists):
   `test_unprefixed_opcodes.py` 120 → 126, `test_corpus_regions.py` 78 → 90.
2. **Category M is already done.** `test_skoolkit_witness.py` (50, independent
   SkoolKit corroboration) is implemented and green — leave it as is.

(A few prefix categories are capped by the oracle's distinct-shape supply — the
Full targets respect that; don't force counts beyond what the oracle provides.)

Success criteria (verifiable, loop until all true):

1. `cd scaled_up && python3 -m pytest tests/ -q` collects **≥ 500 tests** and reports **0 failures, 0 errors**.
2. Counts per category match `MANIFEST.md` Full column (per-file counts within ±2 of target).
3. No test recomputes its own expected value from `z80_disasm` (see §4, Rule 1).
4. `git diff --stat` touches only files under `scaled_up/`. No edits to `scripts/`, `src/`, `cdoc/`, or `rom/`.

The **curated discrete tests** (categories A–K) run against the clean corpus, where
the disassembler already agrees 100% — they must be exactly green. **Real-world
agreement tolerance** lives only in the aggregate test (category L, §6): it runs
the full unfiltered listing and asserts the match rate stays **≥ 99.5%**. So a
discrete test failing is a genuine regression; the 0.5% margin is not a license to
let curated tests fail. Never change the oracle or weaken a curated assertion to
get green — if a curated test legitimately fails, record it per §6.

---

## 2. System under test

All functions are pure (no I/O except `parse_tunstall`, which reads a file).
Import via the provided fixtures / `conftest.py` — `import z80_disasm`.

| Function | Signature | Returns |
|---|---|---|
| `decode_instruction(rom, pc, max_addr)` | rom: bytes, pc/max_addr: int | `(mnemonic_str, byte_count)` or `None` |
| `decode_unprefixed(rom, pc, max_addr)` | " | `(str, int)` or `None` |
| `decode_cb(rom, pc, max_addr)` | " | `(str, int)` or `None` |
| `decode_ed(rom, pc, max_addr)` | " | `(str, int)` or `None` |
| `decode_dd_fd(rom, pc, max_addr, prefix)` | prefix ∈ {0xDD, 0xFD} | `(str, int)` or `None` |
| `normalize_mnemonic(mnemonic, operands)` | str, str | **tuple** `(mnemonic_lc, operands_lc)`; strips `;` comments |
| `parse_tunstall(filepath)` | str path | `(instructions: list[dict], labels: dict)` |
| `is_rom_address(addr)` | int | bool |
| `get_rom_region(addr)` | int | region name str or `None` |

`parse_tunstall` entry dict keys: `addr, hex_bytes, mnemonic, operands, line_num, is_data, label`.

### Gotchas you MUST respect (these cause spurious failures otherwise)

- **Relative branches are address-relative.** `jr` / `djnz` targets are computed
  from `pc`. Decoding the same bytes at `pc=0` gives the wrong target. Always
  decode at the instruction's **real address** inside the full ROM image
  (`rom` fixture + `row["addr"]`). This is verified: at real addresses the
  disassembler agrees with the human reference on **5,288 / 5,288** corpus rows.
- **`normalize_mnemonic` returns a tuple, not a string.** It lowercases and
  strips a trailing `;`-comment from operands. It does **not** collapse internal
  whitespace (`"A , B"` → `"a , b"`).
- **`parse_tunstall` ignores lines before line 529** (the EQU/header block). A
  synthetic fixture needs 528 leading newlines before the first code line.
- **Comparisons must use `decode_matches`, not `==`.** Import it from
  `conftest` (or `oracle_compare`). It lowercases, collapses whitespace, AND
  treats signed-decimal and hex renderings of the same value as equal
  (`cp -2` ≡ `cp $fe`, `ld hl,-24` ≡ `ld hl,$ffe8`). Plain `==` against the raw
  oracle text is fragile: the oracle stores the human's notation, which uses
  signed decimals in places the decoder renders as hex. `assert decode_matches(mnem, row["expected"])`.

---

## 3. The oracle (your only source of truth)

Generated and frozen in `scaled_up/oracle/`. Treat as read-only test data.

| File | What it is |
|---|---|
| `berzerk_flat.bin` | 16 KB flat ROM image, addressable by absolute address. Layout = `z80_disasm.ROM_REGIONS` (ROM0@0x0000, ROM1@0x1000, ROM2@0x1800, ROM3@0x2000, ROM4@0x2800, ROM5@0x3000; RAM gap 0x0800–0x0FFF; 0x3800+ unpopulated). |
| `decode_oracle.jsonl` | **5,288** clean rows: `{addr, bytes, expected, len, label}`. `expected` = normalized Tunstall reference mnemonic+operands (raw human notation, incl. signed decimals — compare with `decode_matches`). Every row verified: ROM bytes match AND disassembler agrees at the real address. |
| `opcode_shapes.jsonl` | **333** rows — one representative per distinct opcode shape (prefix-aware). Use to guarantee opcode-table breadth. Distinct shapes per prefix: unprefixed 223, CB 59, ED 16, DD 16, FD 19. |
| `labels.json` | `{ "0x..": "LABEL" }` from the reference (94 labels). |
| `tunstall_instructions.jsonl` | Raw `parse_tunstall` extraction (provenance; not needed for tests). |

These were produced by reusing the repo's own `parse_tunstall` on
`cdoc/berzerk_tunstall.asm`, then filtering to rows where the ROM bytes match and
the decoder agrees. 7 parse-noise rows (comment fragments, decimal operands) were
excluded. You do **not** need to regenerate them.

---

## 4. Hard rules

1. **No tautological tests.** Never write `assert decode(...) == decode(...)` or
   derive `expected` by calling `z80_disasm` at test time. `expected` must come
   from the oracle JSONL (which is anchored to a human's reverse-engineering).
2. **No invented Z80 semantics.** If a case isn't in the oracle, don't make one up.
   Pull cases from `decode_oracle.jsonl` / `opcode_shapes.jsonl`.
3. **Parametrize, don't copy-paste.** Use `@pytest.mark.parametrize` with rows
   loaded from the oracle. Each parametrized case counts as one test. Give each
   case a readable `id` (e.g. `f"{addr:#06x}:{expected}"`).
4. **Deterministic selection.** When sampling a subset (e.g. 80 corpus rows),
   select by a fixed rule (every Nth row, or sorted-then-sliced) so the suite is
   stable across runs. No randomness without a fixed seed.
5. **One concept per test function.** Region-helper tests don't also assert decode
   output, etc.
6. **Touch only `scaled_up/`.** Do not modify the disassembler or repo data to make
   tests pass. (CLAUDE.md §3: surgical changes.)

---

## 5. Conventions

- Framework: pytest (already configured; `tests/test_*.py`).
- Location: `scaled_up/tests/`. `scaled_up/conftest.py` already sets `sys.path`
  and provides fixtures: `z80`, `rom`, `decode_oracle`, `opcode_shapes`,
  `labels`, plus `normalize()` and `decode_matches()`.
- Run from `scaled_up/`: `python3 -m pytest tests/ -q`.
- File naming mirrors categories — see `MANIFEST.md`.
- Match the existing repo test style (`tests/test_signals.py`): module docstring,
  `from __future__ import annotations`, small helpers, plain `assert`.
- The worked patterns in `tests/test_examples.py` are canonical — **expand those,
  don't reinvent structure.** That file already passes (32 tests); keep it.

---

## 6. Real-world agreement margin & recording regressions

Two distinct mechanisms — don't conflate them:

**(a) Aggregate margin test (category L).** Write one test that loads the *full
unfiltered* listing (`oracle/tunstall_instructions.jsonl`, 5,293 rows), decodes
each at its real address (using `decode_matches`), and asserts the match rate is
**≥ 99.5%**. This honestly captures the disassembler's real agreement against
Tunstall (currently **99.91%** numeric-aware; the residual ~0.09% is 5 catalogued
non-bugs — see `FINDINGS.md` — not decode errors). The 0.5% margin lives here and
nowhere else. Also assert the rate does not *drop* below the **99.91%** baseline by
more than the margin, so a real regression is caught.

**(b) Curated discrete tests (A–K) must be exactly green.** They run on the clean
corpus where agreement is 100%. If one fails, it is either (i) a test bug — almost
always wrong addressing or un-normalized comparison, re-read §2 Gotchas; or
(ii) a genuine disassembler regression. For (ii): do **not** edit the oracle or
weaken the assertion. Append a row to `scaled_up/FINDINGS.md` (address, bytes,
expected, actual, one line of analysis) and leave the test failing so the build
goes red. A red curated test is a real signal, not noise to suppress.

---

## 7. Verification loop (do this, don't skip)

```
1. Implement one category's test file        -> verify: pytest tests/test_<cat>.py -q  (green)
2. After each file, run the whole suite       -> verify: pytest tests/ -q              (green, count rising)
3. When all files done, check the total       -> verify: pytest tests/ --collect-only -q | tail -1   (>= 500, Full column)
4. Confirm per-category counts vs MANIFEST     -> verify: pytest tests/test_<cat>.py --collect-only -q | grep -c '::'
5. Confirm scope                               -> verify: git status --short            (only scaled_up/ touched)
```

Do not report done until step 1–5 all pass. Then summarize: total count, per-file
counts, the category-L agreement rate, and the contents of `FINDINGS.md`.

---

## 8. Independent witness & how to read disagreements

The oracle is anchored to Tunstall (a human). To avoid a single source of truth —
and to avoid "Claude checking Claude" — every gold row was also disassembled by
**SkoolKit 10** (skoolkit.ca), a mature third-party Z80 disassembler unrelated to
this project or to Claude, and frozen in `oracle/skoolkit_instructions.jsonl`.
Category M (`test_skoolkit_witness.py`) asserts the decoder matches this witness.
Result on the gold set: **5,288 / 5,288 agree (100%)** across decoder, Tunstall,
and SkoolKit.

**How to read a three-way disagreement (important — do not shortcut this):**
Two implementations agreeing is *evidence, not proof*. The decoder and SkoolKit
could share a blindspot (e.g. an undocumented opcode both implement the same wrong
way, or a convention Tunstall correctly deviates from). So:

- Any disagreement among {decoder, Tunstall, SkoolKit} is a **flag for inspection**.
- The majority direction is a **hint, never a verdict**. "Decoder + SkoolKit agree,
  so Tunstall is wrong" is exactly the reasoning that hides shared errors — do not
  use it to auto-exonerate the decoder.
- Resolve a flagged row only by reading the bytes against the Z80 instruction set,
  then record the conclusion in `FINDINGS.md`. See the `0x37ca` entry there for a
  worked case where Tunstall + SkoolKit agree *against* the decoder.

The witness is frozen data; **never invoke SkoolKit from a test** — keep the suite
hermetic and deterministic.
