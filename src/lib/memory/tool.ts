import { Type } from "typebox";
import type { FinanceTool, Module } from "@/lib/tools/contracts";
import { maxMemoryChars, type MemoryResult, updateMemory } from "./store";

const parameters = Type.Object({
  operation: Type.Union(
    [Type.Literal("append"), Type.Literal("replace"), Type.Literal("remove")],
    {
      description:
        "append: add a new bullet. replace: rewrite the one bullet matching `match`. remove: delete it.",
    },
  ),
  section: Type.String({
    description:
      "Section heading to write under. Standard sections: Preferences, Watchlist, Notes. A new section is created if it does not exist.",
  }),
  content: Type.Optional(
    Type.String({
      description:
        "Bullet text, required for append and replace: one self-contained fact on a single line (newlines are collapsed); include the reason and, for time-sensitive notes, the date.",
    }),
  ),
  match: Type.Optional(
    Type.String({
      description:
        "Required for replace and remove: a substring, matched case-insensitively, that identifies exactly one existing bullet.",
    }),
  ),
});

const description = `Update the user's durable memory file (memory.md), which is re-read into your system prompt at the start of every turn.

Store only facts that stay true beyond this conversation: how the user wants answers written and which metrics or sources they favour (Preferences), tickers they follow and why (Watchlist), and conclusions the user explicitly asked you to remember (Notes).

Never store transient data: quotes, prices, figures you just fetched, intermediate analysis, or anything that will be stale tomorrow. Those belong in your reply, not in memory. Do not record a preference the user has not stated.

Each entry is one single-line bullet. memory.md is capped at ${maxMemoryChars.toLocaleString("en-US")} characters; a write past it is refused, so condense or remove entries first.`;

const memoryUpdate: FinanceTool<typeof parameters, MemoryResult> = {
  name: "memory_update",
  // Writes to the user's own machine: it edits memory.md.
  meta: { class: "general", effect: "write-local" },
  label: "Update memory",
  description,
  parameters,
  async execute(_toolCallId, params) {
    const result = await updateMemory(params);
    return { content: [{ type: "text", text: result.message }], details: result };
  },
};

export const memoryModule: Module = {
  id: "memory",
  name: "Memory",
  kind: "tool",
  description:
    "Durable notes the agent keeps across chats in a local memory.md file (preferences, watchlist, notes).",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools() {
    return [memoryUpdate];
  },
};
