/**
 * The argument names that name a ticker, whichever one a tool's schema uses. The policy rules
 * read the company a call is about from them, the harness renames one the schema does not declare
 * to one it does, and the evidence normalizer files an entry under the first one a call passes.
 */
export const TICKER_ARGUMENTS: readonly string[] = ["ticker", "tickers", "symbol", "symbols"];
