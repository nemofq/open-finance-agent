import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineContext } from "@/lib/tools/testing";
import { alphaVantageModule, alphaVantagePreset } from "./module";

const listTools = vi.fn();
const callTool = vi.fn();
vi.mock("@/lib/mcp/client", () => ({ connect: async () => ({ listTools, callTool }) }));

const names = ["COMPANY_OVERVIEW", "ETF_PROFILE", "INCOME_STATEMENT", "EARNINGS_CALL_TRANSCRIPT"];
// No cache, so nothing here touches a data folder.
const config = { apiKey: "test-key", allowTools: names, cacheTtlSeconds: 0 };
const context = offlineContext();

beforeEach(() => {
  listTools.mockResolvedValue({ tools: names.map((name) => ({ name, inputSchema: { type: "object", properties: {} } })) });
});

describe("Alpha Vantage tool availability", () => {
  it("keeps current snapshots available for a live turn", async () => {
    const tools = await alphaVantageModule.createTools(config, context);
    expect(tools.map((tool) => tool.label)).toEqual(names);
  });

  it("excludes current-only snapshots from a fixed historical turn, retaining history and document queries", async () => {
    const tools = await alphaVantageModule.createTools(config, { ...context, asOf: "2021-06-30" });
    expect(tools.map((tool) => tool.label)).toEqual(["INCOME_STATEMENT", "EARNINGS_CALL_TRANSCRIPT"]);
  });

  it("does not interpret an emptied historical selection as permission to expose every tool", async () => {
    const tools = await alphaVantageModule.createTools({ ...config, allowTools: ["COMPANY_OVERVIEW", "ETF_PROFILE"] }, { ...context, asOf: "2021-06-30" });
    expect(tools).toEqual([]);
  });
});

describe("Alpha Vantage results", () => {
  it("turn a rate-limit notice answered as a result into a failed call", async () => {
    const limited = JSON.stringify({ error: { type: "rate_limit", message: "Please consider spreading out your free API calls." } });
    callTool.mockResolvedValue({ content: [{ type: "text", text: limited }] });
    const income = (await alphaVantageModule.createTools(config, context)).find((tool) => tool.label === "INCOME_STATEMENT");
    await expect(income?.execute("call-1", { symbol: "NVDA" })).rejects.toThrow("Alpha Vantage INCOME_STATEMENT failed — rate_limit");
  });
});

describe("Alpha Vantage cache TTL", () => {
  it("reads a typed-in TTL, zero included, and a cleared box as the default", () => {
    expect(alphaVantagePreset({ apiKey: "k", cacheTtlSeconds: "60" }).cacheTtlSeconds).toBe(60);
    expect(alphaVantagePreset({ apiKey: "k", cacheTtlSeconds: "0" }).cacheTtlSeconds).toBe(0);
    expect(alphaVantagePreset({ apiKey: "k", cacheTtlSeconds: "" }).cacheTtlSeconds).toBe(900);
    expect(alphaVantagePreset({ apiKey: "k", cacheTtlSeconds: -5 }).cacheTtlSeconds).toBe(900);
  });
});

