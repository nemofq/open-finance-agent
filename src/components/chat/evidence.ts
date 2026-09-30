/**
 * The evidence ledger as the chat rebuilds it from the entries its tool results carried, and the
 * footer counts under each answer that `answer-footer.tsx` renders.
 */
import { compareIds, evidenceOf } from "@/lib/evidence/ids";
import type { EvidenceEntry, EvidenceId } from "@/lib/evidence/types";
import { summarizeChecks } from "@/lib/policy/summary";
import type { AnswerFooter, CheckRecord } from "@/lib/policy/types";
import type { ChatItem, MessagePart } from "./transcript";

/** Entries a tool result carried on its `details`. */
export function entriesOf(part: MessagePart): EvidenceEntry[] {
  return part.kind === "tool" ? evidenceOf(part.details) : [];
}

/** True when the entry holds a disagreement, rather than a confirmation, with another entry. */
export function disagrees(entry: EvidenceEntry): boolean {
  return entry.conflicts?.some((conflict) => !conflict.agree) === true;
}

/** The model's own content, whether the answer stood or was revised. */
/** The parts of an answer or a draft; every other item has none. */
export function partsOf(item: ChatItem): MessagePart[] {
  return item.role === "assistant" || item.role === "draft" ? item.parts : [];
}

/** The ledger as the transcript shows it: one entry per id, in id order. */
export function entriesIn(items: ChatItem[]): EvidenceEntry[] {
  const byId = new Map<EvidenceId, EvidenceEntry>();
  for (const item of items) {
    for (const part of partsOf(item)) {
      // Deduplicate ledger entries, keeping the first occurrence.
      for (const entry of entriesOf(part)) if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}

/** The ledger composition plus what the checks found, as the client can see it. */
export interface AnswerSummary extends AnswerFooter {
  entries: EvidenceEntry[];
}

/** The footer under one answer, from the entries the chat's tool results carried. */
export function footerOf(items: ChatItem[], checks: CheckRecord[]): AnswerSummary {
  const entries = entriesIn(items);
  return { ...summarizeChecks(checks, entries), entries };
}
