import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { fixtureLedger } from "@/lib/reports/ledger.fixture";
import type { ReportSpec } from "@/lib/reports/spec";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { type CreateReportDetails, reportsModule } from "./tool";

function context(evidence: EvidenceLedger): ModuleContext {
  return {
    log: () => {},
    session: { id: "s1" },
    evidence,
  };
}

async function tool(cfg: Record<string, unknown>, evidence: EvidenceLedger): Promise<FinanceTool> {
  const [created] = await reportsModule.createTools(cfg, context(evidence));
  return created;
}

const run = (created: FinanceTool, toolCallId: string, spec: ReportSpec) =>
  created.execute(toolCallId, spec);

const sections = (): ReportSpec["sections"] => [
  { heading: "Setup", blocks: [{ type: "kpis", items: [{ label: "Last price", cell: { value: 214.6, unit: "USD", src: "E3" } }] }] },
  { heading: "Expectations", blocks: [{ type: "text", text: "Consensus sits at {E2:eps_estimate:FY26 Q3}." }] },
  { heading: "What matters this quarter", blocks: [{ type: "list", items: ["Revenue mix"] }] },
  { heading: "Scenarios", blocks: [{ type: "list", items: ["Beat"] }] },
  { heading: "Risks", blocks: [{ type: "list", items: ["Supply"] }] },
  { heading: "Stance", blocks: [{ type: "callout", tone: "neutral", text: "Growth of {C1} is priced in." }] },
];

const spec = (over: Partial<ReportSpec> = {}): ReportSpec => ({
  title: "$ACME — Earnings Preview: FY26 Q3",
  template: "earnings-preview",
  sections: sections(),
  ...over,
});

function resultText(result: AgentToolResult<unknown>): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

