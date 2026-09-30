import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage, AgentToolResult } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TimeContext } from "@/lib/time/types";
import type { ToolMeta } from "@/lib/tools/contracts";
import { createLedger } from "./ledger";
import { registersEvidence, registerToolResult } from "./register";
import type { EvidenceLedger } from "./types";

let home: string;
let ledger: EvidenceLedger;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-register-"));
  ledger = createLedger({ sessionId: "chat-1", dataDir: home });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const live: TimeContext = {
  mode: "live",
  timeZone: "America/New_York",
  localDate: "2026-09-13",
  market: { session: "closed", reason: "weekend", lastCompletedSession: "2026-09-11", nextOpen: "2026-09-14T09:30:00-04:00" },
};

const fixed: TimeContext = { ...live, mode: "fixed", localDate: "2024-08-28", asOf: "2024-08-28" };

const edgarMeta: ToolMeta = {
  class: "data",
  effect: "read",
  source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["fundamentals"] },
};

const avMeta: ToolMeta = {
  class: "data",
  effect: "read",
  source: { id: "alphavantage", name: "Alpha Vantage", tier: 2, coverage: ["fundamentals"] },
};

const statement = `NVDA

**NVIDIA CORP — Income statement** (quarterly, as reported; USD millions except EPS)

| Line | 2024-07-28 |
| :--- | ---: |
| Revenue | 30,040.0 |
| Net income | 16,599.0 |

Source: accession numbers per column — 2024-07-28: 0001045810-24-000029`;

/** What the EDGAR module attaches to that statement, so the ledger indexes it exactly. */
const statementDetails = {
  statement: "income",
  summary: "EDGAR income statement, quarterly, $NVDA, 1 period (latest 2024-07-28)",
  entity: { ticker: "NVDA", cik: "0001045810", name: "NVIDIA CORP" },
  asOf: "2024-07-28",
  periods: ["2024-07-28"],
  currency: "USD",
  facts: [
    { metric: "revenue", period: "2024-07-28", periodType: "quarterly", value: 30_040_000_000, unit: "USD", ref: "0001045810-24-000029", end: "2024-07-28" },
    { metric: "netIncome", period: "2024-07-28", periodType: "quarterly", value: 16_599_000_000, unit: "USD", ref: "0001045810-24-000029", end: "2024-07-28" },
  ],
  table: { columns: ["Line", "2024-07-28"], rows: [["Revenue", 30_040_000_000], ["Net income", 16_599_000_000]], index: "Line" },
};

const result = (text: string, details: unknown = {}): AgentToolResult<unknown> => ({
  content: [{ type: "text", text }],
  details,
});

const registerEdgar = (target = ledger, time = live) =>
  registerToolResult({
    ledger: target,
    tool: { name: "edgar_financials", meta: edgarMeta },
    toolCallId: "call-1",
    args: { ticker: "NVDA", statement: "income", period: "quarterly" },
    result: result(statement, statementDetails),
    isError: false,
    time,
  });

/** Alpha Vantage's details for a report of one quarter's revenue. */
const reportDetails = (symbol: string, revenue: number) => ({
  summary: `Alpha Vantage INCOME_STATEMENT, $${symbol}, 1 quarterly and annual periods`,
  entity: { ticker: symbol },
  asOf: "2024-07-28",
  facts: [{ metric: "revenue", period: "2024-07-28", periodType: "quarterly", value: revenue, unit: "USD" }],
});

/** Alpha Vantage reporting the same quarter, so the two overlap. */
const registerAlphaVantage = (revenue: number) =>
  registerToolResult({
    ledger,
    tool: { name: "alphavantage__INCOME_STATEMENT", meta: avMeta },
    toolCallId: "call-2",
    args: { symbol: "NVDA" },
    result: result(
      JSON.stringify({
        symbol: "NVDA",
        quarterlyReports: [{ fiscalDateEnding: "2024-07-28", reportedCurrency: "USD", totalRevenue: String(revenue) }],
      }),
      reportDetails("NVDA", revenue),
    ),
    isError: false,
    time: live,
  });

