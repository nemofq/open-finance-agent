import { matchFigures } from "@/lib/evidence/figures";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { mentionedIds } from "@/lib/evidence/ids";

/**
 * The research checkpoint: what the model is asked to write, and the check that
 * no figure survives it without an id that holds the value.
 */

export interface CheckpointInput {
  /** The stubbed transcript being compacted. */
  transcript: string;
  /** One line per ledger entry: the ids the checkpoint may cite. */
  evidenceIndex: string;
  /** A `/compact <focus>` instruction from the user. */
  focus?: string;
  /** The turn's local date, so the checkpoint carries the date the research happened on. */
  date?: string;
  /** The previous checkpoint, when this chat has already been compacted once. */
  previous?: string;
  /** Figures a first attempt lost, quoted back so the retry sources or drops them. */
  unsourced?: string[];
}

const SYSTEM = `You are the context summarizer for a financial research assistant. You are given the
research done so far and you write a research checkpoint that replaces it in the assistant's context.

Rules:
- Do not continue the conversation, do not answer the user's question, and do not call tools.
  Output the checkpoint and nothing else.
- Every figure you write must be followed by the evidence id it came from, e.g.
  "revenue $30,040M [E7]", "P/E 28.4 [C3]", "assumes 8% WACC [A1]".
- Copy figures exactly as the evidence index or the transcript states them. Never round, convert,
  recompute or invent a number. A figure you cannot attach an id to must be left out; describe the
  fact in words instead.
- Quote the user's instructions word for word.
- Be terse. Bullets, no preamble, no closing remarks.`;

const SECTIONS = `### Scope
The question, the investor profile in play, the companies ($TICKER, CIK, fiscal calendar), the
periods, the currency, and GAAP vs adjusted basis.

### Facts
One bullet per fact, every figure followed by its id.

### Assumptions and calculations
One line per A- or C-id: what it is and what it depends on.

### Source status
What was fetched, what failed or hit a rate limit, how much quota was used, and any conflict that
is still unresolved.

### User instructions
Word for word.

### Conclusions
Each with its confidence, and the reports created so far by R-id.

### In progress
The step under way, e.g. "earnings-review step 5 of 8".`;

/** The two halves of the summarizer call: a system prompt, and the user message it answers. */
export function checkpointPrompt(input: CheckpointInput): { system: string; user: string } {
  const parts = [
    "Write a research checkpoint covering the research below.",
    "",
    "Use these sections, in this order, and drop a section only when it has nothing in it:",
    "",
    SECTIONS,
  ];

  if (input.date) parts.push("", `Today's date: ${input.date}. State it in the checkpoint.`);
  if (input.focus) parts.push("", `The user asked this checkpoint to focus on: ${input.focus}`);
  if (input.unsourced?.length) {
    parts.push(
      "",
      `A previous attempt wrote these figures without an id that holds them: ${input.unsourced.join(", ")}.` +
        " Cite the id the evidence index gives for each, or leave the figure out.",
    );
  }
  if (input.previous) {
    parts.push("", "## Previous checkpoint", "Update it; keep everything in it that is still true.", "", input.previous);
  }

  parts.push(
    "",
    "## Evidence index",
    "These are the only ids you may cite, with the values they hold.",
    "",
    input.evidenceIndex,
    "",
    "## Research so far",
    "",
    input.transcript,
  );

  return { system: SYSTEM, user: parts.join("\n") };
}

/** A figure counts as sourced when an id sits this close to it. */
const ID_DISTANCE = 40;

const REMOVED = "[figure removed: unsourced]";

/**
 * Strip every figure the ledger does not back. A figure is backed when an entry holds its value
 * *and* that entry's id is written next to it, so the checkpoint stays checkable after compaction.
 */
export function validateCheckpoint(summary: string, ledger: EvidenceLedger): { summary: string; stripped: string[] } {
  const stripped: string[] = [];
  const cuts: { start: number; end: number }[] = [];

  for (const { figure, matches } of matchFigures(summary, ledger)) {
    if (matches.length > 0 && citedNearby(summary, figure.index, figure.raw.length, matches)) continue;
    stripped.push(figure.raw);
    cuts.push({ start: figure.index, end: figure.index + figure.raw.length });
  }

  let text = summary;
  for (const cut of cuts.reverse()) {
    text = `${text.slice(0, cut.start)}${REMOVED}${text.slice(cut.end)}`;
  }
  return { summary: text, stripped };
}

function citedNearby(text: string, index: number, length: number, ids: string[]): boolean {
  const window = text.slice(Math.max(0, index - ID_DISTANCE), Math.min(text.length, index + length + ID_DISTANCE));
  const cited = new Set(mentionedIds(window));
  return ids.some((id) => cited.has(id));
}
