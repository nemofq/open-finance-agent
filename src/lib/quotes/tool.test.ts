import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { registerToolResult } from "@/lib/evidence/register";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { AssetProfile, LiveQuote } from "@/lib/quotes/types";
import type { TimeContext } from "@/lib/time/types";
import { offlineContext } from "@/lib/tools/testing";
import { marketQuotesTool, quotesModule } from "./tool";
import { fetchProfiles, fetchQuotes } from "./yahoo";

vi.mock("./yahoo", () => ({ fetchQuotes: vi.fn(), fetchProfiles: vi.fn() }));

let home: string;
let ledger: EvidenceLedger;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-quotes-"));
  process.env.OFA_HOME = home;
  ledger = createLedger({ sessionId: "chat-1", dataDir: home });
  vi.mocked(fetchQuotes).mockReset();
  vi.mocked(fetchProfiles).mockReset().mockResolvedValue({});
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/** A live turn on the afternoon the quotes were taken, in New York. */
const live: TimeContext = {
  mode: "live",
  timeZone: "America/New_York",
  localDate: "2026-09-15",
  localTime: "16:30",
  instant: "2026-09-15T20:30:00Z",
  market: { session: "after_hours", lastCompletedSession: "2026-09-15", nextOpen: "2026-09-16T09:30:00-04:00" },
};

const quote = (symbol: string, price: number, changePercent: number): LiveQuote => ({
  symbol, price, previousClose: price, change: 0, changePercent, currency: "USD", asOf: "2026-09-15T20:00:00.000Z",
});

/** The tool, then what `afterTool` does with its result on a live turn. */
async function quoteAndRegister(symbols: string[], quotes: Record<string, LiveQuote>, profiles: Record<string, AssetProfile> = {}) {
  vi.mocked(fetchQuotes).mockResolvedValue(quotes);
  vi.mocked(fetchProfiles).mockResolvedValue(profiles);
  const tool = marketQuotesTool();
  const result = await tool.execute("call-1", { symbols });
  return registerToolResult({ ledger, tool, toolCallId: "call-1", args: { symbols }, result, isError: false, time: live });
}

const textOf = (content: { type: string; text?: string }[]) => content.map((part) => part.text ?? "").join("\n");

describe("quotesModule", () => {
  it("exports metadata and tool factory", async () => {
    expect(quotesModule).toMatchObject({ id: "quotes", kind: "data-provider" });
    const tools = await quotesModule.createTools({}, offlineContext());
    expect(tools.map((tool) => tool.name)).toEqual(["market_quotes"]);
    expect(tools[0].meta).toMatchObject({ class: "data", source: { tier: 2 } });
  });
});

describe("quotesModule.ui.quote", () => {
  it("prices the hover card from the default-on quote service", async () => {
    expect(quotesModule.defaultConfig.enabled).toBe(true);
    vi.mocked(fetchQuotes).mockResolvedValue({ NVDA: { ...quote("NVDA", 125.61, -2.1), change: -2.7, previousClose: 128.31, volume: 301_234_500 } });
    expect(await quotesModule.ui?.quote?.(" nvda ", {})).toEqual({
      symbol: "NVDA", price: 125.61, change: -2.7, changePercent: -2.1, volume: 301_234_500, asOf: "2026-09-15T20:00:00.000Z",
    });
    expect(fetchQuotes).toHaveBeenCalledWith(["NVDA"]);
  });

  it("has no quote for a symbol the service cannot price", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue({});
    expect(await quotesModule.ui?.quote?.("ZZZZ", {})).toBeNull();
  });
});

describe("market_quotes", () => {
  it("is registered like any data result, and today's quote is not look-ahead", async () => {
    const output = await quoteAndRegister(["aapl"], { AAPL: quote("AAPL", 200, 2.56) },
      { AAPL: { symbol: "AAPL", sector: "Technology", industry: "Consumer Electronics" } });

    expect(output.entry).toMatchObject({
      id: "E1",
      summary: "Market quotes, $AAPL, as of 2026-09-15",
      asOf: "2026-09-15",
      entity: { ticker: "AAPL" },
      facts: [
        { metric: "price", period: "2026-09-15", periodType: "instant", value: 200, unit: "USD" },
        { metric: "changePercent", period: "2026-09-15", periodType: "instant", value: 2.56, unit: "%" },
      ],
      table: { columns: ["symbol", "price", "changePercent", "currency", "date", "sector", "industry"], index: "symbol",
        rows: [["AAPL", 200, 2.56, "USD", "2026-09-15", "Technology", "Consumer Electronics"]] },
    });
    expect(output.entry?.lookAhead).toBeUndefined();
    const text = textOf(output.content);
    expect(text).toContain("- $AAPL: price 200 USD (+2.56%), sector: Technology, industry: Consumer Electronics");
    expect(text).not.toContain("LOOK-AHEAD");
    expect(ledger.list()).toHaveLength(1);
  });

  it("keeps one entry per call whose facts name each symbol of a batch", async () => {
    const output = await quoteAndRegister(["NVDA", "AAPL", "ZZZZ"], { NVDA: quote("NVDA", 125.61, -2.1), AAPL: quote("AAPL", 200, 0.5) });

    expect(ledger.list()).toHaveLength(1);
    expect(output.entry?.facts?.map((fact) => `${fact.metric}=${fact.value}`)).toEqual([
      "NVDA price=125.61", "NVDA changePercent=-2.1", "AAPL price=200", "AAPL changePercent=0.5",
    ]);
    expect(output.entry?.summary).toBe("Market quotes, $NVDA, $AAPL, as of 2026-09-15");
    expect(textOf(output.content)).toContain("- $ZZZZ: price unavailable, sector: Unknown / Unclassified");
  });

  it("restores after a reload every id the model was shown", async () => {
    const output = await quoteAndRegister(["NVDA", "AAPL"], { NVDA: quote("NVDA", 125.61, -2.1), AAPL: quote("AAPL", 200, 0.5) });
    await ledger.flush();
    const shown = [...textOf(output.content).matchAll(/\[(E\d+)\b/g)].map((match) => match[1]);
    expect(shown).toEqual(["E1"]);

    const saved = JSON.parse(JSON.stringify({ role: "toolResult", toolCallId: "call-1", toolName: "market_quotes",
      content: output.content, details: output.details, isError: false, timestamp: 0 })) as AgentMessage;
    const reopened = createLedger({ sessionId: "chat-1", dataDir: home, messages: [saved] });
    expect(reopened.list()).toEqual(ledger.list());
  });
});