describe("what gets registered", () => {
  it("registers data connections and the web tools, nothing else", () => {
    expect(registersEvidence({ name: "edgar_financials", meta: edgarMeta })).toBe(true);
    expect(registersEvidence({ name: "web_search", meta: { class: "general", effect: "external" } })).toBe(true);
    expect(registersEvidence({ name: "web_fetch", meta: { class: "general", effect: "external" } })).toBe(true);
    expect(registersEvidence({ name: "memory_update", meta: { class: "general", effect: "write-local" } })).toBe(false);
    expect(registersEvidence({ name: "create_report", meta: { class: "finance", effect: "compute" } })).toBe(false);
  });

  it("passes a general tool through untouched", async () => {
    const original = result("Memory updated.", { section: "Profile" });
    const output = await registerToolResult({
      ledger,
      tool: { name: "memory_update", meta: { class: "general", effect: "write-local" } },
      toolCallId: "call-9",
      args: {},
      result: original,
      isError: false,
      time: live,
    });
    expect(output.entry).toBeUndefined();
    expect(output.content).toBe(original.content);
    expect(output.details).toBe(original.details);
    expect(ledger.list()).toEqual([]);
  });

  it.each([
    { name: "edgar_financials", meta: edgarMeta },
    { name: "web_search", meta: { class: "general", effect: "external" } as ToolMeta },
    { name: "portfolio_get", meta: { class: "general", effect: "read" } as ToolMeta },
  ])("distinguishes a failed $name lookup from a negative finding without creating evidence", async (tool) => {
    const original = result("Connection unavailable", { status: 503 });
    const output = await registerToolResult({
      ledger,
      tool,
      toolCallId: "call-8",
      args: {},
      result: original,
      isError: true,
      time: live,
    });
    expect(output.entry).toBeUndefined();
    expect(output.content).toEqual([{ type: "text", text:
      "Retrieval failed: the requested data is unavailable. This error establishes neither the requested facts nor their absence.\n\nConnection unavailable" }]);
    expect(output.details).toBe(original.details);
    expect(original.content).toEqual([{ type: "text", text: "Connection unavailable" }]);
    expect(ledger.list()).toEqual([]);
  });

  it("preserves a successful empty lookup and non-retrieval errors", async () => {
    for (const [tool, isError, text] of [
      [{ name: "portfolio_get", meta: { class: "general", effect: "read" } }, false, "No accounts yet."],
      [{ name: "create_report", meta: { class: "finance", effect: "compute" } }, true, "Invalid section index; saved draft unchanged."],
    ] as const) {
      const original = result(text);
      const output = await registerToolResult({ ledger, tool, toolCallId: "call-10", args: {}, result: original, isError, time: live });
      expect(output.content).toBe(original.content);
      expect(output.details).toBe(original.details);
      expect(output.entry).toBeUndefined();
    }
    expect(ledger.list()).toEqual([]);
  });
});

