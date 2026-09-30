/**
 * Point-in-time trimming for Alpha Vantage responses. Pure functions over one
 * already-parsed response: a fixed as-of turn must never cost an extra API call, so a value
 * dated after the cutoff is dropped, not re-fetched.
 */

import { isRecord } from "@/lib/utils";

export type JsonObject = Record<string, unknown>;

/** A body that is one JSON object, or null for CSV, prose, broken JSON or any other JSON value. */
export function parseJsonObject(text: string): JsonObject | null {
  const body = text.trimStart();
  if (!body.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type TrimOutcome =
  /** The original text stands; `notes` may still carry a caveat to append to it. */
  | { kind: "unchanged"; notes: string[] }
  /** Re-serialise `payload` in place of the original text, then append `notes`. */
  | { kind: "trimmed"; payload: JsonObject; notes: string[] }
  /** Replace the whole result: nothing in it can be rewound to the cutoff. */
  | { kind: "withheld"; text: string };

interface RuleResult {
  payload: JsonObject;
  changed: boolean;
  notes: string[];
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
/** NEWS_SENTIMENT timestamps, e.g. `20250630T143000`. */
const NEWS_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})T/;

/** GLOBAL_QUOTE's wrapper and the only date it carries. */
export const QUOTE_KEY = "Global Quote";
export const QUOTE_DATE_KEY = "07. latest trading day";

/** The `YYYY-MM-DD` head of a date or date-time string, or undefined when it is neither. */
export function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && DATE_PREFIX.test(value) ? value.slice(0, 10) : undefined;
}

/** `YYYYMMDDTHHMMSS` as a plain day. */
export function newsDay(value: unknown): string | undefined {
  const match = typeof value === "string" ? NEWS_TIMESTAMP.exec(value) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** A series object: `Time Series (Daily)`, `Weekly Time Series`, `Technical Analysis: SMA`, … */
export function isDateKeyedObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => DATE_KEY.test(key));
}

/** Functions whose rows are scheduled events: trimming them to the cutoff would empty them. */
export const SCHEDULED_FUNCTIONS = new Set(["EARNINGS_CALENDAR", "IPO_CALENDAR"]);

export function cutoffNote(asOf: string): string {
  return `Point-in-time: trimmed to data on or before ${asOf}.`;
}

export function scheduledNote(toolName: string, asOf: string): string {
  return `Point-in-time: ${toolName} lists scheduled future dates and was not trimmed to ${asOf}.`;
}

/* ------------------------------------------------------------------ rules */

/** Drop dated entries after the cutoff from every top-level date-keyed object. */
function trimSeries(payload: JsonObject, asOf: string): RuleResult {
  const next: JsonObject = { ...payload };
  let changed = false;
  for (const [key, value] of Object.entries(payload)) {
    if (!isDateKeyedObject(value)) continue;
    const kept = Object.entries(value).filter(([date]) => date.slice(0, 10) <= asOf);
    if (kept.length === Object.keys(value).length) continue;
    next[key] = Object.fromEntries(kept);
    changed = true;
  }
  return { payload: next, changed, notes: [] };
}

/**
 * `data[]` rows that carry their own date: the macro series, options chains, insider trades.
 * A row with no date is kept — the shape is then one we do not understand, and dropping it
 * would silently empty results such as REALTIME_BULK_QUOTES.
 */
function trimDataRows(payload: JsonObject, asOf: string): RuleResult {
  const rows = payload.data;
  if (!Array.isArray(rows)) return { payload, changed: false, notes: [] };
  const kept = rows.filter((row) => {
    if (!isRecord(row)) return true;
    const day = isoDay(row.date) ?? isoDay(row.transaction_date);
    return day === undefined || day <= asOf;
  });
  if (kept.length === rows.length) return { payload, changed: false, notes: [] };
  return { payload: { ...payload, data: kept }, changed: true, notes: [] };
}

/** NEWS_SENTIMENT: keep only articles published on or before the cutoff, and fix the count. */
function trimNews(payload: JsonObject, asOf: string): RuleResult {
  const feed = payload.feed;
  if (!Array.isArray(feed)) return { payload, changed: false, notes: [] };
  const kept = feed.filter((item) => {
    if (!isRecord(item)) return false;
    const day = newsDay(item.time_published);
    // An article we cannot date cannot be shown to predate the cutoff.
    return day !== undefined && day <= asOf;
  });
  if (kept.length === feed.length) return { payload, changed: false, notes: [] };
  const items = typeof payload.items === "number" ? kept.length : String(kept.length);
  return { payload: { ...payload, items, feed: kept }, changed: true, notes: [] };
}

