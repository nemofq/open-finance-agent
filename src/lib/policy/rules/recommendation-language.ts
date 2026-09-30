import type { BeforeStopRule } from "../events";

/**
 * P11 — recommendation wording. Flagged, never corrected: the answer is still useful, and the
 * renderer adds the research disclaimer.
 */

/** Phrases that read as investment advice: a buy or sell call, or a position size. */
const PATTERNS: readonly RegExp[] = [
  /\byou (should|ought to|need to|must) (buy|sell|short|dump|avoid buying|get out)\b/i,
  /\b(i|we) (would |'d )?(strongly )?recommend (buying|selling|shorting|adding|trimming)\b/i,
  /\bmy recommendation (is|would be) to (buy|sell|short|hold)\b/i,
  /\b(strong buy|strong sell|table[- ]pounding buy)\b/i,
  /\b(buy|sell) (it |this |them )?now\b/i,
  /\bload up on\b/i,
  /\btime to (buy|sell|short)\b/i,
  /\b(i|we) (would |'d )?(buy|sell|short) (it|this|these|them)\b/i,
  /\b(put|allocate|invest) \d+(\.\d+)?%? ?(of your (portfolio|capital|money)|into)\b/i,
  /\byour position (should|ought to) be\b/i,
];

/** The advice-shaped phrases in a text, in the order they appear. */
export function findRecommendations(text: string): string[] {
  const hits = PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [{ index: match.index, phrase: match[0].trim() }] : [];
  });
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.phrase);
}

export const p11RecommendationWording: BeforeStopRule = (event) => {
  const phrases = findRecommendations(event.text);
  if (phrases.length === 0) return undefined;

  return {
    rule: "P11",
    kind: "flag",
    reason: `The answer reads as advice ("${phrases[0]}"). This product gives research on fit, relevance and risks, not buy or sell calls.`,
  };
};
