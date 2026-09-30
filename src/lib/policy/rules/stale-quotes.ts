import type { EvidenceEntry } from "@/lib/evidence/types";
import type { TimeContext } from "@/lib/time/types";
import type { FinanceTool } from "@/lib/tools/contracts";
import type { AfterToolRule } from "../events";

/**
 * P4 — stale quote. A price result dated before the last completed trading session is annotated,
 * so the model cannot present yesterday's close as today's price. What a quote is, and when it is
 * current, is defined here; P2 reads the same two definitions to decide what it may serve again.
 */

/** A data tool whose source covers prices: what it returns is a quote. */
export function coversPrices(tool: FinanceTool | undefined): boolean {
  return tool?.meta.class === "data" && (tool.meta.source?.coverage.includes("prices") ?? false);
}

/** A quote dated on or after the last completed session. */
export function isCurrentQuote(entry: EvidenceEntry, time: TimeContext): boolean {
  return entry.asOf !== undefined && entry.asOf >= time.market.lastCompletedSession;
}

export const p4StaleQuote: AfterToolRule = (event, context) => {
  const entry = event.entry;
  if (!entry || event.isError || !coversPrices(event.tool)) return undefined;

  const last = context.time.market.lastCompletedSession;
  if (!entry.asOf || isCurrentQuote(entry, context.time)) return undefined;

  return {
    rule: "P4",
    kind: "annotate",
    reason: `${entry.id} is as of ${entry.asOf}, older than the last completed session ${last}.`,
    text: `Note: quote is as of ${entry.asOf}, older than the last completed session ${last}.`,
    evidence: [entry.id],
  };
};