/** Keep rows of a named array whose date field is on or before the cutoff. */
function trimRows(payload: JsonObject, key: string, field: string, asOf: string): RuleResult {
  const rows = payload[key];
  if (!Array.isArray(rows)) return { payload, changed: false, notes: [] };
  const kept = rows.filter((row) => {
    if (!isRecord(row)) return false;
    const day = isoDay(row[field]);
    // These shapes always carry the field; a row missing it cannot be placed in time.
    return day !== undefined && day <= asOf;
  });
  if (kept.length === rows.length) return { payload, changed: false, notes: [] };
  return { payload: { ...payload, [key]: kept }, changed: true, notes: [] };
}

/** EARNINGS: quarters by the date they were reported, years by the date the year ended. */
function trimEarnings(payload: JsonObject, asOf: string): RuleResult {
  const quarterly = trimRows(payload, "quarterlyEarnings", "reportedDate", asOf);
  const annual = trimRows(quarterly.payload, "annualEarnings", "fiscalDateEnding", asOf);
  return { payload: annual.payload, changed: quarterly.changed || annual.changed, notes: [] };
}

/**
 * INCOME_STATEMENT, BALANCE_SHEET and CASH_FLOW: cut on the period end, which is all these
 * responses carry. That is weaker than a filing date, so say so whenever one is present.
 */
function trimStatements(payload: JsonObject, asOf: string): RuleResult {
  if (!Array.isArray(payload.annualReports) && !Array.isArray(payload.quarterlyReports)) {
    return { payload, changed: false, notes: [] };
  }
  const annual = trimRows(payload, "annualReports", "fiscalDateEnding", asOf);
  const quarterly = trimRows(annual.payload, "quarterlyReports", "fiscalDateEnding", asOf);
  return {
    payload: quarterly.payload,
    changed: annual.changed || quarterly.changed,
    notes: [
      `Filing dates are not part of this response: a report whose period ended on or before ` +
        `${asOf} may have been filed after it.`,
    ],
  };
}

/**
 * A quote is "now". Rewinding it needs a second API call, which a fixed as-of turn will not
 * make, so a later quote is withheld and the model is pointed at the daily series instead.
 * An undated quote is withheld for the same reason: it cannot be shown to predate the cutoff.
 */
function trimQuote(payload: JsonObject, asOf: string): TrimOutcome {
  const quote = payload[QUOTE_KEY];
  if (!isRecord(quote)) return { kind: "unchanged", notes: [] };
  const day = isoDay(quote[QUOTE_DATE_KEY]);
  if (day !== undefined && day <= asOf) return { kind: "unchanged", notes: [] };
  const dated = day === undefined ? "carries no trading day" : `is dated ${day}`;
  return {
    kind: "withheld",
    text:
      `Quote withheld: GLOBAL_QUOTE ${dated}, which is not on or before the as-of date ${asOf}. ` +
      `Call TIME_SERIES_DAILY for the last close on or before ${asOf}.`,
  };
}

/* --------------------------------------------------------------- dispatch */

const rules = [trimSeries, trimDataRows, trimNews, trimEarnings, trimStatements] as const;

/** Trim one Alpha Vantage JSON response to `asOf`. */
export function trimToAsOf(toolName: string, payload: JsonObject, asOf: string): TrimOutcome {
  if (SCHEDULED_FUNCTIONS.has(toolName)) {
    return { kind: "unchanged", notes: [scheduledNote(toolName, asOf)] };
  }
  if (toolName === "GLOBAL_QUOTE") return trimQuote(payload, asOf);

  let current = payload;
  let changed = false;
  const notes: string[] = [];
  for (const rule of rules) {
    const result = rule(current, asOf);
    current = result.payload;
    changed = changed || result.changed;
    notes.push(...result.notes);
  }
  if (!changed) return { kind: "unchanged", notes };
  return { kind: "trimmed", payload: current, notes: [cutoffNote(asOf), ...notes] };
}
