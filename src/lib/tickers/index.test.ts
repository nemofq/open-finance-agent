import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote, SymbolHit } from "@/lib/tickers/types";
import type { Module } from "@/lib/tools/contracts";

const modules: Module[] = [];
const enabled: Record<string, boolean> = {};

vi.mock("@/lib/tools/registry", () => ({ get builtinModules() { return modules; } }));
vi.mock("@/lib/config/store", () => ({
  readConfig: () => ({
    modules: Object.fromEntries(Object.entries(enabled).map(([id, on]) => [id, { enabled: on }])),
  }),
}));

const { recentTickerSnapshot, searchSymbols, tickerSnapshot } = await import("./index");

function stub(
  id: string,
  ui: { searchSymbols?: (q: string) => Promise<SymbolHit[]>; quote?: (s: string) => Promise<Quote | null> },
): Module {
  return {
    id,
    name: id,
    kind: "data-provider",
    description: "",
    settings: [],
    defaultConfig: {},
    createTools: async () => [],
    ui,
  };
}

const quote: Quote = {
  symbol: "NVDA",
  price: 180.5,
  change: 2.5,
  changePercent: 1.4,
  asOf: "2026-09-10",
};

beforeEach(() => {
  modules.length = 0;
  for (const key of Object.keys(enabled)) delete enabled[key];
});

describe("searchSymbols", () => {
  it("returns nothing for an empty query without asking any provider", async () => {
    const spy = vi.fn();
    modules.push(stub("edgar", { searchSymbols: spy }));
    enabled.edgar = true;
    expect(await searchSymbols("  ")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips modules the user has not enabled", async () => {
    modules.push(stub("edgar", { searchSymbols: async () => [{ ticker: "NVDA", name: "NVIDIA CORP" }] }));
    enabled.edgar = false;
    expect(await searchSymbols("nvda")).toEqual([]);
  });

  it("merges providers in registry order, dedupes by ticker and lets the first describe the company", async () => {
    modules.push(
      stub("edgar", { searchSymbols: async () => [{ ticker: "NVDA", name: "NVIDIA CORP", cik: "0001045810" }] }),
      stub("alphavantage", {
        searchSymbols: async () => [
          { ticker: "nvda", name: "NVIDIA Corporation" },
          { ticker: "AMD", name: "Advanced Micro Devices" },
        ],
      }),
    );
    enabled.alphavantage = true;
    enabled.edgar = true;

    expect(await searchSymbols("nv")).toEqual([
      { ticker: "NVDA", name: "NVIDIA CORP", cik: "0001045810" },
      { ticker: "AMD", name: "Advanced Micro Devices" },
    ]);
  });

  it("keeps the autocomplete alive when one provider throws", async () => {
    modules.push(
      stub("edgar", { searchSymbols: async () => { throw new Error("EDGAR down"); } }),
      stub("alphavantage", { searchSymbols: async () => [{ ticker: "AMD", name: "AMD" }] }),
    );
    enabled.edgar = true;
    enabled.alphavantage = true;
    expect(await searchSymbols("am")).toEqual([{ ticker: "AMD", name: "AMD" }]);
  });

  it("honours the limit", async () => {
    modules.push(
      stub("edgar", {
        searchSymbols: async () => [
          { ticker: "A", name: "A" },
          { ticker: "B", name: "B" },
          { ticker: "C", name: "C" },
        ],
      }),
    );
    enabled.edgar = true;
    expect(await searchSymbols("a", 2)).toHaveLength(2);
  });
});

describe("tickerSnapshot", () => {
  it("always carries the symbol and an EDGAR filings link", async () => {
    const snapshot = await tickerSnapshot(" nvda ");
    expect(snapshot.symbol).toBe("NVDA");
    expect(snapshot.links.filings).toContain("CIK=NVDA");
  });

  it("combines the EDGAR identity with the first quote provider", async () => {
    modules.push(
      stub("edgar", { searchSymbols: async () => [{ ticker: "NVDA", name: "NVIDIA CORP", cik: "0001045810" }] }),
      stub("alphavantage", { quote: async () => quote }),
    );
    enabled.edgar = true;
    enabled.alphavantage = true;

    const snapshot = await tickerSnapshot("nvda");
    expect(snapshot).toMatchObject({ symbol: "NVDA", name: "NVIDIA CORP", cik: "0001045810", quote });
    expect(snapshot.quoteError).toBeUndefined();
  });

  it("reports a broken quote provider instead of failing the card", async () => {
    modules.push(
      stub("edgar", { searchSymbols: async () => [{ ticker: "NVDA", name: "NVIDIA CORP" }] }),
      stub("alphavantage", { quote: async () => { throw new Error("rate limited"); } }),
    );
    enabled.edgar = true;
    enabled.alphavantage = true;

    const snapshot = await tickerSnapshot("NVDA");
    expect(snapshot.name).toBe("NVIDIA CORP");
    expect(snapshot.quote).toBeUndefined();
    expect(snapshot.quoteError).toBe("rate limited");
  });

  it("leaves identity blank when no provider knows the ticker", async () => {
    modules.push(stub("edgar", { searchSymbols: async () => [{ ticker: "AMD", name: "AMD" }] }));
    enabled.edgar = true;
    const snapshot = await tickerSnapshot("NVDA");
    expect(snapshot.name).toBeUndefined();
  });
});

describe("recentTickerSnapshot", () => {
  it("serves a snapshot from memory for five minutes, then asks the providers again", async () => {
    const quoteOf = vi.fn(async () => ({ ...quote, symbol: "AMD" }));
    modules.push(stub("alphavantage", { quote: quoteOf }));
    enabled.alphavantage = true;
    let clock = 1_000_000;
    const now = () => clock;

    const first = await recentTickerSnapshot("amd", now);
    clock += 4 * 60 * 1000;
    expect(await recentTickerSnapshot(" AMD ", now)).toBe(first);
    expect(quoteOf).toHaveBeenCalledOnce();

    clock += 2 * 60 * 1000;
    expect(await recentTickerSnapshot("AMD", now)).not.toBe(first);
    expect(quoteOf).toHaveBeenCalledTimes(2);
  });
});
