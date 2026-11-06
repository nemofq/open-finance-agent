/**
 * Point-in-time trimming for StockFit responses. Pure functions over one already-parsed response: a
 * fixed as-of turn must never cost an extra API call, so a value dated after the cutoff is dropped,
 * not re-fetched.
 */

import { isRecord } from "@/lib/utils";
import { PRICE_HISTORY_TOOL, STATEMENT_TOOLS } from "./meta";

export type JsonObject = Record<string, unknown>;

export type TrimOutcome =
  /** The original text stands; `notes` may still carry a caveat to append to it. */
  | { kind: "unchanged"; notes: string[] }
  /** Re-serialise `payload` in place of the original text, then append `notes`. */
  | { kind: "trimmed"; payload: unknown; notes: string[] }
  /** Replace the whole result: nothing in it can be rewound to the cutoff. */
  | { kind: "withheld"; text: string };

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/** The `YYYY-MM-DD` head of a date or date-time string, or undefined when it is neither. */
export function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && DATE_PREFIX.test(value) ? value.slice(0, 10) : undefined;
}

/** A price bar's epoch-millisecond timestamp as its UTC day. */
export function barDay(ts: unknown): string | undefined {
  return typeof ts === "number" && Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : undefined;
}

/** What a statement returns when no `limit` is given, and the most it accepts. */
const DEFAULT_PERIODS = 4;
const MAX_PERIODS = 80;

function periodsSince(asOf: string, today: string, quarterly: boolean): number {
  const days = (Date.parse(today) - Date.parse(asOf)) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.ceil(days / (quarterly ? 91 : 365));
}

/**
 * The arguments of a fixed as-of turn. Split adjustment rescales old EPS and share counts by splits
 * after the cutoff while their source filing stays old, so values are asked for as filed. A statement
 * returns its latest periods, which a past cutoff would trim away entirely, so the request reaches
 * back by the periods since the cutoff, plus one for the filing lag.
 */
export function asOfArgs(args: Record<string, unknown>, accepts: ReadonlySet<string>, asOf: string, today: string): Record<string, unknown> {
  const next = { ...args };
  if (accepts.has("splitAdjust")) next.splitAdjust = false;
  if (accepts.has("limit") && accepts.has("period")) {
    const requested = typeof args.limit === "number" && args.limit > 0 ? args.limit : DEFAULT_PERIODS;
    const quarterly = String(args.period ?? "annual").toLowerCase() === "quarter";
    next.limit = Math.min(MAX_PERIODS, requested + periodsSince(asOf, today, quarterly) + 1);
  }
  return next;
}

/* ------------------------------------------------------------- statements */

export interface Supplier {
  accession: string;
  filed: string | undefined;
}

/**
 * The filing that set each fact's value: the latest source listing it. StockFit lists a filing under
 * a fact only when it first supplied or changed the value. A reconstruction (`Q3-Recon-9M-H1`) has
 * no filing date of its own and dates from the row's filing.
 */
export function suppliers(row: JsonObject): Map<string, Supplier> {
  const rowFiled = isoDay(row.dateFiled);
  const found = new Map<string, Supplier>();
  for (const [accession, source] of Object.entries(isRecord(row.sources) ? row.sources : {})) {
    if (!isRecord(source) || !isRecord(source.facts)) continue;
    const filed = isoDay(source.dateFiled) ?? rowFiled;
    for (const field of Object.keys(source.facts)) {
      const current = found.get(field);
      if (!current || (filed ?? "") > (current.filed ?? "")) found.set(field, { accession, filed });
    }
  }
  return found;
}

function sourceDay(source: unknown, rowFiled: string): string {
  return (isRecord(source) ? isoDay(source.dateFiled) : undefined) ?? rowFiled;
}

/**
 * One period as it stood on `asOf`, or undefined when it was filed later. A value a later filing
 * revised is dropped rather than rewound, so a trimmed row never shows a figure that was not public.
 */
