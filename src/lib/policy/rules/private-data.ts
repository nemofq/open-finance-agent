import { extractFigures, figureEquals } from "@/lib/evidence/figures";
import { argsText, isExternalGeneralTool } from "../args";
import type { BeforeToolRule } from "../events";

/**
 * P3 — personal data leaving. A general tool that sends its arguments off the machine must not
 * carry an account name, a position size or a cost basis.
 */

/** Shorter names ("IRA", "HSA") are account types, not identities, and match too much prose. */
const MIN_ACCOUNT_NAME = 4;

/**
 * Round numbers such as 100 or 500 are as likely to be part of a question as a position size,
 * so only a distinctive holdings figure counts as a leak. Calibrated on the benchmark.
 */
function distinctive(value: number): boolean {
  return !Number.isInteger(value) || value % 10 !== 0 || Math.abs(value) >= 10_000;
}

export const p3PersonalDataLeaving: BeforeToolRule = (event, context) => {
  if (!isExternalGeneralTool(event.tool)) return undefined;
  const privacy = context.privacy;
  if (!privacy) return undefined;

  const text = argsText(event.args);
  const lower = text.toLowerCase();
  const account = privacy.accountNames.find(
    (name) => name.trim().length >= MIN_ACCOUNT_NAME && lower.includes(name.trim().toLowerCase()),
  );
  if (account) {
    return {
      rule: "P3",
      kind: "block",
      reason: `Your holdings stay on this machine: the arguments to ${event.toolName} name the account "${account}". Ask about public information instead.`,
    };
  }

  const values = [...privacy.quantities, ...privacy.costs].filter(distinctive);
  if (values.length === 0) return undefined;
  const leak = extractFigures(text).find(
    (figure) => !figure.exempt && values.some((value) => figureEquals(figure, value)),
  );
  if (!leak) return undefined;

  return {
    rule: "P3",
    kind: "block",
    reason: `Your holdings stay on this machine: the arguments to ${event.toolName} contain the position figure ${leak.raw}. Ask about public information instead, and read your own numbers with portfolio_get.`,
    figures: [leak.raw],
  };
};
