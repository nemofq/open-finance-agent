import { GENERATED_HEADINGS } from "./render/sources";
import type { ReportIssue, ReportSection, ReportTemplate } from "./spec";

/**
 * The sections a report is rendered with. The renderer generates Figures, Sources, Assumptions,
 * Verification notes and the disclaimer, so a written section under one of those headings is
 * dropped for the generated one; a template's required section the spec lacks is added, saying
 * it is not covered. Both are reported, so the model and the reader see what changed.
 */

/** Headings are compared by their words: case, punctuation and spacing do not matter. */
function normalizeHeading(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const RESERVED = new Set(GENERATED_HEADINGS.map(normalizeHeading));

/** The one section body a missing required section is given. */
const NOT_COVERED = "Not covered in this report.";

export interface CompletedStructure {
  /** The written sections that are kept, then any required section that was missing. */
  sections: ReportSection[];
  /** How many written sections are kept; with none, there is nothing of the model's to render. */
  written: number;
  issues: ReportIssue[];
}

export function completeStructure(sections: ReportSection[], template: ReportTemplate | undefined): CompletedStructure {
  const issues: ReportIssue[] = [];
  const headings = sections.map((section) => normalizeHeading(section.heading));
  for (const reserved of GENERATED_HEADINGS) {
    const index = headings.indexOf(normalizeHeading(reserved));
    const replaced = index === -1 ? undefined : sections[index];
    if (replaced) {
      issues.push({
        kind: "structure",
        section: replaced.heading,
        message: `${reserved} is generated from the evidence ledger; the written section was replaced by the generated one.`,
      });
    }
  }

  const kept = sections.filter((section) => !RESERVED.has(normalizeHeading(section.heading)));
  const completed = [...kept];
  for (const required of template?.requiredSections ?? []) {
    const wanted = normalizeHeading(required);
    if (kept.some((section) => normalizeHeading(section.heading).includes(wanted))) continue;
    completed.push({ heading: required, blocks: [{ type: "text", text: NOT_COVERED }] });
    issues.push({
      kind: "structure",
      message: `the ${template?.id ?? ""} template requires a "${required}" section, so one was added saying it is not covered.`,
    });
  }
  return { sections: completed, written: kept.length, issues };
}
