import { alphaVantageDetails, alphaVantageSummary } from "@/lib/providers/alphavantage/details";
import { isRecord } from "@/lib/utils";
import { DatasetIntegrityError, shareBasisAsOf } from "./mock-mcp-data";
import { canonicalRecordVisible, type CanonicalTaskView, type MockResult, normalize } from "./mock-mcp-view";
import type { OfflineAuditKind, OfflineOutcome } from "../types";

/** The allowlisted `alphavantage__*` operations, in Alpha Vantage's response format. */

/** The Alpha Vantage operations the dataset models; the compiler keeps only these. */
export const ALPHA_OPERATIONS: readonly string[] = ["GLOBAL_QUOTE", "TIME_SERIES_DAILY", "COMPANY_OVERVIEW", "EARNINGS", "NEWS_SENTIMENT", "SYMBOL_SEARCH"];

/** What the production Alpha Vantage tool derives from the same response. */
function alphaDetails(operation: string, args: Record<string, unknown>, value: unknown) {
  return isRecord(value) ? alphaVantageDetails(operation, args, value).details : alphaVantageSummary(operation, args);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function alphaVantage(view: CanonicalTaskView, operation: string, args: Record<string, unknown>): MockResult {
  const symbol = String(args.symbol ?? args.keywords ?? args.tickers ?? "").toUpperCase();
  if (operation === "SYMBOL_SEARCH") {
    const query = normalize(args.keywords);
    const matches = view.companies.filter((item) => normalize(`${item.ticker} ${item.name} ${item.aliases.join(" ")}`).includes(query)).slice(0, 10);
    const bestMatches = matches.map((item, index) => ({ "1. symbol": item.ticker, "2. name": item.name, "3. type": "Common Stock", "4. region": "United States", "9. matchScore": (1 - index * 0.03).toFixed(4) }));
    return { text: JSON.stringify({ bestMatches }, null, 2), details: { ...alphaDetails(operation, args, { bestMatches }), matches: bestMatches.length }, ...(matches.length ? { outcome: "served" } : { audit: [view.audit(`alphavantage__${operation}`, args, "empty_result", "no symbol matches in the offline issuer directory")], outcome: "empty" }) };
  }
  if (operation === "COMPANY_OVERVIEW") {
    const company = view.companyFor(symbol);
    const quote = view.market.filter((item) => item.symbol === symbol && item.price !== undefined).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
    if (company && quote) {
      const shares = view.facts.filter((item) => item.ticker === company.ticker && item.concept === "EntityCommonStockSharesOutstanding" && item.value !== null && item.value !== undefined &&
        Math.abs(Date.parse(quote.asOf) - Date.parse(item.end ?? item.period)) <= 120 * 86_400_000)
        .sort((a, b) => (b.end ?? b.period).localeCompare(a.end ?? a.period))[0];
      // The price is as traded on its date, so the share count has to be on that date's basis too.
      const basis = shares ? shareBasisAsOf(company, shares, quote.asOf) : undefined;
      const payload = {
        Symbol: company.ticker,
        Name: company.name,
        ...(company.cik ? { CIK: company.cik } : {}),
        Currency: quote.currency ?? "USD",
        LatestTradingDay: quote.asOf,
        Price: String(quote.price),
        ...(basis ? { SharesOutstanding: String(basis.value), MarketCapitalization: String(Math.round((quote.price ?? 0) * basis.value)) } : {}),
        _offline_benchmark: {
          synthetic: true,
          description: "Point-in-time overview assembled from the pinned SEC issuer directory and historical market quote; recent filed shares are included when available, and absent provider fields are omitted",
          priceSource: quote.sourceUrl,
          ...(shares ? { sharesSource: shares.sourceUrl, sharesFiledAt: shares.filedAt } : {}),
          ...(basis?.splits.length ? { sharesRestatedForSplits: basis.splits.map(({ date, ratio }) => ({ date, ratio })) } : {}),
        },
      };
      return { text: JSON.stringify(payload, null, 2), details: { ...alphaDetails(operation, args, payload), symbol, asOf: quote.asOf, source: payload._offline_benchmark }, outcome: "served" };
    }
  }
  if (operation === "TIME_SERIES_DAILY" || operation === "GLOBAL_QUOTE") {
    const bars = view.market.filter((item) => item.symbol === symbol && item.price !== undefined && item.open !== undefined && item.high !== undefined && item.low !== undefined && item.volume !== undefined)
      .sort((a, b) => b.asOf.localeCompare(a.asOf));
    if (bars.length > 0) {
      // The model reads this description, so its wording is part of what the benchmark measures.
      const source = { synthetic: true, description: "Alpha Vantage-shaped sandbox projection of pinned Yahoo historical OHLCV", url: bars[0].sourceUrl };
      if (operation === "TIME_SERIES_DAILY") {
        const selected = bars.slice(0, String(args.outputsize ?? "compact").toLowerCase() === "full" ? bars.length : 100);
        const series = Object.fromEntries(selected.map((bar) => [bar.asOf, {
          "1. open": String(bar.open), "2. high": String(bar.high), "3. low": String(bar.low),
          "4. close": String(bar.price), "5. volume": String(bar.volume),
        }]));
        const value = { "Meta Data": { "1. Information": "Offline historical daily prices", "2. Symbol": symbol, "3. Last Refreshed": selected[0].asOf, "4. Output Size": selected.length === bars.length ? "Full" : "Compact", "5. Time Zone": "US/Eastern" }, "Time Series (Daily)": series, _offline_benchmark: source };
        return { text: JSON.stringify(value, null, 2), details: { ...alphaDetails(operation, args, value), symbol, asOf: selected[0].asOf, source }, outcome: "served" };
      }
      const latest = bars[0];
      const value = { "Global Quote": {
        "01. symbol": symbol, "02. open": String(latest.open), "03. high": String(latest.high), "04. low": String(latest.low),
        "05. price": String(latest.price), "06. volume": String(latest.volume), "07. latest trading day": latest.asOf,
        "08. previous close": String(latest.previousClose ?? latest.price), "09. change": String(latest.change ?? 0),
        "10. change percent": `${latest.changePercent ?? 0}%`,
      }, _offline_benchmark: source };
      return { text: JSON.stringify(value, null, 2), details: { ...alphaDetails(operation, args, value), symbol, asOf: latest.asOf, source }, outcome: "served" };
    }
  }
  const records = view.alphaData.filter((item) => item.operation === operation && (!symbol || item.symbol === symbol));
  if (operation === "NEWS_SENTIMENT" && records.length > 0) {
    const from = String(args.time_from ?? "00000000T0000");
    const to = String(args.time_to ?? `${view.scope.cutoff.replaceAll("-", "")}T2359`);
    const limit = Math.min(1000, Math.max(1, Number(args.limit ?? 50)));
    const capturedWindow = records.some((item) => String(item.args.time_from ?? "") <= from && String(item.args.time_to ?? "") >= to);
    const seen = new Set<string>();
    const feed = records.flatMap((item) => {
      const value = isRecord(item.value) ? item.value : undefined;
      return Array.isArray(value?.feed) ? value.feed : [];
    }).filter((item) => {
      if (!isRecord(item) || typeof item.url !== "string" || typeof item.time_published !== "string") return false;
      if (item.time_published < from || item.time_published > to || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).sort((a, b) => String((b as Record<string, unknown>).time_published).localeCompare(String((a as Record<string, unknown>).time_published))).slice(0, limit);
    const first = isRecord(records[0].value) ? records[0].value : {};
    const payload = { ...first, items: String(feed.length), feed, _offline_benchmark: { source: "pinned Alpha Vantage historical NEWS_SENTIMENT capture", coverageWindowComplete: capturedWindow } };
    const outcome: OfflineOutcome = feed.length ? "served" : capturedWindow ? "empty" : "not_captured";
    return {
      text: `${JSON.stringify(payload, null, 2)}${outcome === "not_captured" ? "\nOffline status: this query extends beyond the pinned historical news window." : ""}`,
      details: { ...alphaDetails(operation, args, payload), symbol, asOf: view.scope.cutoff, coverageState: outcome },
      ...(feed.length ? {} : { audit: [view.audit(`alphavantage__${operation}`, args, outcome === "empty" ? "empty_result" : "not_captured", outcome === "empty" ? "official historical news query returned no articles in the captured window" : "requested news window is not fully captured")] }),
      outcome,
    };
  }
  if (records.length) return { text: asText(records[0].value), details: { ...alphaDetails(operation, args, records[0].value), asOf: records[0].availableAt }, outcome: "served" };
  const future = view.db.alphaRecords.some((item) => item.operation === operation && (!symbol || item.symbol === symbol) && item.taskIds.includes(view.scope.taskId) && !canonicalRecordVisible(item, view.scope));
  const inScope = view.scope.tickers.includes(symbol) || view.scope.peerTickers.includes(symbol);
  const outcome: OfflineOutcome = future ? "not_available_as_of" : inScope ? "not_captured" : "out_of_scope";
  const kind: OfflineAuditKind = future ? "not_available_as_of" : inScope ? "not_captured" : "out_of_scope";
  const statusText = future ? `not available as of ${view.scope.cutoff}` : inScope ? "not captured in the offline corpus" : "outside the task's covered symbols";
  const empty = (value: unknown): MockResult => ({
    text: `${JSON.stringify(value, null, 2)}\nOffline status: Alpha Vantage ${operation} for ${symbol || "the requested symbol"} is ${statusText}. No live fallback was attempted.`,
    details: { ...alphaDetails(operation, args, value), symbol, asOf: view.scope.cutoff, coverageState: outcome, empty: true },
    audit: [view.audit(`alphavantage__${operation}`, args, kind, `no usable ${operation} payload for ${symbol || "the requested arguments"}: ${statusText}`)],
    outcome,
  });
  if (operation === "GLOBAL_QUOTE") return empty({ "Global Quote": {} });
  if (operation === "COMPANY_OVERVIEW") return empty({ Symbol: symbol, Information: "No point-in-time overview payload captured." });
  if (operation === "TIME_SERIES_DAILY") return empty({ "Meta Data": {}, "Time Series (Daily)": {} });
  if (operation === "EARNINGS") return empty({ symbol, annualEarnings: [], quarterlyEarnings: [] });
  if (operation === "NEWS_SENTIMENT") return empty({ items: "0", feed: [] });
  throw new DatasetIntegrityError(view.request(`alphavantage__${operation}`, args), `operation ${operation} is not implemented by the canonical mock MCP server`);
}
