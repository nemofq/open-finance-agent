import { extractFigures } from "@/lib/evidence/figures";


/**
 * Explicit delivery intent is resolved at turn start; automatic choice commits as analysis is drafted.
 * The stop-time check asks once for a missed report; the turn's end renders one from the answer if
 * the model still did not.
 */

export interface Delivery {
  mode: "auto" | "chat" | "report";
  stage: "pending" | "created";
  /** The template a skill promised, when it did. */
  template?: string;
  /** One sentence for the footer and the developer. */
  why: string;
}

/** Ways of asking for the answer in chat. Word-bounded: "briefing" is not "briefly". */
const OPT_OUT =
  /\b(?:in (?:the )?chat|no report|without a report|just tell me|briefly|quickly|quick (?:answer|reply|version|summary|take|check)|short answer|one[- ]liner|tl;?dr|don'?t (?:make|build|create) a report)\b/i;
/** A bounded factual reply is chat; a constraint such as "use only two sources" is not. */
const BOUNDED_FACTS = /(?:^|[.!?—–])\s*(?:just|only)\s+(?:(?:those|these|the)\s+)?(?:one|two|three|four|five|\d+)\s+(?:numbers?|figures?|facts?|values?)\b/im;

/** Default report heuristics apply only when the user leaves delivery open. */
const ANALYSIS = { figures: 8, tableFigures: 3, length: 2_500, longFigures: 3 };

export function resolveDelivery(input: { request: string; skill?: { name: string; output?: string } }): Delivery {
  const template = input.skill?.output?.trim();
  if (input.skill && template) {
    return { mode: "report", stage: "pending", template, why: `The ${input.skill.name} skill delivers a ${template} report.` };
  }
  if (OPT_OUT.test(input.request) || BOUNDED_FACTS.test(input.request)) {
    return { mode: "chat", stage: "pending", why: "The user asked for the answer in chat." };
  }
  return { mode: "auto", stage: "pending", why: "Use a report for analysis and chat for quick facts." };
}

/**
 * The stop-time test for a plain turn: an answer with many figures, a table, or length plus
 * figures is a report that was written in chat. Skill turns never need this — their mode is fixed.
 */
export function looksLikeAnalysis(text: string): string | undefined {
  const figures = extractFigures(text).filter((f) => !f.exempt).length;
  const table = text.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length >= 2;
  const long = text.length > ANALYSIS.length;
  const analysis =
    figures >= ANALYSIS.figures ||
    (table && figures >= ANALYSIS.tableFigures) ||
    (long && figures >= ANALYSIS.longFigures);
  if (!analysis) return undefined;
  return [`${figures} figures`, table ? "a table" : undefined, long ? "long" : undefined].filter(Boolean).join(", ");
}
