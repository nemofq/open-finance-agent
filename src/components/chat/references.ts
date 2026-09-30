import { findReferences } from "@/lib/evidence/ids";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import { resolveReference } from "@/lib/reports/references";

/**
 * Report prose writes figures as references into the evidence ledger, and the renderer fills
 * them in (`rewriteReferences` in `src/lib/reports/references.ts`). The model writes the same
 * form in its chat replies, where nothing filled them in, so the braces reached the reader.
 * This is the client-side half: each reference is resolved with the reports' own
 * `resolveReference`, against the entries the tool results carried, and printed the way the
 * report prints it.
 */

/** A fenced block opens and closes on a line of its own; nothing inside one is rewritten. */
const FENCE_RE = /^\s{0,3}(?:```|~~~)/;

/** True when the reference at `index` sits between backticks, so it is code rather than prose. */
function inCode(line: string, index: number): boolean {
  return (line.slice(0, index).match(/`/g) ?? []).length % 2 === 1;
}

/** One line with its references filled in; read with `findReferences`, as reports read them. */
function rewriteLine(line: string, ledger: Pick<EvidenceLedger, "get">): string {
  let filled = "";
  let from = 0;
  for (const hit of findReferences(line)) {
    const { raw, id, index } = hit;
    filled += line.slice(from, index);
    from = index + raw.length;
    const resolved = inCode(line, index) ? undefined : resolveReference(hit, ledger);
    if (!resolved?.ok) {
      filled += raw;
      continue;
    }
    // The model sometimes writes the tag beside the reference; one is enough.
    const tagged = line.slice(from).trimStart().startsWith(`[${id}]`);
    filled += tagged ? resolved.reference.text : `${resolved.reference.text} [${id}]`;
  }
  return filled + line.slice(from);
}

/**
 * Chat text with every resolvable reference replaced by the figure it stands for, tagged with
 * the entry it came from: `{C17}` becomes `16.4% [C17]`. A reference nothing resolves is left
 * exactly as the model wrote it, as is anything inside a code span or a fenced block.
 */
export function fillChatReferences(text: string, entries: EvidenceEntry[]): string {
  if (entries.length === 0 || !text.includes("{")) return text;

  const ledger = { get: (id: string) => entries.find((entry) => entry.id === id) };
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE_RE.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : rewriteLine(line, ledger);
    })
    .join("\n");
}
