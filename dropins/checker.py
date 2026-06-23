#!/usr/bin/env python3
"""
LLM-as-judge fidelity checker for the Berzerk reimplementation.

Reads endpoint configuration from ~/.config/opencode/config.json, with
environment-variable fallbacks (SCALARLM_BASE_URL / SCALARLM_API_KEY /
SCALARLM_MODEL) and sensible defaults if neither is present.

Auto-discovers every docs/rubric_*.md, sends each to the model with a
strict-JSON system prompt, writes results to docs/scores.json, prints a
summary table.

Usage:
    python checker.py               # score every rubric
    python checker.py rubric_robot_ai   # score one rubric

Rubric file format (each docs/rubric_*.md must start with):
    # Rubric: <feature name>
    Files: <comma-separated list of code files relative to repo root>
    ... (body with ## Scoring section)
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from openai import OpenAI  # pip install openai>=1.0

# ---- configuration -----------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent
DOCS_DIR = REPO_ROOT / "docs"
SCORES_FILE = DOCS_DIR / "scores.json"

OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "config.json"
MAX_FILE_CHARS = 18_000  # truncate each source file before sending


def resolve_endpoint() -> tuple[str, str, str]:
    """
    Resolve (base_url, api_key, model) in order:
      1. ~/.config/opencode/config.json — the opencode source of truth
      2. environment variables SCALARLM_BASE_URL / _API_KEY / _MODEL
      3. defaults
    """
    base_url = None
    model = None
    api_key = None

    # Layer 1: opencode config
    if OPENCODE_CONFIG.exists():
        try:
            cfg = json.loads(OPENCODE_CONFIG.read_text())
            provider = (cfg.get("provider") or {}).get("scalarlm") or {}
            base_url = (provider.get("options") or {}).get("baseURL")
            full_model = cfg.get("model") or ""
            if full_model.startswith("scalarlm/"):
                model = full_model[len("scalarlm/") :]
        except (json.JSONDecodeError, OSError):
            pass

    # Layer 2: env vars override / fill gaps
    base_url = os.environ.get("SCALARLM_BASE_URL", base_url)
    api_key = os.environ.get("SCALARLM_API_KEY", api_key)
    model = os.environ.get("SCALARLM_MODEL", model)

    # Layer 3: defaults
    base_url = base_url or "http://localhost:8080/v1"
    api_key = api_key or "local-no-key-required"
    model = model or "nvidia/Gemma-4-31B-IT-NVFP4"

    return base_url, api_key, model


# ---- rubric parsing ----------------------------------------------------------


@dataclass
class Rubric:
    slug: str  # e.g. "rubric_robot_ai"
    name: str  # e.g. "Robot AI"
    files: list[str]  # paths relative to repo root
    body: str  # full markdown rubric

    @classmethod
    def from_path(cls, path: Path) -> "Rubric":
        text = path.read_text()
        name_match = re.search(r"^#\s*Rubric:\s*(.+)$", text, re.MULTILINE)
        files_match = re.search(r"^Files:\s*(.+)$", text, re.MULTILINE)
        if not name_match or not files_match:
            raise ValueError(
                f"{path.name} missing required header. "
                "First line must be '# Rubric: <name>' and there must be a 'Files: ...' line."
            )
        files = [f.strip() for f in files_match.group(1).split(",") if f.strip()]
        return cls(
            slug=path.stem,
            name=name_match.group(1).strip(),
            files=files,
            body=text,
        )


def load_rubrics(filter_slug: str | None = None) -> list[Rubric]:
    rubrics = []
    for path in sorted(DOCS_DIR.glob("rubric_*.md")):
        if filter_slug and path.stem != filter_slug:
            continue
        rubrics.append(Rubric.from_path(path))
    return rubrics


# ---- file gathering ----------------------------------------------------------


def read_source(rel_path: str) -> tuple[str, int]:
    """Returns (content, byte_count). Missing files are flagged in content."""
    path = REPO_ROOT / rel_path
    if not path.exists():
        return f"<<MISSING FILE: {rel_path} (resolved to {path})>>", 0
    text = path.read_text(errors="replace")
    byte_count = len(text)
    if byte_count > MAX_FILE_CHARS:
        text = text[:MAX_FILE_CHARS] + f"\n<<TRUNCATED after {MAX_FILE_CHARS} chars>>"
    return text, byte_count


def build_source_block(files: Iterable[str]) -> tuple[str, list[tuple[str, int]]]:
    """Returns (formatted block, list of (path, byte_count) for diagnostics)."""
    chunks = []
    diagnostics = []
    for f in files:
        content, n = read_source(f)
        diagnostics.append((f, n))
        chunks.append(f"===== FILE: {f} =====\n{content}\n")
    return "\n".join(chunks), diagnostics


# ---- LLM call ---------------------------------------------------------------

SYSTEM_PROMPT = """You are a strict code-fidelity judge. You evaluate whether a
reimplementation of a classic arcade game matches a written rubric.

