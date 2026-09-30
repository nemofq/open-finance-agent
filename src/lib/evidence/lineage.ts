import type { EvidenceEntry, EvidenceId, EvidenceLedger } from "./types";

/** Printed figures and their recorded inputs, once each, including inputs of earlier calculations. */
export function evidenceLineage(ledger: EvidenceLedger, ids: EvidenceId[]): EvidenceEntry[] {
  const pending = [...ids];
  const seen = new Set<EvidenceId>();
  const entries: EvidenceEntry[] = [];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = ledger.get(id);
    if (!entry) continue;
    entries.push(entry);
    pending.push(...entry.inputs ?? []);
  }
  return entries;
}
