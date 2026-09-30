import type { EvidenceLedger } from "@/lib/evidence/types";
import { rewriteReferences } from "./references";
import type { ReportSpec } from "./spec";

/** A short opening excerpt for the completion, with the report's values and citations resolved. */
export function reportOpening(spec: ReportSpec, ledger: EvidenceLedger): string {
  const opening = spec.sections[0];
  if (!opening) return "";
  const paragraphs = opening.blocks.flatMap((block) => block.type === "text" || block.type === "callout"
    ? [block.text] : block.type === "list" ? block.items : []);
  let excerpt = "";
  for (const paragraph of paragraphs) {
    const rendered = rewriteReferences(paragraph, ledger, { reference: (ref) => `${ref.text} [${ref.entry.id}]` }).text;
    const next = [excerpt, rendered].filter(Boolean).join("\n\n");
    if (next.length > 3_000) break; // Keep whole paragraphs so a value or citation cannot be cut in half.
    excerpt = next;
  }
  return excerpt ? `Report opening (excerpt) — ${opening.heading}:\n${excerpt}` : "";
}
