import type { InstrumentClass } from "@/lib/profile/types";
import type { BeforeModelRule } from "../events";

/**
 * P12 — the request involves instruments the profile excludes, or that do not suit its stated
 * experience. A one-line note goes into the turn's context asking the answer to say so.
 */

/**
 * The instrument classes a request mentions, by keyword. Each pattern is a whole word or phrase
 * that names the instrument itself, not a word that merely shares its stem: "operating leverage",
 * "net leverage" and "a leveraged buyout" describe a company's balance sheet, "treasury stock" is
 * a buyback, "what are my options" is not a derivative and "leaps and bounds" is not a LEAPS.
 */
const PATTERNS: readonly (readonly [InstrumentClass, readonly RegExp[]])[] = [
  ["options", [
    /\b(call|put) options?\b/i,
    /\boptions? (trading|trades?|contracts?|chains?|strateg(y|ies)|premiums?|expir\w*|positions?)\b/i,
    /\b(trade|trading|buy|buying|sell|selling|write|writing) options\b/i,
    /\b(buy|buying|sell|selling|write|writing|sold|bought) (covered |naked |cash[- ]secured )?(calls|puts)\b/i,
    /\bcovered[- ]calls?\b|\bcash[- ]secured puts?\b|\bstrike prices?\b|\bimplied volatility\b/i,
    /\bLEAPS\b/,
  ]],
  ["leverage", [
    /\bleveraged (etfs?|etns?|funds?|products?|tokens?|positions?|trading|trades?|bets?|exposure|long|short)\b/i,
    /\b(use|using|used|with|add|adding|take on|taking on) leverage\b/i,
    /\b(buy|buying|bought|trade|trading|invest|investing) on margin\b|\bmargin (accounts?|loans?|debt|calls?|trading|lending)\b/i,
    /\b[23]x (leveraged |long |short )?(etfs?|funds?|long|short|exposure)\b/i,
  ]],
  ["crypto", [/\b(crypto(currenc(y|ies))?|bitcoin|btc|ethereum|ether|altcoins?|stablecoins?)\b/i]],
  ["bonds", [
    /\b(bonds?|treasuries|fixed income|munis?|t-bills?|t-notes?)\b/i,
    /\btreasury (bonds?|notes?|bills?|yields?|securities|etfs?)\b/i,
  ]],
  ["etfs", [/\b(etfs?|exchange[- ]traded funds?)\b/i]],
  ["funds", [/\b(mutual funds?|index funds?)\b/i]],
  ["stocks", [/\b(stocks?|equities)\b|\b(individual|single) shares\b|\bshares (of|in)\b/i]],
];

/** How a note names an instrument class. */
const INSTRUMENT_LABELS: Record<InstrumentClass, string> = {
  stocks: "stocks",
  etfs: "ETFs",
  funds: "funds",
  bonds: "bonds",
  options: "options",
  leverage: "leverage",
  crypto: "crypto",
};

export function detectInstruments(text: string): InstrumentClass[] {
  return PATTERNS.flatMap(([instrument, patterns]) => (patterns.some((pattern) => pattern.test(text)) ? [instrument] : []));
}

/** Instrument classes a beginner should not be handed without the risks spelled out first. */
const ADVANCED_INSTRUMENTS: readonly InstrumentClass[] = ["options", "leverage"];

function labels(instruments: readonly InstrumentClass[]): string {
  return instruments.map((instrument) => INSTRUMENT_LABELS[instrument]).join(", ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first exclusion the text names as a whole word ("oil" is not in "soil"), plural or not. */
function excludedTerm(text: string, exclusions: string[] | undefined): string | undefined {
  return exclusions?.find((term) => {
    const trimmed = term.trim();
    return trimmed.length >= 3 && new RegExp(`(?<!\\w)${escapeRegExp(trimmed)}(s|es)?(?!\\w)`, "i").test(text);
  });
}

/**
 * Only the user's current request is read, never earlier turns or what the chat fetched, so one
 * mention of an instrument does not keep adding the note to every later question. An empty or
 * absent allowed-instruments list places no constraint.
 */
export const p12ProfileMismatch: BeforeModelRule = (event, context) => {
  const profile = context.profile;
  if (!profile) return undefined;

  const text = event.text;
  const mentioned = detectInstruments(text);

  const allowed = profile.constraints?.allowedInstruments ?? [];
  const disallowed = allowed.length > 0 ? mentioned.filter((instrument) => !allowed.includes(instrument)) : [];
  if (disallowed.length > 0) {
    return {
      rule: "P12",
      kind: "annotate",
      reason: `The request involves ${labels(disallowed)}, which the investor profile does not allow.`,
      text: `Note: this request involves ${labels(disallowed)}, which the investor profile does not allow (allowed: ${labels(allowed)}). Explain the risks and say plainly how this sits with the stated profile; give research, not a recommendation.`,
    };
  }

  const term = excludedTerm(text, profile.constraints?.exclusions);
  if (term) {
    return {
      rule: "P12",
      kind: "annotate",
      reason: `The request touches "${term}", which the investor profile excludes.`,
      text: `Note: this request touches "${term}", which the investor profile excludes. Cover it as research, say why it is excluded, and do not recommend it.`,
    };
  }

  const beyond = mentioned.filter((instrument) => ADVANCED_INSTRUMENTS.includes(instrument));
  if (profile.experience?.level === "beginner" && beyond.length > 0) {
    return {
      rule: "P12",
      kind: "annotate",
      reason: `The request involves ${labels(beyond)}, beyond the profile's beginner experience level.`,
      text: `Note: this request involves ${labels(beyond)}, beyond the stated beginner experience level. Explain the mechanics and the ways this loses money before anything else.`,
    };
  }

  return undefined;
};
