import type { EvidenceLedger } from "@/lib/evidence/types";
import { extractCashtags } from "@/lib/sessions/cashtags";
import type { CoverageDomain } from "@/lib/tools/contracts";

/**
 * A small keyword classifier for rule P1: which coverage domains a web query is after, and which
 * company it is about. It is deliberately conservative — an unclassified query is left alone —
 * and is calibrated on the benchmark before P1 blocks anything.
 */

/** Matched against the query in order; every match contributes its domain. */
const DOMAIN_KEYWORDS: readonly (readonly [CoverageDomain, RegExp])[] = [
  ["filings", /\b(10-?[kq]|8-?k|20-?f|s-1|def\s?14a|proxy statement|prospectus|annual report|risk factors?|sec filing|filed with the sec|edgar)\b/i],
  ["fundamentals", /\b(revenues?|top line|gross margins?|operating margins?|net margins?|operating income|net income|balance sheet|income statement|cash flow|free cash flow|capex|book value|shares outstanding|buybacks?|total debt|leverage ratio)\b/i],
  ["earnings", /\b(earnings|eps|earnings per share|quarterly results|beat|missed expectations|earnings date|reports? (its )?(q[1-4]|fiscal)|guidance)\b/i],
  ["estimates", /\b(estimates?|consensus|analysts? (expect|forecast|estimate)|forecasts?|price targets?|street expects)\b/i],
  ["prices", /\b(share price|stock price|price of|quote|52-?week|all-?time high|closed at|trading at|intraday|stock (?:price )?(?:fall|fell|rise|rose|drop|dropped|jump|jumped|climb|climbed|slide|slid|slip|slipped|sink|sank|tumble|tumbled)|ytd return|total return|market cap)\b/i],
  ["options", /\b(options?|implied move|implied volatility|open interest|strike price|call spread|put spread|leaps)\b/i],
  ["funds", /\b(etfs?|mutual funds?|index funds?|nav|net asset value|expense ratio|distributions?|aum|fund holdings|covered[- ]call fund)\b/i],
  ["transcripts", /\b(transcripts?|earnings calls?|conference calls?|management (said|commentary)|prepared remarks)\b/i],
  ["news", /\b(news|headlines?|announced|announcements?|press releases?|latest on|reported that)\b/i],
  ["ownership", /\b(insiders?|insider (buying|selling)|13-?[fdg]|institutional (ownership|holders)|form 4|stake in)\b/i],
  ["macro", /\b(fed|federal reserve|fomc|rate (cut|hike)|interest rates?|cpi|inflation|pce|treasur(y|ies)|yield curve|gdp|unemployment|jobs report|nonfarm payrolls)\b/i],
];

/** How a block reason names the domain it is protecting. */
export const DOMAIN_LABELS: Record<CoverageDomain, string> = {
  filings: "filing",
  fundamentals: "fundamentals",
  earnings: "earnings",
  estimates: "estimate",
  prices: "price",
  options: "options",
  funds: "fund",
  transcripts: "transcript",
  news: "news",
  ownership: "ownership",
  macro: "macro",
};

/** The coverage domains a query is after; empty when nothing matches, which leaves the query alone. */
export function classifyQuery(query: string): CoverageDomain[] {
  return DOMAIN_KEYWORDS.flatMap(([domain, pattern]) => (pattern.test(query) ? [domain] : []));
}

/** Companies the chat already knows about, used to tell which company a query is about. */
export interface KnownEntities {
  /** Upper-case tickers. */
  tickers: string[];
  /** Company names from the ledger's entities, with the ticker they resolve to. */
  names: { name: string; ticker: string }[];
}

/** Legal suffixes a filing carries and nobody writing about the company does. */
const LEGAL_SUFFIX = /[,\s]+(?:inc|corp|corporation|co|company|ltd|limited|plc|llc|lp|sa|nv|ag|holdings?|group)\.?$/i;

/**
 * How a company is written about, from how its filer is named: "NVIDIA CORP" is "Nvidia"
 * everywhere but the filing, so the name without its legal suffix is kept alongside the full one.
 */
function nameVariants(name: string): string[] {
  let shorter = name.trim().toLowerCase().replace(/[.,]+$/, "");
  const variants = [shorter];
  while (LEGAL_SUFFIX.test(shorter)) {
    shorter = shorter.replace(LEGAL_SUFFIX, "").trim();
    if (shorter.length >= 3) variants.push(shorter);
  }
  return variants;
}

/** The tickers and entity names this chat has seen, from the session and the ledger. */
export function knownEntities(ledger: EvidenceLedger, sessionTickers: string[]): KnownEntities {
  const tickers = new Set(sessionTickers.map((ticker) => ticker.toUpperCase()));
  const names = new Map<string, string>();
  for (const entry of ledger.list()) {
    const entity = entry.entity;
    if (!entity?.ticker) continue;
    const ticker = entity.ticker.toUpperCase();
    tickers.add(ticker);
    for (const variant of entity.name ? nameVariants(entity.name) : []) {
      if (!names.has(variant)) names.set(variant, ticker);
    }
  }
  return { tickers: [...tickers], names: [...names].map(([name, ticker]) => ({ name, ticker })) };
}

/** A bare word that could be a ticker: two to five capitals, optionally with a class suffix. */
const BARE_TICKER = /\b[A-Z]{2,5}(?:\.[A-Z])?\b/g;

/**
 * The company a query is about: a `$TICKER`, a ticker the chat already knows, or a company name
 * from the ledger. Returns `undefined` for a query about no company in particular (macro).
 */
export function extractCompany(query: string, known: KnownEntities): string | undefined {
  const [cashtag] = extractCashtags(query);
  if (cashtag) return cashtag;

  const tickers = new Set(known.tickers);
  for (const word of query.match(BARE_TICKER) ?? []) {
    if (tickers.has(word)) return word;
  }

  const lower = query.toLowerCase();
  // Longest name first, so "Advanced Micro Devices" wins over a shorter name inside it.
  const byLength = [...known.names].sort((a, b) => b.name.length - a.name.length);
  return byLength.find(({ name }) => name.length >= 3 && mentions(lower, name))?.ticker;
}

/** A name has to stand as its own word: "apple" is not in "pineapple". */
function mentions(query: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(query);
}
