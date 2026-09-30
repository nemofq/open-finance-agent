import type { SymbolHit } from "@/lib/tickers/types";
import { edgarJson, padCik } from "./client";

const tickerMapUrl = "https://www.sec.gov/files/company_tickers.json";

export interface TickerEntry {
  ticker: string;
  /** Ten-digit zero-padded CIK, as EDGAR's JSON APIs expect it. */
  cik: string;
  name: string;
}

/** The raw file is an object keyed by row number, not an array. */
interface RawEntry {
  cik_str: number | string;
  ticker: string;
  title: string;
}

/** Every listed company EDGAR knows a ticker for (~10k rows, cached for a day). */
export async function loadTickerMap(contact: string, signal?: AbortSignal): Promise<TickerEntry[]> {
  const raw = await edgarJson<Record<string, RawEntry>>(tickerMapUrl, contact, signal);
  return Object.values(raw)
    .filter((row) => row && typeof row.ticker === "string")
    .map((row) => ({
      ticker: row.ticker.toUpperCase(),
      cik: padCik(row.cik_str),
      name: String(row.title ?? ""),
    }));
}

/** EDGAR writes class shares as `BRK-B`; people type `BRK.B`. */
function normalise(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

/** Exact ticker first, then ticker prefixes, then companies whose name contains the query. */
export function searchTickers(query: string, map: TickerEntry[], limit = 8): TickerEntry[] {
  const symbol = normalise(query);
  if (!symbol) return [];
  const text = query.trim().toLowerCase();

  const scored: { entry: TickerEntry; rank: number }[] = [];
  for (const entry of map) {
    const rank =
      entry.ticker === symbol
        ? 0
        : entry.ticker.startsWith(symbol)
          ? 1
          : entry.name.toLowerCase().includes(text)
            ? 2
            : -1;
    if (rank >= 0) scored.push({ entry, rank });
  }

  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.entry.ticker.length - b.entry.ticker.length ||
        a.entry.ticker.localeCompare(b.entry.ticker),
    )
    .slice(0, limit)
    .map((hit) => hit.entry);
}

export function lookupTicker(symbol: string, map: TickerEntry[]): TickerEntry | null {
  const wanted = normalise(symbol);
  return map.find((entry) => entry.ticker === wanted) ?? null;
}

export function toSymbolHit(entry: TickerEntry): SymbolHit {
  return { ticker: entry.ticker, name: entry.name, cik: entry.cik };
}

/** Resolve a ticker to its CIK, with a message the model can act on when it fails. */
export async function requireCik(symbol: string, contact: string, signal?: AbortSignal): Promise<TickerEntry> {
  const map = await loadTickerMap(contact, signal);
  const entry = lookupTicker(symbol, map);
  if (entry) return entry;
  const near = searchTickers(symbol, map, 5).map((hit) => `${hit.ticker} (${hit.name})`);
  throw new Error(
    `No SEC filer with ticker ${symbol.toUpperCase()}.${near.length ? ` Did you mean: ${near.join(", ")}?` : " Try edgar_lookup_company to find the company."}`,
  );
}
