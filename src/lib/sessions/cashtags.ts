import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { blockText } from "@/lib/text/blocks";

/** `$AAPL`, `$BRK.B` — 1-5 letters with an optional single-letter class suffix. */
const CASHTAG = /(?<![\$\\\w])\$([A-Z]{1,5}(?:\.[A-Z])?)\b(?!\$)/g;

/** Tickers mentioned in `text`, unique and in order of first appearance. */
export function extractCashtags(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(CASHTAG), (match) => match[1]))];
}

/** Plain text a message contributes to ticker extraction (what the user asked for, and assistant prose). */
function messageText(message: AgentMessage): string {
  if (message.role === "skill" || message.role === "scheduled") return message.request;
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : blockText(message.content, "\n");
  }
  if (message.role === "assistant") {
    return blockText(message.content, "\n");
  }
  return "";
}

/** Ordered union of the tickers mentioned anywhere in a transcript. */
export function sessionTickers(messages: AgentMessage[]): string[] {
  return [...new Set(messages.flatMap((message) => extractCashtags(messageText(message))))];
}
