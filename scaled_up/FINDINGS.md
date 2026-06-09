# FINDINGS

Catalogue of every place the disassembler's output diverges from the Tunstall
reference on the full listing, after numeric-formatting normalization. **None of
these are decoder correctness bugs on real instructions.** Recorded here for
transparency so the agreement metric is not a black box.

## Agreement rate

- ROM-byte-matched rows tested: **5,293**
- Correctness matches (numeric-aware): **5,288** → **99.91%**
- Residual divergences: **5** (all explained below; none is an instruction-decode error)

Before normalization the rate read 99.87%, because two semantically identical rows
(`cp -2` vs `cp $fe`) were counted as mismatches purely on signed-decimal-vs-hex
formatting. The width-aware comparator in `oracle_compare.decode_matches` now treats
those as equal, so the metric reflects correctness rather than notation.

## The 5 residual divergences

| Addr | Tunstall text | Decoder | Why it's not a decoder bug |
|---|---|---|---|
| `0x601` | `(hatch pattern)` | `ld a,a` | Graphics **data** region. `parse_tunstall` captured a comment fragment as a "mnemonic"; there is no instruction here. Parser artifact, not decoder. |
| `0x603` | `0.` | `jr nc,$0605` | Same data region; reference text is a stray comment token. |
| `0x1e5e` | `ld hl,` | `ld hl,$ffe8` | Reference operand is a **symbolic label** that the parser truncated. The decoder emits the correct literal immediate. Decoder is the accurate side. |
| `0x27bc` | `ld de,` | `ld de,$fffa` | Same: truncated symbolic operand in the reference; decoder literal is correct. |
| `0x37ca` | `db $dd` | `<None>` | A lone `0xDD` prefix byte at the ROM tail (`0x37ca`, near `0x37ff`) with no following opcode. Tunstall correctly labels it **data** (`db $dd`); the decoder returns `None` on a truncated prefix. Edge-case behavior on a non-instruction byte, covered intentionally in `test_rom_integrity.py`. |

## Interpretation

- 2 rows (`0x601`, `0x603`) are data mis-classified as code by the parser.
- 2 rows (`0x1e5e`, `0x27bc`) are reference-text deficiencies where the decoder is
  more literally correct.
- 1 row (`0x37ca`) is a real decoder behavior difference — see below.

So on genuine instructions the decoder agrees with the human reverse-engineer
**100%**. The 99.91% figure is dragged below 100% only by parser/reference
artifacts and one data byte — not by any decode error.

## Independent third-party corroboration (SkoolKit 10)

To avoid "Claude checking Claude," every gold row was also disassembled by
**SkoolKit 10** (skoolkit.ca) — a mature, independently authored Z80 disassembler
with no connection to this project or to Claude. Result:

- **5,288 / 5,288 gold rows: SkoolKit agrees with both the decoder and Tunstall (100.000%).**
  A common-mode error shared between the decoder and the Claude-built oracle would
  have surfaced here. None did.

On the residual rows, SkoolKit acts as a tie-breaker:

| Addr | Tunstall | decoder | SkoolKit | Reading |
|---|---|---|---|---|
| `0x601` | `(hatch pattern)` | `ld a,a` | `ld a,a` | data byte; decoder corroborated |
| `0x603` | `0.` | `jr nc,$0605` | `jr nc,$0605` | data byte; decoder corroborated |
| `0x1e5e` | `ld hl,` | `ld hl,$ffe8` | `ld hl,$ffe8` | truncated Tunstall operand; decoder corroborated |
| `0x27bc` | `ld de,` | `ld de,$fffa` | `ld de,$fffa` | truncated Tunstall operand; decoder corroborated |
| `0x37ca` | `db $dd` | `<None>` | `defb $dd` | **Tunstall + SkoolKit agree; decoder is the dissenter** |

### RESOLVED (by design): decoder returns `None` for undecodable bytes — `0x37ca`

A lone `0xDD` prefix byte sits in a data region with no valid following opcode.
Both Tunstall and the independent SkoolKit disassembler emit it as a **data byte**
(`db`/`defb $dd`); our decoder returns `None`. Across the whole ROM, **21
addresses decode to `None`** (11 are orphan `DD`/`FD` prefixes), all in data
regions.

**Decision (maintainer): keep `None`. No code change.**

Rationale: `z80_disasm.py` is a *verifier*, not a listing generator. `None` is a
used, meaningful signal — the entry-point scanner (`main()`, ~line 945) treats it
as "not an instruction, advance one byte." Tunstall and SkoolKit emit `db` because
their job is to render a complete listing where every byte must appear as
something; this tool's job is to find real code and flag what isn't, and for that
`None` carries more information than a synthetic `db`. The divergence is one data
byte at a ROM tail with no effect on any real instruction or entry point.

Contract, now intentional: `decode_instruction` returns `(mnemonic, length)` for a
decodable instruction and `None` for a byte that is not the start of one
(typically data). Callers must handle `None` (the existing ones do).

Methodological note worth keeping: this row is also the case that disproves
"decoder + tool agree, so the human is wrong" — here the two *outside* sources
(Tunstall + SkoolKit) agree *against* the decoder, and the resolution was a
deliberate design choice, not an assumption that the majority is correct.
