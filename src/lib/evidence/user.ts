/**
 * Figures the user supplies are evidence too (kind U): a cost basis typed into the
 * chat, a target price, a number from a profile field. They are recorded so the answer can use
 * them without the enforcement engine calling them unsourced.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { StoredAttachment } from "@/lib/attachments/types";
import { sourcedFigures } from "./figures";
import type { EvidenceEntry, EvidenceLedger } from "./types";

const MAX_SNIPPET = 100;

function snippet(text: string, index: number): string {
  const from = Math.max(0, index - 40);
  const slice = text.slice(from, from + MAX_SNIPPET).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${slice}${from + MAX_SNIPPET < text.length ? "…" : ""}`;
}

/** One U entry per distinct figure in the text, skipping years, dates, tickers and counts. */
export function registerUserFigures(
  ledger: EvidenceLedger,
  text: string,
  origin: "message" | "profile" | "holdings",
): EvidenceEntry[] {
  return sourcedFigures(text).map((figure) =>
    ledger.add({
      kind: "U",
      summary: `User said: "${snippet(text, figure.index)}"`,
      name: figure.raw,
      value: figure.value,
      unit: figure.unit,
      origin,
    }),
  );
}

export interface UserReplayOptions {
  /**
   * Records what a document the message carried is worth as evidence. It runs at the
   * message's position and before that message's own figures, which is what keeps the ids of an
   * attached worksheet stable as the chat grows. Omitted outside a turn, where no parse is loaded.
   */
  documents?: (document: StoredAttachment) => EvidenceEntry[];
}

/**
 * U entries live only in memory, because a user message carries no `details` to rebuild them
 * from. Replaying the transcript's user messages in order restores the same ids when a chat
 * is reopened.
 */
export function registerUserMessages(
  ledger: EvidenceLedger,
  messages: AgentMessage[],
  options: UserReplayOptions = {},
): EvidenceEntry[] {
  const created: EvidenceEntry[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "skill") {
      for (const document of message.documents ?? []) created.push(...(options.documents?.(document) ?? []));
    }
    if (message.role !== "user" && message.role !== "scheduled" && message.role !== "skill") continue;
    const text =
      (message.role === "scheduled" || message.role === "skill")
        ? message.request
        : typeof message.content === "string"
        ? message.content
        : message.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .filter(Boolean)
            .join("\n");
    if (text) created.push(...registerUserFigures(ledger, text, "message"));
  }
  return created;
}
