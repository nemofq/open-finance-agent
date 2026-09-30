import { matchingPassages, splitChunks } from "@/lib/text/chunks";

/** Structural subsets of the `@tavily/core` response shapes, so formatting stays testable. */
export interface SearchHit {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface ExtractedPage {
  url: string;
  title?: string | null;
  rawContent: string;
}

export interface FailedPage {
  url: string;
  error: string;
}

/** Each extracted page is capped here; long filings and transcripts would otherwise flood context. */
export const maxPageChars = 15_000;
/** Passages returned per page for a query, about 1,500 characters each. */
export const maxChunks = 5;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n\n[truncated at ${max} characters]`;
}

/** Collapse runs of whitespace so snippets stay on one block. */
function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatSearchResults(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) return `No results for "${query}".`;
  const lines = hits.map((hit, i) => {
    const date = hit.publishedDate?.trim();
    const head = `${i + 1}. ${compact(hit.title) || hit.url} — ${hit.url}${date ? ` (${date})` : ""}`;
    const snippet = compact(hit.content);
    return snippet ? `${head}\n   ${snippet}` : head;
  });
  return `Results for "${query}":\n\n${lines.join("\n\n")}`;
}

/**
 * The top of the page, or with a query the passages that match it anywhere on the page, ranked
 * as EDGAR filings, attachments and `evidence_get` rank theirs. A page that never mentions the
 * query still gets its top, as a page without a query does: an index or a short release is
 * worth reading as it stands, and a second fetch would cost a call.
 */
function pageBody(page: ExtractedPage, query?: string): string {
  const content = page.rawContent.trim();
  if (!query?.trim()) return truncate(content, maxPageChars);
  const passages = matchingPassages(splitChunks(content).map((text) => ({ text })), query, maxChunks);
  return passages ?? `No passage on this page mentions "${query}"; the top of the page follows.\n\n${truncate(content, maxPageChars)}`;
}

export function formatExtractResults(
  pages: ExtractedPage[],
  failed: FailedPage[],
  query?: string,
): string {
  const sections = pages.map(
    (page) => `## ${page.title?.trim() || page.url}\n${page.url}\n\n${pageBody(page, query)}`,
  );
  if (failed.length > 0) {
    const list = failed.map((f) => `- ${f.url}: ${f.error}`).join("\n");
    sections.push(`## Could not be fetched\n${list}`);
  }
  return sections.length > 0 ? sections.join("\n\n---\n\n") : "No content could be extracted.";
}
