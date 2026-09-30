/** The quote service's shapes: what Yahoo Finance returns and what the service caches. */

export interface LiveQuote {
  symbol: string;
  name?: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  /** Shares traded in the regular session, when Yahoo states it. */
  volume?: number;
  asOf: string;
}

export interface AssetProfile {
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
}
