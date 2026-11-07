import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { registerToolResult } from "@/lib/evidence/register";
import type { TimeContext } from "@/lib/time/types";
import { offlineContext } from "@/lib/tools/testing";
import { stockfitModule, stockfitPreset } from "./module";
import { fixtAccessions, fixtureBody, fixtureTools } from "./responses.fixture";

const listTools = vi.fn();
const callTool = vi.fn();
vi.mock("@/lib/mcp/client", () => ({ connect: async () => ({ listTools, callTool }) }));

const names = fixtureTools.map((tool) => tool.name);
// No cache, so nothing here touches a data folder.
const config = { apiKey: "test-key", allowTools: names, cacheTtlSeconds: 0 };

const fixed: TimeContext = {
  mode: "fixed",
  timeZone: "America/New_York",
  localDate: "2025-08-15",
  asOf: "2025-08-15",
  market: { session: "after_hours", lastCompletedSession: "2025-08-15", nextOpen: "2025-08-18T09:30:00-04:00" },
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-stockfit-"));
  listTools.mockResolvedValue({ tools: fixtureTools });
  callTool.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_available_tools_of_current_plan") {
      return { content: [{ type: "text", text: JSON.stringify({ currentTier: "free", totalTools: 124, accessibleCount: 34, tools: [] }) }] };
    }
    return { content: [{ type: "text", text: fixtureBody(request.name) }] };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

async function tool(name: string, asOf?: string) {
  const tools = await stockfitModule.createTools(config, offlineContext({ asOf }));
  const found = tools.find((candidate) => candidate.label === name);
  if (!found) throw new Error(`${name} was not built`);
  return found;
}

describe("StockFit connection", () => {
  it("contributes no tool until it has a key", async () => {
    expect(await stockfitModule.createTools(stockfitModule.defaultConfig, offlineContext())).toEqual([]);
  });

  it("sends the key as a bearer token, never in the URL", () => {
    const preset = stockfitPreset({ apiKey: "secret-key" });
    expect(preset.headers?.Authorization).toBe("Bearer secret-key");
    expect(preset.url).not.toContain("secret-key");
    expect(preset.coverage).toEqual(expect.arrayContaining(["fundamentals", "earnings", "filings", "prices", "news"]));
  });

  it("reads a typed-in cache TTL, zero included, and a cleared box as the default", () => {
    expect(stockfitPreset({ apiKey: "k", cacheTtlSeconds: "0" }).cacheTtlSeconds).toBe(0);
    expect(stockfitPreset({ apiKey: "k", cacheTtlSeconds: "" }).cacheTtlSeconds).toBe(900);
  });

  it("reports the key's plan when validated, and refuses a key the server rejects", async () => {
    expect(await stockfitModule.validate?.(config)).toMatchObject({ ok: true, message: expect.stringContaining("free plan: 34 of 124") });
    callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "Error 401: invalid token" }], isError: true });
    expect(await stockfitModule.validate?.(config)).toMatchObject({ ok: false, message: expect.stringContaining("Settings › Data connections") });
  });
});

describe("StockFit tool availability", () => {
  it("offers every allowed tool on a live turn", async () => {
    const tools = await stockfitModule.createTools(config, offlineContext());
    expect(tools.map((built) => built.label)).toEqual(names);
  });

  it("offers a fixed historical turn only the tools that honour its cutoff", async () => {
    const tools = await stockfitModule.createTools(config, offlineContext({ asOf: "2025-08-15" }));
    expect(tools.map((built) => built.label)).toEqual(["financials_income_statement", "financials_balance_sheet", "price_history"]);
  });

  it("does not read an emptied historical selection as permission to expose every tool", async () => {
    const tools = await stockfitModule.createTools({ ...config, allowTools: ["company_details"] }, offlineContext({ asOf: "2025-08-15" }));
    expect(tools).toEqual([]);
  });
});

describe("StockFit requests", () => {
  it("asks for statements as filed on a historical turn, and as given on a live one", async () => {
    await (await tool("financials_income_statement", "2025-08-15")).execute("call-1", { symbol: "FIXT", period: "quarter" });
    await (await tool("financials_income_statement")).execute("call-2", { symbol: "FIXT", period: "quarter" });
    const [historical, live] = callTool.mock.calls.map(([request]) => request.arguments);
    expect(historical).toMatchObject({ symbol: "FIXT", period: "quarter", splitAdjust: false });
    expect(historical.limit).toBeGreaterThan(4);
    expect(live).toEqual({ symbol: "FIXT", period: "quarter" });
  });

  it("registers a historical statement as evidence holding only what was filed by then", async () => {
    const income = await tool("financials_income_statement", fixed.asOf);
    const args = { symbol: "FIXT", period: "quarter" };
    const result = await income.execute("call-1", args);
    const ledger = createLedger({ sessionId: "chat-1", dataDir: home });

    const { entry } = await registerToolResult({ ledger, tool: income, toolCallId: "call-1", args, result, isError: false, time: fixed });

    expect(entry).toMatchObject({ source: { id: "stockfit", name: "StockFit", tier: 2 }, entity: { ticker: "FIXT" }, asOf: "2025-07-30" });
    expect(entry?.lookAhead).toBeUndefined();
    expect(ledger.findFacts({ entity: { ticker: "FIXT" }, metric: "netIncome", period: "2025-06-30" }).map(({ fact }) => fact))
      .toEqual([expect.objectContaining({ value: 120, unit: "USD", ref: fixtAccessions.Q2_10Q })]);
    expect(ledger.findFacts({ entity: { ticker: "FIXT" }, metric: "revenue" })).toEqual([]);
  });
});
