import { describe, expect, it } from "vitest";
import { fixtureLedger } from "./ledger.fixture";
import { renderReport } from "./render";
import { niceTicks } from "./render/blocks";
import { MAX_TABLE_ROWS_PER_SLIDE, slideGroups } from "./render/slides";
import type { ReportSpec } from "./spec";

const ledger = fixtureLedger();

const spec: ReportSpec = {
  title: "$ACME — Earnings Preview: FY26 Q3",
  template: "earnings-preview",
  sections: [
    {
      heading: "Setup",
      blocks: [
        { type: "kpis", items: [{ label: "Last price", cell: { value: 214.6, unit: "USD", src: "E3" } }] },
        { type: "text", text: "Revenue reached {E1:revenue:FY26 Q2}, up {C1} on the year." },
      ],
    },
    {
      heading: "Expectations",
      blocks: [
        {
          type: "table",
          key: true,
          columns: ["Line", "Consensus", "Prior year"],
          rows: [
            ["EPS (adjusted)", { value: 1.87, unit: "USD/share", src: "E2" }, { value: 1.79, unit: "USD/share", src: "E1" }],
            ["Revenue", { value: 4.318, unit: "USD B", src: "E1", period: "FY26 Q2" }, "not available"],
          ],
        },
        {
          type: "chart",
          kind: "bar",
          unit: "USD",
          series: [
            {
              name: "Revenue",
              points: [
                { x: "FY25 Q2", y: { value: 3_883_000_000, src: "E1" } },
                { x: "FY26 Q2", y: { value: 4_318_000_000, src: "E1" } },
              ],
            },
          ],
        },
      ],
    },
    {
      heading: "Stance",
      blocks: [
        { type: "callout", tone: "neutral", text: "A cost of capital of {A1} leaves the setup balanced." },
        { type: "html", html: '<p>Position of <strong>{U1}</strong>.</p><script>alert(1)</script>' },
      ],
    },
  ],
};

const doc = renderReport(spec, ledger, "doc");
const slides = renderReport(spec, ledger, "slides");

