import type { EvidenceEntry, EvidenceId, EvidenceKind, EvidenceLedger } from "@/lib/evidence/types";
import { compareIds } from "@/lib/evidence/ids";
import { evidenceLineage } from "@/lib/evidence/lineage";
import { formatCell } from "../format";
import { escapeHtml } from "./blocks";
import { originLine, originParts, sourceHead } from "./origin";

/**
 * Figures, sources, assumptions and the disclaimer are generated from the entries the report
 * actually printed, never written by the model. A figure the reader can see therefore
 * always has a line below it saying where it came from.
 */

export const FIGURES_HEADING = "Figures";
const SOURCES_HEADING = "Sources";
const ASSUMPTIONS_HEADING = "Assumptions";
const VERIFICATION_HEADING = "Verification notes";

const DISCLAIMER =
  "Research and analysis only. Not investment advice and not a recommendation to buy or sell any security.";

/** Headings the renderer owns; a spec that uses one of them is rejected by the validator. */
export const GENERATED_HEADINGS = [FIGURES_HEADING, SOURCES_HEADING, ASSUMPTIONS_HEADING, VERIFICATION_HEADING, "Disclaimer"];

function used(ids: EvidenceId[], ledger: EvidenceLedger, kinds: EvidenceKind[]): EvidenceEntry[] {
  return evidenceLineage(ledger, ids)
    .filter((entry) => kinds.includes(entry.kind))
    .sort((a, b) => compareIds(a.id, b.id));
}

/** The source head, plus the tool when the source is not already named after it. */
function sourceLine(entry: EvidenceEntry): string {
  return entry.tool !== undefined && entry.tool !== entry.source?.name ? `${sourceHead(entry)} · ${entry.tool}` : sourceHead(entry);
}

function assumptionLine(entry: EvidenceEntry): string {
  const value = typeof entry.value === "number" ? formatCell(entry.value, entry.unit) : "";
  const label = entry.name ?? entry.summary;
  const head = value === "" ? label : `${label}: ${value}`;
  const why = entry.why ?? (entry.declared === false ? "undeclared constant, recorded by the calculator" : "");
  return why === "" ? head : `${head} — ${why}`;
}

/**
 * The Figures list: every figure the report computed, assumed or was given, with the value,
 * formula and inputs behind it. Retrieved entries are left to Sources.
 */
function figureItems(figures: EvidenceId[], ledger: EvidenceLedger): string[] {
  return used(figures, ledger, ["C", "U"]).map(
    (entry) =>
      `<li><strong>${escapeHtml(entry.id)}</strong> · ${escapeHtml(originLine(originParts(entry)))}</li>`,
  );
}

/** The Sources list: one line per retrieved entry the report drew a figure from. */
function sourceItems(figures: EvidenceId[], ledger: EvidenceLedger): string[] {
  return used(figures, ledger, ["E"]).map(
    (entry) =>
      `<li><strong>${escapeHtml(entry.id)}</strong> ${escapeHtml(entry.summary)}<br><span class="meta">${escapeHtml(sourceLine(entry))}</span></li>`,
  );
}

/** The Assumptions list: every A entry behind a printed figure, with the reason it was made. */
function assumptionItems(figures: EvidenceId[], ledger: EvidenceLedger): string[] {
  return used(figures, ledger, ["A"]).map(
    (entry) => `<li><strong>${escapeHtml(entry.id)}</strong> ${escapeHtml(assumptionLine(entry))}</li>`,
  );
}

export interface GeneratedSection {
  heading: string;
  /** One `<li>` per entry, so a deck can split a long list across slides. */
  items: string[];
}

/**
 * The sections appended to every report, in order; empty ones are left out. `notes` are the
 * figures and sections the validator could not confirm: the reader sees them where the figures
 * are, instead of the report being withheld.
 */
export function generatedSections(figures: EvidenceId[], ledger: EvidenceLedger, notes: string[] = []): GeneratedSection[] {
  const sections: GeneratedSection[] = [
    { heading: FIGURES_HEADING, items: figureItems(figures, ledger) },
    { heading: SOURCES_HEADING, items: sourceItems(figures, ledger) },
    { heading: ASSUMPTIONS_HEADING, items: assumptionItems(figures, ledger) },
    { heading: VERIFICATION_HEADING, items: notes.map((note) => `<li class="unverified">${escapeHtml(note)}</li>`) },
  ];
  return sections.filter((section) => section.items.length > 0);
}

export function generatedListHtml(items: string[]): string {
  return `<ul class="generated">${items.join("")}</ul>`;
}

export function disclaimerHtml(): string {
  return `<p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>`;
}
