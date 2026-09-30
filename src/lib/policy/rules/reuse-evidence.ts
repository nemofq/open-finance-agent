import type { EvidenceEntry } from "@/lib/evidence/types";
import { stableStringify } from "@/lib/text/stable-json";
import type { BeforeToolRule, RuleContext } from "../events";
import { coversPrices, isCurrentQuote } from "./stale-quotes";

/**
 * P2 — duplicate data call. The same data tool with the same arguments, whose evidence is still
 * fresh, is served from the ledger instead of being fetched again.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function sameUtcDay(iso: string, now: number): boolean {
  const fetched = Date.parse(iso);
  return Number.isFinite(fetched) && Math.floor(fetched / DAY_MS) === Math.floor(now / DAY_MS);
}

/**
 * A quote is fresh while it is not older than the last completed session; everything else is
 * fresh for the rest of the day it was fetched on.
 */
function isFresh(entry: EvidenceEntry, priceLike: boolean, context: RuleContext): boolean {
  if (priceLike) return isCurrentQuote(entry, context.time);
  return sameUtcDay(entry.fetchedAt, context.now());
}

export const p2DuplicateDataCall: BeforeToolRule = (event, context) => {
  if (event.tool?.meta.class !== "data") return undefined;

  const args = stableStringify(event.args, { omitUndefined: true });
  const priceLike = coversPrices(event.tool);
  const served = context.ledger
    .list("E")
    .findLast(
      (entry) =>
        entry.tool === event.toolName &&
        stableStringify(entry.args, { omitUndefined: true }) === args &&
        isFresh(entry, priceLike, context),
    );
  if (!served) return undefined;

  return {
    rule: "P2",
    kind: "serve",
    reason: `Already fetched as ${served.id}: ${served.summary}. Use evidence_get ${served.id} for values.`,
    evidence: [served.id],
  };
};
