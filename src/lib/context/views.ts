import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { EvidenceEntry, EvidenceTable } from "@/lib/evidence/types";
import { textTokens, tokenChars } from "./tokens";
import type { ContextBudget } from "./types";

/**
 * Layer 1: the model gets a view of a tool result sized to its window. The full
 * payload is already in the evidence store, so every view ends with the id that returns it.
 */

export interface CompactViewOptions {
  budget: ContextBudget;
  /** The ledger entry the result produced; without it the view cannot point anywhere. */
  entry?: EvidenceEntry;
}

/** Rows of a price series kept verbatim, so the model can still read the recent moves. */
const SERIES_ROWS = 20;
/** Headings listed in a filing's section index before the rest are summed up. */
const MAX_SECTIONS = 30;
/** Share of the view a section index may take. */
const SECTION_INDEX_SHARE = 0.25;
/** The tag block (tag, policy notes, cross-check lines) stays whole up to this size; past it only the tag line survives. */
const HEADER_CHARS = 2_000;
const HEADER_LINES = 12;

/** Share of a head/tail truncation spent on the head. */
const HEAD_SHARE = 0.7;

const isText = (block: TextContent | ImageContent): block is TextContent => block.type === "text";

/**
 * Shrink a tool result to `budget.toolResultMax` tokens, by kind. Text already within budget,
 * and content with no text at all, is returned untouched.
 */
export function compactToolResult(
  content: (TextContent | ImageContent)[],
  options: CompactViewOptions,
): (TextContent | ImageContent)[] {
  const texts = content.filter(isText);
  if (texts.length === 0) return content;

  const text = texts.map((block) => block.text).join("\n");
  if (textTokens(text) <= options.budget.toolResultMax) return content;

  const images = content.filter((block): block is ImageContent => block.type === "image");
  return [{ type: "text", text: buildView(text, options) }, ...images];
}

function buildView(text: string, { budget, entry }: CompactViewOptions): string {
  const { tag, body } = splitTag(text);
  // The floor only binds when a tag would eat the whole budget; real budgets start at 2,000.
  const limit = Math.max(50, budget.toolResultMax - (tag ? textTokens(tag) + 1 : 0));
  const view = viewFor(body, limit, entry);
  return tag ? `${tag}\n${view}` : view;
}

function viewFor(body: string, limit: number, entry?: EvidenceEntry): string {
  const table = entry?.table;
  if (table && isDateSeries(table)) return seriesView(table, limit, entry);

  const sections = findSections(body);
  if (sections.length >= 3) return sectionsView(body, sections, limit, entry);

  if (table && table.rows.length > 0) return tableView(table, limit, entry);
  return headTailView(body, limit, entry);
}

/**
 * The header the ledger prepends survives every view: the tag (`[E7 · SEC EDGAR · tier 1 · as
 * of …]`) and the cross-check and CONFLICT lines under it, which run to the first blank line.
 */
function splitTag(text: string): { tag?: string; body: string } {
  if (!text.startsWith("[E")) return { body: text };
  const brk = text.indexOf("\n");
  const tagLine = brk < 0 ? text : text.slice(0, brk);
  const blank = text.indexOf("\n\n");
  const header = blank < 0 ? tagLine : text.slice(0, blank);
  // Policy notes and cross-check lines ride along with the tag; they are the enforcement's voice.
  const bounded = header.length <= HEADER_CHARS && header.split("\n").length <= HEADER_LINES;
  const tag = bounded ? header : tagLine;
  return { tag, body: text.slice(tag.length).trimStart() };
}

function truncatedHint(entry?: EvidenceEntry): string {
  return entry ? `(truncated; evidence_get ${entry.id} for the rest)` : "(truncated)";
}

/* ----------------------------------------------------------------- series */

const DATE = /^\d{4}-\d{2}-\d{2}/;

const isDateLike = (value: string | number | null): boolean => typeof value === "string" && DATE.test(value);

/** A price series: an index column whose first and last values are dates. */
function isDateSeries(table: EvidenceTable): boolean {
  const column = table.index ? table.columns.indexOf(table.index) : -1;
  if (column < 0 || table.rows.length === 0) return false;
  const first = table.rows[0][column];
  const last = table.rows[table.rows.length - 1][column];
  return isDateLike(first) && isDateLike(last);
}

/** The column a series is summarised by: an explicit close, else the last numeric column. */
function valueColumn(table: EvidenceTable): number {
  const close = table.columns.findIndex((name) => /^(adj(usted)?[ _]?)?close$/i.test(name.trim()));
  if (close >= 0) return close;
  const row = table.rows[0];
  for (let i = table.columns.length - 1; i >= 0; i -= 1) {
    if (typeof row[i] === "number") return i;
  }
  return -1;
}

