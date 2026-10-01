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

  it("drops style declarations that size, place or unwrap a box, keeping colours and spacing", () => {
    expect(sanitizeHtml('<div style="width:900px;white-space:nowrap;color:var(--neg);padding:.5rem 1rem">x</div>')).toBe(
      '<div style="color:var(--neg);padding:.5rem 1rem">x</div>',
    );
    expect(sanitizeHtml('<div style="position:absolute;left:0;min-width:40rem;float:right">x</div>')).toBe("<div>x</div>");
    expect(sanitizeHtml('<div style="display:grid;grid-template-columns:repeat(6,200px)">x</div>')).toBe("<div>x</div>");
    expect(sanitizeHtml('<p style="border-left:3px solid #d1d5db;background-color:#f7f7f8">x</p>')).toBe(
      '<p style="border-left:3px solid #d1d5db;background-color:#f7f7f8">x</p>',
    );
  });

  it("keeps a font size only when it follows the report's own", () => {
    expect(sanitizeHtml('<span style="font-size:.85em">a</span>')).toBe('<span style="font-size:.85em">a</span>');
    expect(sanitizeHtml('<span style="font-size:40px">a</span>')).toBe("<span>a</span>");
  });

  it("drops spacing large enough to be layout", () => {
    expect(sanitizeHtml('<div style="padding-left:900px;margin:0 50vw">x</div>')).toBe("<div>x</div>");
  });

  it("keeps geometry on SVG elements only", () => {
    expect(sanitizeHtml('<table><colgroup><col width="400"></colgroup></table>')).toBe("<table><colgroup><col></colgroup></table>");
    expect(sanitizeHtml('<div width="900" height="40">x</div>')).toBe("<div>x</div>");
    expect(sanitizeHtml('<svg width="900" height="300" viewBox="0 0 900 300"><rect x="0" y="0" width="10" height="10"></rect></svg>')).toBe(
      '<svg width="900" height="300" viewBox="0 0 900 300"><rect x="0" y="0" width="10" height="10"></rect></svg>',
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

  it("decodes each entity once, so an escaped entity stays text", () => {
    expect(textContent("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
    expect(textContent("<p>R&amp;D &lt; 5%</p>")).toBe("R&D < 5%");
  });
});
