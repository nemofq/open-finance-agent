import type { ReportBlock, ReportSection, ReportSpec } from "../spec";
import { blocksHtml, escapeHtml, type RenderContext } from "./blocks";
import { disclaimerHtml, generatedListHtml, generatedSections } from "./sources";

/** Rows beyond this force a table onto a continuation slide, so nothing scrolls inside one. */
export const MAX_TABLE_ROWS_PER_SLIDE = 12;

/** A generated list (Figures, Sources, Assumptions) is continued on the same budget. */
const MAX_GENERATED_ITEMS_PER_SLIDE = MAX_TABLE_ROWS_PER_SLIDE;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Split one report section into the blocks each slide carries. A table longer than
 * `MAX_TABLE_ROWS_PER_SLIDE` continues on its own slides rather than shrinking to fit.
 */
export function slideGroups(section: ReportSection): ReportBlock[][] {
  const groups: ReportBlock[][] = [];
  let current: ReportBlock[] = [];

  for (const block of section.blocks) {
    if (block.type !== "table" || block.rows.length <= MAX_TABLE_ROWS_PER_SLIDE) {
      current.push(block);
      continue;
    }
    const parts = chunk(block.rows, MAX_TABLE_ROWS_PER_SLIDE);
    current.push({ ...block, rows: parts[0] });
    groups.push(current);
    current = [];
    for (const rows of parts.slice(1)) groups.push([{ ...block, rows }]);
  }

  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups;
}

function slide(heading: string, body: string, continued: boolean): string {
  const title = continued ? `${heading} (cont.)` : heading;
  return `<section><h2>${escapeHtml(title)}</h2>\n${body}</section>`;
}

/** The deck layout: a title slide, then one slide per section, long tables continued. */
export function renderSlides(spec: ReportSpec, ctx: RenderContext, subtitle?: string, notes: string[] = []): string {
  const lede = subtitle === undefined ? "" : `<p class="lede">${escapeHtml(subtitle)}</p>`;
  const slides = [`<section class="title-slide"><h1>${escapeHtml(spec.title)}</h1>${lede}</section>`];

  for (const section of spec.sections) {
    slideGroups(section).forEach((blocks, index) => {
      slides.push(slide(section.heading, blocksHtml(blocks, ctx), index > 0));
    });
  }

  for (const generated of generatedSections(ctx.figures, ctx.ledger, notes)) {
    chunk(generated.items, MAX_GENERATED_ITEMS_PER_SLIDE).forEach((items, index) => {
      slides.push(slide(generated.heading, generatedListHtml(items), index > 0));
    });
  }

  // The disclaimer rides on the closing slide rather than taking one of its own.
  const last = slides.length - 1;
  slides[last] = slides[last].replace(/<\/section>$/, `${disclaimerHtml()}</section>`);
  return slides.join("\n");
}
