import { figureEquals, figureProblem, holdsValue, matchFigures } from "@/lib/evidence/figures";
import { CITABLE_CLASS, findReferences } from "@/lib/evidence/ids";
import { factsFor } from "@/lib/evidence/metrics";
import type { EvidenceLedger, ReportVerification } from "@/lib/evidence/types";
import { errorMessage } from "@/lib/utils";
import { evidenceTable } from "./evidence-table";
import { cellFigure } from "./format";
import { resolveReference, rewriteReferences } from "./references";
import { reportSpecSchema } from "./schema";
import { sanitizeHtml, textContent } from "./sanitize";
import { completeStructure } from "./structure";
import type { ReportBlock, ReportCell, ReportFormat, ReportIssue, ReportSpec, ReportTemplate } from "./spec";
import { templateById, templateIds } from "./templates";

/** Validates report figures against the evidence ledger and checks for required template sections. */

const MAX_SPEC_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
export const MAX_SECTIONS = 40;

/** How many problems the error message lists before it stops; the rest are counted. */
const MAX_REPORTED_ISSUES = 20;

/** A citation that is nothing but one bracketed id, `[E7]`: the only kind a repair rewrites. */
const CITATION_ONLY = new RegExp(String.raw`^\[(${CITABLE_CLASS}\d+)\]$`);

/** A digit-free stand-in for a resolved reference, so only literal figures are left to check. */
const REFERENCE_PLACEHOLDER = "▪";

export interface ReportValidateOptions {
  template?: ReportTemplate;
  defaultFormat: ReportFormat;
}

/**
 * `spec` is the report as it will be rendered, its sections completed (`structure.ts`). It is
 * absent only when the input does not parse or no written section is left to render; every other
 * problem is an issue beside it.
 */
export interface ReportValidateResult {
  spec?: ReportSpec;
  issues: ReportIssue[];
  verification?: ReportVerification;
}

/** Figure-bearing surfaces examined, and those that raised no issue. */
interface Tally { checked: number; supported: number }

interface Where {
  section?: string;
  location?: string;
}

/** Collects issues as the spec is walked; `where` is the section and cell being checked. */
type AddIssue = (kind: ReportIssue["kind"], where: Where, message: string) => void;

/** Everything that carries prose a reader sees, collected while the spec is walked. */
interface TextSurface extends Where {
  text: string;
  /** Writes a repaired text back into the spec, for surfaces that are a single string. */
  set?: (text: string) => void;
}

/** Called with each figure cell as the walk reaches it, before the text beside it is read. */
type CellVisitor = (cell: ReportCell, where: Where) => void;

function cellText(cell: ReportCell): string {
  return typeof cell.value === "string" ? cell.value : "";
}

/** A numeric or referenced cell is one figure: counted, and supported when it raised no issue. */
function checkCell(cell: ReportCell, where: Where, add: AddIssue, ledger: EvidenceLedger, tally: Tally): void {
  let flagged = false;
  inspectCell(cell, where, (kind, at, message) => { flagged = true; add(kind, at, message); }, ledger);
  if (cell.ref === undefined && typeof cell.value !== "number") return;
  tally.checked += 1;
  if (!flagged) tally.supported += 1;
}