function trimRow(row: JsonObject, asOf: string): { row: JsonObject; removed: number } | undefined {
  const filed = isoDay(row.dateFiled);
  // A period that cannot be placed in time cannot be shown to predate the cutoff.
  if (!filed || filed > asOf) return undefined;

  const sources = isRecord(row.sources) ? row.sources : {};
  const allKnown = Object.values(sources).every((source) => sourceDay(source, filed) <= asOf);
  if (allKnown) return { row, removed: 0 };

  const supplied = suppliers(row);
  const facts: JsonObject = {};
  let removed = 0;
  for (const [field, value] of Object.entries(isRecord(row.facts) ? row.facts : {})) {
    const supplier = supplied.get(field);
    // A derived line (EBITDA, free cash flow) has no source of its own; one revised input taints it.
    const known = supplier ? supplier.filed !== undefined && supplier.filed <= asOf : allKnown;
    if (known) facts[field] = value;
    else removed++;
  }
  const keptSources = Object.fromEntries(Object.entries(sources).filter(([, source]) => sourceDay(source, filed) <= asOf));
  const trimmed: JsonObject = { ...row, facts, sources: keptSources };
  if (Array.isArray(row.derived)) trimmed.derived = row.derived.filter((field) => typeof field === "string" && field in facts);
  return { row: trimmed, removed };
}

function trimStatements(payload: unknown, asOf: string): TrimOutcome {
  if (!Array.isArray(payload)) return { kind: "unchanged", notes: [] };
  const kept: unknown[] = [];
  let removed = 0;
  let changed = false;
  for (const row of payload) {
    const result = isRecord(row) ? trimRow(row, asOf) : undefined;
    if (!result || result.row !== row) changed = true;
    if (!result) continue;
    removed += result.removed;
    kept.push(result.row);
  }
  if (!changed) return { kind: "unchanged", notes: [] };
  const notes = [`Point-in-time: trimmed to values filed on or before ${asOf}.`];
  if (removed > 0) notes.push(`Removed ${removed} value${removed === 1 ? "" : "s"} that a filing after ${asOf} revised.`);
  return { kind: "trimmed", payload: kept, notes };
}

/** A trailing-twelve-month total is summed from today's latest four quarters, so it cannot be rewound. */
function withheldTtm(toolName: string, asOf: string): TrimOutcome {
  return {
    kind: "withheld",
    text:
      `Withheld: ${toolName} with period=ttm sums the latest four quarters as of today, not as of ${asOf}. ` +
      `Call it with period=quarter and add up the four quarters filed on or before ${asOf}.`,
  };
}

/* ----------------------------------------------------------------- prices */

function trimPrices(payload: unknown, asOf: string): TrimOutcome {
  const basis = `Point-in-time: closes are on today's split basis, and adjusted closes also deduct distributions paid after ${asOf}.`;
  if (!isRecord(payload) || !Array.isArray(payload.data)) return { kind: "unchanged", notes: [basis] };

  const data = payload.data.filter((bar) => {
    const day = Array.isArray(bar) ? barDay(bar[0]) : undefined;
    return day !== undefined && day <= asOf;
  });
  const latestDay = isRecord(payload.latestQuote) ? isoDay(payload.latestQuote.ts) : undefined;
  const dropLatest = "latestQuote" in payload && (latestDay === undefined || latestDay > asOf);
  if (data.length === payload.data.length && !dropLatest) return { kind: "unchanged", notes: [basis] };

  const trimmed: JsonObject = Object.fromEntries(Object.entries(payload).filter(([key]) => !(dropLatest && key === "latestQuote")));
  trimmed.data = data;
  return { kind: "trimmed", payload: trimmed, notes: [`Point-in-time: trimmed to bars on or before ${asOf}.`, basis] };
}

/* --------------------------------------------------------------- dispatch */

/** Trim one StockFit JSON response to `asOf`. */
export function trimToAsOf(toolName: string, args: Record<string, unknown>, payload: unknown, asOf: string): TrimOutcome {
  if (STATEMENT_TOOLS.has(toolName)) {
    if (String(args.period ?? "").toLowerCase() === "ttm") return withheldTtm(toolName, asOf);
    return trimStatements(payload, asOf);
  }
  if (toolName === PRICE_HISTORY_TOOL) return trimPrices(payload, asOf);
  return { kind: "unchanged", notes: [] };
}
