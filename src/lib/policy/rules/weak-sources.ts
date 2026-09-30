import { matchFigures } from "@/lib/evidence/figures";
import type { EvidenceId } from "@/lib/evidence/types";
import type { BeforeStopRule, RuleContext } from "../events";

/**
 * P9 — a figure whose only backing is the open web (tier 4) is flagged as unverified, rather
 * than corrected: there is no cheaper source to send the model to.
 */

function openWebOnly(ids: EvidenceId[], context: RuleContext): boolean {
  return ids.every((id) => context.ledger.get(id)?.source?.tier === 4);
}

export const p9UnverifiedFigures: BeforeStopRule = (event, context) => {
  const unverified = matchFigures(event.text, context.ledger).filter(
    (match) => !match.figure.exempt && match.matches.length > 0 && openWebOnly(match.matches, context),
  );
  if (unverified.length === 0) return undefined;

  const figures = [...new Set(unverified.map((match) => match.figure.raw))];
  return {
    rule: "P9",
    kind: "flag",
    reason: `${figures.length} figure${figures.length === 1 ? "" : "s"} rest only on open-web sources (tier 4): ${figures.join(", ")}. Treat them as unverified.`,
    figures,
    evidence: [...new Set(unverified.flatMap((match) => match.matches))],
  };
};
