import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote, REQUEST_TIMEOUT_MS, toQuote, toSymbolHits } from "./rest";

const globalQuote = {
  "Global Quote": {
    "01. symbol": "IBM",
    "02. open": "235.5200",
    "05. price": "243.2700",
    "06. volume": "4914722",
    "07. latest trading day": "2026-09-11",
    "08. previous close": "234.0200",
    "09. change": "9.2500",
    "10. change percent": "3.9527%",
  },
};

describe("toQuote", () => {
  it("reads GLOBAL_QUOTE's price and trading day", () => {
    expect(toQuote(globalQuote)).toEqual({ price: 243.27, asOf: "2026-09-11" });
  });

  it("returns null for an unknown symbol", () => {
    expect(toQuote({ "Global Quote": {} })).toBeNull();
    expect(toQuote(null)).toBeNull();
  });
});

describe("toSymbolHits", () => {
  it("maps SYMBOL_SEARCH matches", () => {
    const payload = {
      bestMatches: [
        { "1. symbol": "TSCO.LON", "2. name": "Tesco PLC" },
        { "1. symbol": "", "2. name": "junk" },
      ],
    };
    expect(toSymbolHits(payload)).toEqual([{ ticker: "TSCO.LON", name: "Tesco PLC" }]);
  });

  it("tolerates an empty response", () => {
    expect(toSymbolHits({})).toEqual([]);
  });
});

describe("requests", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("give up on a server that never answers", async () => {
    vi.useFakeTimers();
    // A fetch that hangs until its signal aborts, as a real one does.
    const fetch = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    vi.stubGlobal("fetch", fetch);

    const pending = fetchQuote("IBM", "key");
    const outcome = expect(pending).rejects.toThrow("Alpha Vantage GLOBAL_QUOTE did not answer within 10s");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it("read an answer that arrives in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(globalQuote))));
    expect(await fetchQuote("IBM", "key")).toMatchObject({ price: 243.27 });
  });
});
