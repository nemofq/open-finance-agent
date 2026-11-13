import type { StructuredDetails } from "@/lib/evidence/types";
import { trimToAsOf, type TrimOutcome } from "./asof";
import { stockfitDetails, stockfitSummary } from "./details";

export interface PostProcessed {
  text: string;
  details?: StructuredDetails;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Rewrite one StockFit MCP result before the model sees it: trim it to the turn's as-of date and
 * describe it for the evidence ledger. It runs on the raw server text after the cache, never inside
 * it, since one cached body is shared by turns with different as-of dates.
 */
export function stockfitPostProcess(toolName: string, args: Record<string, unknown>, text: string, asOf?: string): PostProcessed {
  const payload = parseJson(text);
  if (payload === undefined) return { text, details: stockfitSummary(toolName, args) };

  const outcome: TrimOutcome = asOf ? trimToAsOf(toolName, args, payload, asOf) : { kind: "unchanged", notes: [] };
  if (outcome.kind === "withheld") return { text: outcome.text, details: stockfitSummary(toolName, args) };

  const kept = outcome.kind === "trimmed" ? outcome.payload : payload;
  const body = outcome.kind === "trimmed" ? JSON.stringify(kept) : text;
  const normalized = stockfitDetails(toolName, args, kept);
  const notes = [...outcome.notes, ...normalized.notes];
  return { text: notes.length ? `${body}\n\n${notes.join("\n")}` : body, details: normalized.details };
}
