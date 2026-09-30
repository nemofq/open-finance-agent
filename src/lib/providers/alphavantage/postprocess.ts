import type { StructuredDetails } from "@/lib/evidence/types";
import { cutoffNote, type JsonObject, parseJsonObject, SCHEDULED_FUNCTIONS, scheduledNote, trimToAsOf } from "./asof";
import { type CsvBody, csvText, parseCsvBody, trimCsvRows } from "./csv";
import { alphaVantageCsvDetails, alphaVantageDetails, alphaVantageSummary, type Normalized } from "./details";

export interface PostProcessed {
  text: string;
  details?: StructuredDetails;
}

function assemble(body: string, notes: string[], details?: StructuredDetails): PostProcessed {
  return { text: notes.length ? `${body}\n\n${notes.join("\n")}` : body, details };
}

/** JSON responses: trim the shapes we understand, then describe what is left. */
function processJson(
  toolName: string,
  args: Record<string, unknown>,
  text: string,
  payload: JsonObject,
  asOf?: string,
): PostProcessed {
  const outcome = asOf ? trimToAsOf(toolName, payload, asOf) : { kind: "unchanged" as const, notes: [] };
  if (outcome.kind === "withheld") return { text: outcome.text, details: alphaVantageSummary(toolName, args) };

  const trimmed = outcome.kind === "trimmed" ? outcome.payload : payload;
  const body = outcome.kind === "trimmed" ? JSON.stringify(outcome.payload, null, 2) : text;
  const normalized: Normalized = alphaVantageDetails(toolName, args, trimmed);
  return assemble(body, [...outcome.notes, ...normalized.notes], normalized.details);
}

/** CSV responses: the same cutoff and the same table, read off the header instead of the keys. */
function processCsv(
  toolName: string,
  args: Record<string, unknown>,
  text: string,
  csv: CsvBody,
  asOf?: string,
): PostProcessed {
  const scheduled = SCHEDULED_FUNCTIONS.has(toolName);
  const trim = asOf && !scheduled ? trimCsvRows(csv, asOf) : { rows: csv.rows, lines: csv.lines, changed: false };
  const normalized = alphaVantageCsvDetails(toolName, args, csv, trim.rows, scheduled);

  const notes: string[] = [];
  if (asOf && scheduled) notes.push(scheduledNote(toolName, asOf));
  if (trim.changed && asOf) notes.push(cutoffNote(asOf));
  notes.push(...normalized.notes);

  // Only a trim rewrites the body; an untouched CSV reaches the model exactly as it arrived.
  return assemble(trim.changed ? csvText(csv, trim.lines) : text, notes, normalized.details);
}

/**
 * Rewrite one Alpha Vantage MCP result before the model sees it: trim it to the turn's as-of
 * date and describe it for the evidence ledger. It runs on the raw server text after the cache,
 * never inside it — one cached body is shared by turns with different as-of dates. A failure
 * disguised as a result never gets here: `assertNoProblem` refuses it inside the cache loader.
 */
export function alphaVantagePostProcess(
  toolName: string,
  args: Record<string, unknown>,
  text: string,
  asOf?: string,
): PostProcessed {
  // The MCP server hands back JSON as text; CSV and prose take the other paths.
  const payload = parseJsonObject(text);
  if (payload) return processJson(toolName, args, text, payload, asOf);

  const csv = parseCsvBody(text);
  if (csv) return processCsv(toolName, args, text, csv, asOf);

  return { text, details: alphaVantageSummary(toolName, args) };
}
