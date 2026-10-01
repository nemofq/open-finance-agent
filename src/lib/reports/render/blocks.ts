import { CITABLE_CLASS } from "@/lib/evidence/ids";
import { evidenceTag } from "@/lib/evidence/tags";
import type { EvidenceId, EvidenceLedger } from "@/lib/evidence/types";
import { evidenceTable } from "../evidence-table";
import { cellMagnitude, formatCell } from "../format";
import { rewriteReferences } from "../references";
import { sanitizeHtml } from "../sanitize";
import type { ReportBlock, ReportCell } from "../spec";
import { originLines, originParts } from "./origin";

/** Collects the entries a report actually printed, so the Sources section lists only those. */
export interface RenderContext {
  ledger: EvidenceLedger;
  use(id: EvidenceId): void;
  /** Entries used so far, in first-use order. */
  readonly figures: EvidenceId[];
}

export function createRenderContext(ledger: EvidenceLedger): RenderContext {
  const figures: EvidenceId[] = [];
  return {
    ledger,
    figures,
    use(id: EvidenceId) {
      if (id !== "" && !figures.includes(id)) figures.push(id);
    },
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The superscript that ties a printed figure back to the ledger entry behind it. The origin box
 * rides inside the marker so it needs no script and no link: the iframe runs neither (a fragment
 * link there navigates the frame to `about:blank`), so hover and focus in CSS are all we have.
 */
function marker(id: EvidenceId, ctx: RenderContext, period?: string): string {
  const entry = ctx.ledger.get(id);
  if (entry === undefined) return "";
  ctx.use(id);
  const tag = period === undefined ? evidenceTag(entry) : `${evidenceTag(entry)} · ${period}`;
  const lines = originLines(originParts(entry, period))
    .map((line) => {
      const title = line.title === undefined ? "" : ` title="${escapeHtml(line.title)}"`;
      return `<span class="origin-${line.kind}"${title}>${escapeHtml(line.text)}</span>`;
    })
    .join("");
  // `tabindex` is what opens the box for the keyboard and for a tap, where there is no hover.
  return `<sup class="src" tabindex="0" title="${escapeHtml(tag)}">${escapeHtml(id)}<span class="origin" role="tooltip">${lines}</span></sup>`;
}

/** One figure: its printed value, its source marker, and any note the model attached. */
function cellHtml(cell: ReportCell, ctx: RenderContext): string {
  const text = escapeHtml(formatCell(cell.value, cell.unit));
  const note = cell.note === undefined ? "" : `<span class="note">${escapeHtml(cell.note)}</span>`;
  return `<span class="fig">${text}${marker(cell.src, ctx, cell.period)}</span>${note}`;
}

/** A citation the model wrote as plain text, e.g. `… ending 2026-06-30 [E2].` */
const CITATION_RE = new RegExp(String.raw`[ \t]*\[(${CITABLE_CLASS}\d+)\]`, "g");

/** Markup the citation pass steps over: a whole code span, or any single tag. */
const SKIP_RE = /<(code|pre)\b[\s\S]*?<\/\1>|<[^>]*>/gi;

/**
 * The model is asked for `{E2}` references but sometimes cites an entry as `[E2]` in prose.
 * Where the id is one the ledger holds, the bracket becomes the marker a reference would have
 * got, so the entry reaches Sources and carries its origin box; an unknown id is left as written.
 */
function fillCitations(html: string, ctx: RenderContext): string {
  const rewrite = (chunk: string) =>
    chunk.replace(CITATION_RE, (raw, id: string) => marker(id, ctx) || raw);
  let out = "";
  let cursor = 0;
  for (const match of html.matchAll(SKIP_RE)) {
    out += rewrite(html.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return out + rewrite(html.slice(cursor));
}

function fillReferences(text: string, ctx: RenderContext, literal?: (chunk: string) => string): string {
  return rewriteReferences(text, ctx.ledger, {
    literal: (chunk) => fillCitations(literal === undefined ? chunk : literal(chunk), ctx),
    reference: (reference) =>
      `<span class="fig">${escapeHtml(reference.text)}${marker(reference.entry.id, ctx, reference.period)}</span>`,
    unresolved: (hit) => (literal === undefined ? hit.raw : literal(hit.raw)),
  }).text;
}

/** A Markdown link, `[label](https://…)`, or a bare autolink, `<https://…>`, written into prose. */
const MARKDOWN_LINK_RE = /\[([^\][\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)|<(https?:\/\/[^\s<>]+)>/g;

/** A label that is itself a citation, kept bracketed so `fillCitations` still turns it into a marker. */
const CITATION_LABEL_RE = new RegExp(String.raw`^${CITABLE_CLASS}\d+$`);

/**
 * Prose is plain text, so a link the model wrote in Markdown would show as raw brackets and a
 * URL. It reads as its label alone: the iframe is sandboxed and could not follow a link anyway,
 * and the source behind the claim is cited by its marker.
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(MARKDOWN_LINK_RE, (_raw, label: string | undefined, _url, bare: string | undefined) => {
    if (label === undefined) return bare ?? "";
    return CITATION_LABEL_RE.test(label) ? `[${label}]` : label;
  });
}

/** Plain prose with its references filled in from the ledger; the rest is escaped. */
function inlineHtml(text: string, ctx: RenderContext): string {
  text = stripMarkdownLinks(text);
  const tickers = new Set(ctx.ledger.list().flatMap((entry) => entry.entity?.ticker ? [entry.entity.ticker] : []));
  for (const ticker of tickers) {
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(ticker)) continue;
    const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![$\\w])${escaped}(?![\\w])`, "g"), () => `$${ticker}`);
  }
  return fillReferences(text, ctx, escapeHtml);
}

/** The same, for markup that has already been sanitized and must not be escaped again. */
function inlineMarkup(html: string, ctx: RenderContext): string {
  return fillReferences(html, ctx);
}

function tableHtml(block: Extract<ReportBlock, { type: "table" }>, ctx: RenderContext): string {
  // A column of figures is read down the page, so it is set right-aligned; one with any label in
  // it is prose and stays left.
  const numeric = block.columns.map(
    (_, index) => block.rows.length > 0 && block.rows.every((row) => typeof row[index] === "object"),
  );
  const cls = (index: number) => (numeric[index] === true ? ' class="num"' : "");
  const head = block.columns.map((column, index) => `<th${cls(index)}>${escapeHtml(column)}</th>`).join("");
  const body = block.rows
    .map((row) => {
      const cells = row
        .map(
          (cell, index) =>
            `<td${cls(index)}>${typeof cell === "string" ? inlineHtml(cell, ctx) : cellHtml(cell, ctx)}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table${block.key === true ? ' class="key"' : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function kpisHtml(block: Extract<ReportBlock, { type: "kpis" }>, ctx: RenderContext): string {
  const items = block.items
    .map(
      (item) =>
        `<div class="kpi"><span class="kpi-label">${escapeHtml(item.label)}</span><span class="kpi-value">${cellHtml(item.cell, ctx)}</span></div>`,
    )
    .join("");
  return `<div class="kpis">${items}</div>`;
}

const SERIES_COLOURS = ["var(--accent)", "var(--pos)", "var(--neg)", "var(--muted)"];

/** Steps a reader counts in; each is tried again ten times larger before a range is given up on. */
const TICK_STEPS = [1, 2, 2.5, 5, 10];

/** How close to zero a line has to run before zero is worth putting on its axis. */
const ZERO_MARGIN = 0.2;

/** Trims the tail a step of 2.5 leaves behind, so a tick reads 17.5 and not 17.500000000000002. */
function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/** A percent coordinate, short enough not to bloat the document. */
function at(value: number): string {
  return value.toFixed(2);
}

/**
 * Four to six rounded gridlines covering `lo` to `hi`, the bounds pushed out to the step so the
 * axis reads 0, 20, 40 rather than 4.318, 15.2, 26.1.
 */
export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo, lo + 1];
  const magnitude = 10 ** (Math.floor(Math.log10(span)) - 1);
  for (const scale of [magnitude, magnitude * 10]) {
    for (const factor of TICK_STEPS) {
      const step = factor * scale;
      const first = Math.floor(tidy(lo / step));
      const count = Math.ceil(tidy(hi / step)) - first + 1;
      if (count <= 6) return Array.from({ length: count }, (_, index) => tidy((first + index) * step));
    }
  }
  return [lo, hi];
}

/**
 * The axis one set of values is drawn against. A bar is read from its baseline, so zero is always
 * on it; a line is read as a shape and may sit far from zero, so zero joins it only where the
 * data crosses zero or already runs near it — otherwise a band of 12% to 25% is flattened into
 * the top of an empty chart.
 */
function axisTicks(values: number[], kind: "line" | "bar"): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const near = Math.min(Math.abs(min), Math.abs(max)) <= span * ZERO_MARGIN;
  const zero = kind === "bar" || min * max <= 0 || near;
  return niceTicks(zero ? Math.min(0, min) : min, zero ? Math.max(0, max) : max);
}

/**
 * The chart is an SVG stretched to the plot box, so every coordinate below is a percentage of it
 * and nothing in the geometry depends on the width the report is read at. Strokes hold their
 * pixel width through `vector-effect`, and no text goes in the SVG at all: the axis labels and
 * the legend are HTML around it, at the same size as the rest of the report.
 */
function chartHtml(block: Extract<ReportBlock, { type: "chart" }>, ctx: RenderContext): string {
  const unit = block.unit;
  const points = block.series.map((series) =>
    series.points.map((point) => {
      ctx.use(point.y.src);
      const value = typeof point.y.value === "number" ? cellMagnitude(point.y.value, point.y.unit ?? unit) : null;
      return { x: point.x, value };
    }),
  );

  const labels: string[] = [];
  for (const series of points) for (const point of series) if (!labels.includes(point.x)) labels.push(point.x);
  const values = points.flat().flatMap((point) => (point.value === null ? [] : [point.value]));
  if (labels.length === 0 || values.length === 0) return "";

  const ticks = axisTicks(values, block.kind);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const span = hi - lo === 0 ? 1 : hi - lo;
  const y = (value: number) => ((hi - value) / span) * 100;
  const band = 100 / labels.length;
  const centre = (index: number) => band * (index + 0.5);

  const grid = ticks
    .map(
      (value) =>
        `<line x1="0" y1="${at(y(value))}" x2="100" y2="${at(y(value))}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
    )
    .join("");
  const baseline =
    lo <= 0 && hi >= 0
      ? `<line x1="0" y1="${at(y(0))}" x2="100" y2="${at(y(0))}" stroke="var(--muted)" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      : "";

  const marks = points.map((series, seriesIndex) => {
    const colour = SERIES_COLOURS[seriesIndex % SERIES_COLOURS.length];
    if (block.kind === "line") {
      const path = series
        .flatMap((point) =>
          point.value === null ? [] : [`${at(centre(labels.indexOf(point.x)))},${at(y(point.value))}`],
        )
        .join(" ");
      return `<polyline points="${path}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    }
    const group = band * 0.72;
    const width = group / points.length;
    return series
      .flatMap((point) => {
        if (point.value === null) return [];
        const x = centre(labels.indexOf(point.x)) - group / 2 + width * seriesIndex;
        const top = Math.min(y(point.value), y(0));
        const height = Math.max(0.4, Math.abs(y(point.value) - y(0)));
        return [
          `<rect x="${at(x)}" y="${at(top)}" width="${at(width)}" height="${at(height)}" fill="${colour}"/>`,
        ];
      })
      .join("");
  });

  const yAxis = ticks
    .map(
      (value) =>
        `<span class="ytick" style="top:${at(y(value))}%">${escapeHtml(formatCell(value, unit))}</span>`,
    )
    .join("");
  // One cell per category keeps the labels under the marks they name; past eight, every other
  // cell is left empty rather than letting the labels collide.
  const skip = labels.length > 8 ? 2 : 1;
  const xAxis = labels
    .map((label, index) => `<span>${index % skip === 0 ? escapeHtml(label) : ""}</span>`)
    .join("");

  const legend =
    block.series.length > 1
      ? `<div class="chart-legend">${block.series
          .map(
            (series, index) =>
              `<span><span class="swatch" style="background:${SERIES_COLOURS[index % SERIES_COLOURS.length]}"></span>${escapeHtml(series.name)}</span>`,
          )
          .join("")}</div>`
      : "";

  const label = escapeHtml(block.series.map((series) => series.name).join(", "));
  return `<div class="chart">${legend}<div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${label}">${grid}${baseline}${marks.join("")}</svg>${yAxis}</div><div class="xaxis">${xAxis}</div></div>`;
}

/** One block of a section as HTML. */
function blockHtml(block: ReportBlock, ctx: RenderContext): string {
  switch (block.type) {
    case "text":
      return `<p>${inlineHtml(block.text, ctx)}</p>`;
    case "kpis":
      return kpisHtml(block, ctx);
    case "evidence_table":
      return tableHtml(evidenceTable(block, ctx.ledger), ctx);
    case "table":
      return tableHtml(block, ctx);
    case "chart":
      return chartHtml(block, ctx);
    case "callout":
      return `<div class="callout callout-${block.tone}"><p>${inlineHtml(block.text, ctx)}</p></div>`;
    case "list":
      return `<ul>${block.items.map((item) => `<li>${inlineHtml(item, ctx)}</li>`).join("")}</ul>`;
    case "html":
      return inlineMarkup(sanitizeHtml(block.html), ctx);
  }
}

/** The blocks of one section, in order. */
export function blocksHtml(blocks: ReportBlock[], ctx: RenderContext): string {
  return blocks.map((block) => blockHtml(block, ctx)).join("\n");
}
