import { describe, expect, it } from "vitest";
import { type ReportCall, reportOf, reportTitleOf } from "./report-call";

/** A `create_report` call that has not settled yet, unless `fields` says otherwise. */
const call = (fields: Partial<ReportCall>): ReportCall => ({ id: "t1", name: "create_report", args: {}, ...fields });

describe("reportOf", () => {
  const html = "<p>a</p>";

  it("reads only the report tool", () => {
    expect(reportOf(call({ name: "quote", details: { title: "Q3", html } }))).toBeNull();
  });

  it("skips a result without rendered HTML", () => {
    expect(reportOf(call({ details: { title: "Q3" } }))).toBeNull();
    expect(reportOf(call({ details: { title: "Q3", html: "" } }))).toBeNull();
    expect(reportOf(call({ details: "oops" }))).toBeNull();
  });

  it("skips a report whose tool call failed", () => {
    expect(reportOf(call({ details: { title: "Q3", html }, result: "html too large", isError: true }))).toBeNull();
  });

  it("defaults to a doc for an unknown or missing format", () => {
    expect(reportOf(call({ details: { title: "Q3", html, format: "deck" } }))?.format).toBe("doc");
    expect(reportOf(call({ details: { title: "Q3", html } }))?.format).toBe("doc");
  });

  it("dates the report by when the call settled", () => {
    expect(reportOf(call({ details: { title: "Q3", html }, timestamp: 4000 }))?.createdAt).toBe(4000);
    expect(reportOf(call({ details: { title: "Q3", html } }))?.createdAt).toBe(0);
  });
});

describe("reportOf, spec reports", () => {
  const args = { spec: { title: "$ACME — Earnings Preview: FY26 Q3", template: "earnings-preview", sections: [] } };

  const rendered = (details: unknown) => call({ args, result: "[R1 · report …]", isError: false, details, timestamp: 0 });

  it("takes the rendered HTML from the tool result, not the model's arguments", () => {
    const report = reportOf(
      rendered({
        title: "$ACME — Earnings Preview: FY26 Q3",
        format: "slides",
        template: "earnings-preview",
        bytes: 12,
        html: "<section>a</section>",
      }),
    );
    expect(report).toEqual({
      id: "t1",
      title: "$ACME — Earnings Preview: FY26 Q3",
      html: "<section>a</section>",
      format: "slides",
      template: "earnings-preview",
      createdAt: 0,
    });
  });

  it("has no report to open while the call is still streaming", () => {
    expect(reportOf(call({ args }))).toBeNull();
  });
});

describe("reportTitleOf", () => {
  it("reads the title from a spec call, a legacy call, or neither", () => {
    expect(reportTitleOf({ spec: { title: "From spec" } })).toBe("From spec");
    expect(reportTitleOf({ title: "Legacy" })).toBe("Legacy");
    expect(reportTitleOf({ spec: {} })).toBe("Report");
    expect(reportTitleOf("oops")).toBe("Report");
  });
});