function inspectCell(
  cell: ReportCell,
  where: Where,
  add: AddIssue,
  ledger: EvidenceLedger,
): void {
  if (cell.ref) {
    const hits = findReferences(`{${cell.ref}}`);
    const resolved = hits.length === 1 ? resolveReference(hits[0], ledger) : undefined;
    if (!resolved?.ok) { add("references", where, resolved?.message ?? "Invalid cell reference; use E7:metric:period or C3."); return; }
    const { entry, value, unit, period } = resolved.reference;
    Object.assign(cell, { value, unit, period, src: entry.id });
  }
  const value = typeof cell.value === "number" ? cell.value : undefined;
  if (value !== undefined && cell.src === "") {
    add("sources", where, "no `src`: every numeric cell needs the id of the E, C, A or U entry it comes from.");
    return;
  }
  if (cell.src === "") return;

  const entry = ledger.get(cell.src);
  if (entry === undefined) {
    add("sources", where, `\`src\` "${cell.src}" is not in the evidence ledger.`);
    return;
  }
  if (entry.lookAhead) { add("sources", where, `${entry.id} was not available at the turn cutoff.`); return; }
  if (entry.kind === "R") {
    add(
      "sources",
      where,
      `\`src\` "${cell.src}" is a report, not a figure. Cite the E, C, A or U entry the figure came from.`,
    );
    return;
  }
  if (value === undefined) return;

  const figure = cellFigure(value, cell.unit);
  const facts = cell.period ? factsFor(entry, cell.period) : undefined;
  const reference = cell.metric && cell.period ? resolveReference({ raw: `{${cell.src}:${cell.metric}:${cell.period}}`, id: cell.src, path: [cell.metric, cell.period], index: 0 }, ledger) : undefined;
  if (reference && !reference.ok) { add("values", where, reference.message); return; }
  const matches = reference?.ok ? figureEquals(figure, reference.reference.value, reference.reference.unit)
    : facts && (entry.facts?.length ?? 0) > 0 ? facts.some((fact) => figureEquals(figure, fact.value, fact.unit)) : holdsValue(entry, figure);
  // A wrong `src` whose value exactly one other entry holds is a citation slip the harness can fix.
  const others = matches || cell.metric || cell.period ? [] : ledger.matchValue(figure).filter((id) => id !== entry.id && !ledger.get(id)?.lookAhead);
  if (others.length === 1) {
    add("repaired", where, `shows ${figure.raw}, which ${entry.id} does not hold; citation corrected to ${others[0]}.`);
    cell.src = others[0];
  } else if (!matches) {
    add(
      "values",
      where,
      `shows ${figure.raw}, but ${entry.id} holds no value equal to it at that precision. Use a figure ${entry.id} actually reports, or compute it with the calculator and cite the result.`,
    );
  }
}

/** References must resolve, and any literal figure left over must exist somewhere in the ledger. */
function checkProse(surface: TextSurface, add: AddIssue, ledger: EvidenceLedger, tally: Tally): void {
  const { text, ...where } = surface;
  // Same-length placeholders keep every offset valid in the original text.
  let resolved = 0;
  const rewritten = rewriteReferences(text, ledger, {
    reference: ({ hit }) => { resolved += 1; return REFERENCE_PLACEHOLDER.repeat(hit.raw.length); },
    unresolved: (hit) => REFERENCE_PLACEHOLDER.repeat(hit.raw.length),
  });
  for (const problem of rewritten.problems) add("references", where, problem.message);

  const figures = matchFigures(rewritten.text, ledger);
  tally.checked += resolved + rewritten.problems.length + figures.length;
  tally.supported += resolved + figures.filter((match) => match.matches.length > 0).length;
  // A citation another figure relies on is never rewritten; nor is one that needs two corrections.
  const kept = new Set(figures.flatMap((match) => match.matches.length && match.citation ? [match.citation.at] : []));
  const edits = new Map<number, { text: string; to: string }>();
  for (const match of figures) {
    if (match.matches.length > 0) continue;
    const { citation, candidates } = match;
    const cited = citation?.text.match(CITATION_ONLY)?.[1];
    const candidate = candidates?.length === 1 ? candidates[0] : undefined;
    const to = candidate === undefined ? undefined : `[${candidate}]`;
    const at = citation?.at ?? -1;
    if (surface.set && citation && cited && to && !kept.has(at) && (edits.get(at)?.to ?? to) === to) {
      edits.set(at, { text: citation.text, to });
      add("repaired", where, `the figure "${match.figure.raw}" cited ${cited}, which does not hold it; citation corrected to ${candidate}.`);
      continue;
    }
    add(
      "values",
      where,
      figureProblem(match) + (match.candidates ? "" : " Write it as a reference such as {C3} or {E7:metric:period}, or compute it with the calculator first."),
    );
  }
  if (edits.size > 0 && surface.set) {
    let repaired = text;
    for (const [at, edit] of [...edits].sort(([a], [b]) => b - a)) repaired = repaired.slice(0, at) + edit.to + repaired.slice(at + edit.text.length);
    surface.set(repaired);
  }
}