let ledger: EvidenceLedger;
let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-report-test-"));
  ledger = fixtureLedger();
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("create_report", () => {
  it("is a finance tool that computes", () => {
    expect(reportsModule.kind).toBe("financial-tool");
  });

  it("exposes object and array argument types to provider tool parsers", async () => {
    const created = await tool({}, ledger);
    expect(created.parameters).toMatchObject({ type: "object", properties: { title: { type: "string" }, sections: { type: "array" } } });
    expect(created.parameters).not.toHaveProperty("anyOf");
    expect(created.parameters).not.toHaveProperty("properties.spec");
    expect(created.parameters).not.toHaveProperty("properties.edits");
  });

  it("requires a title and settles cells a model is likely to send into the schema's shape", async () => {
    const created = await tool({}, ledger);
    const section = { heading: "Findings", blocks: [{ type: "text", text: "Supported growth: {C1}." }] };
    expect(() => created.prepareArguments!({ sections: [section] })).toThrow("title");
    const loose = { title: "New", sections: [{ heading: "Findings", blocks: [
      { type: "table", columns: ["Metric", "Value"], rows: [["Revenue", 12.5], ["Note", null], ["Flags", ["a", "b"]]] },
      { type: "kpis", items: [{ label: "Growth", cell: 3 }] },
    ] }] };
    expect(created.prepareArguments!(loose)).toMatchObject({ title: "New", sections: [{ blocks: [
      { rows: [["Revenue", "12.5"], ["Note", ""], ["Flags", "a b"]] }, { items: [{ cell: { value: "3" } }] }] }] });
  });

  it("renders the spec and keeps only a stub in the model's context", async () => {
    const createReport = await tool({}, ledger);
    const result = await run(createReport, "call-1", spec());
    const text = resultText(result);

    expect(text).toContain('[R1 · report "$ACME — Earnings Preview: FY26 Q3" · doc · 6 sections · key figures E3, E2, C1]');
    expect(text).toContain("The report is open beside the chat.");
    expect(text).not.toContain("<html");
  });

  it("returns opening prose with the same resolved figures as the report", async () => {
    const loss = ledger.add({ kind: "C", summary: "Drawdown scenario", unit: "USD", table: {
      columns: ["label", "value"], index: "label", rows: [["Down: 20%", -40000]],
    } });
    const createReport = await tool({}, ledger);
    const result = await run(createReport, "opening", spec({ template: undefined, sections: [
      { heading: "Conclusion", blocks: [
        { type: "text", text: `Revenue was {E1:revenue:FY26 Q2}; growth was {C1}. The scenario change is {${loss.id}:Down: 20%}.` },
        { type: "callout", tone: "neutral", text: "The scenario is an assumption, not a forecast." },
      ] },
      { heading: "Details", blocks: [{ type: "text", text: "Additional analysis belongs in the report." }] },
    ] }));
    const text = resultText(result);
    expect(text).toContain("Revenue was USD 4.32B [E1]; growth was 11.2% [C1].");
    expect(text).toContain(`The scenario change is USD -40,000 [${loss.id}].`);
    expect(text).toContain("The scenario is an assumption, not a forecast.");
    expect(text).not.toContain("{C1}");
    expect(text).not.toContain("Additional analysis belongs in the report.");
    expect((result.details as CreateReportDetails).html).toContain("USD -40,000");
  });

  it("returns the rendered HTML and the R entry on details", async () => {
    const createReport = await tool({}, ledger);
    const result = await run(createReport, "call-1", spec());
    const details = result.details as CreateReportDetails;

    expect(details).toMatchObject({
      title: "$ACME — Earnings Preview: FY26 Q3",
      format: "doc",
      template: "earnings-preview",
    });
    expect(details.html).toContain("USD 214.60");
    expect(details.evidence).toMatchObject({
      id: "R1",
      kind: "R",
      toolCallId: "call-1",
      report: { title: "$ACME — Earnings Preview: FY26 Q3" },
    });
  });

  it("adds the R entry to the ledger and stores the spec and HTML as its payload", async () => {
    const createReport = await tool({}, ledger);
    await run(createReport, "call-1", spec());

    expect(ledger.get("R1")?.kind).toBe("R");
    const payload = await ledger.loadPayload<{ spec: ReportSpec; html: string }>("R1");
    expect(payload?.spec.title).toBe("$ACME — Earnings Preview: FY26 Q3");
    expect(payload?.html).toContain("<!doctype html>");
  });

  it("delivers a report whose figure does not match its source, and lists it under Verification notes", async () => {
    const createReport = await tool({}, ledger);
    const broken = spec();
    broken.sections[0] = {
      heading: "Setup",
      blocks: [{ type: "kpis", items: [{ label: "Last price", cell: { value: 512.4, unit: "USD", src: "E3" } }] }],
    };
    const result = await run(createReport, "call-1", broken);
    const details = result.details as CreateReportDetails;
    expect(details.verification).toMatchObject({ supported: details.verification.checked - 1, repaired: 0, unverified: 1, byKind: { values: 1 } });
    expect(resultText(result)).toContain(`verification: ${details.verification.checked - 1} of ${details.verification.checked} figures supported, 0 repaired, 1 unverified`);
    expect(details.html).toContain("Verification notes");
    expect(details.html).toContain("USD 512.40");
    expect(resultText(result)).toContain('1 figure could not be verified');
    expect(resultText(result)).toContain('Setup › kpi "Last price"');
    expect(ledger.list("R")).toHaveLength(1);
  });

  it("delivers a report that is missing a template section and notes the gap", async () => {
    const createReport = await tool({}, ledger);
    const short = spec();
    short.sections = short.sections.slice(0, 2);
    const result = await run(createReport, "call-1", short);
    expect((result.details as CreateReportDetails).html).toMatch(/requires a .*Stance.* section/);
    expect(resultText(result)).toContain("Stance");
    const saved = await ledger.loadPayload<{ spec: ReportSpec }>((result.details as CreateReportDetails).evidence.id);
    expect(saved?.spec.sections.map((section) => section.heading)).toEqual(["Setup", "Expectations", "What matters this quarter", "Scenarios", "Risks", "Stance"]);
    expect(saved?.spec.sections[5].blocks).toEqual([{ type: "text", text: "Not covered in this report." }]);
    expect((result.details as CreateReportDetails).html.match(/Not covered in this report\./g)).toHaveLength(4);
  });

  it("drops a written Sources section in favour of the generated one", async () => {
    const createReport = await tool({}, ledger);
    const doubled = spec();
    doubled.sections.push({ heading: "Sources", blocks: [{ type: "text", text: "Company filings." }] });
    const result = await run(createReport, "call-1", doubled);
    expect((result.details as CreateReportDetails).html).not.toContain("Company filings.");
    const saved = await ledger.loadPayload<{ spec: ReportSpec }>("R1");
    expect(saved!.spec.sections.map((section) => section.heading)).not.toContain("Sources");
  });

  it("applies the configured default format and lets the spec override it", async () => {
    const asSlides = await tool({ format: "slides" }, ledger);
    const deck = await run(asSlides, "call-1", spec());
    expect(deck.details).toMatchObject({ format: "slides" });
    expect((deck.details as CreateReportDetails).html).toContain('<body class="deck">');

    const page = await run(asSlides, "call-2", spec({ format: "doc" }));
    expect(page.details).toMatchObject({ format: "doc" });
  });

  it("ignores a configured format that is not a known one", async () => {
    const createReport = await tool({ format: "keynote" }, ledger);
    const result = await run(createReport, "call-1", spec());
    expect(result.details).toMatchObject({ format: "doc" });
  });

  it("tells the model the spec contract and the user's default format", async () => {
    const createReport = await tool({ format: "slides" }, ledger);
    expect(createReport.description).toContain("Default format for this user: slides");
    expect(createReport.description).toContain("For structured facts use");
    expect(createReport.description).toContain("{E7:revenue:FY26 Q2}");
    expect(createReport.description).toContain("Figures, Sources, Assumptions and the disclaimer are generated");
    expect(createReport.description).toContain("earnings-preview");
    expect(createReport.meta).toEqual({ class: "finance", effect: "compute" });
  });

  it("counts a corrected citation as repaired, not unverified, and still lists it", async () => {
    const createReport = await tool({}, ledger);
    const cited = spec();
    cited.sections[0] = { heading: "Setup", blocks: [{ type: "kpis", items: [{ label: "Last price", cell: { value: 214.6, unit: "USD", src: "E1" } }] }] };
    const result = await run(createReport, "call-1", cited);
    const details = result.details as CreateReportDetails;
    expect(details).toMatchObject({ verification: { repaired: 1, unverified: 0 } });
    expect(details.html).toContain("citation corrected to E3");
    expect(resultText(result)).not.toContain("could not be verified");
  });

  it("accepts a stringified JSON spec and prepares arguments cleanly", async () => {
    const createReport = await tool({}, ledger);
    const validSpec = spec();
    const stringified = JSON.stringify(validSpec);
    const prepared = createReport.prepareArguments?.({ spec: stringified }) as ReportSpec | undefined;
    expect(prepared).toEqual(validSpec);

    const result = await createReport.execute("call-1", prepared!);
    expect(resultText(result)).toContain('[R1 · report "$ACME — Earnings Preview: FY26 Q3"');
  });

  it("rejects legacy JSON that repairs into an array instead of a specification", async () => {
    const createReport = await tool({}, ledger);
    const validSpec = spec();
    validSpec.sections[0].blocks.push({
      type: "callout",
      tone: "neutral",
      text: "Guidance of {C1} expected.",
    });
    const raw = JSON.stringify(validSpec);
    // Simulate LLM outputting "]}},{"type":"callout"" instead of "]},{"type":"callout""
    const glitched = raw.replace(']},{"type":"callout"', ']}},{"type":"callout"');
    const prepared = createReport.prepareArguments?.({ spec: glitched }) as ReportSpec | undefined;
    expect(typeof prepared).toBe("object");

    await expect(createReport.execute("call-1", prepared!)).rejects.toThrow();
  });

  it("reports the syntax error for a malformed serialized sections array", async () => {
    const createReport = await tool({}, ledger);
    const sections = '[{"heading":"Findings","blocks":[{"type":"list","items":["One"]], {"type":"chart","series":[]}]}, {"heading":"Next","blocks":[]}]';
    const error = (() => { try { createReport.prepareArguments?.({ title: "Facts", sections }); } catch (error) { return error as Error; } })();
    expect(error?.message).toContain("Invalid report JSON");
    expect(error?.message).toContain('⟪HERE⟫]');
    expect(error?.message).toContain("No report was created");
    expect(ledger.list("R")).toEqual([]);
  });

  it("rejects misplaced blocks instead of guessing which section they belong to", async () => {
    const createReport = await tool({}, ledger);
    const rawSpec: Record<string, unknown> = {
      title: "$ACME — Earnings Preview: FY26 Q3",
      template: "earnings-preview",
      sections: [
        ...sections(),
        // A loose block accidentally emitted as a section
        { type: "callout", tone: "neutral", text: "Additional note with {C1}." },
      ],
    };
    const error = (() => { try { createReport.prepareArguments?.({ spec: rawSpec }); } catch (error) { return error as Error; } })();
    expect(error?.message).toContain("No report was created");
    expect(error?.message).toContain(`sections.${sections().length}.heading`);
    expect(error?.message).toContain("complete title and sections");
    expect(error?.message).not.toContain("Additional note");
  });

  it("preserves the advertised root-level fields", async () => {
    const createReport = await tool({}, ledger);
    const validSpec = spec();
    const prepared = createReport.prepareArguments?.(validSpec) as ReportSpec | undefined;
    expect(prepared).toEqual(validSpec);
  });

  it("rejects a nested spec wrapper instead of inventing its intended structure", async () => {
    const createReport = await tool({}, ledger);
    const realSessionSpec = JSON.stringify({
      title: "$ACME — Earnings Preview: FY26 Q3",
      template: "earnings-preview",
      sections: sections(),
    }).replace(']}]},{"heading":"Scenarios"', ']}},{"type":"callout","tone":"neutral","text":"Stray block with {C1}"}]},{"heading":"Scenarios"');

    const prepared = createReport.prepareArguments?.({ spec: realSessionSpec }) as ReportSpec | undefined;
    expect(typeof prepared).toBe("object");
    await expect(createReport.execute("bad-wrapper", prepared!)).rejects.toThrow();
  });
  it("keeps an unsupported literal figure in the report, flagged, instead of withholding the report", async () => {
    const created = await tool({}, ledger);
    const broken = spec({ template: undefined });
    broken.sections[0].blocks = [{ type: "text", text: "Unsupported margin: 91.234%." }];
    const result = await run(created, "first-draft", broken);
    const details = result.details as CreateReportDetails;
    expect(details.html).toContain("91.234%");
    expect(details.html).toContain("Verification notes");
    expect(details.verification.unverified).toBe(1);
    expect(resultText(result)).toContain("91.234%");
    expect(ledger.list("R").map((entry) => entry.id)).toEqual(["R1"]);
  });

  it("keeps the report when an evidence table cannot be built, saying so in its place", async () => {
    const created = await tool({}, ledger);
    const result = await created.execute("no-table", { title: "Facts", sections: [{ heading: "Results",
      blocks: [{ type: "evidence_table", source: "C1" }, { type: "text", text: "Growth of {C1}." }] }] });
    const details = result.details as CreateReportDetails;
    expect(details.verification.unverified).toBe(1);
    expect(details.html).toContain("Evidence table from C1 omitted");
    expect(ledger.list("R")).toHaveLength(1);
  });

  it("renders reference cells without model-written values or units", async () => {
    const created = await tool({}, ledger);
    const result = await created.execute("reference-cell", { title: "Facts", sections: [{ heading: "Results",
      blocks: [{ type: "kpis", items: [{ label: "Growth", cell: { ref: "C1" } }] }] }] });
    expect(resultText(result)).toContain("key figures C1");
    const saved = await ledger.loadPayload<{ spec: ReportSpec }>("R1");
    expect(saved!.spec.sections[0].blocks[0]).toMatchObject({ items: [{ cell: { value: ledger.get("C1")!.value, src: "C1" } }] });
  });

});