describe("a registered result", () => {
  it("shows exact indexed table keys and a stored-value example without changing the source", async () => {
    const table = { columns: ["metric", "2023-05-31"], rows: [["freeCashFlow", 4_872_000_000]], index: "metric" };
    const original = result("Free cash flow: USD 4,872 million", { table, unit: "USD" });
    const output = await registerToolResult({ ledger, tool: { name: "edgar_financials", meta: edgarMeta },
      toolCallId: "schema", args: {}, result: original, isError: false, time: live });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain('index "metric"; columns ["2023-05-31"]; row keys ["freeCashFlow"]');
    expect(text).toContain('Example: `E1.loc["freeCashFlow", "2023-05-31"]` = 4872000000');
    expect(text.endsWith("Free cash flow: USD 4,872 million")).toBe(true);
    expect(output.entry?.table).toEqual(table);
    expect(await ledger.loadPayload("E1")).toEqual(original);
  });

  it("bounds indexed table previews and identifies omitted keys", async () => {
    const columns = ["metric", ...Array.from({ length: 20 }, (_, i) => `period${i}`)];
    const rows = Array.from({ length: 20 }, (_, i) => [`line${i}`, ...Array(20).fill(i)]);
    const output = await registerToolResult({ ledger, tool: { name: "edgar_financials", meta: edgarMeta },
      toolCallId: "wide-schema", args: {}, result: result("Statement", { table: { columns, rows, index: "metric" } }),
      isError: false, time: live });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain("first 12 of 20");
    expect(text).toContain('"line11"');
    expect(text).not.toContain('"line12"');
    expect(text).not.toContain('"period12"');
    expect(text.length).toBeLessThan(1_000);
  });

  it("shows stored per-metric units beside a statement displayed in millions", async () => {
    const table = { columns: ["metric", "2024-06-29"], index: "metric", rows: [
      ["revenue", 12_833_000_000], ["dilutedShares", 4_267_000_000], ["dilutedEps", -0.38],
    ] };
    const facts = [
      { metric: "revenue", period: "2024-06-29", value: 12_833_000_000, unit: "USD" },
      { metric: "dilutedShares", period: "2024-06-29", value: 4_267_000_000, unit: "shares" },
      { metric: "dilutedEps", period: "2024-06-29", value: -0.38, unit: "USD/share" },
    ];
    const original = result("USD millions except EPS; shares in millions", { table, facts, unit: "USD" });
    const output = await registerToolResult({ ledger, tool: { name: "edgar_financials", meta: edgarMeta },
      toolCallId: "mixed-units", args: {}, result: original, isError: false, time: live });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain('Stored units: ["revenue: USD","dilutedShares: shares","dilutedEps: USD/share"]');
    expect(text.endsWith("USD millions except EPS; shares in millions")).toBe(true);
    expect(output.entry?.table).toEqual(table);
    expect(output.entry?.facts).toEqual(facts);
    expect(await ledger.loadPayload("E1")).toEqual(original);
  });

  it("uses known column units for a date-indexed table without inventing missing units", async () => {
    const table = { columns: ["date", "close", "volume", "unlabelled"], index: "date", rows: [["2024-06-29", 25, 1_000, 7]] };
    const facts = [
      { metric: "close", period: "2024-06-29", value: 25, unit: "USD" },
      { metric: "close", period: "2024-06-28", value: 24, unit: "USD" },
      { metric: "volume", period: "2024-06-29", value: 1_000, unit: "shares" },
      { metric: "other", period: "2024-06-29", value: 9, unit: "USD" },
    ];
    const output = await registerToolResult({ ledger, tool: { name: "prices", meta: edgarMeta },
      toolCallId: "column-units", args: {}, result: result("Prices", { table, facts }), isError: false, time: live });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain('Stored units: ["close: USD","volume: shares"]');
    expect(text).not.toContain("unlabelled:");
    expect(text.split("Report references:")[0]).not.toContain("other:");
  });

  it("retains the bounded table keys when unit metadata alone exceeds the hint limit", async () => {
    const output = await registerToolResult({ ledger, tool: { name: "data", meta: edgarMeta },
      toolCallId: "long-unit", args: {}, isError: false, time: live,
      result: result("Source", {
        table: { columns: ["metric", "2024"], index: "metric", rows: [["value", 10]] },
        facts: [{ metric: "value", period: "2024", value: 10, unit: "u".repeat(1_500) }],
      }),
    });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain('row keys ["value"]');
    expect(text).not.toContain("Stored units:");
    expect(text.length).toBeLessThan(1_500);
  });

  it("opens with its tag and keeps the original text below it", async () => {
    const output = await registerEdgar();
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text.startsWith("[E1 · SEC EDGAR · tier 1 · as of 2024-07-28 · table 2×2]\n\n")).toBe(true);
    expect(text).toContain("| Revenue | 30,040.0 |");
  });

  it("carries the entry on details beside the tool's own fields", async () => {
    const output = await registerEdgar();
    expect(output.details).toMatchObject({ statement: "income", evidence: { id: "E1", kind: "E" } });
    expect(output.entry?.tool).toBe("edgar_financials");
    expect(output.entry?.toolCallId).toBe("call-1");
    expect(output.entry?.args).toMatchObject({ ticker: "NVDA" });
  });

  it("stores the full payload and hashes it", async () => {
    const output = await registerEdgar();
    expect(output.entry?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(output.entry?.hasPayload).toBe(true);
    expect(await ledger.loadPayload("E1")).toMatchObject({ content: [{ text: statement }] });
  });

  it("produces the same entry when the result is replayed", async () => {
    const liveRun = await registerEdgar();
    const replayLedger = createLedger({ sessionId: "chat-2", dataDir: home });
    // A cassette round trip reorders object keys; the hash must not notice.
    const replayed = await registerToolResult({
      ledger: replayLedger,
      tool: { name: "edgar_financials", meta: edgarMeta },
      toolCallId: "call-1",
      args: { period: "quarterly", statement: "income", ticker: "NVDA" },
      result: JSON.parse(JSON.stringify({ details: statementDetails, content: [{ type: "text", text: statement }] })) as AgentToolResult<unknown>,
      isError: false,
      time: live,
    });
    expect(replayed.entry?.hash).toBe(liveRun.entry?.hash);
    expect(replayed.entry?.facts).toEqual(liveRun.entry?.facts);
    expect(replayed.entry?.id).toBe("E1");
  });
});

describe("reloading a chat", () => {
  it("rebuilds the same ledger from the transcript the details were saved on", async () => {
    await registerEdgar();
    await registerAlphaVantage(30_040_000_000);
    await ledger.flush();

    // What the session file holds: the details pi persisted, through JSON and back.
    const transcript: AgentMessage[] = ledger.list().map((entry, index) =>
      JSON.parse(
        JSON.stringify({
          role: "toolResult",
          toolCallId: `call-${index}`,
          toolName: entry.tool ?? "",
          content: [{ type: "text", text: "…" }],
          details: { evidence: entry },
          isError: false,
          timestamp: index,
        }),
      ) as AgentMessage,
    );

    const reopened = createLedger({ sessionId: "chat-1", dataDir: home, messages: transcript });
    expect(reopened.list()).toEqual(ledger.list());
    expect(reopened.add({ kind: "E", summary: "next" }).id).toBe("E3");
    // Payloads outlive the process, so a rebuilt entry can still be read in full.
    expect(await reopened.loadPayload("E1")).toMatchObject({ content: [{ text: statement }] });
  });
});

