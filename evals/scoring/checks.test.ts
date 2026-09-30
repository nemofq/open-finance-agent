import { describe, expect, it } from "vitest";
import type { EvidenceEntry, EvidenceFact, Figure, FigureMatch } from "@/lib/evidence/types";
import { runDeterministicChecks } from "./checks";
import { analyseEvidence } from "./evidence";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type EvalSourceEvidence, type EvalTask, type OfflineOutcome, type ToolCallTrace } from "../types";

const NVDA = RETAIL_EVAL_TASKS[0];
/** A task whose one evidence requirement, all 15 points, is an NVDA quote the answer relies on. */
const QUOTED: EvalTask = { ...NVDA, requiredEvidence: [{ kind: "ledger", source: "quote", ticker: "NVDA", label: "NVDA quote", points: 15 }] };
const TSLY_TASK = RETAIL_EVAL_TASKS.find((task) => task.id === "retail-04-dividend-yield-trap");

function sources(task: EvalTask | undefined): EvalSourceEvidence[] {
  return (task?.requiredEvidence ?? []).filter((requirement): requirement is EvalSourceEvidence => requirement.kind === "source");
}

function evidenceDetail(details: string[]): string | undefined {
  return details.find((detail) => detail.startsWith("[Evidence:"));
}

function call(toolName: string, args: Record<string, unknown> = {}, output = ""): ToolCallTrace {
  return { toolCallId: `call-${toolName}`, toolName, args, output, durationMs: 5, isError: false };
}

function sourceCall(toolName: string, toolCallId: string, url: string, served: boolean): ToolCallTrace {
  const evidence = { id: `E-${toolCallId}`, kind: "E" as const, summary: "Official fund document", fetchedAt: "2024-06-15T12:00:00Z", tool: toolName, toolCallId };
  return {
    ...call(toolName),
    toolCallId,
    offlineOutcome: served ? "served" : "not_captured",
    details: { urls: [url], fetched: toolName === "web_fetch" && served ? [url] : [], url, evidence },
  };
}

function figure(raw: string, value: number, index = 0): Figure {
  return { raw, value, index };
}

function backed(raw: string, value: number, ids: string[]): FigureMatch {
  return { figure: figure(raw, value), matches: ids };
}

function entry(id: string, kind: EvidenceEntry["kind"], summary: string): EvidenceEntry {
  return { id, kind, summary, fetchedAt: "2026-01-01T00:00:00Z" };
}

/** A served NVDA quote whose result registered ledger entry `id`, which meets `QUOTED`'s requirement once backed. */
function quote(id = "E1"): ToolCallTrace {
  return { ...call("market_quotes", { symbols: ["NVDA"] }), toolCallId: `quote-${id}`, offlineOutcome: "served", details: { evidence: { id } } };
}

describe("the task suite", () => {
  it("keeps the canonical suite with unique ids", () => {
    expect(RETAIL_EVAL_TASKS).toHaveLength(12);
    expect(new Set(RETAIL_EVAL_TASKS.map((task) => task.id)).size).toBe(12);
  });

  it("gives every task an as-of date, entities and a full rubric", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      expect(task.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(task.expectedEntities.length).toBeGreaterThan(0);
      expect(task.prompt.length).toBeGreaterThan(10);
      expect(task.latentIntent.length).toBeGreaterThan(20);
      for (const criteria of Object.values(task.rubric)) expect(criteria.length).toBeGreaterThan(10);
    }
  });
});

