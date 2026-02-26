"""Extract clean HTML from LLM responses that may contain markdown fences or commentary.

LLMs are inconsistent in how they return HTML. Sometimes they output raw HTML starting with
<!DOCTYPE html>, sometimes they wrap it in markdown code fences (```html ... ```), and
sometimes they embed it in explanatory prose. This module handles all three cases and
provides a minimal validation check to ensure the output looks like a playable game.
"""

import re


def extract_html(raw_response: str) -> str:
    """Extract a complete HTML document from an LLM response.

    Tries extraction strategies in order of likelihood:
    1. Raw HTML -- response starts directly with <!DOCTYPE or <html
    2. Markdown code fences -- HTML inside ```html ... ``` or ``` ... ```
    3. Embedded HTML -- <!DOCTYPE html>...</html> buried in surrounding text
    4. Bare <html> -- same as 3 but without the DOCTYPE prefix

    Raises ValueError if no HTML document can be found.
    """
    stripped = raw_response.strip()

    # Case 1: Response is already raw HTML (most common when the prompt asks for
    # "only the HTML file" and the model complies)
    if stripped.lower().startswith("<!doctype") or stripped.lower().startswith("<html"):
        return stripped

    # Case 2: HTML in markdown code fences (```html ... ``` or ``` ... ```)
    # The model sometimes wraps output in fences despite being told not to.
    # We require the fenced content to actually contain <html or <!doctype
    # to avoid extracting non-HTML fenced blocks.
    fence_pattern = re.compile(r"```(?:html)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
    fence_match = fence_pattern.search(stripped)
    if fence_match:
        candidate = fence_match.group(1).strip()
        if "<html" in candidate.lower() or "<!doctype" in candidate.lower():
            return candidate

    # Case 3: HTML document embedded in prose text. Use a non-greedy match from
    # <!DOCTYPE html...> through the first </html>. This handles responses like
    # "Sure, here is the game: <!DOCTYPE html>.....</html> Let me know..."
    html_pattern = re.compile(
        r"(<!DOCTYPE\s+html[^>]*>.*?</html>)", re.DOTALL | re.IGNORECASE
    )
    html_match = html_pattern.search(stripped)
    if html_match:
        return html_match.group(1).strip()

    # Case 4: Same as case 3 but the model omitted the DOCTYPE declaration.
    # Less ideal but still recoverable.
    simple_pattern = re.compile(r"(<html[^>]*>.*?</html>)", re.DOTALL | re.IGNORECASE)
    simple_match = simple_pattern.search(stripped)
    if simple_match:
        return simple_match.group(1).strip()

    # None of the strategies found valid HTML
    raise ValueError(
        "Could not extract HTML from LLM response. "
        f"Response starts with: {stripped[:200]!r}"
    )


def validate_html_minimal(html: str) -> list[str]:
    """Check that the extracted HTML has the minimum structure for a canvas game.

    Returns a list of issue strings. An empty list means the HTML passed all checks.
    This is intentionally minimal -- it only verifies the presence of required tags,
    not correctness of the game logic. The goal is to catch obvious LLM failures
    (e.g. returning a text explanation instead of a game) before launching a container.
    """
    issues = []
    lower = html.lower()
    if "<html" not in lower:
        issues.append("Missing <html> tag")
    if "<canvas" not in lower:
        issues.append("Missing <canvas> element")
    if "<script" not in lower:
        issues.append("Missing <script> tag")
    return issues
