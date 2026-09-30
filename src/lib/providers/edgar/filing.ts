import { bestChunks } from "@/lib/text/chunks";
import { edgarFetch, padCik } from "./client";

const defaultMaxChars = 20_000;

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  deg: "°",
  reg: "®",
  trade: "™",
  copy: "©",
  euro: "€",
  pound: "£",
  yen: "¥",
  sect: "§",
  para: "¶",
  times: "×",
  minus: "−",
};

export function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return namedEntities[body.toLowerCase()] ?? match;
  });
}

const blockTags = "p|div|tr|br|li|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|hr";

/** A deliberately small HTML-to-text pass: filings are plain documents, not apps. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(new RegExp(`</?(?:${blockTags})\\b[^>]*>`, "gi"), "\n")
      .replace(/<\/?(?:td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/(?: ?\| ?)+/g, " | ")
    .split("\n")
    .map((line) => line.replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function looksLikeHtml(body: string): boolean {
  return /<\/?(?:html|body|div|p|table|font|span)\b/i.test(body.slice(0, 4_000));
}

/* --------------------------------------------------------- filing indexes */

export interface FilingDocument {
  seq: string;
  description: string;
  file: string;
  type: string;
  url: string;
}

/** `...-index.htm` and bare directory URLs list a filing's documents rather than its text. */
export function isFilingIndexUrl(url: string): boolean {
  const path = url.split("?")[0];
  return /-index\.html?$/i.test(path) || /\/(?:index\.json|index\.html?)?$/i.test(path);
}

/** Pull the "Document Format Files" table out of an EDGAR filing index page. */
export function parseFilingIndex(html: string): FilingDocument[] {
  const documents: FilingDocument[] = [];
  for (const [, table] of html.matchAll(/<table[^>]*class="tableFile[^"]*"[\s\S]*?>([\s\S]*?)<\/table>/gi)) {
    for (const [, row] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
      if (cells.length < 4) continue;
      const href = /href="([^"]+)"/i.exec(cells[2])?.[1];
      if (!href) continue;
      const file = href.replace(/^.*\/ix\?doc=/, "").split("/").pop() ?? href;
      documents.push({
        seq: htmlToText(cells[0]).trim() || "—",
        description: htmlToText(cells[1]).trim(),
        file,
        type: htmlToText(cells[3]).trim(),
        url: new URL(href.replace(/^\/ix\?doc=/, ""), "https://www.sec.gov").toString(),
      });
    }
  }
  return documents;
}

function renderIndex(url: string, documents: FilingDocument[]): string {
  if (documents.length === 0) {
    return `No documents listed at ${url}. It may not be a filing index page.`;
  }
  const rows = documents.map(
    (doc) => `| ${doc.seq} | ${doc.type || "—"} | ${doc.description || "—"} | ${doc.url} |`,
  );
  return [
    `Filing index ${url} — ${documents.length} documents. Call edgar_read_filing again on the URL of the document you want (an earnings press release is usually EX-99.1).`,
    "",
    "| Seq | Type | Description | URL |",
    "| :--- | :--- | :--- | :--- |",
    ...rows,
  ].join("\n");
}

/* ----------------------------------------------------------- provenance */

/** `/Archives/edgar/data/<cik>/…` is the only part of an EDGAR URL that names the filer. */
export function cikFromFilingUrl(url: string): string | undefined {
  const match = /\/Archives\/edgar\/data\/(\d+)/i.exec(url);
  return match ? padCik(match[1]) : undefined;
}

/** The filing date an EDGAR filing-index page states in its "Filing Date" box. */
export function filingDateFromIndex(html: string): string | undefined {
  return /Filing\s*Date\s*<\/div>\s*<div[^>]*>\s*(\d{4}-\d{2}-\d{2})/i.exec(html)?.[1];
}

/**
 * A full YYYYMMDD run in the document's file name (`nvda-20260826.htm`), which is the period
 * the document refers to. Accession numbers are longer runs of digits, so they never match.
 */
export function dateFromDocumentUrl(url: string): string | undefined {
  const file = url.split("?")[0].split("/").pop() ?? "";
  for (const run of file.match(/\d+/g) ?? []) {
    if (run.length !== 8) continue;
    const [year, month, day] = [run.slice(0, 4), run.slice(4, 6), run.slice(6, 8)];
    if (year < "1900" || month < "01" || month > "12" || day < "01" || day > "31") continue;
    return `${year}-${month}-${day}`;
  }
  return undefined;
}

/* ------------------------------------------------------------------ public */

export interface ReadFilingOptions {
  query?: string;
  maxChars?: number;
  signal?: AbortSignal;
}

export interface FilingRead {
  text: string;
  /** Ten-digit CIK of the filer, when the URL is an archive path. */
  cik?: string;
  /** The date the document is as of: an index page's filing date, else a date in its file name. */
  asOf?: string;
}

/**
 * Read one filing document as plain text. Filing index pages are listed instead of
 * flattened, so the model can pick the exhibit it actually wants.
 */
export async function readFiling(
  url: string,
  contact: string,
  options: ReadFilingOptions = {},
): Promise<FilingRead> {
  if (!/^https:\/\/(?:www\.|data\.)?sec\.gov\//i.test(url)) {
    throw new Error(`edgar_read_filing only reads sec.gov URLs; got ${url}. Use web_fetch for other sites.`);
  }
  const body = await edgarFetch(url, contact, options.signal);
  const cik = cikFromFilingUrl(url);

  // An index page states its filing date outright; a document only ever hints at one.
  if (isFilingIndexUrl(url)) {
    return { text: renderIndex(url, parseFilingIndex(body)), cik, asOf: filingDateFromIndex(body) };
  }
  const asOf = dateFromDocumentUrl(url);

  const text = looksLikeHtml(body) ? htmlToText(body) : body.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { text: `${url} contained no readable text.`, cik, asOf };

  if (options.query) return { text: `${url}\n\n${bestChunks(text, options.query)}`, cik, asOf };

  const maxChars = Math.max(1_000, options.maxChars ?? defaultMaxChars);
  if (text.length <= maxChars) return { text: `${url}\n\n${text}`, cik, asOf };
  return {
    text: `${url}\n\n${text.slice(0, maxChars)}\n\n[truncated: ${text.length.toLocaleString("en-US")} characters total. Pass a query to get the relevant passages instead of the top of the document.]`,
    cik,
    asOf,
  };
}
