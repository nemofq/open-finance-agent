import { describe, expect, it } from "vitest";
import { fixtureLedger } from "../ledger.fixture";
import { createLedger } from "@/lib/evidence/ledger";
import { renderReport } from "../render";
import type { ReportSpec } from "../spec";
import { validateReportSpec } from "../validate";
import { formatFormula } from "./origin";
import { FIGURES_HEADING } from "./sources";

const ledger = fixtureLedger();

const spec: ReportSpec = {
  title: "$ACME — Origins",
  sections: [
    {
      heading: "Setup",
      blocks: [
        {
          type: "table",
          columns: ["Line", "Value"],
          rows: [
            ["Revenue", { value: 4.318, unit: "USD B", src: "E1", period: "FY26 Q2" }],
            ["Growth", { value: 11.2, unit: "%", src: "C1" }],
            ["Cost of capital", { value: 8.5, unit: "%", src: "A1" }],
            ["Position", { value: 250, unit: "shares", src: "U1" }],
          ],
        },
      ],
    },
  ],
};

const doc = renderReport(spec, ledger, "doc");

/** The popover markup behind one marker, so a test can read the lines the reader sees. */
function popover(html: string, id: string): string {
  const match = new RegExp(`<sup class="src"[^>]*>${id}<span class="origin" role="tooltip">(.*?)</span></sup>`).exec(
    html,
  );
  expect(match, `no marker for ${id}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** The generated section with this heading, as rendered in the document. */
function section(html: string, heading: string): string {
  return html.split(`<h2>${heading}</h2>`)[1]?.split("</section>")[0] ?? "";
}

describe("origin popover", () => {
  it("keeps the marker focusable and titled, so a tap and the keyboard both open it", () => {
    expect(doc.html).toContain('<sup class="src" tabindex="0" title="[C1 · computed]">C1');
    expect(doc.html).not.toMatch(/<a\s/i);
    expect(doc.html).not.toMatch(/<script/i);
  });

  it("shows a computed figure's value, formula and inputs", () => {
    const box = popover(doc.html, "C1");
    expect(box).toContain('<span class="origin-head">C1 · yoy revenue growth</span>');
    expect(box).toContain('<span class="origin-value">11.2%</span>');
    expect(box).toContain('<span class="origin-formula" title="fin.growth(revenue)">= fin.growth(revenue)</span>');
    expect(box).toContain('<span class="origin-note">from E1</span>');
  });

  it("names the source, tier and as-of date of a retrieved figure, and the fact behind it", () => {
    const box = popover(doc.html, "E1");
    expect(box).toContain("E1 · SEC EDGAR · tier 1 · as of 2026-08-01");
    expect(box).toContain("EDGAR income statement");
    expect(box).toContain("revenue FY26 Q2");
  });

  it("gives an assumption its reason and a user figure its origin", () => {
    expect(popover(doc.html, "A1")).toContain("peer median cost of capital, no company disclosure");
    expect(popover(doc.html, "U1")).toContain("from your message");
  });

  it("escapes a formula and cuts a very long one", () => {
    const long = createLedger({ sessionId: "long" });
    long.add({
      kind: "C",
      summary: "Interest cover",
      name: "cover",
      value: 4,
      unit: "x",
      formula: `fin.div(ebit & "x", ${"long_input_name + ".repeat(20)}0)`,
    });
    const box = popover(
      renderReport(
        { title: "Long", sections: [{ heading: "S", blocks: [{ type: "kpis", items: [{ label: "Cover", cell: { value: 4, unit: "x", src: "C1" } }] }] }] },
        long,
        "doc",
      ).html,
      "C1",
    );
    expect(box).toContain("&amp;");
    expect(box).not.toContain('"x"');
    expect(box).toContain("…</span>");
  });

  it("hides the popover in print, and only in CSS", () => {
    const print = doc.html.split("@media print{")[1];
    expect(print).toContain(".origin{display:none!important}");
    expect(doc.html).toContain(".src:hover .origin,.src:focus-within .origin{display:block}");
    // The box itself is always in the markup; only the stylesheet decides when it shows.
    expect(doc.html.match(/class="origin"/g)?.length).toBe(4);
  });
});

describe("figures appendix", () => {
  it("lists every computed and user-provided figure once, in id order", () => {
    const figures = section(doc.html, FIGURES_HEADING);
    // Assumptions have their own generated section; listing them here too would say it twice.
    expect(figures).not.toContain("<strong>A1</strong>");
    expect(figures).toContain(
      "<strong>C1</strong> · yoy revenue growth: 11.2% — fin.growth(revenue) — from E1",
    );
    expect(figures).toContain("<strong>U1</strong> · position: 250 shares — from your message");
    expect(figures.match(/<li>/g)).toHaveLength(2);
    expect(figures.indexOf("C1")).toBeLessThan(figures.indexOf("U1"));
    expect(figures.indexOf("C1")).toBeLessThan(figures.indexOf("U1"));
  });

  it("leaves retrieved entries to Sources, and comes before it", () => {
    // E1 shows only as an input of C1, never as a line of its own.
    expect(section(doc.html, FIGURES_HEADING)).not.toContain("<strong>E1</strong>");
    expect(section(doc.html, "Sources")).toContain("<strong>E1</strong>");
    expect(doc.html.indexOf(`<h2>${FIGURES_HEADING}</h2>`)).toBeLessThan(doc.html.indexOf("<h2>Sources</h2>"));
  });

  it("continues a long list on its own slides", () => {
    const many = createLedger({ sessionId: "many" });
    for (let i = 0; i < 15; i += 1) {
      many.add({ kind: "C", summary: `Figure ${i}`, name: `figure ${i}`, value: i, unit: "%" });
    }
    const wide: ReportSpec = {
      title: "$ACME — Many",
      sections: [
        {
          heading: "All",
          blocks: [
            {
              type: "kpis",
              items: Array.from({ length: 15 }, (_, i) => ({
                label: `Figure ${i}`,
                cell: { value: i, unit: "%", src: `C${i + 1}` },
              })),
            },
          ],
        },
      ],
    };
    const deck = renderReport(wide, many, "slides");
    expect(deck.html).toContain("Figures (cont.)");
    // Title slide, the section, then twelve figures and the three that did not fit.
    expect(deck.html.match(/<section[\s>]/g)).toHaveLength(4);
  });

  it("is a heading the model cannot claim", () => {
    const result = validateReportSpec(
      { title: "$ACME — Origins", sections: [{ heading: "Setup", blocks: [{ type: "list", items: ["one"] }] }, { heading: FIGURES_HEADING, blocks: [{ type: "list", items: ["C1"] }] }] },
      ledger,
      { defaultFormat: "doc" },
    );
    expect(result.issues[0]).toMatchObject({ kind: "structure", section: FIGURES_HEADING });
  });
});

describe("formatFormula", () => {
  it("scales the magnitudes the calculator writes, and leaves the rest alone", () => {
    expect(formatFormula("yoy = (3.31839e+11 - 2.81724e+11) / |2.81724e+11|")).toBe(
      "yoy = (331.84B - 281.72B) / |281.72B|",
    );
    expect(formatFormula("cagr = (9.0007e+10/6.5585e+10)^(1/1.75) - 1")).toBe(
      "cagr = (90.01B/65.59B)^(1/1.75) - 1",
    );
    expect(formatFormula("net_margin = 65585000000 / 331839000000")).toBe("net_margin = 65.59B / 331.84B");
  });

  it("leaves a number a reader can already size, and every identifier, as written", () => {
    expect(formatFormula("0.1779")).toBe("0.1779");
    expect(formatFormula("fin.growth(revenue_q4_2026, 1.75)")).toBe("fin.growth(revenue_q4_2026, 1.75)");
    expect(formatFormula("sum(x1, x2) / 12")).toBe("sum(x1, x2) / 12");
  });
});
