/**
 * Shared reading of a tool result: its text, the numbers in it, the dates it states and the
 * entity it is about. The normalizers start here, and so do providers describing their results.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { TICKER_ARGUMENTS } from "@/lib/tools/arguments";
import type { ToolMeta } from "@/lib/tools/contracts";
import { sourcedFigures } from "../figures";
import type { EvidenceEntity, EvidenceEntry, EvidenceNumber, EvidenceSource, StructuredDetails } from "../types";

/** What a normalizer makes of a result: an entry, less what the ledger assigns when it registers it. */
export type Normalized = Omit<EvidenceEntry, "id" | "fetchedAt" | "kind">;

/** A long filing repeats the same figures; past this many distinct values the tail adds nothing. */
const MAX_NUMBERS = 300;
const MAX_CONTEXT_CHARS = 160;

export function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The line the figure sits on, which in tool output is almost always its label too. */
function contextAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const line = collapse(text.slice(start, end));
  if (line.length <= MAX_CONTEXT_CHARS) return line;
  const from = Math.max(0, index - start - MAX_CONTEXT_CHARS / 2);
  return collapse(text.slice(start + from, start + from + MAX_CONTEXT_CHARS));
}

/** Every number worth sourcing, with the line it came from. */
export function extractNumbers(text: string, limit = MAX_NUMBERS): EvidenceNumber[] {
  return sourcedFigures(text).slice(0, limit).map((figure) => {
    const number: EvidenceNumber = { value: figure.value, context: contextAt(text, figure.index) };
    if (figure.unit) number.unit = figure.unit;
    return number;
  });
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function pad(value: string): string {
  return value.padStart(2, "0");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** `2024-08-28`, `Aug 28, 2024`, `8/28/2024` and Alpha Vantage's `20240828T161500` as one shape. */
export function toIsoDate(value: string): string | undefined {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = /^(\d{4})(\d{2})(\d{2})T/.exec(trimmed);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const named = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(trimmed);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month) return `${named[3]}-${month}-${pad(named[2])}`;
  }
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashed) return `${slashed[3]}-${pad(slashed[1])}-${pad(slashed[2])}`;
  return undefined;
}

/** The latest of some `YYYY-MM-DD` days, skipping the ones that are missing or not a real date. */
export function latestDate(dates: (string | undefined)[]): string | undefined {
  const valid = dates.filter((date): date is string => !!date && isIsoDate(date));
  return valid.length ? valid.sort().at(-1) : undefined;
}

const MONTH_NAMES = Object.keys(MONTHS).join("|");

/** Extracts explicitly stated publication or filing dates from text. */
export function publishedDate(text: string): string | undefined {
  const patterns = [
    /https?:\/\/\S+\s*\((\d{4}-\d{2}-\d{2})\)/g,
    /\b(?:published|updated|posted|dated|as of|filed)\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})\b/gi,
    new RegExp(
      `\\b(?:published|updated|posted|dated|as of|filed)\\s*(?:on|:)?\\s*((?:${MONTH_NAMES})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})\\b`,
      "gi",
    ),
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const iso = toIsoDate(match[1]);
      if (iso) found.push(iso);
    }
  }
  return latestDate(found);
}

const CIK_KEYS = ["cik", "cik_number"];

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  }
  return undefined;
}

/** What the call was about, taken from the arguments the model passed. */
export function entityFromArgs(args: unknown): EvidenceEntity | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const ticker = stringField(record, TICKER_ARGUMENTS);
  const cik = stringField(record, CIK_KEYS);
  if (!ticker && !cik) return undefined;
  const entity: EvidenceEntity = {};
  if (ticker) entity.ticker = ticker.replace(/^\$/, "").toUpperCase();
  if (cik) entity.cik = cik;
  return entity;
}

export function mergeEntities(...parts: (EvidenceEntity | undefined)[]): EvidenceEntity | undefined {
  const merged: EvidenceEntity = {};
  for (const part of parts) {
    if (part?.ticker && !merged.ticker) merged.ticker = part.ticker;
    if (part?.cik && !merged.cik) merged.cik = part.cik;
    if (part?.name && !merged.name) merged.name = part.name;
  }
  return merged.ticker || merged.cik || merged.name ? merged : undefined;
}

/** What a data tool attached for us, when the module already knows its own numbers exactly. */
export function structuredOf(details: unknown): StructuredDetails {
  if (!details || typeof details !== "object") return {};
  return details as StructuredDetails;
}

/** The tool's declared source, unless the result names a better one (a sec.gov web page). */
export function sourceOf(meta: ToolMeta, override?: EvidenceSource): EvidenceSource | undefined {
  if (override) return override;
  if (!meta.source) return undefined;
  const { id, name, tier } = meta.source;
  return { id, name, tier };
}
