/**
 * The one-line tag that opens every data result.
 * The tag is what the model reads: `[E7 · SEC EDGAR · tier 1 · as of 2026-08-01]`.
 */
import type { EvidenceEntry, EvidenceKind } from "./types";

const KIND_LABELS: Record<EvidenceKind, string> = {
  E: "evidence",
  C: "computed",
  A: "assumption",
  U: "user",
  R: "report",
};

/** What the entry carries, so the model knows whether to reach for `evidence_get`. */
function contentPart(entry: EvidenceEntry): string | undefined {
  if (entry.table) return `table ${entry.table.rows.length}×${entry.table.columns.length}`;
  if (entry.facts?.length) return `${entry.facts.length} fact${entry.facts.length === 1 ? "" : "s"}`;
  return undefined;
}

/** The line prepended to a tool result, and the same line the UI and reports show. */
export function evidenceTag(entry: EvidenceEntry): string {
  const parts = [entry.id];
  parts.push(entry.source?.name ?? entry.tool ?? KIND_LABELS[entry.kind]);
  if (entry.source) parts.push(`tier ${entry.source.tier}`);
  if (entry.asOf) parts.push(`as of ${entry.asOf}`);
  const content = contentPart(entry);
  if (content) parts.push(content);
  if (entry.lookAhead) parts.push("LOOK-AHEAD");
  return `[${parts.join(" · ")}]`;
}
