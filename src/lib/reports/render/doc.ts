import type { ReportSpec } from "../spec";
import { blocksHtml, escapeHtml, type RenderContext } from "./blocks";
import { disclaimerHtml, generatedListHtml, generatedSections } from "./sources";

/** The document layout: one scrolling page, headings in spec order, generated sections last. */
export function renderDoc(spec: ReportSpec, ctx: RenderContext, subtitle?: string, notes: string[] = []): string {
  const sections = spec.sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2>\n${blocksHtml(section.blocks, ctx)}</section>`,
    )
    .join("\n");

  const generated = generatedSections(ctx.figures, ctx.ledger, notes)
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2>\n${generatedListHtml(section.items)}</section>`,
    )
    .join("\n");

  const lede = subtitle === undefined ? "" : `<p class="lede">${escapeHtml(subtitle)}</p>`;
  return `<header><h1>${escapeHtml(spec.title)}</h1>${lede}</header>\n${sections}\n${generated}\n${disclaimerHtml()}`;
}