function walkBlock(
  block: ReportBlock,
  index: number,
  section: string,
  surfaces: TextSurface[],
  visit: CellVisitor,
): void {
  const at = (location: string): Where => ({ section, location });

  switch (block.type) {
    case "text":
    case "callout":
      surfaces.push({ ...at(`${block.type === "text" ? "text block" : "callout"} ${index + 1}`), text: block.text, set: (text) => { block.text = text; } });
      return;
    case "list":
      block.items.forEach((item, i) => {
        surfaces.push({ ...at(`list ${index + 1} item ${i + 1}`), text: item, set: (text) => { block.items[i] = text; } });
      });
      return;
    case "kpis":
      for (const item of block.items) {
        const where = at(`kpi "${item.label}"`);
        visit(item.cell, where);
        surfaces.push({ ...where, text: `${item.label} ${cellText(item.cell)}` });
      }
      return;
    case "table":
      surfaces.push({ ...at(`table ${index + 1} header`), text: block.columns.join(" ") });
      block.rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          const where = at(`table ${index + 1} row ${r + 1} col ${c + 1}`);
          if (typeof cell === "string") {
            surfaces.push({ ...where, text: cell, set: (text) => { row[c] = text; } });
            return;
          }
          visit(cell, where);
          if (cellText(cell) !== "") surfaces.push({ ...where, text: cellText(cell) });
        });
      });
      return;
    case "chart":
      for (const series of block.series) {
        for (const point of series.points) {
          const where = at(`chart ${index + 1} series "${series.name}" point "${point.x}"`);
          const cell = { ...point.y, unit: point.y.unit ?? block.unit };
          visit(cell, where);
          point.y.src = cell.src;
        }
      }
      return;
    case "html": {
      const where = at(`html block ${index + 1}`);
      surfaces.push({ ...where, text: textContent(sanitizeHtml(block.html)) });
      return;
    }
  }
}

/**
 * The prose surfaces of a spec in reading order, each figure cell handed to `visit` as the walk
 * reaches it; a chart point's cell carries the chart's unit when it names none. An
 * `evidence_table` block shows nothing until it is built from the ledger (`evidenceTable`), which
 * is why `validateReportSpec` repeats this loop, building each table in place before its walk.
 */
export function specSurfaces(spec: ReportSpec, visit: CellVisitor = () => {}): TextSurface[] {
  const surfaces: TextSurface[] = [{ location: "title", text: spec.title }];
  for (const section of spec.sections) {
    surfaces.push({ section: section.heading, location: "heading", text: section.heading });
    section.blocks.forEach((block, index) => walkBlock(block, index, section.heading, surfaces, visit));
  }
  return surfaces;
}

