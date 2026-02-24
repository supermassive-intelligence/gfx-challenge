"""Tests for llm.code_cleaner.

Not tested (coverage gaps):
- extract_html: markdown fence containing non-HTML content (e.g. ```html with only plain text
  inside) -- currently falls through to case 3, not explicitly tested.
- extract_html: multiple HTML documents in one response -- behavior is to return the first
  match, but no test verifies this.
- extract_html: fence with language tag other than "html" (e.g. ```xml) -- should fall through,
  not tested.
- extract_html: <html> without closing </html> -- regex won't match, should raise ValueError,
  not tested.
- extract_html: very large input (performance) -- no test.
- validate_html_minimal: uppercase tags like <HTML>, <CANVAS>, <SCRIPT> -- the function
  lowercases before checking so these should pass, but no explicit test.
- validate_html_minimal: self-closing tags like <canvas/> -- should still match, not tested.
"""

import pytest

from llm.code_cleaner import extract_html, validate_html_minimal


class TestExtractHtml:
    def test_raw_html_doctype(self):
        raw = "<!DOCTYPE html>\n<html><head></head><body><canvas></canvas><script>x</script></body></html>"
        assert extract_html(raw) == raw

    def test_raw_html_no_doctype(self):
        raw = "<html><head></head><body>hello</body></html>"
        assert extract_html(raw) == raw

    def test_markdown_fenced_html(self):
        raw = (
            "Here is the game:\n\n"
            "```html\n"
            "<!DOCTYPE html>\n<html><body><canvas></canvas><script>x</script></body></html>\n"
            "```\n\n"
            "Enjoy!"
        )
        result = extract_html(raw)
        assert result.startswith("<!DOCTYPE html>")
        assert result.endswith("</html>")

    def test_markdown_fenced_no_lang(self):
        raw = "```\n" "<!DOCTYPE html>\n<html><body>hi</body></html>\n" "```"
        result = extract_html(raw)
        assert "<html>" in result

    def test_html_in_surrounding_text(self):
        raw = (
            "Sure, here is the asteroids game:\n\n"
            "<!DOCTYPE html>\n<html><head><title>Game</title></head>"
            "<body><canvas></canvas><script>play()</script></body></html>\n\n"
            "Let me know if you need changes."
        )
        result = extract_html(raw)
        assert result.startswith("<!DOCTYPE html>")
        assert result.endswith("</html>")

    def test_no_html_raises(self):
        with pytest.raises(ValueError, match="Could not extract HTML"):
            extract_html("This is just a plain text response with no HTML.")

    def test_whitespace_handling(self):
        raw = "\n\n  <!DOCTYPE html>\n<html><body>ok</body></html>  \n\n"
        result = extract_html(raw)
        assert result.startswith("<!DOCTYPE html>")


class TestValidateHtmlMinimal:
    def test_valid_game(self):
        html = "<html><body><canvas></canvas><script>game()</script></body></html>"
        assert validate_html_minimal(html) == []

    def test_missing_canvas(self):
        html = "<html><body><script>game()</script></body></html>"
        issues = validate_html_minimal(html)
        assert "Missing <canvas> element" in issues

    def test_missing_script(self):
        html = "<html><body><canvas></canvas></body></html>"
        issues = validate_html_minimal(html)
        assert "Missing <script> tag" in issues

    def test_missing_html(self):
        html = "<body><canvas></canvas><script>x</script></body>"
        issues = validate_html_minimal(html)
        assert "Missing <html> tag" in issues

    def test_all_missing(self):
        html = "<div>hello</div>"
        issues = validate_html_minimal(html)
        assert len(issues) == 3
