import YahooFinance from "yahoo-finance2";
import { errorMessage } from "@/lib/utils";
import type { AssetProfile, LiveQuote } from "./types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

type YahooQuoteLike = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  currency?: string;
  regularMarketVolume?: number | null;
  regularMarketTime?: Date | number | string | null;
};

function toLiveQuote(item: YahooQuoteLike, symbol: string): LiveQuote | null {
  if (item.regularMarketPrice == null) return null;
  const price = Number(item.regularMarketPrice);
  const previousClose = item.regularMarketPreviousClose == null ? price : Number(item.regularMarketPreviousClose);
  const change = item.regularMarketChange == null ? price - previousClose : Number(item.regularMarketChange);
  const changePercent =
    item.regularMarketChangePercent == null
      ? previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0
      : Number(item.regularMarketChangePercent);
  if (![price, previousClose, change, changePercent].every(Number.isFinite)) return null;
  const marketTime =
    item.regularMarketTime instanceof Date
      ? item.regularMarketTime
      : item.regularMarketTime == null
        ? null
        : new Date(
            typeof item.regularMarketTime === "number" && item.regularMarketTime < 1e12
              ? item.regularMarketTime * 1000
              : item.regularMarketTime,
          );
  const asOf = marketTime && !Number.isNaN(marketTime.getTime()) ? marketTime.toISOString() : new Date().toISOString();

  return {
    symbol,
    name: item.shortName ?? item.longName ?? undefined,
    price,
    previousClose,
    change,
    changePercent,
    currency: item.currency?.trim().toUpperCase() || "USD",
    ...(Number.isFinite(item.regularMarketVolume) ? { volume: Number(item.regularMarketVolume) } : {}),
    asOf,
  };
}

/** Each Yahoo symbol with the one asked for: `BRK.B` is `BRK-B` there. The service normalizes first. */
function yahooSymbols(symbols: string[]): Map<string, string> {
  return new Map(symbols.map((symbol) => [symbol.replace(/\./g, "-"), symbol]));
}

export async function fetchQuotes(symbols: string[]): Promise<Record<string, LiveQuote>> {
  const asked = yahooSymbols(symbols);
  const results: Record<string, LiveQuote> = {};
  let failures = 0;

  const addQuote = (raw: unknown, yahooSymbol?: string) => {
    const item = raw as YahooQuoteLike | undefined;
    if (!item?.symbol) return;
    const returned = item.symbol.toUpperCase();
    const symbol = asked.get(returned) ?? asked.get(yahooSymbol ?? returned) ?? returned;
    const quote = toLiveQuote(item, symbol);
    if (quote) results[symbol] = quote;
  };

  const chunkSize = 50;
  const yahoo = [...asked.keys()];
  for (let i = 0; i < yahoo.length; i += chunkSize) {
    const chunk = yahoo.slice(i, i + chunkSize);
    try {
      const raw = await yf.quote(chunk);
      for (const item of Array.isArray(raw) ? raw : [raw]) addQuote(item);
    } catch (cause) {
      failures += 1;
      console.warn("[quotes.yahoo] batch quote request failed", { symbols: chunk, error: errorMessage(cause) });
      // If a batch fails, retry each ticker so one bad symbol does not hide good quotes.
      for (const yahooSymbol of chunk) {
        try {
          addQuote(await yf.quote(yahooSymbol), yahooSymbol);
        } catch (singleCause) {
          failures += 1;
          console.warn("[quotes.yahoo] quote request failed", { symbol: yahooSymbol, error: errorMessage(singleCause) });
        }
      }
    }
  }

  if (Object.keys(results).length === 0 && failures > 0) {
    throw new Error(`Yahoo Finance could not return any of the requested quotes (${yahoo.join(", ")}).`);
  }
  return results;
}

export async function fetchProfiles(symbols: string[]): Promise<Record<string, AssetProfile>> {
  const results: Record<string, AssetProfile> = {};
  const failures: Array<{ symbol: string; error: string }> = [];
  await Promise.all(
    [...yahooSymbols(symbols)].map(async ([yahooSymbol, symbol]) => {
      try {
        const summary = await yf.quoteSummary(yahooSymbol, { modules: ["assetProfile", "fundProfile", "price"] });
        results[symbol] = {
          symbol,
          name: summary.price?.shortName ?? summary.price?.longName ?? undefined,
          sector:
            summary.assetProfile?.sector ??
            (summary.fundProfile?.categoryName ? `ETF (${summary.fundProfile.categoryName})` : undefined),
          industry: summary.assetProfile?.industry,
        };
      } catch (cause) {
        failures.push({ symbol, error: errorMessage(cause) });
      }
    }),
  );
  if (failures.length > 0) console.warn("[quotes.yahoo] profile requests failed", failures);
  return results;
}
