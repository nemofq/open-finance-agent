/**
 * What `market_quotes` returns, built once for the live tool and the benchmark's mock: the lines
 * the model reads, and the `StructuredDetails` the evidence ledger indexes. The ledger registers
 * the whole result as one entry, so a batch is one entry whose facts name each symbol.
 */
import type { EvidenceFact, EvidenceTable, StructuredDetails } from "@/lib/evidence/types";

/** One symbol's quote and profile, as far as the source had them. */
export interface QuoteLine {
  symbol: string;
  price?: number;
  changePercent?: number;
  /** ISO 4217; the source's own, or USD when it states none. */
  currency?: string;
  /** The quote's time or its market day; only the day is indexed. */
  asOf?: string;
  sector?: string;
  industry?: string;
}

export const QUOTES_HEADER = "Market quotes & profiles:";
const SUMMARY_SYMBOLS = 6;

/**
 * The market day a quote belongs to. Only the day is kept: a live quote stamped with the time of
 * its last trade is still today's data, and a timestamp compared as text against a `YYYY-MM-DD`
 * cutoff always reads as later than it.
 */
function marketDay(asOf: string | undefined): string | undefined {
  const day = asOf?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

/** `- $NVDA: price 125.61 USD (-2.10%), sector: Technology`; the day only when it is not the batch's. */
export function quoteText(quote: QuoteLine, batchDay?: string): string {
  const currency = quote.currency ?? "USD";
  const price = quote.price === undefined ? "unavailable" : `${quote.price} ${currency}`;
  const change = quote.changePercent === undefined ? "" : ` (${signed(quote.changePercent)})`;
  const day = marketDay(quote.asOf);
  const dated = quote.price !== undefined && day && day !== batchDay ? ` as of ${day}` : "";
  const industry = quote.industry ? `, industry: ${quote.industry}` : "";
  return `- $${quote.symbol}: price ${price}${change}${dated}, sector: ${quote.sector ?? "Unknown / Unclassified"}${industry}`;
}

type Priced = QuoteLine & { price: number };

/**
 * One symbol's facts are `price` and `changePercent`, so they cross-check against another quote
 * of the same ticker. In a batch the entry has one entity for several tickers, so each metric
 * carries its symbol instead (`AAPL price`), which keeps one ticker's price from being compared
 * with, or looked up as, another's.
 */
function quoteFacts(priced: Priced[]): EvidenceFact[] {
  const named = (symbol: string, metric: string) => (priced.length > 1 ? `${symbol} ${metric}` : metric);
  return priced.flatMap((quote) => {
    const day = marketDay(quote.asOf);
    if (!day) return [];
    const at = { period: day, periodType: "instant" as const, end: day };
    const facts: EvidenceFact[] = [{ metric: named(quote.symbol, "price"), value: quote.price, unit: quote.currency ?? "USD", ...at }];
    if (quote.changePercent !== undefined) facts.push({ metric: named(quote.symbol, "changePercent"), value: quote.changePercent, unit: "%", ...at });
    return facts;
  });
}

function quoteTable(priced: Priced[]): EvidenceTable {
  return {
    columns: ["symbol", "price", "changePercent", "currency", "date", "sector", "industry"],
    rows: priced.map((quote) => [quote.symbol, quote.price, quote.changePercent ?? null, quote.currency ?? "USD",
      marketDay(quote.asOf) ?? null, quote.sector ?? null, quote.industry ?? null]),
    index: "symbol",
  };
}

/** The details the ledger indexes: the latest market day in the batch, a fact per figure and a table. */
export function quotesDetails(quotes: QuoteLine[]): StructuredDetails {
  const priced = quotes.filter((quote): quote is Priced => quote.price !== undefined && Number.isFinite(quote.price));
  const days = [...new Set(priced.flatMap((quote) => marketDay(quote.asOf) ?? []))].sort();
  const asOf = days.at(-1);
  const currencies = new Set(priced.map((quote) => quote.currency ?? "USD"));
  const named = priced.slice(0, SUMMARY_SYMBOLS).map((quote) => `$${quote.symbol}`).join(", ");
  const more = priced.length > SUMMARY_SYMBOLS ? ` and ${priced.length - SUMMARY_SYMBOLS} more` : "";
  const facts = quoteFacts(priced);
  return {
    summary: priced.length === 0 ? "Market quotes, none available" : `Market quotes, ${named}${more}${asOf ? `, as of ${asOf}` : ""}`,
    ...(asOf ? { asOf } : {}),
    ...(priced.length === 1 ? { entity: { ticker: priced[0].symbol } } : {}),
    ...(days.length > 0 ? { periods: days } : {}),
    ...(currencies.size === 1 ? { currency: [...currencies][0] } : {}),
    ...(facts.length > 0 ? { facts } : {}),
    ...(priced.length > 0 ? { table: quoteTable(priced) } : {}),
  };
}

/** The live tool's whole result: one line per symbol under the header, and the details. */
export function quotesResult(quotes: QuoteLine[]): { text: string; details: StructuredDetails } {
  const details = quotesDetails(quotes);
  return { text: [QUOTES_HEADER, ...quotes.map((quote) => quoteText(quote, details.asOf))].join("\n"), details };
}
