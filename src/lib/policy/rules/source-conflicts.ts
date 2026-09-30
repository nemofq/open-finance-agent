import { extractFigures, figureEquals } from "@/lib/evidence/figures";
import type { AfterToolRule, BeforeStopRule } from "../events";

/**
 * P5 — sources disagree. The evidence track records the disagreement and annotates the result;
 * this rule keeps the record, and checks at the end of the turn that the answer says so.
 */

/** "conflict", "conflicting", "differ", "different", "discrepancy", "disagree". */
const MENTIONS_CONFLICT = /\b(conflict|differ|discrepan|disagree)/i;

export const p5SourcesDisagree: AfterToolRule = (event) => {
  const entry = event.entry;
  const disagreements = entry?.conflicts?.filter((conflict) => !conflict.agree) ?? [];
  if (!entry || disagreements.length === 0) return undefined;

  const first = disagreements[0];
  return {
    rule: "P5",
    kind: "annotate",
    reason: `${entry.id} and ${first.with} disagree on ${first.metric} for ${first.period}: ${first.value} vs ${first.otherValue}.`,
    figures: disagreements.flatMap((conflict) => [String(conflict.value), String(conflict.otherValue)]),
    evidence: [entry.id, ...disagreements.map((conflict) => conflict.with)],
  };
};

export const p5ConflictUnmentioned: BeforeStopRule = (event, context) => {
  const conflicts = context.state.conflicts;
  if (conflicts.length === 0 || MENTIONS_CONFLICT.test(event.text)) return undefined;

  const figures = extractFigures(event.text);
  const shows = (value: number) => figures.some((figure) => figureEquals(figure, value));
  const silent = conflicts.filter((conflict) => !(shows(conflict.value) && shows(conflict.otherValue)));
  if (silent.length === 0) return undefined;

  const first = silent[0];
  return {
    rule: "P5",
    kind: "flag",
    reason: `Sources disagree on ${first.metric} for ${first.period} (${first.value} vs ${first.otherValue}) and the answer does not say so.`,
    figures: silent.flatMap((conflict) => [String(conflict.value), String(conflict.otherValue)]),
    evidence: silent.flatMap((conflict) => [conflict.entry, conflict.with]),
  };
};
