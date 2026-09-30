/**
 * Alpha Vantage's REST API, for what is not an agent tool: checking a key in Settings and the `$`
 * autocomplete. The agent's tools go through the official MCP server instead (see module.ts).
 */
import { cached } from "@/lib/cache";
import type { SymbolHit } from "@/lib/tickers/types";
import { restProblem } from "./errors";

const BASE_URL = "https://www.alphavantage.co/query";
const SEARCH_TTL_SECONDS = 24 * 60 * 60;

/**
 * The autocomplete, the hover card's company lookup and Settings' Validate button each wait on
 * one of these requests, and none of them has a Stop button: a server that never answers must
 * not leave them waiting.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Raw body of one Alpha Vantage query, with the service's in-band errors raised as failures. */
async function avGet(
  fn: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<string> {
  const url = new URL(BASE_URL);
  url.searchParams.set("function", fn);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Alpha Vantage ${fn} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`)),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, { headers: { "user-agent": "open-finance-agent/0.1" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Alpha Vantage ${fn} failed with HTTP ${response.status}`);

    // The body is read under the same deadline: a stalled stream hangs as surely as no answer.
    const body = await response.text();
    const problem = restProblem(body);
    if (problem) throw new Error(problem);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function avJson<T>(fn: string, params: Record<string, string>, apiKey: string): Promise<T> {
  return JSON.parse(await avGet(fn, params, apiKey)) as T;
}

/* ------------------------------------------------------------------ quote */

type GlobalQuote = Record<string, string>;

/** GLOBAL_QUOTE's price and trading day, the two things Validate says about a working key. */
export function toQuote(payload: unknown): { price: number; asOf: string } | null {
  const raw = (payload as { "Global Quote"?: GlobalQuote } | null)?.["Global Quote"];
  const price = Number(raw?.["05. price"]);
  if (!raw?.["01. symbol"] || !Number.isFinite(price)) return null;
  return { price, asOf: raw["07. latest trading day"] ?? "" };
}

/** Live quote, bypassing the cache. Used by `validate()` so a fixed key is retried for real. */
export async function fetchQuote(symbol: string, apiKey: string): Promise<{ price: number; asOf: string } | null> {
  return toQuote(await avJson<unknown>("GLOBAL_QUOTE", { symbol }, apiKey));
}

/* ----------------------------------------------------------------- search */

interface SymbolSearchResponse {
  bestMatches?: Record<string, string>[];
}

export function toSymbolHits(payload: unknown): SymbolHit[] {
  const matches = (payload as SymbolSearchResponse | null)?.bestMatches ?? [];
  return matches
    .map((match) => ({ ticker: match["1. symbol"] ?? "", name: match["2. name"] ?? "" }))
    .filter((hit) => hit.ticker !== "");
}

/** Symbol lookup, cached for a day: autocomplete must not burn the daily quota. */
export async function searchSymbols(query: string, apiKey: string): Promise<SymbolHit[]> {
  const keywords = query.trim();
  if (!keywords) return [];
  return cached(`av:search:${keywords.toLowerCase()}`, SEARCH_TTL_SECONDS, async () =>
    toSymbolHits(await avJson<unknown>("SYMBOL_SEARCH", { keywords }, apiKey)),
  );
}
