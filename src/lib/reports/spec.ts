import type { ReportVerification } from "@/lib/evidence/types";

import type { ReportFormat } from "./schema";

/** The spec types are inferred from the Zod schemas in `schema.ts`, the one definition of the spec. */
export type { ReportBlock, ReportCell, ReportFormat, ReportSection, ReportSpec } from "./schema";

/** A validation problem found in a report specification. */
export interface ReportIssue {
  kind: "sources" | "values" | "references" | "structure" | "size" | "repaired";
  section?: string;
  /** e.g. `table row 3 col 2`, `kpi "Revenue"`, `text block 1` */
  location?: string;
  message: string;
}

/**
 * Stored on the `create_report` tool result `details`; the transcript keeps only the args and this.
 * The panel reads the title, format, template and HTML; the benchmark reads the rest. An alias, not
 * an interface, so it stays assignable to pi-ai's JSON details.
 */
export type ReportDetails = {
  title: string;
  format: ReportFormat;
  template?: string;
  /** The rendered document or deck, ready for the panel's iframe. */
  html: string;
  /** The validator's per-figure outcome; the eval reads this rather than re-matching the text. */
  verification: ReportVerification;
  /** Set when the harness rendered the report from the chat answer; the benchmark counts these. */
  rendered?: "answer";
};

/** A required-sections declaration for a template, matched against `ReportSection.heading`. */
export interface ReportTemplate {
  id: string;
  name: string;
  requiredSections: string[];
}
