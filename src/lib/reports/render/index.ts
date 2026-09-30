import type { EvidenceId, EvidenceLedger } from "@/lib/evidence/types";
import type { ReportFormat, ReportSpec } from "../spec";
import { templateById } from "../templates";
import { createRenderContext, escapeHtml } from "./blocks";
import { renderDoc } from "./doc";
import { renderSlides } from "./slides";
import { reportStyles } from "./theme";

export interface RenderedReport {
  /** A complete, self-contained document for the panel's sandboxed iframe. */
  html: string;
  /** The ledger entries the report printed a figure from, in first-use order. */
  figures: EvidenceId[];
}

/**
 * One spec, both formats. Every figure is filled in from the ledger and tagged with
 * the entry behind it; Figures, Sources, Assumptions and the disclaimer are appended by the renderer.
 */
export function renderReport(
  spec: ReportSpec,
  ledger: EvidenceLedger,
  format: ReportFormat,
  notes: string[] = [],
): RenderedReport {
  const ctx = createRenderContext(ledger);
  const subtitle = templateById(spec.template)?.name;
  const body = format === "slides" ? renderSlides(spec, ctx, subtitle, notes) : renderDoc(spec, ctx, subtitle, notes);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(spec.title)}</title>
${reportStyles()}
</head>
<body class="${format === "slides" ? "deck" : "doc"}">
${body}
</body>
</html>`;
  return { html, figures: ctx.figures };
}
