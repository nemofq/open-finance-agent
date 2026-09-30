import type { Horizon, InstrumentClass, InvestorProfile, InvestorRole, PrimaryObjective, RiskTolerance } from "./types";

/** Only mappings that differ from the stored value live here; the rest read well as they are. */
const roleWords: Record<InvestorRole, string> = {
  individual: "individual investor",
  advisor: "advisor",
  analyst: "analyst",
  portfolio_manager: "portfolio manager",
};

const objectiveWords: Record<PrimaryObjective, string> = {
  growth: "growth",
  income: "income",
  preservation: "capital preservation",
  balanced: "balanced",
  speculation: "speculation",
};

/** Phrased to follow "over", e.g. "income over 3-10 years". */
const horizonWords: Record<Horizon, string> = {
  under_1y: "less than 1 year",
  "1_3y": "1-3 years",
  "3_10y": "3-10 years",
  over_10y: "10+ years",
};

const toleranceWords: Record<RiskTolerance, string> = {
  low: "low",
  moderate: "moderate",
  high: "high",
  very_high: "very high",
};

const instrumentWords: Record<InstrumentClass, string> = {
  stocks: "stocks",
  etfs: "ETFs",
  funds: "funds",
  bonds: "bonds",
  options: "options",
  leverage: "leverage",
  crypto: "crypto",
};

/** A field that is unset contributes `undefined`, which drops out here. */
function present(values: (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value !== "");
}

function line(label: string, values: (string | undefined)[], separator = ", "): string | undefined {
  const set = present(values);
  return set.length > 0 ? `- ${label}: ${set.join(separator)}` : undefined;
}

/** "a", "a and b", "a, b and c". */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function commaList(items: string[] | undefined): string | undefined {
  return items && items.length > 0 ? items.join(", ") : undefined;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * The profile as a compact block for the system prompt: at most 12 lines (a heading, up to eight
 * facts and the rule), only the fields the user actually set, and `""` when nothing is set.
 */
export function formatProfileForPrompt(profile: InvestorProfile): string {
  const { experience, objectives, risk, constraints, jurisdiction, style } = profile;

  const objective = objectives?.primary && objectiveWords[objectives.primary];
  const horizon = objectives?.horizon && horizonWords[objectives.horizon];
  const instruments = commaList(constraints?.allowedInstruments?.map((instrument) => instrumentWords[instrument]));
  const metrics = style?.preferredMetrics?.length ? sentenceList(style.preferredMetrics) : undefined;
  const accounts = commaList(jurisdiction?.accountTypes);
  const avoids = commaList(constraints?.exclusions);
  const where = present([
    jurisdiction?.baseCurrency && `base currency: ${jurisdiction.baseCurrency}`,
    jurisdiction?.country && `country: ${jurisdiction.country}`,
    jurisdiction?.taxResidency && `tax residency: ${jurisdiction.taxResidency}`,
    accounts && `accounts: ${accounts}`,
  ]);

  const body = present([
    line("Experience", [experience?.level, experience?.role && roleWords[experience.role]], " "),
    objective ? `- Objective: ${objective}${horizon ? ` over ${horizon}` : ""}` : horizon && `- Horizon: ${horizon}`,
    line("Risk", [
      risk?.tolerance && `${toleranceWords[risk.tolerance]} tolerance`,
      risk?.capacityForLoss && `${risk.capacityForLoss} capacity for loss`,
      risk?.liquidityNeeds && `${risk.liquidityNeeds} liquidity needs`,
    ]),
    instruments && `- Allowed instruments: ${instruments}`,
    avoids && `- Avoids: ${avoids}`,
    where.length > 0 ? `- ${capitalize(where.join("; "))}` : undefined,
    line("Style", [style?.approach && `${style.approach} approach`, metrics && `prefers ${metrics}`]),
    line("Answers", [style?.depth && `${style.depth} depth`, style?.answerLanguage && `in ${style.answerLanguage}`]),
  ]);

  if (body.length === 0) return "";
  return [
    "## Investor profile",
    ...body,
    "It changes framing, emphasis and depth, never the evidence standard; answers stay research, not buy or sell advice.",
  ].join("\n");
}
