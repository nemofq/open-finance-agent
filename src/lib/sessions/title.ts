import type { Context } from "@earendil-works/pi-ai";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import type { SessionFile } from "@/lib/sessions/types";
import { skillTurnLabel } from "@/lib/skills/label";

/**
 * How a chat gets its name. The first turn saves a heuristic title from what the user sent, then
 * the chat's own model writes the sidebar title from the first message (a topic, not the message
 * text); `src/lib/agent/title.ts` makes that call. Browser-safe: it imports only types and pure
 * helpers, so the chat shows the same default the store writes.
 */

/** What a chat is called until something names it. */
export const DEFAULT_TITLE = "New chat";

/** A title taken from the message itself: short, since it is the message's own words. */
const HEURISTIC_TITLE_MAX = 40;
/** Wide enough for a topic, narrow enough that the sidebar row still truncates gracefully. */
const GENERATED_TITLE_MAX = 60;
/** Enough of the first message to know what the chat is about. */
const TEXT_MAX = 1_500;

/** First line of the user's message, trimmed to a sidebar-sized title. */
export function titleFromText(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return DEFAULT_TITLE;
  return line.length > HEURISTIC_TITLE_MAX ? `${line.slice(0, HEURISTIC_TITLE_MAX - 1).trimEnd()}…` : line;
}

const SYSTEM_PROMPT =
  "You name chats in a personal finance assistant. Write a title for this chat: three to six words, " +
  "sentence case, no trailing period, write tickers as $TICKER, reply with the title only.";

/** ```fenced``` replies: keep what is inside the fence, drop the fence lines. */
function stripFences(raw: string): string {
  if (!raw.includes("```")) return raw;
  return raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("```"))
    .join("\n");
}

const QUOTES = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;
/** `Title:`, `**Title**:`, `Chat title —` … whatever label the model put in front of the answer. */
const LABEL = /^\**\s*(?:chat\s+)?title\**\s*[:\-–—]\s*/i;

/**
 * The title as it should be stored, or `null` when the reply held nothing usable. Cashtags are
 * left exactly as written, so `$MSFT` survives.
 */
export function cleanTitle(raw: string): string | null {
  let title = stripFences(raw).replace(/\s+/g, " ").trim();
  // A label can sit inside the quotes, and quotes inside the label; strip until neither moves.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = title;
    title = title.replace(LABEL, "").replace(QUOTES, "").trim();
    if (title === before) break;
  }
  title = title.replace(/\.+$/, "").trim();
  if (!title) return null;
  if (title.length > GENERATED_TITLE_MAX) {
    const cut = title.slice(0, GENERATED_TITLE_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–—-]+$/, "");
  }
  if (!title) return null;
  // Sentence case is asked for but not always given; a cashtag keeps its own first character.
  return title.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

export interface TitlePromptInput {
  /** The user's first message. */
  text: string;
  skill?: string;
  tickers?: string[];
}

/** The one-shot request behind a title: a system prompt and the first message, trimmed. */
export function titlePrompt({ text, skill, tickers = [] }: TitlePromptInput): Context {
  const lines = [text.trim().slice(0, TEXT_MAX)];
  if (skill) lines.push(`Skill: ${skill}`);
  if (tickers.length > 0) lines.push(`Tickers: ${tickers.map((ticker) => `$${ticker}`).join(" ")}`);
  return {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: lines.join("\n\n"), timestamp: Date.now() }],
  };
}

/**
 * The name the sidebar carries until the model writes one. `titleFromText` answers "New chat" for
 * an empty message, which is right for a turn that had nothing in it and wrong for one that was
 * a screenshot or a spreadsheet and no words, so attachments name themselves.
 */
export function heuristicTitle(
  skill: string | undefined,
  text: string,
  images: StoredImage[] = [],
  documents: StoredAttachment[] = [],
): string {
  const label = skillTurnLabel(skill, text);
  if (label) return titleFromText(label);
  // A file has a name of its own, which beats "2 images" whenever there is one.
  if (documents.length > 0) return titleFromText(documents.length === 1 ? documents[0].name : `${documents.length} files`);
  if (images.length === 0) return titleFromText(label);
  return images.length === 1 ? "Image" : `${images.length} images`;
}

/** A chat earns a written title once: on its first turn, while it still carries the default one. */
export function wantsTitle(session: SessionFile): boolean {
  return session.title === DEFAULT_TITLE;
}