describe("point in time", () => {
  it("rejects a future-dated feed without publication metadata in a live turn", async () => {
    const output = await registerEdgar(ledger, { ...live, localDate: "2024-06-30", instant: "2024-06-30T12:15:00Z" });
    expect(output.entry?.lookAhead).toBe(true);
    expect(output.content[0]).toMatchObject({ text: expect.stringContaining("LOOK-AHEAD") });
  });

  it("uses disclosure time rather than period end for a pre-open answer", async () => {
    const output = await registerToolResult({ ledger, tool: { name: "edgar_financials", meta: edgarMeta },
      toolCallId: "after-close", args: {}, isError: false,
      time: { ...live, localDate: "2024-08-01", instant: "2024-08-01T12:15:00Z" },
      result: result("Revenue was $10M", { asOf: "2024-06-30", availableAt: "2024-08-01T20:30:00Z",
        table: { columns: ["metric", "Q2"], rows: [["revenue", 10_000_000]], index: "metric" } }),
    });
    expect(output.entry).toMatchObject({ asOf: "2024-06-30", availableAt: "2024-08-01T20:30:00Z", lookAhead: true });
    expect(JSON.stringify(output.content)).not.toContain("$10M");
    expect(JSON.stringify(output.content)).not.toContain("Calculator frame");
    expect(JSON.stringify(output.content)).toContain("values are withheld");
    expect(await ledger.loadPayload(output.entry!.id)).toMatchObject({ content: [{ text: "Revenue was $10M" }] });
    const computed = ledger.add({ kind: "C", summary: "Derived", value: 5, inputs: [output.entry!.id] });
    expect(computed.lookAhead).toBe(true);
  });
  it("marks evidence dated after a fixed as-of as look-ahead", async () => {
    const output = await registerEdgar(ledger, { ...fixed, asOf: "2024-06-30" });
    expect(output.entry?.lookAhead).toBe(true);
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain("LOOK-AHEAD");
  });

  it("leaves evidence on or before the as-of date alone", async () => {
    const output = await registerEdgar(ledger, fixed);
    expect(output.entry?.lookAhead).toBeUndefined();
  });

  it("accepts historical evidence in a live turn", async () => {
    const output = await registerEdgar(ledger, live);
    expect(output.entry?.lookAhead).toBeUndefined();
  });

  it.each([
    ["a timestamp on the cutoff day", "2026-09-13T20:00:00.000Z", undefined],
    ["a timestamp on the next day", "2026-09-14T00:30:00.000Z", true],
    ["the next day", "2026-09-14", true],
  ])("compares an as-of date by day, not as text: %s", async (_label, asOf, lookAhead) => {
    const register = (time: TimeContext) => registerToolResult({ ledger, tool: { name: "feed", meta: avMeta },
      toolCallId: `feed-${time.mode}`, args: {}, isError: false, time, result: result("Price 200", { asOf }) });
    expect((await register(live)).entry?.lookAhead).toBe(lookAhead);
    expect((await register({ ...fixed, localDate: "2026-09-13", asOf: "2026-09-13" })).entry?.lookAhead).toBe(lookAhead);
  });
});

describe("automatic cross-check", () => {
  it("records agreement when a second source reports the same figure", async () => {
    await registerEdgar();
    const output = await registerAlphaVantage(30_040_000_000);
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain("Cross-check: revenue 2024-07-28 agrees with E1");
    expect(output.entry?.conflicts).toContainEqual({
      with: "E1",
      metric: "revenue",
      period: "2024-07-28",
      value: 30_040_000_000,
      otherValue: 30_040_000_000,
      agree: true,
    });
  });

  it("reports a conflict with both values", async () => {
    await registerEdgar();
    const output = await registerAlphaVantage(31_000_000_000);
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).toContain("CONFLICT: revenue 2024-07-28 — E1 reports 30.04B vs 31.00B here");
    expect(output.entry?.conflicts?.[0].agree).toBe(false);
  });

  it("says nothing when the sources do not overlap", async () => {
    await registerEdgar();
    const output = await registerToolResult({
      ledger,
      tool: { name: "alphavantage__INCOME_STATEMENT", meta: avMeta },
      toolCallId: "call-3",
      args: { symbol: "AMD" },
      result: result(
        JSON.stringify({
          symbol: "AMD",
          quarterlyReports: [{ fiscalDateEnding: "2024-07-28", reportedCurrency: "USD", totalRevenue: "5835000000" }],
        }),
        reportDetails("AMD", 5_835_000_000),
      ),
      isError: false,
      time: live,
    });
    const text = output.content[0].type === "text" ? output.content[0].text : "";
    expect(text).not.toContain("Cross-check");
    expect(output.entry?.conflicts).toBeUndefined();
  });
});
