import { describe, expect, it } from "vitest";
import { sanitizeHtml, textContent } from "./sanitize";

describe("sanitizeHtml", () => {
  it("drops a script with everything inside it", () => {
    expect(sanitizeHtml('<p>Revenue</p><script>fetch("/steal")</script><p>grew</p>')).toBe("<p>Revenue</p><p>grew</p>");
  });

  it("drops frames, styles and anything else that escapes the block", () => {
    expect(sanitizeHtml('<iframe src="https://x"></iframe><p>ok</p>')).toBe("<p>ok</p>");
    expect(sanitizeHtml("<style>body{display:none}</style><p>ok</p>")).toBe("<p>ok</p>");
  });

  it("unwraps links but keeps the words inside them", () => {
    expect(sanitizeHtml('<p>See <a href="https://sec.gov">the filing</a>.</p>')).toBe("<p>See the filing.</p>");
  });

  it("unwraps a section so a deck's slide count stays exact", () => {
    expect(sanitizeHtml("<section><p>one</p></section>")).toBe("<p>one</p>");
  });

  it("strips event handlers, external sources and style URLs", () => {
    expect(sanitizeHtml('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeHtml('<img src="https://x/a.png">')).toBe("");
    expect(sanitizeHtml('<div style="background:url(https://x/a.png)">hi</div>')).toBe(
      "<div>hi</div>",
    );
  });

  it("keeps a style attribute that only sets colours", () => {
    expect(sanitizeHtml('<span style="color:var(--pos)">up</span>')).toBe(
      '<span style="color:var(--pos)">up</span>',
    );
  });

  it("keeps tables and inline SVG", () => {
    const table = "<table><thead><tr><th>Q</th></tr></thead><tbody><tr><td>FY26 Q2</td></tr></tbody></table>";
    expect(sanitizeHtml(table)).toBe(table);
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="var(--accent)"></circle></svg>';
    expect(sanitizeHtml(svg)).toBe(svg);
  });

  it("escapes a stray angle bracket instead of guessing a tag", () => {
    expect(sanitizeHtml("margin < 40%")).toBe("margin &lt; 40%");
  });

  it("drops comments", () => {
    expect(sanitizeHtml("<p>a</p><!-- note --><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });
});

describe("textContent", () => {
  it("returns the words a block shows, without its markup", () => {
    expect(textContent("<p>Revenue <strong>4.32B</strong></p>")).toBe("Revenue 4.32B");
  });
});
