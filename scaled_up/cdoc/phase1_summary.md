# Phase 1 Summary — Disassembler (Berzerk)

Companion: `phase2_summary.md`. Plan: `cdoc/z80-port-plan.md` (Phase 1).
Decisions: `cdoc/decisions.md`. Tracker: `tasks/STATUS.md`.

**Milestone:** a trustworthy, machine-readable decode of the Berzerk ROM,
validated against independent external oracles, with **every ROM byte accounted
for** -- classified as opcode, operand, or explicitly-unknown -- and the unknowns
enumerated as a work list rather than left as invisible gaps. Phase 1's exit
ability per the plan: *"navigate the ROM knowing exactly which bytes are decoded
code and which are unresolved."*

**Status at write time:** **T1.1 (byte-accounting) done** and verified;
**T1.2 (coverage feedback loop) blocked by design** on Phase 4 execution traces.
So the *accounting* milestone is reached; the *resolution* of the unknown bytes
is deliberately deferred (see Section 5). Full disassembler suite:
**507 tests passing**.

> Provenance note: the disassembler and its oracle suite were built before the
> recent machine sessions; this summary is reconstructed from the artifacts
> (`disassembler/`, `cdoc/decisions.md`, `FINDINGS.md`, `MANIFEST.md`, the T1.x
> task files), not from first-hand session memory.

## 1. What Phase 1 set out to do

Produce a decode of the ROM we can *trust* -- because everything downstream (the
machine's correctness anchor, trace-driven annotation, the eventual port) rests
on knowing what each byte is. Critically, the method must generalize to games
with **no** published disassembly, so correctness is anchored to external ground
truth, not to the tool's own say-so. Berzerk's published references are used to
*grade* the method, not as a crutch.

## 2. Steps implemented

- **Z80 disassembler + dual-oracle validation** (`disassembler/`, Python +
  pytest, ~1.3k lines). The decoder is checked at real ROM addresses against a
  **frozen oracle corpus** (`oracle/decode_oracle.jsonl`, `opcode_shapes.jsonl`)
  and two independent references:
  - **Tunstall** (a human reverse-engineer's listing) -- the correctness reference;
  - **SkoolKit 10** (a mature, third-party Z80 disassembler with no connection to
    this project) -- an **independent witness** to defeat "Claude checking Claude."
- **A structured test budget** (`MANIFEST.md`): 13 categories (A-M) -- unprefixed/
  CB/ED/DD-FD opcode coverage, per-region differential spot-checks, relative-branch
  target resolution, operand formatting, region-boundary helpers, ROM integrity,
  an aggregate agreement-margin gate, and the SkoolKit witness -- sized ~150 for
  Phase 1 scaling to ~500. Expectations are pulled from the frozen oracle
  (non-tautological); only the config/parsing/string tests use hand-listed pairs.
  Actual: **507 passing**.
- **Agreement result** (`FINDINGS.md`): **5,288 / 5,293 rows = 99.91%**
  (numeric-aware comparison). On genuine instructions the decoder agrees with the
  human RE **100%**; the 5 residual rows are all explained (Section 3) and none is
  a decode error. SkoolKit independently agrees **5,288 / 5,288 = 100.000%**.
- **T1.1 -- byte-accounting audit** (`byte_accounting.py` + `coverage_report.json`).
  Walks the 6 populated ROM regions (**12,288 bytes**) and classifies each byte
  from the frozen oracle (each oracle row = 1 opcode + N-1 operand bytes):
  **opcode 5,288 / operand 3,433 / unknown 3,567**, across **161 unknown regions**,
  with **0 bytes double-classified** and none silently dropped. Seven tests assert
  the partition is complete and non-overlapping and that unknowns are enumerated.
- **T1.2 -- coverage feedback loop**: scoped and **blocked** (depends on Phase 4
  traces). The plan is to ingest execution traces, mark executed PCs as confirmed
  code, re-emit code/data-separated disassembly, and assert every traced PC lands
  on an instruction boundary; never-executed regions get reclassified.

## 3. Roadblocks hit

1. **"Claude checking Claude."** If the decoder were validated only against an
   oracle the same author produced, a shared blind spot would pass silently.
   Resolved by adding the **SkoolKit 10 independent witness** -- a common-mode
   decoder/oracle error would have surfaced as a SkoolKit disagreement; none did
   (100% on all 5,288 gold rows).
2. **Notation counted as error.** The raw agreement read 99.87% only because
   semantically identical rows (`cp -2` vs `cp $fe`) differed in
   signed-decimal-vs-hex formatting. A **width-aware comparator** fixed the metric
   to reflect correctness (99.91%), not notation.
3. **Five residual divergences vs Tunstall** -- investigated rather than waved
   away: 2 are graphics **data** the reference parser mis-captured as code; 2 are
   **truncated symbolic operands** in the reference where the decoder's literal is
   *more* correct (SkoolKit corroborates the decoder); 1 is a lone `0xDD` prefix
   byte at the ROM tail (see below).
4. **The one case the outside sources agreed *against* the tool (`0x37ca`).** A
   lone `0xDD` prefix with no following opcode: both Tunstall and SkoolKit render
   it as a data byte (`db $dd`); the decoder returns `None`. This is the case that
   disproves "tool + oracle agree, so the human is wrong" -- here the resolution
   was a **deliberate design choice**, not majority-rules (see Section 4).
5. **The fundamental limit of static analysis.** Computed jumps and inline data
   cannot be resolved by static disassembly -- which is exactly why **3,567 bytes
   remain "unknown"** and why T1.2 is **blocked on Phase 4 traces** rather than
   forced now. Guessing them as data would be unfounded.

## 4. Decisions and the trade-offs weighed

- **External oracle as ground truth (conftest principle)** vs the tool asserting
  its own correctness. Anchoring to outside references costs the upfront work of
  importing/freezing them; it buys trust that generalizes to source-less games.
  **Anchored externally.**
- **Independent third-party witness (SkoolKit)** vs single-reference validation.
  Extra integration, but it's the only thing that catches a common-mode error
  between the decoder and a same-author oracle. **Added.**
- **`None` for undecodable bytes** vs emitting a synthetic `db`. Tunstall/SkoolKit
  emit `db` because they render complete listings; this tool is a **verifier**, so
  `None` ("not an instruction, advance one byte") carries *more* information for
  the entry-point scanner. The divergence is one data byte at a ROM tail.
  **Keep `None`** -- documented as an intentional contract.
- **Classify from the frozen oracle, not a re-run linear sweep.** Avoids the
  decoder grading itself and avoids guessing data. Bytes no oracle row claims are
  **"unknown,"** not assumed-data. **Oracle-driven.**
- **Defer unknown-resolution to T1.2/Phase 4** vs forcing a static code/data split
  now. Static analysis literally cannot resolve computed jumps and inline tables;
  an honest enumerated work list of 161 unknown regions beats a wrong guess.
  **Deferred** (the coverage feedback loop closes it once traces exist).

## 5. What Phase 1 proves -- and what it doesn't

It proves the decode is **trustworthy and complete-as-accounting**: every byte of
the populated ROM is opcode, operand, or an enumerated unknown, corroborated by
two independent references, with no overlaps or silent gaps. It does **not** yet
resolve the 3,567 unknown bytes into code vs data -- that needs execution evidence
(**Phase 4 traces**, consumed by **T1.2**). The output is the foundation the rest
of the pipeline builds on: a ROM you can navigate knowing precisely what is
verified code and what is still an open question.
