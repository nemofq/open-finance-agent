import { figureProblem, matchFigures } from "@/lib/evidence/figures";
import type { BeforeStopRule } from "../events";

/**
 * P8 — unsourced figures. A figure in the final answer that matches no E, C, A or U entry is
 * challenged once, within the shared follow-up budget, and flagged after that.
 */

export const p8UnsourcedFigures: BeforeStopRule = (event, context) => {
  const unsourced = matchFigures(event.text, context.ledger).filter(
    (match) => !match.figure.exempt && match.matches.length === 0,
  );
  if (unsourced.length === 0) return undefined;

  const figures = [...new Set(unsourced.map((match) => match.figure.raw))];
  const reason = `${figures.length} figure${figures.length === 1 ? "" : "s"} lack matching available evidence or cite the wrong entry: ${figures.join(", ")}.`;
  if (context.followUpsLeft <= 0) return { rule: "P8", kind: "flag", reason, figures };
  // A figure is asked about once per run. One still unsourced after the model was sent back is
  // more likely a value the matcher cannot see (a figure quoted from a filing's prose, say) than
  // a fresh miss, and spending the whole budget re-asking would starve the other rules.
  const asked = new Set(
    context.checks
      .filter((check) => check.rule === "P8" && check.kind === "follow_up")
      .flatMap((check) => check.figures ?? []),
  );
  if (figures.every((figure) => asked.has(figure))) {
    return { rule: "P8", kind: "flag", reason: `${reason} They were already asked for once this run.`, figures };
  }

  const fix = context.calculatorAvailable
    ? "compute it with financial_calculator, naming the evidence ids it builds on, or cite the evidence id it comes from, or take it out"
    : "cite the evidence id it comes from, or take it out — the calculator is unavailable, so a figure that needs a calculation cannot be used";
  return {
    rule: "P8",
    kind: "follow_up",
    reason,
    text:
      unsourced.map(figureProblem).join("\n") +
      `\nPlace each figure's citation immediately after its value, before another figure. For a missing figure, ${fix}. Preserve the required answer scope and length. Give the corrected answer directly, without commentary about these corrections.`,
    figures,
  };
};