You MUST respond with a single JSON object and nothing else. The object has:
  - "score": integer 1, 2, 3, or 4 (per the rubric's scoring band)
  - "justification": 2-4 sentence explanation citing specific lines or symbols
  - "evidence": list of short code excerpts (<= 5) you used to decide
  - "improvements": list of 2-3 concrete suggestions to raise the score by 1

Be conservative. If evidence for a higher band is missing, score lower.
Do not award points for comments, TODOs, or filenames alone."""

USER_TEMPLATE = """RUBRIC ({name}):
---
{rubric_body}
---

CODE UNDER REVIEW:
---
{source_block}
---

Return the JSON object now."""


def score_rubric(client: OpenAI, rubric: Rubric, model: str) -> dict:
    source_block, diagnostics = build_source_block(rubric.files)
    user = USER_TEMPLATE.format(
        name=rubric.name,
        rubric_body=rubric.body,
        source_block=source_block,
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        temperature=0.0,
        max_tokens=800,
    )
    raw = resp.choices[0].message.content or ""
    parsed = parse_json_response(raw, rubric.slug)
    parsed["_source_files"] = [{"path": p, "bytes": n} for p, n in diagnostics]
    return parsed


def parse_json_response(raw: str, slug: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return {"score": 0, "justification": f"unparseable response: {raw[:200]}"}
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            return {"score": 0, "justification": f"json error: {e}; raw={raw[:200]}"}
    obj["_slug"] = slug
    return obj


# ---- main -------------------------------------------------------------------


def main() -> int:
    if not DOCS_DIR.exists():
        print(f"docs/ not found at {DOCS_DIR}", file=sys.stderr)
        return 1

    base_url, api_key, model = resolve_endpoint()
    print(f"checker.py using baseURL={base_url} model={model}", flush=True)

    filter_slug = sys.argv[1] if len(sys.argv) > 1 else None
    rubrics = load_rubrics(filter_slug)
    if not rubrics:
        print(
            "No rubrics found. Expected files matching docs/rubric_*.md",
            file=sys.stderr,
        )
        return 1

    client = OpenAI(base_url=base_url, api_key=api_key)

    results = []
    for r in rubrics:
        print(f"[scoring] {r.slug}: {r.name} ...", flush=True)
        try:
            result = score_rubric(client, r, model)
        except Exception as e:
            result = {"_slug": r.slug, "score": 0, "justification": f"call failed: {e}"}
        result["name"] = r.name
        results.append(result)

    DOCS_DIR.mkdir(exist_ok=True)
    SCORES_FILE.write_text(json.dumps(results, indent=2))

    print()
    print(f"{'Feature':<35} {'Score':>5}  {'Source bytes':>13}")
    print("-" * 58)
    total = 0
    for r in results:
        score = r.get("score", 0) or 0
        total += score
        bytes_total = sum(f["bytes"] for f in r.get("_source_files", []))
        print(f"{r['name']:<35} {score:>5}  {bytes_total:>13}")
    avg = total / len(results) if results else 0
    print("-" * 58)
    print(f"{'AVERAGE':<35} {avg:>5.2f}")
    print(f"\nFull JSON written to {SCORES_FILE.relative_to(REPO_ROOT)}")
    print(
        "Sanity check: if 'Source bytes' is 0, the rubric's Files: line "
        "points at a path that does not exist — judge is scoring nothing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