function seriesView(table: EvidenceTable, limit: number, entry?: EvidenceEntry): string {
  const dateAt = table.columns.indexOf(table.index ?? "");
  const rows = table.rows;
  const ascending = String(rows[0][dateAt]) <= String(rows[rows.length - 1][dateAt]);
  const firstDate = String(rows[ascending ? 0 : rows.length - 1][dateAt]);
  const lastDate = String(rows[ascending ? rows.length - 1 : 0][dateAt]);

  const lines = [`${entry?.summary ?? "Series"} — ${rows.length} rows, ${firstDate} → ${lastDate}.`];

  const valueAt = valueColumn(table);
  if (valueAt >= 0) {
    const points = rows
      .map((row) => ({ date: String(row[dateAt]), value: row[valueAt] }))
      .filter((point): point is { date: string; value: number } => typeof point.value === "number");
    if (points.length > 0) {
      const latest = ascending ? points[points.length - 1] : points[0];
      const min = points.reduce((low, point) => (point.value < low.value ? point : low));
      const max = points.reduce((high, point) => (point.value > high.value ? point : high));
      const name = table.columns[valueAt];
      lines.push(
        `${name}: last ${latest.value} (${latest.date}), min ${min.value} (${min.date}), max ${max.value} (${max.date}).`,
      );
    }
  }

  const recent = ascending ? rows.slice(-SERIES_ROWS) : rows.slice(0, SERIES_ROWS);
  const hint = entry ? `full series in ${entry.id} (evidence_get)` : "full series omitted";
  const spent = textTokens([...lines, `Most recent ${recent.length} rows:`, hint].join("\n"));
  const body = renderRows(table.columns, recent, limit - spent);

  return [...lines, `Most recent ${body.rows} rows:`, body.text, hint].join("\n");
}

/* ------------------------------------------------------------------ table */

function tableView(table: EvidenceTable, limit: number, entry?: EvidenceEntry): string {
  const head = `${entry?.summary ?? "Table"} — ${table.rows.length} rows × ${table.columns.length} columns.`;
  const hint = entry ? `(${table.rows.length} rows total; evidence_get ${entry.id} for the rest)` : truncatedHint();
  const body = renderRows(table.columns, table.rows, limit - textTokens(`${head}\n${hint}`));
  return [head, body.text, body.rows < table.rows.length ? hint : ""].filter(Boolean).join("\n");
}

/** Render as many rows as fit, header first; values are never reformatted so figures stay exact. */
function renderRows(
  columns: string[],
  rows: (string | number | null)[][],
  limit: number,
): { text: string; rows: number } {
  const chars = tokenChars(limit);
  const header = columns.join(" | ");
  const lines = [header];
  let used = header.length;
  let kept = 0;
  for (const row of rows) {
    const line = row.map((cell) => (cell === null ? "" : String(cell))).join(" | ");
    if (used + line.length + 1 > chars) break;
    lines.push(line);
    used += line.length + 1;
    kept += 1;
  }
  return { text: lines.join("\n"), rows: kept };
}

/* --------------------------------------------------------------- sections */

interface Section {
  title: string;
}

const HEADING_PATTERNS = [
  /^#{1,6}\s+(\S.*)$/,
  /^((?:item|part)\s+[0-9ivx]+[a-z]?\.?.*)$/i,
];

/** Headings a filing or transcript is navigated by, so a stubbed body still has a map. */
function findSections(text: string): Section[] {
  const sections: Section[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.length > 90) continue;
    const matched = HEADING_PATTERNS.map((pattern) => pattern.exec(line)).find((match) => match !== null);
    const title = matched ? matched[1].trim() : isShoutedHeading(line) ? line : undefined;
    if (!title) continue;
    if (sections[sections.length - 1]?.title !== title) sections.push({ title });
  }
  return sections;
}

/** An upper-case line with real words in it, the way filings and transcripts mark a section. */
function isShoutedHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && line === line.toUpperCase() && !line.endsWith(".");
}

function sectionsView(body: string, sections: Section[], limit: number, entry?: EvidenceEntry): string {
  const listed = sections.slice(0, MAX_SECTIONS).map((section) => section.title);
  const rest = sections.length - listed.length;
  const index = `Sections: ${listed.join("; ")}${rest > 0 ? `; …and ${rest} more` : ""}`;
  const trimmedIndex = clip(index, tokenChars(Math.floor(limit * SECTION_INDEX_SHARE)));
  const hint = truncatedHint(entry);
  const head = clip(body.trimStart(), tokenChars(limit) - trimmedIndex.length - hint.length - 2);
  return [head, trimmedIndex, hint].join("\n");
}

/* -------------------------------------------------------------- head/tail */

function headTailView(body: string, limit: number, entry?: EvidenceEntry): string {
  const marker = `… ${truncatedHint(entry)} …`;
  const chars = Math.max(0, tokenChars(limit) - marker.length - 2);
  const headChars = Math.floor(chars * HEAD_SHARE);
  const head = clip(body.slice(0, headChars), headChars);
  const tail = body.slice(body.length - (chars - headChars));
  return [head, marker, tail.slice(tail.indexOf("\n") + 1)].join("\n");
}

/** Cut to a character budget, preferring the last line break so a row is never half shown. */
function clip(text: string, chars: number): string {
  if (chars <= 0) return "";
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const brk = cut.lastIndexOf("\n");
  return brk > chars * 0.5 ? cut.slice(0, brk) : cut;
}
