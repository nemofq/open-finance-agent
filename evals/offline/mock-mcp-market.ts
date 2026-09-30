import { type QuoteLine, QUOTES_HEADER, quotesDetails, quoteText } from "@/lib/quotes/details";
import { atOrBeforeCutoff, type CanonicalTaskView, type MockResult } from "./mock-mcp-view";
import type { OfflineAuditEvent, OfflineAuditKind, OfflineOutcome } from "../types";

/** `market_quotes` over the task's dated market records, described by the live tool's own builders. */

export function marketQuotes(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const symbols = [...new Set((Array.isArray(args.symbols) ? args.symbols : []).map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { text: "No symbols provided to quote.", details: {} };
  // A missing symbol's line says why, so lines are rendered once the batch's market day is known.
  const lines: Array<QuoteLine | string> = [];
  const served: QuoteLine[] = [];
  const audits: OfflineAuditEvent[] = [];
  const missing: Array<{ symbol: string; status: "not_captured" | "out_of_scope" | "not_available_as_of" }> = [];
  for (const symbol of symbols) {
    // At an intraday cutoff, same-day date-only rows are not yet visible,
    // while a prior session's date-only close is exactly the previous close.
    const records = view.market.filter((item) => item.symbol === symbol && atOrBeforeCutoff(item.asOf, view.scope.cutoff, view.scope.asOfTime));
    const record = records.sort((a, b) => Number(b.price !== undefined) - Number(a.price !== undefined) || b.asOf.localeCompare(a.asOf))[0];
    if (!record) {
      const future = view.db.marketData.some((item) => item.symbol === symbol && item.asOf.slice(0, 10) > view.scope.cutoff);
      const inScope = view.scope.tickers.includes(symbol) || view.scope.peerTickers.includes(symbol);
      const status = future ? "not_available_as_of" : inScope ? "not_captured" : "out_of_scope";
      const kind: OfflineAuditKind = future ? "not_available_as_of" : inScope ? "not_captured" : "out_of_scope";
      missing.push({ symbol, status });
      lines.push(`- $${symbol}: ${status === "not_available_as_of" ? `quotes exist only after ${view.scope.cutoff}` : status === "not_captured" ? "quote not captured in the offline corpus" : "outside the task's quote coverage"}`);
      audits.push(view.audit("market_quotes", args, kind, status === "not_captured" ? `no quote was captured for in-scope symbol ${symbol}` : status === "out_of_scope" ? `${symbol} is outside the declared task and peer symbols` : `${symbol} quote exists only after ${view.scope.cutoff}`));
      continue;
    }
    const quote: QuoteLine = { symbol, price: record.price, changePercent: record.changePercent, currency: record.currency ?? "USD",
      asOf: record.asOf, sector: record.sector, industry: record.industry };
    lines.push(quote);
    if (quote.price !== undefined) served.push(quote);
  }
  const outcome: OfflineOutcome = !missing.length
    ? "served"
    : served.length > 0
      ? "served"
      : missing.every((item) => item.status === "not_available_as_of")
        ? "not_available_as_of"
        : missing.every((item) => item.status === "out_of_scope")
          ? "out_of_scope"
          : "not_captured";
  const details = quotesDetails(served);
  const text = [QUOTES_HEADER, ...lines.map((line) => typeof line === "string" ? line : quoteText(line, details.asOf))].join("\n");
  return { text, details: { ...details, missing }, ...(audits.length ? { audit: audits, outcome } : { outcome: "served" }) };
}
