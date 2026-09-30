/**
 * How much of a message's attached text may be inlined. A 32k-context model and a
 * 1M-context model get different answers, decided from the model alone: there is no setting, and
 * the model never has to be told how big it is.
 *
 * Client-safe, like `./limits`, and for the same reason: the composer works out the same budget to
 * decide whether a chip should say the agent will read the file in parts, and the two must agree.
 */

import type { StoredAttachment } from "./types";

/** The share of the window one message's attachments may take. */
const INLINE_SHARE = 0.2;

/** Below this a digest is barely worth writing; above it, one file would crowd out the chat. */
const MIN_INLINE_TOKENS = 4_000;
export const MAX_INLINE_TOKENS = 60_000;

/**
 * A hand-listed endpoint model often states no window. `resolveContextBudget` assumes 32k for its
 * own thresholds; inlining is the riskier bet of the two, so it assumes less than a fifth of that.
 */
const UNKNOWN_WINDOW_TOKENS = 6_000;

/**
 * Tokens the documents on one message may take together. A window of zero, or none at all, is an
 * endpoint that never said how big it is: the server still has to pick a number, and picks this.
 * A caller with nothing useful to show the user may prefer to say nothing instead.
 */
export function inlineBudget(contextWindow: number | undefined): number {
  if (contextWindow === undefined || !(contextWindow > 0)) return UNKNOWN_WINDOW_TOKENS;
  return Math.min(MAX_INLINE_TOKENS, Math.max(MIN_INLINE_TOKENS, Math.floor(contextWindow * INLINE_SHARE)));
}

/**
 * Which of a message's documents are inlined in full, in the order they were attached.
 *
 * The budget is spent rather than divided: each document in turn takes what it needs, and one that
 * does not fit what is left is digested and spends nothing. A single huge file therefore does not
 * cost the smaller ones beside it their full text, which dividing the budget evenly would.
 *
 * A table is never inlined — the model computes on tables through the calculator, not by reading
 * rows — so it is not offered the budget either.
 */
export function fitsInline(documents: StoredAttachment[], budget: number): boolean[] {
  let left = budget;
  return documents.map((document) => {
    if (document.kind === "table" || document.tokens > left) return false;
    left -= document.tokens;
    return true;
  });
}
