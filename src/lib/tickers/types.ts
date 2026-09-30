/**
 * What the ticker hover card and the `$` autocomplete show, and what a module's `ui` hooks return
 * to feed them. Types only, so browser code can import them.
 */

export interface SymbolHit {
  ticker: string;
  name: string;
  cik?: string;
}

/** A price as the hover card shows it. */
export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  asOf: string;
}

export interface TickerSnapshot {
  symbol: string;
  name?: string;
  cik?: string;
  quote?: Quote;
  /** Set instead of `quote` when a provider was asked but failed. */
  quoteError?: string;
  links: { filings: string };
}
