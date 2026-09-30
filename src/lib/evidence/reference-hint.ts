import { reportReference } from "./ids";
import type { EvidenceEntry } from "./types";

/** A short set of exact references, alongside the source's own subject/metric/period labels. */
export function referenceHint(entry: EvidenceEntry): string | undefined {
  if (entry.lookAhead) return undefined;
  const counts = new Map<string, number>();
  for (const fact of entry.facts ?? []) {
    const ref = reportReference(entry.id, fact.metric, fact.period);
    if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  const references = typeof entry.value === "number" ? [reportReference(entry.id)]
    : [...counts].filter(([, count]) => count === 1).slice(0, 6).map(([ref]) => ref);
  const usable = references.filter(Boolean);
  if (!usable.length) return undefined;
  const subject = entry.entity?.ticker ?? entry.name;
  return `Report references${subject ? ` for ${subject}` : ""}: ${usable.join(", ")}.`;
}
