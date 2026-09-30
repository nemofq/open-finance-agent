import { getCached, setCached } from "@/lib/cache";
import { marketClock } from "@/lib/time/session";
import { errorMessage } from "@/lib/utils";
import type { AssetProfile, LiveQuote } from "./types";
import { fetchProfiles, fetchQuotes } from "./yahoo";

/** Profiles change with a reclassification, not with the market. */
const PROFILE_TTL_SECONDS = 30 * 86_400;

/**
 * Determine cache TTL based on US market session.
 * - Open session: 15s to keep quotes fresh while avoiding rate bursts.
 * - Extended hours (pre/post): 60s.
 * - Closed (night/weekend/holiday): 1800s (30m).
 */
export function quoteTtlSeconds(now = new Date()): number {
  try {
    const clock = marketClock(now);
    if (clock.session === "open") return 15;
    if (clock.session === "pre_market" || clock.session === "after_hours") return 60;
    return 1800;
  } catch {
    return 30; // fallback safe default
  }
}

/** Where the service reports what it skipped; a module passes its context's `log`. */
export type QuoteLog = (message: string) => void;

const warn: QuoteLog = (message) => console.warn(`[quotes] ${message}`);

interface BatchOptions {
  refresh?: boolean;
  log?: QuoteLog;
}

/** A provider failure is different from a symbol that has no quote. Keep that distinction visible. */
export class QuoteProviderError extends Error {
  constructor(
    message: string,
    public readonly symbols: string[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "QuoteProviderError";
  }
}

/** Trimmed, upper-cased and deduplicated, in the order first given; blanks dropped. */
export function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function isUsableQuote(value: LiveQuote | null | undefined): value is LiveQuote {
  return Boolean(
    value &&
      Number.isFinite(value.price) &&
      Number.isFinite(value.previousClose) &&
      Number.isFinite(value.change) &&
      Number.isFinite(value.changePercent) &&
      value.currency?.trim(),
  );
}

function isUsableProfile(value: AssetProfile | null | undefined): value is AssetProfile {
  return Boolean(value && (value.sector || value.industry || value.name));
}

/** The cached values that are still usable, and the symbols that need a fetch. */
async function fromCache<T>(
  prefix: string,
  symbols: string[],
  refresh: boolean | undefined,
  usable: (value: T | null | undefined) => value is T,
): Promise<{ found: Record<string, T>; missing: string[] }> {
  const found: Record<string, T> = {};
  const missing: string[] = [];
  for (const symbol of symbols) {
    const hit = refresh ? undefined : await getCached<T | null>(`${prefix}:${symbol}`);
    if (usable(hit)) found[symbol] = hit;
    else missing.push(symbol);
  }
  return { found, missing };
}

/**
 * Fetch quotes for multiple symbols with intelligent caching and deduplication.
 */
export async function getBatchQuotes(
  symbols: string[],
  options: BatchOptions = {},
): Promise<Record<string, LiveQuote>> {
  const wanted = normalizeSymbols(symbols);
  if (wanted.length === 0) return {};

  const log = options.log ?? warn;
  const ttl = quoteTtlSeconds();
  const { found: results, missing } = await fromCache("quote", wanted, options.refresh, isUsableQuote);
  if (missing.length === 0) return results;

  let fetched: Record<string, LiveQuote>;
  try {
    fetched = await fetchQuotes(missing);
  } catch (cause) {
    throw new QuoteProviderError(`Quote provider failed for ${missing.join(", ")}: ${errorMessage(cause)}`, missing, { cause });
  }
  for (const [symbol, quote] of Object.entries(fetched)) {
    if (!isUsableQuote(quote)) {
      log(`Quote provider returned an invalid quote for ${symbol}`);
      continue;
    }
    results[symbol] = quote;
    await setCached(`quote:${symbol}`, ttl, quote);
  }
  return results;
}

/**
 * Fetch asset profiles (sector, industry, name) cached for 30 days.
 */
export async function getBatchProfiles(
  symbols: string[],
  options: BatchOptions = {},
): Promise<Record<string, AssetProfile>> {
  const wanted = normalizeSymbols(symbols);
  if (wanted.length === 0) return {};

  const log = options.log ?? warn;
  const { found: results, missing } = await fromCache("profile", wanted, options.refresh, isUsableProfile);
  if (missing.length === 0) return results;

  let fetched: Record<string, AssetProfile>;
  try {
    fetched = await fetchProfiles(missing);
  } catch (cause) {
    // Profiles are enrichment rather than valuation inputs, so keep quotes usable while making
    // the provider failure observable for diagnosis.
    log(`Profile provider failed for ${missing.join(", ")}: ${errorMessage(cause)}`);
    return results;
  }
  for (const [symbol, profile] of Object.entries(fetched)) {
    results[symbol] = profile;
    await setCached(`profile:${symbol}`, PROFILE_TTL_SECONDS, profile);
  }
  return results;
}
