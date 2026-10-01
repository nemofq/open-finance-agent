import type { ReportSpec } from "./spec";

/**
 * A report built to be wider than its panel: every block that has ever pushed the page sideways,
 * read against `fixtureLedger()`. `e2e/report-layout.spec.ts` lays it out at phone and panel
 * widths and expects nothing to scroll the page horizontally.
 */

const PERIODS = ["FY24 Q3", "FY24 Q4", "FY25 Q1", "FY25 Q2", "FY25 Q3", "FY25 Q4", "FY26 Q1", "FY26 Q2", "FY26 Q3"];

export const wideReport: ReportSpec = {
  title: "$ACME — Quarterly Per-Share Results, Guidance and Event Calendar Across Nine Reporting Periods",
  template: "earnings-preview",
  sections: [
    {
      heading: "Headline figures for the period under review",
      blocks: [
        {
          type: "kpis",
          items: [
            { label: "Investor day", cell: { value: "Not available; overview of the investor day agenda was not published in any filing we hold", src: "E2" } },
            { label: "Next earnings date", cell: { value: "November 18, 2026; set by the company's own release, after the market closes", src: "E2" } },
            { label: "Diluted EPS", cell: { value: 2.22, unit: "USD/share", src: "E1", note: "fiscal second quarter, as filed" } },
            { label: "Revenue", cell: { value: 4.318, unit: "USD B", src: "E1", period: "FY26 Q2" } },
          ],
        },
        {
          type: "text",
          text: "Full detail is on the [company's investor relations events and presentations page](https://investor.acme.example/events-and-presentations/default.aspx) and in the filing index https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000012345&type=10-Q&dateb=&owner=include&count=40 for {E1:revenue:FY26 Q2}.",
        },
      ],
    },
    {
      heading: "Per-share results by quarter",
      blocks: [
        {
          type: "table",
          columns: ["Line item", ...PERIODS],
          rows: [
            ["Diluted EPS", ...PERIODS.map((_, i) => ({ value: (179 + i * 7) / 100, unit: "USD/share", src: "E1" }))],
            ["Webcast", ...PERIODS.map(() => "[replay](https://investor.acme.example/events/replay)")],
            ["Revenue", ...PERIODS.map((_, i) => ({ value: 3_883_000_000 + i * 61_000_000, unit: "USD", src: "E1" }))],
            ["Gross margin", ...PERIODS.map((_, i) => ({ value: 61.2 + i / 10, unit: "%", src: "C1" }))],
          ],
        },
        {
          type: "table",
          columns: ["Quarter", "EPS", "Estimate", "Surprise", "Revenue", "Prior", "Growth", "Margin", "Guide low", "Guide high"],
          rows: PERIODS.slice(0, 4).map((period, i) => [
            period,
            { value: 2.22 + i / 100, unit: "USD/share", src: "E1" },
            { value: 1.87, unit: "USD/share", src: "E2" },
            { value: 0.35, unit: "USD/share", src: "C1" },
            { value: 4.318, unit: "USD B", src: "E1" },
            { value: 3.883, unit: "USD B", src: "E1" },
            { value: 11.2, unit: "%", src: "C1" },
            { value: 61.4, unit: "%", src: "C1" },
            { value: 4.4, unit: "USD B", src: "A1" },
            { value: 4.6, unit: "USD B", src: "A1" },
          ]),
        },
      ],
    },
    {
      heading: "Skill layout",
      blocks: [
        {
          type: "html",
          html:
            '<div style="width:900px;white-space:nowrap;color:var(--accent)">A skill-written row that asked for a fixed width and no wrapping, which a phone-width panel cannot give it.</div>' +
            '<table><colgroup><col width="400"><col width="400"></colgroup><tbody><tr><td style="min-width:30rem">Wide column</td><td style="position:relative;left:300px">Shifted</td></tr></tbody></table>' +
            "<pre>curl https://data.acme.example/v1/series?ticker=ACME&amp;fields=revenue,eps_diluted,gross_margin,operating_margin&amp;from=2019-01-01</pre>" +
            '<svg width="900" height="120" viewBox="0 0 900 120"><rect x="0" y="0" width="900" height="120" fill="var(--surface)"></rect></svg>',
        },
        { type: "callout", tone: "neutral", text: "Supercalifragilisticexpialidocious-sized-identifier_without_any_break_opportunity_at_all_ACME_FY26_Q2_results" },
      ],
    },
  ],
};
