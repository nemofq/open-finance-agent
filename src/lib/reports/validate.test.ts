import { describe, expect, it } from "vitest";
import type { ReportSection, ReportSpec } from "./spec";
import { renderReport } from "./render";
import { fixtureLedger } from "./ledger.fixture";
import { templateById } from "./templates";
import { formatIssues, issueNotes, validateReportSpec, MAX_SECTIONS } from "./validate";

const ledger = fixtureLedger();

const section = (heading: string, blocks: ReportSection["blocks"]): ReportSection => ({ heading, blocks });

const baseSpec = (sections: ReportSection[]): ReportSpec => ({
  title: "$ACME — Earnings Preview: FY26 Q3",
  sections,
});

const check = (spec: ReportSpec, template?: string) =>
  validateReportSpec(spec, ledger, { defaultFormat: "doc", template: templateById(template) });

describe("validateReportSpec", () => {
  it("validates and renders the exact calculated series label in cells and prose", () => {
    const source = fixtureLedger();
    const label = "Plan: reserve | then invest: +5%";
    const entry = source.add({ kind: "C", summary: "Scenario balance", unit: "USD", table: {
      columns: ["label", "value"], index: "label", rows: [[label, 7000]],
    } });
    const ref = `${entry.id}:${label}`;
    const report = baseSpec([section("Scenario", [
      { type: "text", text: `Ending balance: {${ref}}.` },
      { type: "kpis", items: [{ label: "Ending balance", cell: { ref, value: "", src: "" } }] },
    ])]);
    const result = validateReportSpec(report, source, { defaultFormat: "doc" });
    expect(result.issues).toEqual([]);
    if (!result.spec) return;
    const rendered = renderReport(result.spec, source, "doc");
    expect(rendered.html.match(/USD 7,000/g)).toHaveLength(2);
    expect(rendered.figures).toEqual([entry.id]);
    report.sections[0].blocks = [{ type: "text", text: `Ending balance: {${entry.id}:Plan:reserve | then invest: +5%}.` }];
    expect(validateReportSpec(report, source, { defaultFormat: "doc" }).issues).not.toEqual([]);
  });

  it("distinguishes an ambiguous wrong citation from a value missing from the ledger", () => {
    const source = fixtureLedger();
    const copy = source.add({ kind: "E", summary: "Revenue restated", value: 4.32e9, unit: "USD" });
    const report = baseSpec([section("Revenue", [{ type: "text", text: "Revenue was $4.32B [C1]." }])]);
    const result = validateReportSpec(report, source, { defaultFormat: "doc" });
    expect(result.issues).not.toEqual([]);
    expect(formatIssues(result.issues)).toContain(`Equal values appear in E1, ${copy.id}`);
    expect(formatIssues(result.issues)).not.toContain("compute it with the calculator first");
    expect(report.sections[0].blocks[0]).toMatchObject({ text: "Revenue was $4.32B [C1]." });
  });

  it("corrects a citation when exactly one other entry holds the value, and says so", () => {
    const report = baseSpec([section("Revenue", [
      { type: "text", text: "Revenue was $4.32B [C1]; growth was {C1}." },
      { type: "list", items: ["Revenue $4.32B [C1]"] },
      { type: "kpis", items: [{ label: "Revenue", cell: { value: 4.32, unit: "USD B", src: "C1" } }] },
    ])]);
    const result = check(report);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["repaired", "repaired", "repaired"]);
    expect(issueNotes(result.issues)[0]).toContain("citation corrected to E1");
    const [text, list, kpis] = result.spec?.sections[0].blocks ?? [];
    expect(text).toMatchObject({ text: "Revenue was $4.32B [E1]; growth was {C1}." });
    expect(list).toMatchObject({ items: ["Revenue $4.32B [E1]"] });
    expect(kpis).toMatchObject({ items: [{ cell: { src: "E1" } }] });
  });

  it("never rewrites a citation another figure on the line relies on", () => {
    const text = "Revenue was $4.32B and price USD 214.60 [E3].";
    const result = check(baseSpec([section("Revenue", [{ type: "text", text }])]));
    expect(result.issues.map((issue) => issue.kind)).toEqual(["values"]);
    expect(result.spec?.sections[0].blocks[0]).toMatchObject({ text });
  });

  it("reads a prose number without its own unit in its entry's unit, as the ledger does", () => {
    const source = fixtureLedger();
    const release = source.add({ kind: "E", summary: "Press release", unit: "USD", numbers: [{ value: 12.5, context: "Dividend of 12.5 per share." }] });
    const cited = (unit: string) => validateReportSpec(baseSpec([section("Dividend", [
      { type: "kpis", items: [{ label: "Dividend", cell: { value: 12.5, unit, src: release.id } }] },
    ])]), source, { defaultFormat: "doc" });

    expect(cited("USD").issues).toEqual([]);
    const euros = cited("EUR");
    expect(euros.issues.map((issue) => issue.kind)).toEqual(["values"]);
  });

  it("checks a cited metric and period, not another equal number in the same source", () => {
    const source = fixtureLedger();
    const e = source.add({ kind: "E", summary: "Two periods", facts: [
      { metric: "revenue", period: "2024-06-30", value: 100, unit: "USD" },
      { metric: "netIncome", period: "2024-06-30", value: 20, unit: "USD" },
      { metric: "netIncome", period: "2024-03-31", value: 100, unit: "USD" },
    ] });
    const report = baseSpec([section("Facts", [{ type: "kpis", items: [{ label: "Net income",
      cell: { value: 100, unit: "USD", src: e.id, metric: "netIncome", period: "2024-06-30" } }] }])]);
    const result = validateReportSpec(report, source, { defaultFormat: "doc" });
    expect(result.issues).not.toEqual([]);
    expect(result.issues[0]).toMatchObject({ kind: "values", section: "Facts", location: 'kpi "Net income"' });
  });

  it("blocks reference cells whose source was unavailable at the cutoff", () => {
    const source = fixtureLedger();
    source.get("C1")!.lookAhead = true;
    const report = baseSpec([section("Facts", [{ type: "kpis", items: [{ label: "Growth", cell: { ref: "C1", value: "", src: "" } }] }])]);
    expect(validateReportSpec(report, source, { defaultFormat: "doc" }).issues).not.toEqual([]);
  });
  it("summarizes the outcome of every figure-bearing surface it checked", () => {
    const result = check(baseSpec([section("Findings", [
      { type: "text", text: "Revenue was $4.32B [E1]; margin was {C9}." },
      { type: "kpis", items: [
        { label: "Last price", cell: { value: 512.4, unit: "USD", src: "E3" } },
        { label: "Prior price", cell: { value: 214.6, unit: "USD", src: "" } },
      ] },
    ])]));
    expect(result.issues.map((issue) => issue.kind).sort()).toEqual(["references", "sources", "values"]);
    expect(result.verification).toEqual({
      checked: 4, supported: 1, repaired: 0, unverified: 3,
      byKind: { values: 1, sources: 1, references: 1, structure: 0 },
    });
  });

  it("accepts a spec whose figures all trace to the ledger", () => {
    const result = check(
      baseSpec([
        section("Setup", [
          { type: "kpis", items: [{ label: "Last price", cell: { value: 214.6, unit: "USD", src: "E3" } }] },
          { type: "text", text: "Revenue reached {E1:revenue:FY26 Q2}, up {C1} on the year." },
        ]),
      ]),
    );
    expect(result.issues).toEqual([]);
    expect(result.spec?.format).toBe("doc");
  });

  it("rejects a figure that does not match its source, naming the section and the cell", () => {
    const result = check(
      baseSpec([
        section("Expectations", [
          {
            type: "table",
            columns: ["Line", "Consensus"],
            rows: [["EPS (adjusted)", { value: 2.41, unit: "USD/share", src: "E2" }]],
          },
        ]),
      ]),
    );
    expect(result.issues).not.toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "values", section: "Expectations", location: "table 1 row 1 col 2" }),
    );
    const message = formatIssues(result.issues);
    expect(message).toContain("Expectations › table 1 row 1 col 2");
    expect(message).toContain("USD 2.41 per share");
    expect(message).toContain("call create_report again");
  });

  it("rejects a numeric cell with no source", () => {
    const result = check(
      baseSpec([section("Setup", [{ type: "kpis", items: [{ label: "Revenue", cell: { value: 9.9, unit: "USD B", src: "" } }] }])]),
    );
    expect(result.issues).not.toEqual([]);
    expect(result.issues[0]).toMatchObject({ kind: "sources", location: 'kpi "Revenue"' });
  });

  it("rejects a source id that is not in the ledger", () => {
    const result = check(
      baseSpec([section("Setup", [{ type: "kpis", items: [{ label: "Revenue", cell: { value: 214.6, unit: "USD", src: "E9" } }] }])]),
    );
    expect(formatIssues(result.issues)).toContain('"E9" is not in the evidence ledger');
  });

  it("reports a missing required section of the template", () => {
    const result = check(baseSpec([section("Setup", [{ type: "list", items: ["one"] }])]), "earnings-preview");
    expect(result.issues).not.toEqual([]);
    const message = formatIssues(result.issues);
    expect(message).toContain('requires a "Stance" section');
    expect(message).toContain('requires a "Scenarios" section');
    // The section is added before the model reads this, so the note says what was done.
    expect(message).toContain('the earnings-preview template requires a "Stance" section, so one was added saying it is not covered.');
    expect(message).not.toContain("Add it");
  });

  it("accepts a heading that extends a required one", () => {
    const spec = baseSpec(
      ["Setup", "Expectations", "What matters this quarter", "Scenarios", "Risks to the view", "Stance"].map((heading) =>
        section(heading, [{ type: "list", items: ["one"] }]),
      ),
    );
    expect(check(spec, "earnings-preview").issues).toEqual([]);
  });

  it("refuses to let the model write the generated sections", () => {
    const result = check(baseSpec([section("Setup", [{ type: "list", items: ["one"] }]), section("Sources", [{ type: "list", items: ["EDGAR"] }])]));
    expect(result.issues[0]).toMatchObject({ kind: "structure", section: "Sources" });
    expect(result.spec?.sections.map((kept) => kept.heading)).toEqual(["Setup"]);
  });

  it("refuses a report with no written section left to render, and says only that", () => {
    const result = check(baseSpec([section("Sources", [{ type: "list", items: ["EDGAR"] }])]));
    expect(result.spec).toBeUndefined();
    expect(formatIssues(result.issues)).toBe(
      "The report was not created: 1 problem to fix.\n1. [structure] every section used a generated heading; write the analysis under headings of your own.\n\nFix these in the spec and call create_report again.",
    );
  });

  it("adds a missing required section as not covered, in the template's order after the written ones", () => {
    const result = check(baseSpec([section("Setup", [{ type: "list", items: ["one"] }])]), "peer-comps");
    expect(result.spec?.sections.map((kept) => [kept.heading, kept.blocks])).toEqual([
      ["Setup", [{ type: "list", items: ["one"] }]],
      ...["Peer set", "Comparison", "Read-through"].map((heading) => [heading, [{ type: "text", text: "Not covered in this report." }]]),
    ]);
  });

  it("rejects an unknown template", () => {
    const result = validateReportSpec({ ...baseSpec([section("A", [])]), template: "nope" }, ledger, {
      defaultFormat: "doc",
    });
    expect(formatIssues(result.issues)).toContain('unknown template "nope"');
  });

  it("renders ticker decoration without rejecting the report", () => {
    const result = check(baseSpec([section("Setup", [{ type: "text", text: "ACME reports next week." }])]));
    expect(result.issues).toEqual([]);
    if (result.spec) expect(renderReport(result.spec, ledger, "doc").html).toContain("$ACME reports next week.");
  });

  it("rejects a literal figure that no entry holds, and accepts one that is referenced", () => {
    const literal = check(baseSpec([section("Risks", [{ type: "callout", tone: "negative", text: "Bitcoin is 4.4% of the float." }])]));
    expect(formatIssues(literal.issues)).toContain('the figure "4.4%" is in no available evidence entry');

    const referenced = check(baseSpec([section("Risks", [{ type: "callout", tone: "negative", text: "Growth of {C1} is priced in." }])]));
    expect(referenced.issues).toEqual([]);
  });

  it("leaves years, fiscal labels and small counts alone", () => {
    const result = check(
      baseSpec([section("Setup", [{ type: "list", items: ["FY26 Q3 reports in 2026, the eighth quarter of the run."] }])]),
    );
    expect(result.issues).toEqual([]);
  });

  it("reports a reference that cannot be resolved", () => {
    const result = check(baseSpec([section("Setup", [{ type: "text", text: "Margin was {C9}." }])]));
    expect(formatIssues(result.issues)).toContain("C9 is not in the evidence ledger");
  });

  it("checks figures inside an html block, after the markup is stripped", () => {
    const result = check(
      baseSpec([
        section("Setup", [
          { type: "html", html: '<script>alert(1)</script><p>Free cash flow of USD 7.10B covers it.</p>' },
        ]),
      ]),
    );
    expect(result.issues).not.toEqual([]);
    const message = formatIssues(result.issues);
    expect(message).toContain("html block 1");
    expect(message).toContain("USD 7.10B");
    expect(message).not.toContain("script");
  });

  it("reports a spec that is not the right shape at all", () => {
    const result = validateReportSpec({ title: "", sections: [] }, ledger, { defaultFormat: "doc" });
    expect(result.issues).not.toEqual([]);
    expect(result.issues.every((issue) => issue.kind === "structure")).toBe(true);
  });

  it("caps the number of sections", () => {
    const sections = Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => section(`S${i}`, []));
    const result = check(baseSpec(sections));
    expect(result.issues.some((issue) => issue.kind === "size")).toBe(true);
  });
});

describe("issueNotes", () => {
  it("prints where and what, for the report's Verification notes", () => {
    expect(issueNotes([
      { kind: "values", section: "Setup", location: 'kpi "Revenue"', message: "shows USD 1, but E1 holds no value equal to it." },
      { kind: "structure", message: "the template requires a Stance section." },
    ])).toEqual(['Setup › kpi "Revenue": shows USD 1, but E1 holds no value equal to it.', "the template requires a Stance section."]);
  });
});