/** Validate a report spec against the evidence ledger before rendering. */
export function validateReportSpec(
  spec: unknown,
  ledger: EvidenceLedger,
  options: ReportValidateOptions,
): ReportValidateResult {
  const parsed = reportSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        kind: "structure" as const,
        location: issue.path.length === 0 ? undefined : issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const issues: ReportIssue[] = [];
  const add: AddIssue = (kind, where, message) => issues.push({ kind, ...where, message });
  const tally: Tally = { checked: 0, supported: 0 };
  const check: CellVisitor = (cell, where) => checkCell(cell, where, add, ledger, tally);
  const value: ReportSpec = { ...parsed.data, format: parsed.data.format ?? options.defaultFormat };

  if (value.sections.length > MAX_SECTIONS) {
    add("size", {}, `${value.sections.length} sections, over the limit of ${MAX_SECTIONS}. Merge related sections.`);
  }

  const template = options.template ?? templateById(value.template);
  if (value.template !== undefined && template === undefined) {
    add("structure", {}, `unknown template "${value.template}". Use one of: ${templateIds().join(", ")}.`);
  }
  const structure = completeStructure(value.sections, template);
  issues.push(...structure.issues);

  const surfaces: TextSurface[] = [{ location: "title", text: value.title }];
  for (const section of value.sections) {
    surfaces.push({ section: section.heading, location: "heading", text: section.heading });
    section.blocks.forEach((block, index) => {
      if (block.type === "evidence_table") {
        const source = block.source;
        try { block = section.blocks[index] = evidenceTable(block, ledger); }
        catch (error) {
          // The table cannot be built, so the report says so where it would have stood.
          const message = errorMessage(error);
          add("sources", { section: section.heading }, message);
          section.blocks[index] = { type: "text", text: `Evidence table from ${source} omitted: ${message}` };
          return;
        }
      }
      walkBlock(block, index, section.heading, surfaces, check);
    });
  }

  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_SPEC_BYTES) {
    add("size", {}, `the spec is ${Math.round(bytes / 1024)} KB, over the ${MAX_SPEC_BYTES / 1024} KB limit. Cut prose or table rows.`);
  }

  for (const surface of surfaces) checkProse(surface, add, ledger, tally);

  const verification = summarizeVerification(issues, tally);
  // Nothing the model wrote survives, so there is nothing to render; a size problem is named first.
  if (structure.written === 0 && !issues.some((issue) => issue.kind === "size")) {
    return { issues: [{ kind: "structure", message: "every section used a generated heading; write the analysis under headings of your own." }], verification };
  }
  return { spec: { ...value, sections: structure.sections }, issues, verification };
}

/** The per-figure outcome delivered with the report: unrepaired issues are unverified, split by kind. */
function summarizeVerification(issues: ReportIssue[], tally: Tally): ReportVerification {
  const count = (kind: ReportIssue["kind"]) => issues.filter((issue) => issue.kind === kind).length;
  const repaired = count("repaired");
  return {
    ...tally,
    repaired,
    unverified: issues.length - repaired,
    byKind: { values: count("values"), sources: count("sources"), references: count("references"), structure: count("structure") },
  };
}

/** The rendered document must also fit the panel; checked once the HTML exists. */
export function checkRenderedSize(html: string): ReportIssue[] {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes <= MAX_HTML_BYTES) return [];
  return [
    {
      kind: "size",
      message: `the rendered report is ${Math.round(bytes / 1024)} KB, over the ${MAX_HTML_BYTES / 1024} KB limit. Cut table rows or shorten the prose.`,
    },
  ];
}

/** Every issue as one message the model can act on. */
export function formatIssues(issues: ReportIssue[]): string {
  const shown = issues.slice(0, MAX_REPORTED_ISSUES).map((issue, index) => {
    const place = [issue.section, issue.location].filter((part) => part !== undefined).join(" › ");
    return `${index + 1}. [${issue.kind}] ${place === "" ? "" : `${place}: `}${issue.message}`;
  });
  const more = issues.length > shown.length ? `\n…and ${issues.length - shown.length} more.` : "";
  const count = issues.length === 1 ? "1 problem" : `${issues.length} problems`;
  return `The report was not created: ${count} to fix.\n${shown.join("\n")}${more}\n\nFix these in the spec and call create_report again.`;
}

/** One line per issue for the report's Verification notes: where, then what. */
export function issueNotes(issues: ReportIssue[]): string[] {
  return issues.map((issue) => {
    const place = [issue.section, issue.location].filter((part) => part !== undefined).join(" › ");
    return place === "" ? issue.message : `${place}: ${issue.message}`;
  });
}
