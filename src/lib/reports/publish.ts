import type { EvidenceEntry, EvidenceLedger, ReportVerification } from "@/lib/evidence/types";
import { renderReport } from "./render";
import type { ReportDetails, ReportFormat, ReportIssue, ReportSpec } from "./spec";
import { checkRenderedSize, formatIssues, issueNotes, validateReportSpec, type ReportValidateOptions } from "./validate";
import { REPORT_TOOL } from "./tool-name";

export interface PublishedReport {
  spec: ReportSpec;
  format: ReportFormat;
  html: string;
  /** What the ledger could not confirm; printed in the report under Verification notes. */
  issues: ReportIssue[];
  /** The per-figure outcome of validation, summarized for the tool result and the eval. */
  verification: ReportVerification;
  evidence: EvidenceEntry;
  /** The one-line handle the model and the transcript keep. */
  stub: string;
}

export interface PublishOptions extends ReportValidateOptions {
  /** The call the report answers, so later turns can stub its spec down to the R id. */
  toolCallId?: string;
}

/** What a `create_report` result carries; `evidence` is what a reloaded chat rebuilds its R entry from. */
export type CreateReportDetails = ReportDetails & { evidence: EvidenceEntry };

/**
 * Validate, render and record one report. A figure the ledger cannot confirm never withholds
 * the report: it is listed in the document's own Verification notes and returned to the caller.
 * Only a spec that cannot be rendered at all, malformed or over the size limits, is refused.
 */
export async function publishReport(input: unknown, ledger: EvidenceLedger, options: PublishOptions): Promise<PublishedReport> {
  const validated = validateReportSpec(input, ledger, options);
  if (!validated.spec || !validated.verification) throw new Error(formatIssues(validated.issues));
  const { spec, verification } = validated;
  const oversized = validated.issues.filter((issue) => issue.kind === "size");
  if (oversized.length > 0) throw new Error(formatIssues(oversized));

  const format = spec.format ?? options.defaultFormat;
  const { html, figures } = renderReport(spec, ledger, format, issueNotes(validated.issues));
  const rendered = checkRenderedSize(html);
  if (rendered.length > 0) throw new Error(formatIssues(rendered));

  const headings = spec.sections.map((section) => section.heading);
  const evidence = ledger.add({
    kind: "R",
    summary: `Report "${spec.title}" (${format}, ${headings.length} sections)`,
    tool: REPORT_TOOL,
    ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    report: { title: spec.title },
  });
  await ledger.savePayload(evidence.id, { spec, html });

  const keyFigures = figures.slice(0, 6);
  const stub = `[${evidence.id} · report "${spec.title}" · ${format} · ${headings.length} sections${keyFigures.length === 0 ? "" : ` · key figures ${keyFigures.join(", ")}`}]`;
  return { spec, format, html, issues: validated.issues, verification, evidence, stub };
}

/**
 * The `create_report` result details, one shape for the tool and for a report the harness renders
 * from the answer: the ledger restores the R entry from `evidence`, so a copy without it would let
 * the next report reuse the id and overwrite this one's payload.
 */
export function reportDetails(report: PublishedReport): CreateReportDetails {
  return {
    title: report.spec.title,
    format: report.format,
    template: report.spec.template,
    html: report.html,
    verification: report.verification,
    evidence: report.evidence,
  };
}