describe("renderReport", () => {
  it("builds a self-contained document with one inline stylesheet and no scripts", () => {
    expect(doc.html.startsWith("<!doctype html>")).toBe(true);
    expect(doc.html).toContain("</head>");
    expect(doc.html).not.toMatch(/<script/i);
    expect(doc.html).not.toMatch(/https?:\/\//);
    expect(doc.html.match(/<style>/g)).toHaveLength(1);
    expect(doc.html).toContain("--report-bg");
    expect(doc.html).toContain("@media print");
  });

  it("prints every figure from the ledger, in both formats", () => {
    for (const { html } of [doc, slides]) {
      expect(html).toContain("USD 214.60");
      expect(html).toContain("USD 4.32B");
      expect(html).toContain("USD 1.87 per share");
      expect(html).toContain("11.2%");
      expect(html).toContain("8.5%");
      expect(html).toContain("250 shares");
    }
  });

  it("tags each figure with the entry behind it", () => {
    expect(doc.html).toContain(
      '<sup class="src" tabindex="0" title="[E1 · SEC EDGAR · tier 1 · as of 2026-08-01 · 3 facts] · FY26 Q2">E1',
    );
    expect(doc.figures).toEqual(["E3", "E1", "C1", "E2", "A1", "U1"]);
    expect(slides.figures).toEqual(doc.figures);
  });

  it("generates the figures, sources, assumptions and disclaimer sections", () => {
    for (const { html } of [doc, slides]) {
      expect(html).toContain("Figures");
      expect(html).toContain("yoy revenue growth: 11.2% — fin.growth(revenue) — from E1");
      expect(html).toContain("Sources");
      expect(html).toContain("SEC EDGAR · tier 1 · as of 2026-08-01");
      expect(html).toContain("Assumptions");
      expect(html).toContain("peer median cost of capital");
      expect(html).toContain("Not investment advice");
    }
  });

  it("draws a chart in percent coordinates, with every label in HTML beside it", () => {
    expect(doc.html).toContain('<svg viewBox="0 0 100 100" preserveAspectRatio="none"');
    expect(doc.html).toContain("<rect ");
    // No text in the SVG, and no stroke that the stretch to the column could thicken.
    expect(doc.html).not.toMatch(/<text[\s>]/);
    expect(doc.html).not.toMatch(/<line(?![^>]*vector-effect="non-scaling-stroke")/);
    expect(doc.html).toMatch(/<span class="ytick" style="top:0\.00%">USD 5B<\/span>/);
    expect(doc.html).toContain('<div class="xaxis"><span>FY25 Q2</span><span>FY26 Q2</span></div>');
  });

  it("emphasises a key table and keeps string cells as written", () => {
    expect(doc.html).toContain('<table class="key">');
    expect(doc.html).toContain("<td>not available</td>");
  });

  it("sanitizes an html block but still fills its references in", () => {
    expect(doc.html).toContain('<p>Position of <strong><span class="fig">250 shares');
    expect(doc.html).not.toContain("alert(1)");
  });

  it("lays a document out as sections and a deck as top-level slides", () => {
    expect(doc.html).toContain('<body class="doc">');
    expect(slides.html).toContain('<body class="deck">');
    expect(slides.html).toContain('<section class="title-slide">');
    // Title slide, three sections, then Figures, Sources and Assumptions.
    expect(slides.html.match(/<section[\s>]/g)).toHaveLength(7);
  });
});

describe("slide splitting", () => {
  const rows = Array.from({ length: 30 }, (_, i) => [`FY${i}`, { value: 11.2, unit: "%", src: "C1" }]);
  const long: ReportSpec = {
    title: "$ACME — History",
    sections: [{ heading: "Quarters", blocks: [{ type: "table", columns: ["Quarter", "Growth"], rows }] }],
  };

  it("continues a long table on its own slides", () => {
    const groups = slideGroups(long.sections[0]);
    expect(groups).toHaveLength(Math.ceil(30 / MAX_TABLE_ROWS_PER_SLIDE));

    const deck = renderReport(long, ledger, "slides");
    expect(deck.html).toContain("Quarters (cont.)");
    // Title slide, three table slides, Figures, and the source behind the computed entry.
    expect(deck.html.match(/<section[\s>]/g)).toHaveLength(6);
    expect(deck.html.match(/<tbody>/g)).toHaveLength(3);
  });

  it("keeps the same rows in the document, in one table", () => {
    const page = renderReport(long, ledger, "doc");
    expect(page.html.match(/<tbody>/g)).toHaveLength(1);
    expect(page.html.match(/<tr>/g)).toHaveLength(31);
  });
});

describe("niceTicks", () => {
  it("covers the range in three to six rounded steps", () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 4.318e9)).toEqual([0, 1e9, 2e9, 3e9, 4e9, 5e9]);
    expect(niceTicks(11.8, 24.2)).toEqual([10, 15, 20, 25]);
    expect(niceTicks(-3.2, 8.4)).toEqual([-5, 0, 5, 10]);
    expect(niceTicks(0.11, 0.37)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("never leaves a tick with a floating-point tail, and survives a flat range", () => {
    expect(niceTicks(0, 17.5).every((tick) => `${tick}`.length <= 4)).toBe(true);
    expect(niceTicks(5, 5)).toEqual([5, 6]);
  });
});

/** The shape of a real peer report: notes on KPIs, a wide table, a line chart far from zero. */
const quarters = ["Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26", "Q2'26"];
const acme = [16, 12.3, 13.3, 18.1, 18.4, 16.7, 18.3, 17.7];
const beta = [15.1, 11.8, 12, 13.8, 15.9, 18, 21.8, 24.2];
const revenue = [65.59, 69.63, 70.07, 76.44, 77.67, 81.27, 82.89, 90.01];

const peer: ReportSpec = {
  title: "$ACME vs $BETA — Revenue Growth, Last 8 Quarters",
  sections: [
    {
      heading: "Peer set",
      blocks: [
        {
          type: "text",
          text: "Both are SEC filers and the figures below come from each company's own XBRL facts [E1], through the period ending 2026-06-30 [E2]. A citation we do not hold, [E9], stays as written.",
        },
        {
          type: "kpis",
          items: [
            {
              label: "$ACME TTM revenue",
              cell: { value: 331.839, unit: "USD B", src: "C1", note: "sum of last 4 quarters, derived" },
            },
            { label: "$ACME TTM revenue YoY", cell: { value: 17.79, unit: "%", src: "C1", note: "derived" } },
            { label: "$BETA TTM revenue YoY", cell: { value: 20.05, unit: "%", src: "C1", note: "derived" } },
          ],
        },
      ],
    },
    {
      heading: "Comparison",
      blocks: [
        {
          type: "table",
          columns: ["Quarter end", "$ACME revenue", "$ACME YoY", "$BETA revenue", "$BETA YoY"],
          rows: quarters.map((quarter, index) => [
            quarter,
            { value: revenue[index], unit: "USD B", src: "E1" },
            { value: acme[index], unit: "%", src: "E1" },
            { value: revenue[index] * 1.33, unit: "USD B", src: "E2" },
            { value: beta[index], unit: "%", src: "E2" },
          ]),
        },
        {
          type: "chart",
          kind: "line",
          unit: "%",
          series: [
            { name: "$ACME revenue YoY", points: quarters.map((x, i) => ({ x, y: { value: acme[i], unit: "%", src: "E1" } })) },
            { name: "$BETA revenue YoY", points: quarters.map((x, i) => ({ x, y: { value: beta[i], unit: "%", src: "E2" } })) },
          ],
        },
      ],
    },
    {
      heading: "Read-through",
      blocks: [
        { type: "text", text: "$BETA is accelerating while $ACME holds a mid-teens band [E1]." },
        { type: "callout", tone: "neutral", text: "The gap has been stable [E2]; cost of capital is {A1}." },
      ],
    },
  ],
};

const report = renderReport(peer, ledger, "doc");

describe("a peer report", () => {
  it("starts a line chart's axis near its data, never at zero", () => {
    const ticks = [...report.html.matchAll(/<span class="ytick"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(ticks).toEqual(["10%", "15%", "20%", "25%"]);
  });

  it("labels every category once, with the legend above the plot", () => {
    expect(report.html).toContain("<span>Q3'24</span>");
    expect(report.html.indexOf('class="chart-legend"')).toBeLessThan(report.html.indexOf('class="plot"'));
    expect(report.html.match(/<div class="xaxis">.*?<\/div>/)?.[0].match(/<span>/g)).toHaveLength(8);
  });

  it("right-aligns the columns that hold only figures", () => {
    expect(report.html).toContain('<th>Quarter end</th><th class="num">$ACME revenue</th>');
    expect(report.html).toContain(`<td>Q3'24</td><td class="num">`);
  });

  it("turns a bracketed citation into the marker a reference would have got", () => {
    expect(report.html).toContain('XBRL facts<sup class="src" tabindex="0" title="[E1');
    expect(report.html).toContain("2026-06-30<sup");
    // An id the ledger does not hold is the model's text, not a reference.
    expect(report.html).toContain("A citation we do not hold, [E9], stays as written.");
    expect(report.figures).toContain("E2");
    expect(report.html).toContain("<strong>E2</strong>");
  });

  it("drops a KPI note onto its own line", () => {
    expect(report.html).toContain(
      '.kpi-value .note{display:block;margin-top:.2rem;margin-left:0;font-size:.8rem;font-weight:400}',
    );
    expect(report.html).toContain('<span class="note">sum of last 4 quarters, derived</span>');
  });
});
