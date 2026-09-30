import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBatchProfiles, getBatchQuotes, normalizeSymbols, quoteTtlSeconds } from "./service";
import type { LiveQuote } from "./types";
import { fetchProfiles, fetchQuotes } from "./yahoo";

vi.mock("./yahoo", () => ({ fetchQuotes: vi.fn(), fetchProfiles: vi.fn() }));

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-quote-service-"));
  process.env.OFA_HOME = home;
  vi.mocked(fetchQuotes).mockReset();
  vi.mocked(fetchProfiles).mockReset();
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const mockQuote: LiveQuote = {
  symbol: "AAPL",
  price: 150,
  previousClose: 145,
  change: 5,
  changePercent: 3.45,
  currency: "USD",
  asOf: "2026-09-15T20:00:00Z",
};

describe("quoteTtlSeconds", () => {
  it("returns a positive TTL for any date", () => {
    const ttl = quoteTtlSeconds(new Date());
    expect(ttl).toBeGreaterThan(0);
  });
});

describe("normalizeSymbols", () => {
  it("trims, upper-cases and dedupes, keeping the first order and dropping blanks", () => {
    expect(normalizeSymbols([" msft", "aapl ", "MSFT", "  ", "brk.b"])).toEqual(["MSFT", "AAPL", "BRK.B"]);
  });
});

describe("getBatchQuotes", () => {
  it("returns empty object for empty symbol list", async () => {
    const res = await getBatchQuotes([]);
    expect(res).toEqual({});
  });

  it("normalizes and fetches quotes from provider", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue({ AAPL: mockQuote });

    const res = await getBatchQuotes(["  aapl  ", "AAPL"], { refresh: true });

    expect(fetchQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect(res.AAPL).toEqual(mockQuote);
  });

  it("serves a fresh cached quote without asking the provider again", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue({ AAPL: mockQuote });
    await getBatchQuotes(["AAPL"]);
    vi.mocked(fetchQuotes).mockReset().mockRejectedValue(new Error("Network offline"));
    expect(await getBatchQuotes(["aapl"])).toEqual({ AAPL: mockQuote });
    expect(fetchQuotes).not.toHaveBeenCalled();
  });

  it("asks only for the symbols the cache cannot answer", async () => {
    vi.mocked(fetchQuotes).mockResolvedValue({ AAPL: mockQuote });
    await getBatchQuotes(["AAPL"]);
    const msft = { ...mockQuote, symbol: "MSFT" };
    vi.mocked(fetchQuotes).mockResolvedValue({ MSFT: msft });
    expect(await getBatchQuotes(["AAPL", "MSFT"])).toEqual({ AAPL: mockQuote, MSFT: msft });
    expect(fetchQuotes).toHaveBeenLastCalledWith(["MSFT"]);
  });

  it("skips an invalid quote, reports it and never caches it", async () => {
    const log = vi.fn();
    vi.mocked(fetchQuotes).mockResolvedValue({ AAPL: { ...mockQuote, price: Number.NaN } });
    expect(await getBatchQuotes(["AAPL"], { log })).toEqual({});
    expect(log).toHaveBeenCalledWith("Quote provider returned an invalid quote for AAPL");
    await getBatchQuotes(["AAPL"], { log });
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  it("surfaces provider failure with the affected symbols", async () => {
    vi.mocked(fetchQuotes).mockRejectedValue(new Error("Network offline"));

    await expect(getBatchQuotes(["FAIL"], { refresh: true })).rejects.toMatchObject({
      name: "QuoteProviderError",
      symbols: ["FAIL"],
      message: expect.stringContaining("Network offline"),
    });
  });
});

describe("getBatchProfiles", () => {
  const profile = { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" };

  it("caches a fetched profile", async () => {
    vi.mocked(fetchProfiles).mockResolvedValue({ AAPL: profile });
    expect(await getBatchProfiles(["aapl"])).toEqual({ AAPL: profile });
    expect(await getBatchProfiles(["AAPL"])).toEqual({ AAPL: profile });
    expect(fetchProfiles).toHaveBeenCalledTimes(1);
  });

  it("reports a failing profile provider and keeps what the cache had", async () => {
    vi.mocked(fetchProfiles).mockResolvedValue({ AAPL: profile });
    await getBatchProfiles(["AAPL"]);
    const log = vi.fn();
    vi.mocked(fetchProfiles).mockRejectedValue(new Error("Network offline"));
    expect(await getBatchProfiles(["AAPL", "MSFT"], { log })).toEqual({ AAPL: profile });
    expect(log).toHaveBeenCalledWith("Profile provider failed for MSFT: Network offline");
  });
});
