import type { AfterToolRule } from "../events";

/**
 * P13 — look-ahead evidence. The evidence track tags an entry dated after the turn's fixed
 * as-of date; the record makes it countable, and the benchmark reports the count.
 */

export const p13LookAhead: AfterToolRule = (event, context) => {
  const entry = event.entry;
  if (!entry?.lookAhead) return undefined;

  const asOf = context.time.asOf ?? context.time.localDate;
  return {
    rule: "P13",
    kind: "annotate",
    reason: `${entry.id} is dated ${entry.asOf ?? "later"}, after this turn's as-of date ${asOf}; do not use it.`,
    evidence: [entry.id],
  };
};
