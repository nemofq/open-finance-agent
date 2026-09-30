import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "@/lib/config/store";
import { QUOTES_OFF_MESSAGE } from "@/lib/portfolio/current";
import { QuoteProviderError } from "@/lib/quotes/service";

const mockGetBatchQuotes = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    AAPL: {
      symbol: "AAPL",
      price: 200,
      previousClose: 190,
      change: 10,
      changePercent: 5.26,
      currency: "USD",
      asOf: "2026-09-15T20:00:00Z",
    },
  }),
);

vi.mock("@/lib/quotes/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quotes/service")>("@/lib/quotes/service");
  return {
    ...actual,
    getBatchQuotes: mockGetBatchQuotes,
  };
});

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-portfolio-current-api-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("GET /api/portfolio/current", () => {
  it("returns portfolio holdings with valuation object", async () => {
    const accounts = await import("../accounts/route");
    const positions = await import("../positions/route");
    const current = await import("./route");

    const created = await accounts.POST(
      json("http://localhost/api/portfolio/accounts", "POST", {
        name: "Test Account",
        type: "taxable",
        baseCurrency: "USD",
        costBasisMethod: "fifo",
      }),
    );
    const { account } = (await created.json()) as { account: { id: string } };

    await positions.POST(
      json("http://localhost/api/portfolio/positions", "POST", {
        accountId: account.id,
        symbol: "AAPL",
        quantity: 5,
        totalCost: 750,
        currency: "USD",
        acquiredAt: "2024-01-01",
      }),
    );

    const res = await current.GET(new Request("http://localhost/api/portfolio/current"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toHaveProperty("holdings");
    expect(data).toHaveProperty("cash");
    expect(data).toHaveProperty("valuation");
    expect(data.valuation).toHaveProperty("totalCostBasis");
    expect(data.valuation).toHaveProperty("totalMarketValue");
    expect(data.valuation.totalCostBasis).toBe(750);
    expect(data.holdings).toHaveLength(1);
    expect(data.holdings[0].valuation).toBeDefined();
    expect(data.holdings[0].valuation.marketValue).toBeGreaterThan(0);
  });

  it("keeps the response visibly incomplete when the quote provider fails", async () => {
    const current = await import("./route");
    mockGetBatchQuotes.mockRejectedValueOnce(new QuoteProviderError("provider unavailable", ["AAPL"]));

    const res = await current.GET(new Request("http://localhost/api/portfolio/current"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.quoteError).toContain("provider unavailable");
    expect(data.valuation.complete).toBe(false);
    expect(data.valuation.missingQuotes).toEqual(["AAPL"]);
    expect(data.valuation.totalMarketValue).toBe(0);
    expect(data.holdings[0].valuation.marketValue).toBeNull();
  });

  it("sends no symbol to the quote provider while Market Quotes is off, and says why", async () => {
    const current = await import("./route");
    const config = readConfig();
    writeConfig({ ...config, modules: { ...config.modules, quotes: { enabled: false } } });
    mockGetBatchQuotes.mockClear();

    try {
      const res = await current.GET(new Request("http://localhost/api/portfolio/current?refresh=true"));
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(mockGetBatchQuotes).not.toHaveBeenCalled();
      expect(data.quoteError).toBe(QUOTES_OFF_MESSAGE);
      expect(data.valuation.complete).toBe(false);
      expect(data.valuation.totalCostBasis).toBe(750);
      expect(data.holdings[0].valuation.marketValue).toBeNull();
    } finally {
      writeConfig(config);
    }
  });

  it("counts what the page dates today east of UTC, before UTC reaches that date", async () => {
    // 08:30 on 28 September in Tokyo is still the 27th in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T23:30:00Z"));
    try {
      const accounts = await import("../accounts/route");
      const positions = await import("../positions/route");
      const transactions = await import("../transactions/route");
      const current = await import("./route");
      const created = await accounts.POST(
        json("http://localhost/api/portfolio/accounts", "POST", { name: "Tokyo", type: "taxable", baseCurrency: "JPY", costBasisMethod: "fifo" }),
      );
      const { account } = (await created.json()) as { account: { id: string } };

      const added = await positions.POST(
        json("http://localhost/api/portfolio/positions?today=2026-09-28", "POST", {
          accountId: account.id,
          symbol: "TM",
          quantity: 2,
          totalCost: 600,
          currency: "JPY",
        }),
      );
      expect(((await added.json()) as { transaction: { tradeDate: string } }).transaction.tradeDate).toBe("2026-09-28");
      // The transaction dialog defaults to the browser's own date.
      await transactions.POST(
        json("http://localhost/api/portfolio/transactions", "POST", {
          accountId: account.id,
          type: "buy",
          symbol: "SONY",
          tradeDate: "2026-09-28",
          quantity: 10,
          price: 3_000,
          currency: "JPY",
        }),
      );

      const res = await current.GET(new Request("http://localhost/api/portfolio/current?symbol=SONY&today=2026-09-28"));
      const data = await res.json();
      expect(data.asOf).toBe("2026-09-28");
      expect(data.holdings).toHaveLength(1);
      expect((await current.GET(new Request("http://localhost/api/portfolio/current?today=28-09-2026"))).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });
});
