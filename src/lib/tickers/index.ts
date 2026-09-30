import { enabledModules } from "@/lib/agent/modules";
import type { AppConfig } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { processSingleton } from "@/lib/process-state";
import type { SymbolHit, TickerSnapshot } from "@/lib/tickers/types";
import { moduleConfig } from "@/lib/tools/config";
import { errorMessage } from "@/lib/utils";

/**
 * Ask every enabled provider, merge by ticker, keep the first description of each. Providers are
 * asked in registry order, which lists EDGAR first so its keyless company names lead.
 */
async function searchWith(config: AppConfig, query: string, limit: number): Promise<SymbolHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const results = await Promise.all(
    enabledModules(config).map(async (module) => {
      const ui = module.ui;
      if (!ui?.searchSymbols) return [];
      try {
        return await ui.searchSymbols(trimmed, moduleConfig(config, module));
      } catch {
        return []; // one broken provider must not empty the autocomplete
      }
    }),
  );

  const merged = new Map<string, SymbolHit>();
  for (const hit of results.flat()) {
    const ticker = hit.ticker.toUpperCase();
    if (!ticker || merged.has(ticker)) continue;
    merged.set(ticker, { ...hit, ticker });
  }
  return [...merged.values()].slice(0, limit);
}

export async function searchSymbols(query: string, limit = 8): Promise<SymbolHit[]> {
  return searchWith(readConfig(), query, limit);
}

/**
 * The SEC's public company page, not a call to the EDGAR module: it needs no key and no enabled
 * module, so the card links it for every ticker.
 */
function filingsLink(symbol: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&type=&dateb=&owner=include&count=40`;
}

/** Everything the ticker hover card shows: company identity plus a quote when one is available. */
export async function tickerSnapshot(symbol: string): Promise<TickerSnapshot> {
  const ticker = symbol.trim().toUpperCase();
  const snapshot: TickerSnapshot = { symbol: ticker, links: { filings: filingsLink(ticker) } };

  const config = readConfig();
  const hits = await searchWith(config, ticker, 8);
  const identity = hits.find((hit) => hit.ticker === ticker);
  if (identity) {
    snapshot.name = identity.name;
    snapshot.cik = identity.cik;
  }

  // The first enabled module that quotes, in registry order.
  const quoting = enabledModules(config).find((module) => module.ui?.quote);
  const quote = quoting?.ui?.quote;
  if (quoting && quote) {
    try {
      snapshot.quote = (await quote(ticker, moduleConfig(config, quoting))) ?? undefined;
    } catch (err) {
      snapshot.quoteError = errorMessage(err);
    }
  }
  return snapshot;
}

/** How long a hover card's snapshot is served from memory before the providers are asked again. */
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

interface CachedSnapshot {
  expiresAt: number;
  snapshot: TickerSnapshot;
}

/**
 * `tickerSnapshot`, kept in memory for five minutes: hover cards fire on every pointer pass, and
 * each miss asks every enabled provider. A failed snapshot is not kept.
 */
export async function recentTickerSnapshot(symbol: string, now: () => number = Date.now): Promise<TickerSnapshot> {
  const snapshots = processSingleton("tickers.snapshots", () => new Map<string, CachedSnapshot>());
  const ticker = symbol.trim().toUpperCase();
  const hit = snapshots.get(ticker);
  if (hit && hit.expiresAt > now()) return hit.snapshot;
  const snapshot = await tickerSnapshot(ticker);
  snapshots.set(ticker, { expiresAt: now() + SNAPSHOT_TTL_MS, snapshot });
  return snapshot;
}