describe("evidence-aware checks", () => {
  it("scores retail-04 by read and cited official sources, independent of route", () => {
    expect(TSLY_TASK).toBeDefined();
    if (!TSLY_TASK) return;
    const [tsly, msty] = sources(TSLY_TASK);
    expect(tsly?.points).toBe(8);
    expect(msty?.points).toBe(7);
    const tslyUrl = tsly?.urls[0] ?? "";
    const mstyUrl = msty?.urls[0] ?? "";
    const calls = [sourceCall("web_fetch", "call-tsly", tslyUrl, true), sourceCall("edgar_read_filing", "call-msty", mstyUrl, true)];
    const evidence = calls.map((toolCall) => {
      const details = toolCall.details as { evidence: EvidenceEntry };
      return details.evidence;
    });
    const result = runDeterministicChecks({
      task: TSLY_TASK,
      toolCalls: calls,
      finalText: `TSLY paid $0.5 (${tslyUrl}); MSTY paid $4.0 (${mstyUrl}).`,
      sessionTickers: ["TSLY", "MSTY"],
      evidence,
      figureMatches: [backed("$0.5", 0.5, ["E-call-tsly"]), backed("$4.0", 4, ["E-call-msty"])],
      evidenceAvailable: true,
    });

    expect(evidenceDetail(result.details)).toContain("[Evidence: 15/15]");
  });

  it("credits a tagged source only through figures it backs, never through the tag alone", () => {
    expect(TSLY_TASK).toBeDefined();
    if (!TSLY_TASK) return;
    const requirements = sources(TSLY_TASK);
    const calls = [
      sourceCall("web_fetch", "cited-tsly", requirements[0]?.urls[0] ?? "", true),
      sourceCall("edgar_read_filing", "cited-msty", requirements[1]?.urls[0] ?? "", true),
    ];
    const evidence = calls.map((toolCall, index) => {
      const details = toolCall.details as { evidence: EvidenceEntry };
      details.evidence.id = `E${index + 1}`;
      return details.evidence;
    });

    const score = (finalText: string, figureMatches: FigureMatch[]) => evidenceDetail(runDeterministicChecks({
      task: TSLY_TASK,
      toolCalls: calls,
      finalText,
      sessionTickers: ["TSLY", "MSTY"],
      evidence,
      figureMatches,
      evidenceAvailable: true,
    }).details);

    // A bare tag shows the model knows the id, not that it relied on the document.
    expect(score("TSLY prospectus [E1]. MSTY prospectus [E2].", [])).toContain("[Evidence: 0/15]");
    expect(score("TSLY paid $0.5 [E1]. MSTY paid $4.0 [E2].", [backed("$0.5", 0.5, ["E1"]), backed("$4.0", 4, ["E2"])])).toContain("[Evidence: 15/15]");
    // Figures attributed to ids the run never produced earn nothing.
    expect(score("TSLY $0.5 [E900]. MSTY $4.0 [E901].", [backed("$0.5", 0.5, ["E900"]), backed("$4.0", 4, ["E901"])])).toContain("[Evidence: 0/15]");
  });

  it("does not award a source result for an unsuccessful fetch or only one fund", () => {
    expect(TSLY_TASK).toBeDefined();
    if (!TSLY_TASK) return;
    const requirements = sources(TSLY_TASK);
    const tslyUrl = requirements[0]?.urls[0] ?? "";
    const mstyUrl = requirements[1]?.urls[0] ?? "";
    const incompleteCalls = [
      sourceCall("web_fetch", "failed-fetch", mstyUrl, false),
      sourceCall("edgar_read_filing", "one-fund", tslyUrl, true),
    ];
    const result = runDeterministicChecks({
      task: TSLY_TASK,
      toolCalls: incompleteCalls,
      finalText: `TSLY paid $0.5 (${tslyUrl}); MSTY paid $4.0 (${mstyUrl}).`,
      sessionTickers: ["TSLY", "MSTY"],
      evidence: incompleteCalls.map((toolCall) => (toolCall.details as { evidence: EvidenceEntry }).evidence),
      figureMatches: [backed("$0.5", 0.5, ["E-one-fund"]), backed("$4.0", 4, ["E-failed-fetch"])],
      evidenceAvailable: true,
    });

    expect(evidenceDetail(result.details)).toContain("[Evidence: 8/15]");

    const onlyFailedFetch = sourceCall("web_fetch", "only-failed-fetch", mstyUrl, false);
    const fetchOnlyResult = runDeterministicChecks({
      task: TSLY_TASK,
      toolCalls: [onlyFailedFetch],
      finalText: `MSTY paid $4.0 (${mstyUrl}).`,
      sessionTickers: ["TSLY", "MSTY"],
      evidence: [(onlyFailedFetch.details as { evidence: EvidenceEntry }).evidence],
      figureMatches: [backed("$4.0", 4, ["E-only-failed-fetch"])],
      evidenceAvailable: true,
    });
    expect(evidenceDetail(fetchOnlyResult.details)).toContain("[Evidence: 0/15]");
  });

  it("rejects an otherwise cited source URL that is not covered by the task contract", () => {
    expect(TSLY_TASK).toBeDefined();
    if (!TSLY_TASK) return;
    const futureUrl = "https://example.com/future-fund-document";
    const retrieved = sourceCall("web_fetch", "future-source", futureUrl, true);
    const result = runDeterministicChecks({
      task: TSLY_TASK,
      toolCalls: [retrieved],
      finalText: `TSLY paid $0.5 (${futureUrl}).`,
      sessionTickers: ["TSLY", "MSTY"],
      evidence: [(retrieved.details as { evidence: EvidenceEntry }).evidence],
      figureMatches: [backed("$0.5", 0.5, ["E-future-source"])],
      evidenceAvailable: true,
    });

    expect(evidenceDetail(result.details)).toContain("[Evidence: 0/15]");
  });

  describe("source citation paths", () => {
    function retail04Run(served: boolean) {
      const requirements = sources(TSLY_TASK);
      const urls = requirements.map((requirement) => requirement.urls[0] ?? "");
      const calls = [
        sourceCall("web_fetch", "path-tsly", urls[0] ?? "", served),
        sourceCall("edgar_read_filing", "path-msty", urls[1] ?? "", served),
      ];
      const evidence = calls.map((toolCall, index) => {
        const details = toolCall.details as { evidence: EvidenceEntry };
        details.evidence.id = `E${index + 1}`;
        return details.evidence;
      });
      return { calls, evidence, urls };
    }

    function sourcesDetail(finalText: string, figureMatches: FigureMatch[], served = true): string | undefined {
      if (!TSLY_TASK) return undefined;
      const { calls, evidence } = retail04Run(served);
      const result = runDeterministicChecks({
        task: TSLY_TASK,
        toolCalls: calls,
        finalText,
        sessionTickers: ["TSLY", "MSTY"],
        evidence,
        figureMatches,
        evidenceAvailable: true,
      });
      return evidenceDetail(result.details);
    }

    it("gives a bare evidence tag with no backed figure nothing", () => {
      expect(TSLY_TASK).toBeDefined();
      expect(sourcesDetail("TSLY distribution [E1]. MSTY distribution [E2].", [])).toContain("[Evidence: 0/15]");
    });

    it("accepts a source URL only together with a backed figure or a quote", () => {
      expect(TSLY_TASK).toBeDefined();
      const { urls } = retail04Run(true);
      expect(sourcesDetail(`TSLY: ${urls[0]}\nMSTY: ${urls[1]}`, [])).toContain("[Evidence: 0/15]");
      expect(sourcesDetail(`TSLY paid $0.5: ${urls[0]}\nMSTY: ${urls[1]}`, [backed("$0.5", 0.5, ["E1"])])).toContain("[Evidence: 8/15]");
    });

    it("accepts a figure the matcher attributes to the acquired entry, without a tag or URL", () => {
      expect(TSLY_TASK).toBeDefined();
      const text = "TSLY paid $0.5 per share and MSTY paid $4.0 per share.";
      expect(sourcesDetail(text, [backed("$0.5", 0.5, ["E1"])])).toContain("[Evidence: 8/15]");
      expect(sourcesDetail(text, [backed("$0.5", 0.5, ["E1"]), backed("$4.0", 4, ["E2"])])).toContain("[Evidence: 15/15]");
      // An exempt figure is not attribution, even if it happens to equal a ledger value.
      const exempt: FigureMatch = { figure: { raw: "2024", value: 2024, index: 0, exempt: "year" }, matches: ["E1", "E2"] };
      expect(sourcesDetail(text, [exempt])).toContain("[Evidence: 0/15]");
    });

    it("awards nothing when the source was not acquired, however it is cited", () => {
      expect(TSLY_TASK).toBeDefined();
      const { urls } = retail04Run(false);
      const text = `TSLY [E1] ${urls[0]} paid $0.5. MSTY [E2] ${urls[1]} paid $4.0.`;
      expect(sourcesDetail(text, [backed("$0.5", 0.5, ["E1"]), backed("$4.0", 4, ["E2"])], false)).toContain("[Evidence: 0/15]");
    });

    it("accepts a quoted passage of at least eight consecutive words from the body read, not from its title", () => {
      expect(TSLY_TASK).toBeDefined();
      if (!TSLY_TASK) return;
      const { calls, evidence, urls } = retail04Run(true);
      calls[0] = {
        ...calls[0],
        output: [
          "[E1 · YieldMax · tier 1 · as of 2024-02-28]",
          "## YieldMax TSLA Option Income Strategy ETF summary prospectus for investors",
          urls[0] ?? "",
          "",
          "The Fund's investment objective is to seek current income. The Fund's secondary investment objective is to seek exposure to the share price of TSLA, subject to a limit on potential investment gains.",
        ].join("\n"),
      };
      const score = (finalText: string) => evidenceDetail(runDeterministicChecks({
        task: TSLY_TASK, toolCalls: calls, finalText, sessionTickers: [], evidence, figureMatches: [], evidenceAvailable: true,
      }).details);

      expect(score("The prospectus says exposure is \"subject to a limit on potential investment gains\" [E1].")).toContain("[Evidence: 8/15] met [TSLY]");
      // Seven words is a phrase, not a passage.
      expect(score("Exposure is subject to a limit on potential investment [E1].")).toContain("[Evidence: 0/15]");
      // The page title only names the document.
      expect(score("See the YieldMax TSLA Option Income Strategy ETF summary prospectus [E1].")).toContain("[Evidence: 0/15]");
    });
  });

  describe("evidence outcomes", () => {
    const byId = (id: string): EvalTask => {
      const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === id);
      if (!task) throw new Error(`No task ${id}`);
      return task;
    };

    function run(
      task: EvalTask,
      toolCalls: ToolCallTrace[],
      evidence: EvidenceEntry[],
      finalText: string,
      figureMatches: FigureMatch[] = [],
      reportFigureMatches: FigureMatch[] = [],
    ) {
      return runDeterministicChecks({ task, toolCalls, finalText, sessionTickers: [], evidence, figureMatches, reportFigureMatches, evidenceAvailable: true });
    }

    function financials(
      id: string,
      ticker: string,
      statement: string,
      facts: EvidenceFact[],
      options: { tier?: 1 | 2; outcome?: OfflineOutcome } = {},
    ): { call: ToolCallTrace; entry: EvidenceEntry } {
      const entry: EvidenceEntry = {
        id,
        kind: "E",
        summary: `SEC EDGAR, ${ticker}`,
        fetchedAt: "2024-11-22T12:00:00Z",
        tool: "edgar_financials",
        toolCallId: `call-${id}`,
        source: { id: "edgar", name: "SEC EDGAR", tier: options.tier ?? 1 },
        entity: { ticker },
        facts,
      };
      const trace: ToolCallTrace = {
        ...call("edgar_financials", { ticker, statement, period: "quarterly" }),
        toolCallId: `call-${id}`,
        offlineOutcome: options.outcome ?? "served",
        details: { statement, facts, evidence: entry },
      };
      return { call: trace, entry };
    }

    const fact = (metric: string, period: string, value: number): EvidenceFact => ({ metric, period, end: period, value, unit: "USD" });

    it("credits a source only when its body was read, not when a search listed it", () => {
      expect(TSLY_TASK).toBeDefined();
      if (!TSLY_TASK) return;
      const tslyUrl = sources(TSLY_TASK)[0]?.urls[0] ?? "";
      const listed = sourceCall("web_search", "listed", tslyUrl, true);
      const listedEntry = (listed.details as { evidence: EvidenceEntry }).evidence;
      listedEntry.id = "E1";
      const searchOnly = run(TSLY_TASK, [listed], [listedEntry], `TSLY paid $0.5 [E1] ${tslyUrl}`, [backed("$0.5", 0.5, ["E1"])]);
      expect(evidenceDetail(searchOnly.details)).toContain("[Evidence: 0/15]");

      const read = sourceCall("web_fetch", "read", tslyUrl, true);
      const readEntry = (read.details as { evidence: EvidenceEntry }).evidence;
      readEntry.id = "E2";
      const fetched = run(TSLY_TASK, [listed, read], [listedEntry, readEntry], "TSLY paid $0.5 [E2].", [backed("$0.5", 0.5, ["E2"])]);
      expect(evidenceDetail(fetched.details)).toBe("[Evidence: 8/15] met [TSLY]; missing [MSTY]");
    });

    it("credits a served, cited statement fact for the ticker, and names what is missing", () => {
      const task = byId("retail-01-nvda-beat-and-drop");
      const { call: pulled, entry } = financials("E1", "NVDA", "key_metrics", [fact("grossMargin", "2024-07-28", 75.1), fact("revenue", "2024-07-28", 30_040_000_000)]);

      expect(evidenceDetail(run(task, [pulled], [entry], "Gross margin was 75.1% [E1].", [backed("75.1%", 75.1, ["E1"])]).details)).toBe(
        "[Evidence: 8/15] met [NVDA gross margin, Q2 FY25 (2024-07-28), NVDA revenue, Q2 FY25 (2024-07-28)]; missing [NVIDIA Q2 FY25 results (8-K Ex. 99.1 / 99.2)]",
      );
      // Pulled but never used: the answer has to rely on the entry, and a bare tag is not reliance.
      expect(evidenceDetail(run(task, [pulled], [entry], "Gross margin stepped down.").details)).toContain("[Evidence: 0/15]");
      expect(evidenceDetail(run(task, [pulled], [entry], "Gross margin stepped down [E1].").details)).toContain("[Evidence: 0/15]");
      // A figure the matcher attributes to the entry is use, without a tag.
      expect(evidenceDetail(run(task, [pulled], [entry], "Margin 75.1%.", [backed("75.1%", 75.1, ["E1"])]).details)).toContain("[Evidence: 8/15]");
    });

    it("accepts revenue from the income statement for a key-metrics requirement, but only tier 1 and by the cutoff", () => {
      const task = byId("retail-01-nvda-beat-and-drop");
      const revenue = [backed("$30.04B", 30_040_000_000, ["E1"])];
      const income = financials("E1", "NVDA", "income", [fact("revenue", "2024-07-28", 30_040_000_000)]);
      expect(evidenceDetail(run(task, [income.call], [income.entry], "Revenue $30.04B [E1].", revenue).details)).toContain("[Evidence: 3/15] met [NVDA revenue, Q2 FY25 (2024-07-28)]");

      const vendor = financials("E1", "NVDA", "key_metrics", [fact("revenue", "2024-07-28", 30_040_000_000)], { tier: 2 });
      expect(evidenceDetail(run(task, [vendor.call], [vendor.entry], "Revenue $30.04B [E1].", revenue).details)).toContain("[Evidence: 0/15]");

      const future = financials("E1", "NVDA", "key_metrics", [fact("revenue", "2024-10-27", 35_082_000_000)]);
      expect(evidenceDetail(run(task, [future.call], [future.entry], "Revenue $35.08B [E1].", [backed("$35.08B", 35_082_000_000, ["E1"])]).details)).toContain("[Evidence: 0/15]");

      const otherTicker = financials("E1", "AMD", "key_metrics", [fact("revenue", "2024-06-29", 5_835_000_000)]);
      expect(evidenceDetail(run(task, [otherTicker.call], [otherTicker.entry], "Revenue $5.835B [E1].", [backed("$5.835B", 5_835_000_000, ["E1"])]).details)).toContain("[Evidence: 0/15]");

      // The rubric is about the Q2 FY25 report; an entry without that quarter is the wrong ground truth.
      const stale = financials("E1", "NVDA", "key_metrics", [fact("revenue", "2024-04-28", 26_044_000_000)]);
      expect(evidenceDetail(run(task, [stale.call], [stale.entry], "Revenue $26.04B [E1].", [backed("$26.04B", 26_044_000_000, ["E1"])]).details)).toContain("[Evidence: 0/15]");

      const unserved = financials("E1", "NVDA", "key_metrics", [fact("revenue", "2024-07-28", 30_040_000_000)], { outcome: "not_captured" });
      expect(evidenceDetail(run(task, [unserved.call], [unserved.entry], "Revenue $30.04B [E1].", revenue).details)).toContain("[Evidence: 0/15]");
    });

    it("credits a fact through a used calculator result derived from it, not through a shared value", () => {
      const task = byId("retail-01-nvda-beat-and-drop");
      const { call: pulled, entry } = financials("E1", "NVDA", "key_metrics", [fact("revenue", "2024-07-28", 30_040_000_000)]);
      const computed = (id: string, inputs: string[] | undefined): EvidenceEntry => ({
        id, kind: "C", summary: `${id} (calculated)`, fetchedAt: "2024-08-29T12:00:00Z", name: "growth", value: 15.2, unit: "%", ...(inputs ? { inputs } : {}),
      });
      const growth = [backed("15.2%", 15.2, ["C1"])];
      const label = "NVDA revenue, Q2 FY25 (2024-07-28)";

      // Derived from the served revenue, and the derived figure is shown: the fact was used.
      expect(evidenceDetail(run(task, [pulled], [entry, computed("C1", ["E1"])], "Revenue grew 15.2% [C1].", growth).details)).toContain(`met [${label}]`);
      // Through an intermediate calculation, the lineage still reaches the fact.
      expect(evidenceDetail(run(task, [pulled], [entry, computed("C2", ["E1"]), computed("C1", ["C2"])], "Revenue grew 15.2% [C1].", growth).details)).toContain(`met [${label}]`);
      // Derived but never shown: a calculation the answer does not use relies on nothing.
      expect(evidenceDetail(run(task, [pulled], [entry, computed("C1", ["E1"])], "Revenue grew [C1].").details)).toContain("[Evidence: 0/15]");
      // The same value from a calculation with no recorded lineage to the fact does not count.
      expect(evidenceDetail(run(task, [pulled], [entry, computed("C1", undefined)], "Revenue grew 15.2% [C1].", growth).details)).toContain("[Evidence: 0/15]");
      // Nor does a calculation derived from an unrelated entry that happens to hold the value.
      const unrelated: EvidenceEntry = { id: "E9", kind: "E", summary: "News article", fetchedAt: "2024-08-29T12:00:00Z", numbers: [{ value: 30_040_000_000, context: "revenue $30.04B" }] };
      expect(evidenceDetail(run(task, [pulled], [entry, unrelated, computed("C1", ["E9"])], "Revenue grew 15.2% [C1].", growth).details)).toContain("[Evidence: 0/15]");
    });

    it("credits a source through a used calculator result derived from its read, not through a shared value", () => {
      const task = byId("retail-09-narrative-factcheck-apple");
      const [, thirteenF] = sources(task);
      const label = "Berkshire 13F Apple position (Q1 2024)";
      const read = sourceCall("edgar_read_filing", "read-13f", thirteenF?.urls[1] ?? "", true);
      const readEntry = (read.details as { evidence: EvidenceEntry }).evidence;
      readEntry.id = "E11";
      const computed = (id: string, inputs: string[] | undefined): EvidenceEntry => ({
        id, kind: "C", summary: `${id} (calculated)`, fetchedAt: "2024-08-06T12:00:00Z", name: "shares sold", value: 559_629_579, unit: "shares", ...(inputs ? { inputs } : {}),
      });
      const sold = [backed("559,629,579", 559_629_579, ["C25"])];
      const text = "Berkshire sold 559,629,579 shares [C25].";

      // The stake change was computed from the 13F's holding rows and the answer shows it.
      expect(evidenceDetail(run(task, [read], [readEntry, computed("C25", ["E11"])], text, sold).details)).toContain(`met [${label}]`);
      expect(evidenceDetail(run(task, [read], [readEntry, computed("C2", ["E11"]), computed("C25", ["C2"])], text, sold).details)).toContain(`met [${label}]`);
      // Derived but not shown, no recorded lineage, or lineage to another entry: nothing.
      expect(evidenceDetail(run(task, [read], [readEntry, computed("C25", ["E11"])], "Berkshire sold shares [C25].").details)).toContain(`missing [Apple Q3 FY24 results release, ${label}]`);
      expect(evidenceDetail(run(task, [read], [readEntry, computed("C25", undefined)], text, sold).details)).toContain(`missing [Apple Q3 FY24 results release, ${label}]`);
      const unrelated: EvidenceEntry = { id: "E9", kind: "E", summary: "News article", fetchedAt: "2024-08-06T12:00:00Z" };
      expect(evidenceDetail(run(task, [read], [readEntry, unrelated, computed("C25", ["E9"])], text, sold).details)).toContain(`missing [Apple Q3 FY24 results release, ${label}]`);
      // Lineage to a read that was not served, or to a document the contract does not name, earns nothing.
      const blocked = { ...read, offlineOutcome: "not_available_as_of" as const };
      expect(evidenceDetail(run(task, [blocked], [readEntry, computed("C25", ["E11"])], text, sold).details)).toContain(`missing [Apple Q3 FY24 results release, ${label}]`);
      const cover = sourceCall("edgar_read_filing", "read-13f", "https://www.sec.gov/Archives/edgar/data/1067983/000095012324005622/xslForm13F_X02/primary_doc.xml", true);
      const coverEntry = { ...(cover.details as { evidence: EvidenceEntry }).evidence, id: "E11" };
      expect(evidenceDetail(run(task, [cover], [coverEntry, computed("C25", ["E11"])], text, sold).details)).toContain(`missing [Apple Q3 FY24 results release, ${label}]`);
    });

    it("credits quotes and holdings through used calculator results derived from them, not through a shared value", () => {
      const task = byId("retail-12-concentration-profile-fit");
      const holdings: EvidenceEntry = { id: "U1", kind: "U", origin: "holdings", summary: "NVDA: 260 shares", name: "NVDA quantity", value: 260, entity: { ticker: "NVDA" }, fetchedAt: "2024-09-20T12:00:00Z" };
      const portfolio: ToolCallTrace = { ...call("portfolio_get", { mode: "current" }), details: { evidence: [holdings] } };
      const quoteEntry: EvidenceEntry = {
        id: "E1", kind: "E", summary: "Market Quotes, $NVDA", fetchedAt: "2024-09-20T12:00:00Z",
        tool: "market_quotes", toolCallId: "call-quote", source: { id: "quotes", name: "Market Quotes", tier: 2 }, entity: { ticker: "NVDA" },
      };
      const quote: ToolCallTrace = { ...call("market_quotes", { symbols: ["NVDA"] }), toolCallId: "call-quote", offlineOutcome: "served", details: { missing: [], evidence: quoteEntry } };
      const weight = (inputs: string[] | undefined): EvidenceEntry => ({
        id: "C1", kind: "C", summary: "NVDA weight (calculated)", fetchedAt: "2024-09-20T12:00:00Z", name: "weight", value: 61.4, unit: "%", ...(inputs ? { inputs } : {}),
      });
      const shown = [backed("61.4%", 61.4, ["C1"])];
      const text = "NVDA is 61.4% of the portfolio [C1].";

      // A weight computed from the quote and the declared quantity uses both.
      expect(evidenceDetail(run(task, [portfolio, quote], [holdings, quoteEntry, weight(["U1", "E1"])], text, shown).details))
        .toBe("[Evidence: 9/15] met [Declared holdings read and cited, NVDA dated quote]; missing [AAPL dated quote, MSFT dated quote, VOO dated quote]");
      // Derived but not shown, or no recorded lineage: nothing.
      expect(evidenceDetail(run(task, [portfolio, quote], [holdings, quoteEntry, weight(["U1", "E1"])], "NVDA dominates [C1].").details)).toContain("[Evidence: 0/15]");
      expect(evidenceDetail(run(task, [portfolio, quote], [holdings, quoteEntry, weight(undefined)], text, shown).details)).toContain("[Evidence: 0/15]");
      // Lineage to an unserved quote earns nothing for the quote.
      const blocked = { ...quote, offlineOutcome: "not_available_as_of" as const };
      expect(evidenceDetail(run(task, [portfolio, blocked], [holdings, quoteEntry, weight(["U1", "E1"])], text, shown).details))
        .toContain("met [Declared holdings read and cited]; missing [NVDA dated quote");
    });

    it("pins a fact to its period when the requirement names one", () => {
      const task = byId("retail-13-semis-figure-survival");
      const latest = financials("E1", "AMD", "key_metrics", [fact("revenue", "2024-09-28", 6_819_000_000), fact("revenue", "2024-06-29", 5_835_000_000)]);
      const intel = financials("E2", "INTC", "key_metrics", [fact("grossMargin", "2024-09-28", 15.03)]);
      const both = [backed("$6.819B", 6_819_000_000, ["E1"]), backed("15.03%", 15.03, ["E2"])];
      expect(evidenceDetail(run(task, [latest.call, intel.call], [latest.entry, intel.entry], "AMD $6.819B [E1]; Intel 15.03% [E2].", both).details)).toContain("[Evidence: 15/15]");

      const stale = financials("E1", "AMD", "key_metrics", [fact("revenue", "2024-06-29", 5_835_000_000)]);
      expect(evidenceDetail(run(task, [stale.call], [stale.entry], "AMD $5.835B [E1].", [backed("$5.835B", 5_835_000_000, ["E1"])]).details)).toContain("[Evidence: 0/15]");
    });

    it("credits a statement fact served through the key-metrics view when that view carries the metric", () => {
      const task = byId("retail-05-intel-value-trap");
      const label = "INTC free cash flow, Q2 2024 (2024-06-29)";
      const fcf = [backed("-$3.39B", -3_390_000_000, ["E1"])];

      // Free cash flow is the same ground truth in the key-metrics view as in the cash flow statement.
      const viaKeyMetrics = financials("E1", "INTC", "key_metrics", [fact("freeCashFlow", "2024-06-29", -3_390_000_000)]);
      expect(evidenceDetail(run(task, [viaKeyMetrics.call], [viaKeyMetrics.entry], "FCF was -$3.39B [E1].", fcf).details)).toContain(`[Evidence: 4/15] met [${label}]`);
      // A key-metrics entry without the metric serves nothing for it, whatever else it shows.
      const lacking = financials("E1", "INTC", "key_metrics", [fact("revenue", "2024-06-29", 12_833_000_000)]);
      expect(evidenceDetail(run(task, [lacking.call], [lacking.entry], "Revenue $12.833B [E1].", [backed("$12.833B", 12_833_000_000, ["E1"])]).details)).toContain("[Evidence: 0/15]");
      // An unrelated statement still does not count.
      const income = financials("E1", "INTC", "income", [fact("freeCashFlow", "2024-06-29", -3_390_000_000)]);
      expect(evidenceDetail(run(task, [income.call], [income.entry], "FCF was -$3.39B [E1].", fcf).details)).toContain("[Evidence: 0/15]");

      const debt: EvalTask = {
        ...task,
        requiredEvidence: [{ kind: "fact", label: "INTC long-term debt", points: 15, ticker: "INTC", statement: "balance", metric: "longTermDebt" }],
      };
      const balance = financials("E1", "INTC", "key_metrics", [fact("longTermDebt", "2024-03-30", 49_000_000_000)]);
      expect(evidenceDetail(run(debt, [balance.call], [balance.entry], "Long-term debt $49B [E1].", [backed("$49B", 49_000_000_000, ["E1"])]).details))
        .toBe("[Evidence: 15/15] met [INTC long-term debt]; missing [none]");
    });

    it("credits holdings read through portfolio_get only when the answer uses them", () => {
      const task = byId("retail-12-concentration-profile-fit");
      // Holdings are user-provided entries: they carry no tool call id, and portfolio_get never
      // passes through the mock, so it has no offline outcome.
      const holdings: EvidenceEntry[] = [
        { id: "U1", kind: "U", origin: "holdings", summary: "AAPL: 55 shares", name: "AAPL quantity", value: 55, entity: { ticker: "AAPL" }, fetchedAt: "2024-09-20T12:00:00Z" },
        { id: "U2", kind: "U", origin: "holdings", summary: "NVDA: 40 shares", name: "NVDA quantity", value: 40, entity: { ticker: "NVDA" }, fetchedAt: "2024-09-20T12:00:00Z" },
      ];
      const read: ToolCallTrace = { ...call("portfolio_get", { mode: "current" }), details: { evidence: holdings } };

      const shares = [backed("55", 55, ["U1"])];
      const label = "Declared holdings read and cited";
      expect(evidenceDetail(run(task, [read], holdings, "Your 55 AAPL shares [U1] dominate.", shares).details)).toContain(`met [${label}`);
      expect(evidenceDetail(run(task, [read], holdings, "You hold mostly large tech.").details)).toContain(`missing [${label}`);
      // Naming the holdings entry without showing anything from it is not reading it.
      expect(evidenceDetail(run(task, [read], holdings, "Your AAPL position [U1] dominates.").details)).toContain(`missing [${label}`);
      expect(evidenceDetail(run(task, [{ ...read, isError: true }], holdings, "Your 55 AAPL shares [U1].", shares).details)).toContain(`missing [${label}`);
      // An entry the call did not produce cannot be credited to it.
      expect(evidenceDetail(run(task, [{ ...read, details: {} }], holdings, "Your 55 AAPL shares [U1].", shares).details)).toContain(`missing [${label}`);
    });

    it("credits the dated quote for the named ticker from a served market_quotes call", () => {
      const task = byId("retail-14-apple-pre-open-timing");
      const quote = (symbols: string[], entity: string, extra: Record<string, unknown> = {}, outcome: OfflineOutcome = "served") => {
        const entry: EvidenceEntry = {
          id: "E1", kind: "E", summary: `Market Quotes, $${entity}`, fetchedAt: "2024-10-31T12:15:00Z",
          tool: "market_quotes", toolCallId: "call-quote", source: { id: "quotes", name: "Market Quotes", tier: 2 }, entity: { ticker: entity },
        };
        const trace: ToolCallTrace = { ...call("market_quotes", { symbols }), toolCallId: "call-quote", offlineOutcome: outcome, details: { asOf: "2024-10-31", missing: [], ...extra, evidence: entry } };
        return { trace, entry };
      };
      const label = "Dated prior close (2024-10-30) cited";
      const close = [backed("$230.10", 230.1, ["E1"])];

      const direct = quote(["AAPL"], "AAPL");
      expect(evidenceDetail(run(task, [direct.trace], [direct.entry], "Last close $230.10 [E1].", close).details)).toContain(`[Evidence: 15/15] met [${label}]`);
      // One entry covers a multi-symbol call and is named after its first symbol.
      const batch = quote(["MSFT", "AAPL"], "MSFT");
      expect(evidenceDetail(run(task, [batch.trace], [batch.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 15/15]");
      const missing = quote(["MSFT", "AAPL"], "MSFT", { missing: [{ symbol: "AAPL", status: "not_captured" }] });
      expect(evidenceDetail(run(task, [missing.trace], [missing.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
      const other = quote(["MSFT"], "MSFT");
      expect(evidenceDetail(run(task, [other.trace], [other.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
      const blocked = quote(["AAPL"], "AAPL", {}, "not_available_as_of");
      expect(evidenceDetail(run(task, [blocked.trace], [blocked.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
    });

    it("credits the dated quote from any served quote tool, not only market_quotes", () => {
      const task = byId("retail-14-apple-pre-open-timing");
      const label = "Dated prior close (2024-10-30) cited";
      const close = [backed("$230.10", 230.1, ["E1"])];
      const alpha = (tool: string, symbol: string, outcome: OfflineOutcome = "served", isError = false) => {
        const entry: EvidenceEntry = {
          id: "E1", kind: "E", summary: `Alpha Vantage, $${symbol}`, fetchedAt: "2024-10-31T12:15:00Z",
          tool, toolCallId: "call-av", source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 }, entity: { ticker: symbol },
        };
        const trace: ToolCallTrace = { ...call(tool, { symbol }), toolCallId: "call-av", isError, offlineOutcome: outcome, details: { evidence: entry } };
        return { trace, entry };
      };

      const global = alpha("alphavantage__GLOBAL_QUOTE", "AAPL");
      expect(evidenceDetail(run(task, [global.trace], [global.entry], "Last close $230.10 [E1].", close).details)).toContain(`[Evidence: 15/15] met [${label}]`);
      const daily = alpha("alphavantage__TIME_SERIES_DAILY", "AAPL");
      expect(evidenceDetail(run(task, [daily.trace], [daily.entry], "Last close $230.10 [E1].", close).details)).toContain(`[Evidence: 15/15] met [${label}]`);
      // A served quote for another ticker, an unused one, a blocked one or an error earns nothing.
      const other = alpha("alphavantage__GLOBAL_QUOTE", "MSFT");
      expect(evidenceDetail(run(task, [other.trace], [other.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
      expect(evidenceDetail(run(task, [global.trace], [global.entry], "Apple closed higher.").details)).toContain("[Evidence: 0/15]");
      // Tagging the quote without printing it is not using it.
      expect(evidenceDetail(run(task, [global.trace], [global.entry], "See the last close [E1].").details)).toContain("[Evidence: 0/15]");
      const blocked = alpha("alphavantage__TIME_SERIES_DAILY", "AAPL", "not_available_as_of");
      expect(evidenceDetail(run(task, [blocked.trace], [blocked.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
      const failed = alpha("alphavantage__GLOBAL_QUOTE", "AAPL", "served", true);
      expect(evidenceDetail(run(task, [failed.trace], [failed.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
      // Tools that are not quotes do not count, even for the right ticker.
      const overview = alpha("alphavantage__COMPANY_OVERVIEW", "AAPL");
      expect(evidenceDetail(run(task, [overview.trace], [overview.entry], "Last close $230.10 [E1].", close).details)).toContain("[Evidence: 0/15]");
    });

    it("counts figures and quotes in a delivered report, where the short chat reply has none", () => {
      const task = byId("retail-11-nike-earnings-review-report");
      const releaseUrl = sources(task)[0]?.urls[0] ?? "";
      const read = {
        ...sourceCall("edgar_read_filing", "read-release", releaseUrl, true),
        output: "[E1 · SEC EDGAR · tier 1 · as of 2024-06-27]\n\nNIKE, Inc. expects fiscal 2025 revenue to be down mid-single digits, with first quarter revenue down approximately 10 percent.",
      };
      const readEntry = (read.details as { evidence: EvidenceEntry }).evidence;
      readEntry.id = "E1";
      const report = (text: string, isError = false): ToolCallTrace => ({
        ...call("create_report", { spec: { title: "Nike Q4 FY24", sections: [{ heading: "Guidance", blocks: [{ type: "text", text }] }] } }),
        toolCallId: "call-report",
        isError,
        details: { figures: ["E1"], html: "<html></html>" },
      });
      const reply = "The report is open beside the chat: revenue fell and the guide was cut.";
      const label = "Nike Q4 FY24 8-K Exhibit 99.1";
      const revenue = [backed("USD 12.61B", 12_610_000_000, ["E1"])];

      expect(evidenceDetail(run(task, [read], [readEntry], reply).details)).toContain("[Evidence: 0/15]");
      // The report printed a figure the matcher attributes to the release.
      expect(evidenceDetail(run(task, [read, report("Revenue {E1:revenue:FY24 Q4}.")], [readEntry], reply, [], revenue).details)).toContain(`[Evidence: 15/15] met [${label}]`);
      // The renderer's list of ids it touched, or a URL in the spec, is not a figure.
      const urlOnly = report(`Source: ${releaseUrl}`);
      expect(evidenceDetail(run(task, [read, urlOnly], [readEntry], reply).details)).toContain("[Evidence: 0/15]");
      // A passage quoted in the report's prose is use.
      const quoted = report("Nike said it expects fiscal 2025 revenue to be down mid-single digits.");
      expect(evidenceDetail(run(task, [read, quoted], [readEntry], reply).details)).toContain("[Evidence: 15/15]");
      // A rejected report delivered nothing, so it shows nothing.
      expect(evidenceDetail(run(task, [read, report("Nike said it expects fiscal 2025 revenue to be down mid-single digits.", true)], [readEntry], reply).details)).toContain("[Evidence: 0/15]");
    });
  });

  it("scores an empty final answer as zero even when tools ran", () => {
    const result = runDeterministicChecks({
      task: NVDA,
      toolCalls: [call("edgar_financials"), call("edgar_filings")],
      finalText: "",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income")],
      figureMatches: [],
      evidenceAvailable: true,
    });

    expect(result.score).toBe(0);
    expect(result.matchedEntities).toEqual([]);
  });

  it("awards all 40 when entities, tools, derived figures and sourcing line up", () => {
    const result = runDeterministicChecks({
      task: QUOTED,
      toolCalls: [quote()],
      finalText: "NVDA revenue was $30,040M and gross margin 75.1%.",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income"), entry("C1", "C", "QoQ margin change")],
      figureMatches: [backed("$30,040M", 30_040, ["E1"]), backed("75.1%", 75.1, ["E1"])],
      evidenceAvailable: true,
    });

    expect(result.version).toBe(BENCHMARK_VERSION);
    expect(result.score).toBe(40);
    expect(result.derivedFigures).toBe(1);
    expect(result.figuresBacked).toBe(2);
  });

  it("scores the calculator on derived figures, not on the tool name", () => {
    const result = runDeterministicChecks({
      task: NVDA,
      toolCalls: [call("edgar_financials", { ticker: "NVDA" }), call("financial_calculator", { code: "1+1" })],
      finalText: "NVDA revenue was $30,040M.",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income")],
      figureMatches: [backed("$30,040M", 30_040, ["E1"])],
      evidenceAvailable: true,
    });

    expect(result.mathExpectationSatisfied).toBe(false);
    expect(result.details.some((detail) => detail.startsWith("[Math: 0/5]"))).toBe(true);
  });

  it("gives partial citation credit for the share of figures the ledger backs", () => {
    const result = runDeterministicChecks({
      task: QUOTED,
      toolCalls: [quote()],
      finalText: "Revenue $30,040M, margin 75.1%, and a made-up 42.7% share.",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income"), entry("C1", "C", "margin delta")],
      figureMatches: [
        backed("$30,040M", 30_040, ["E1"]),
        backed("75.1%", 75.1, ["E1"]),
        { figure: figure("42.7%", 42.7, 40), matches: [] },
      ],
      evidenceAvailable: true,
    });

    expect(result.figuresChecked).toBe(3);
    expect(result.figuresBacked).toBe(2);
    // 2 of 3 figures backed, rounded onto the 5-point scale.
    expect(result.score).toBe(15 + 15 + 5 + 3);
  });

  it("notes that no report was delivered when the answer stands alone", () => {
    const result = runDeterministicChecks({
      task: QUOTED,
      toolCalls: [quote()],
      finalText: "The report is open: revenue $30,040M.",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income"), entry("C1", "C", "margin delta")],
      figureMatches: [backed("$30,040M", 30_040, ["E1"])],
      evidenceAvailable: true,
    });
    expect(result.details.find((detail) => detail.startsWith("[Citations:"))).toBe(
      "[Citations: 5/5] 1/1 non-exempt figures backed by evidence (0 from the delivered report)",
    );
  });

  describe("the report validator's verification summary", () => {
    const input = {
      task: QUOTED,
      finalText: "The report is open: revenue $30,040M.",
      sessionTickers: ["NVDA"],
      evidence: [entry("E1", "E", "EDGAR income"), entry("C1", "C", "margin delta")],
      figureMatches: [backed("$30,040M", 30_040, ["E1"])],
      // The report's figures as matched by value; its citation count comes from the validator.
      reportFigureMatches: [backed("USD 30.04B", 30_040_000_000, ["E1"]), backed("75.1%", 75.1, ["E1"])],
      evidenceAvailable: true,
    };
    const reportCall = (details: unknown, isError = false): ToolCallTrace => ({ ...call("create_report", { spec: { title: "NVDA", sections: [] } }), details, isError });
    const tools = [quote()];
    const citations = (details: string[]) => details.find((detail) => detail.startsWith("[Citations:"));
    const summary = (checked: number, supported: number, repaired: number, unverified: number) => ({
      verification: { checked, supported, repaired, unverified, byKind: { values: unverified, sources: 0, references: 0, structure: 0 } },
    });

    it("scores the report's figures from the summary, weighted with the chat's", () => {
      const result = runDeterministicChecks({ ...input, toolCalls: [...tools, reportCall(summary(9, 3, 0, 6))] });
      // Chat 1/1 plus report 3/9: 4/10.
      expect(result.figuresChecked).toBe(10);
      expect(result.figuresBacked).toBe(4);
      expect(citations(result.details)).toBe(
        "[Citations: 2/5] 4/10 non-exempt figures backed by evidence (9 from the delivered report, per its validator: 6 unsupported)",
      );
    });

    it("counts a repaired citation as supported", () => {
      const result = runDeterministicChecks({ ...input, toolCalls: [...tools, reportCall(summary(9, 3, 5, 1))] });
      expect(result.figuresChecked).toBe(10);
      expect(result.figuresBacked).toBe(9);
      expect(citations(result.details)).toBe(
        "[Citations: 5/5] 9/10 non-exempt figures backed by evidence (9 from the delivered report, per its validator: 1 unsupported, 5 citation(s) repaired)",
      );
    });

    it("sums the summaries of several delivered reports and ignores a rejected one", () => {
      const result = runDeterministicChecks({
        ...input,
        toolCalls: [...tools, reportCall(summary(4, 4, 0, 0)), reportCall(summary(6, 1, 1, 4)), reportCall(summary(50, 0, 0, 50), true)],
      });
      expect(result.figuresChecked).toBe(11);
      expect(result.figuresBacked).toBe(7);
    });

  });

  it("scores entities and tools proportionally when some are missing", () => {
    const nike = RETAIL_EVAL_TASKS.find((task) => task.id === "retail-02-nike-moat-erosion");
    expect(nike).toBeDefined();
    if (!nike) return;

    const result = runDeterministicChecks({
      task: nike,
      toolCalls: [],
      finalText: "Nike looks cheap.",
      sessionTickers: ["NKE"],
      evidence: [],
      figureMatches: [],
      evidenceAvailable: false,
    });
    expect(result.score).toBeLessThan(40);
  });
});

describe("fallbacks when no ledger exists", () => {
  const component = (details: string[], name: string) => details.find((detail) => detail.startsWith(`[${name}:`));

  it("falls back to the calculator tool name and to citation markers", () => {
    const result = runDeterministicChecks({
      task: QUOTED,
      toolCalls: [call("edgar_financials"), call("edgar_filings"), call("financial_calculator")],
      finalText: "NVDA revenue grew (EDGAR 10-Q, FY25 Q2) to $30,040M.",
      sessionTickers: ["NVDA"],
      evidence: [],
      figureMatches: [],
      evidenceAvailable: false,
    });

    expect(result.evidenceAvailable).toBe(false);
    expect(result.mathExpectationSatisfied).toBe(true);
    expect(result.citationCount).toBeGreaterThan(0);
    expect(component(result.details, "Math")).toMatch(/^\[Math: 5\/5\]/);
    expect(component(result.details, "Citations")).toMatch(/^\[Citations: 5\/5\]/);
    // Entities and the two fallbacks; no ledger means no evidence was used.
    expect(result.score).toBe(15 + 0 + 5 + 5);
  });

  it("gives no citation points to an answer with neither markers nor evidence", () => {
    const result = runDeterministicChecks({
      task: QUOTED,
      toolCalls: [call("edgar_financials"), call("edgar_filings"), call("financial_calculator")],
      finalText: "NVDA fell because expectations were high.",
      sessionTickers: ["NVDA"],
      evidence: [],
      figureMatches: [],
      evidenceAvailable: false,
    });

    expect(component(result.details, "Citations")).toMatch(/^\[Citations: 0\/5\]/);
    expect(result.score).toBe(15 + 0 + 5 + 0);
  });
});

describe("rebuilding the ledger from a transcript", () => {
  it("matches the answer's figures against the entries the turn registered", async () => {
    const evidence: EvidenceEntry = {
      id: "E1",
      kind: "E",
      summary: "EDGAR income statement, quarterly, $NVDA",
      fetchedAt: "2026-01-01T00:00:00Z",
      facts: [{ metric: "revenue", period: "FY25 Q2", value: 30_040, unit: "USD" }],
    };
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000",
      dataDir: "/tmp/does-not-need-to-exist",
      messages: [
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "edgar_financials",
          content: [{ type: "text", text: "Revenue: $30,040M" }],
          isError: false,
          timestamp: 0,
          details: { evidence },
        },
      ],
      reported: [evidence],
      finalText: "Revenue reached $30,040M in the quarter.",
    });

    expect(analysis.available).toBe(true);
    expect(analysis.entries.map((item) => item.id)).toEqual(["E1"]);
    expect(analysis.figureMatches.some((match) => match.matches.includes("E1"))).toBe(true);
  });

  it("matches the figures a delivered report shows: cells, evidence tables, references and literals", async () => {
    const messages = [
      {
        role: "toolResult" as const,
        toolCallId: "call-1",
        toolName: "edgar_financials",
        content: [{ type: "text" as const, text: "Revenue: $12,606M" }],
        isError: false,
        timestamp: 0,
        details: {
          evidence: {
            id: "E1",
            kind: "E" as const,
            summary: "EDGAR key metrics, quarterly, $NKE",
            fetchedAt: "2026-01-01T00:00:00Z",
            facts: [{ metric: "revenue", period: "FY24 Q4", value: 12_606_000_000, unit: "USD" }],
          },
        },
      },
    ];
    const spec = {
      title: "Nike FY24 Q4",
      sections: [{
        heading: "Results",
        blocks: [
          { type: "kpis", items: [{ label: "Revenue", cell: { value: 12.61, unit: "USD B", src: "E1" } }] },
          { type: "text", text: "Revenue was {E1:revenue:FY24 Q4}, and wholesale took a 42.7% share." },
          { type: "evidence_table", source: "E1" },
        ],
      }],
    };
    const delivered: ToolCallTrace = { ...call("create_report", { spec: JSON.stringify(spec) }), toolCallId: "call-report" };
    const rejected: ToolCallTrace = { ...call("create_report", { spec: { ...spec, title: "Draft", sections: [{ heading: "x", blocks: [{ type: "text", text: "99.9%" }] }] } }), isError: true };
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000",
      dataDir: "/tmp/does-not-need-to-exist",
      messages,
      reported: [messages[0].details.evidence],
      finalText: "The report is open.",
      toolCalls: [delivered, rejected],
    });

    const report = analysis.reportFigureMatches.filter((match) => !match.figure.exempt);
    expect(report.map((match) => [match.figure.raw, match.matches])).toEqual([
      ["USD 12.61B", ["E1"]],
      ["USD 12.61B", ["E1"]],
      ["USD 12.61B", ["E1"]],
      ["42.7%", []],
    ]);
  });

  it("counts a figure the user typed as sourced, via a U entry", async () => {
    const filing: EvidenceEntry = { id: "E1", kind: "E", summary: "EDGAR 8-K, $SMCI", fetchedAt: "2026-01-01T00:00:00Z" };
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000",
      dataDir: "/tmp/does-not-need-to-exist",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Super Micro has crashed over 53.4% in days. Dip-buying opportunity?" }],
          timestamp: 0,
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "edgar_filings",
          content: [{ type: "text", text: "8-K: auditor resignation" }],
          isError: false,
          timestamp: 1,
          details: { evidence: filing },
        },
      ],
      reported: [filing],
      finalText: "You mention the 53.4% fall; the auditor resignation is the reason to look at.",
    });

    expect(analysis.available).toBe(true);
    expect(analysis.entries.map((item) => item.kind).sort()).toEqual(["E", "U"]);
    const drop = analysis.figureMatches.find((match) => match.figure.value === 53.4);
    expect(drop?.matches.some((id) => id.startsWith("U"))).toBe(true);
  });

  it("reports no ledger, and the answer's raw figures, when nothing registered evidence", async () => {
    const analysis = await analyseEvidence({
      sessionId: "1ac74a0c-0000-4000-8000-000000000000",
      dataDir: "/tmp/does-not-need-to-exist",
      messages: [],
      reported: [],
      finalText: "Revenue reached $30,040M.",
    });

    expect(analysis.available).toBe(false);
    expect(analysis.entries).toEqual([]);
    expect(analysis.figureMatches.every((match) => match.matches.length === 0)).toBe(true);
  });
});
