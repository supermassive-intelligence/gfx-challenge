"""Comparison helpers for decoder-output vs human-reference mnemonics.

The oracle stores raw Tunstall text (e.g. "cp -2"). The disassembler emits hex
(e.g. "cp $fe"). These are the SAME instruction. To measure *correctness* rather
than *formatting*, comparisons must treat numeric tokens as equal when they denote
the same value at the operand's bit width.

Keeping this logic out of the oracle (rather than rewriting the reference to hex)
preserves the oracle's independence: expected values stay as the human wrote them.
"""

from __future__ import annotations

import re

_NUM = re.compile(r"\$[0-9a-fA-F]+|-?\d+")


def normalize(s: str) -> str:
    """Lowercase + collapse internal whitespace."""
    return " ".join(s.split()).lower()


def _tokenize(s: str):
    """Return (skeleton_with_#_placeholders, [int_values]) for numeric tokens."""
    vals = []

    def repl(m):
        t = m.group(0)
        vals.append((t, int(t[1:], 16) if t.startswith("$") else int(t)))
        return "#"

    return _NUM.sub(repl, s), vals


def _num_equal(ref_tok, ref_val, got_tok, got_val) -> bool:
    if ref_val == got_val:
        return True
    # Width implied by the decoder's hex token (e.g. "$fe" -> 8 bits, "$ffe8" -> 16).
    width = (len(got_tok) - 1) * 4 if got_tok.startswith("$") else 16
    mod = 1 << width
    return (ref_val % mod) == (got_val % mod)


def decode_matches(got: str, expected: str) -> bool:
    """True iff decoder output `got` matches reference `expected`, treating
    signed-decimal and hex renderings of the same value as equal.

    Use this instead of `==` for any decoder-vs-oracle assertion.
    """
    g, e = normalize(got), normalize(expected)
    if g == e:
        return True
    g_sk, g_vals = _tokenize(g)
    e_sk, e_vals = _tokenize(e)
    if g_sk != e_sk or len(g_vals) != len(e_vals):
        return False
    return all(_num_equal(et, ev, gt, gv) for (et, ev), (gt, gv) in zip(e_vals, g_vals))
