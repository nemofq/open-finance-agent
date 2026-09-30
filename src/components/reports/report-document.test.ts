import { describe, expect, it } from "vitest";
import { countSlides, reportSrcDoc } from "./report-document";

describe("reportSrcDoc", () => {
  it("wraps a body fragment in a minimal document", () => {
    const doc = reportSrcDoc("<h1>Q3</h1>", "light");
    expect(doc.startsWith("<!doctype html><html><head>")).toBe(true);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain("<body><h1>Q3</h1></body>");
    expect(doc).toContain("--report-bg:");
  });

  it("injects the style before </head> of a whole document", () => {
    const doc = reportSrcDoc(
      "<!doctype html><html><head><style>body{color:red}</style></head><body>hi</body></html>",
      "light",
    );
    expect(doc.indexOf("--report-bg:")).toBeGreaterThan(doc.indexOf("body{color:red}"));
    expect(doc.indexOf("--report-bg:")).toBeLessThan(doc.indexOf("</head>"));
    // The document is kept as-is, not re-wrapped.
    expect(doc.match(/<body>/g)).toHaveLength(1);
  });

  it("defines every variable of the contract in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const doc = reportSrcDoc("<p>x</p>", theme);
      for (const name of ["bg", "fg", "muted", "border", "surface", "accent", "positive", "negative"]) {
        expect(doc).toContain(`--report-${name}:`);
      }
      expect(doc).toContain(`color-scheme: ${theme}`);
    }
  });

  it("gives light and dark different values", () => {
    expect(reportSrcDoc("<p>x</p>", "light")).not.toEqual(reportSrcDoc("<p>x</p>", "dark"));
  });
});

describe("slide views", () => {
  const deck = "<section>one</section><section>two</section><section>three</section>";

  it("shows only the requested slide, after the theme block", () => {
    const doc = reportSrcDoc(deck, "light", { format: "slides", slide: 2 });
    expect(doc).toContain("body > section:nth-of-type(2) { display: block; }");
    expect(doc).toContain("display: none;");
    expect(doc.indexOf("nth-of-type(2)")).toBeGreaterThan(doc.indexOf("--report-bg:"));
  });

  it("lays every slide out for printing", () => {
    const doc = reportSrcDoc(deck, "light", { format: "slides", print: true });
    expect(doc).toContain("page-break-after: always;");
    expect(doc).not.toContain("nth-of-type");
  });

  it("adds no slide rules to a document", () => {
    expect(reportSrcDoc("<p>x</p>", "light", { format: "doc" })).toEqual(reportSrcDoc("<p>x</p>", "light"));
  });
});

describe("countSlides", () => {
  it("counts the top-level sections, whatever their attributes or case", () => {
    expect(countSlides("<section>a</section><SECTION class='x'>b</SECTION><section/>")).toBe(3);
  });

  it("is zero for a document with no sections", () => {
    expect(countSlides("<p>x</p>")).toBe(0);
    expect(countSlides("<div class='sectional'>x</div>")).toBe(0);
  });
});
