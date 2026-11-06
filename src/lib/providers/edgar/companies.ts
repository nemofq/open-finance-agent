import { edgarFetch } from "./client";
import { decodeEntities } from "./filing";

/**
 * EDGAR's company index: every filer, including those with no listed ticker, matched against
 * current and former names. The ticker map only holds listed companies under their current name,
 * so this is where a subsidiary that files on its own, or a renamed filer, is found.
 */

export interface CompanyMatch {
  /** Ten-digit zero-padded CIK. */
  cik: string;
  name: string;
  /** Standard Industrial Classification code; operating companies have one, most shells do not. */
  sic?: string;
}

export function companySearchUrl(query: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?${new URLSearchParams({
    action: "getcompany", company: query.trim(), type: "", dateb: "", owner: "include", count: "40" })}`;
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * The two shapes of a search result page. A single match shows the company's own page, which also
 * has a `tableFile2` table of its filings, so it is recognised first; several matches are a
 * `tableFile2` table with the CIK in the first cell and the name, then an optional SIC, in the second.
 */
export function parseCompanySearch(html: string): CompanyMatch[] {
  const single = /<span class="companyName">([\s\S]*?)<acronym[\s\S]*?CIK=(\d{10})/i.exec(html);
  if (single) {
    const sic = /SIC=(\d{4})/.exec(html.slice(single.index))?.[1];
    return [{ cik: single[2], name: stripTags(single[1]), ...(sic ? { sic } : {}) }];
  }
  const table = /<table[^>]*class="tableFile2"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) return [];
  const matches: CompanyMatch[] = [];
  for (const [, row] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
    const cik = /(\d{10})/.exec(stripTags(cells[0] ?? ""))?.[1];
    if (!cik || cells.length < 2) continue;
    const [name, rest = ""] = cells[1].split(/<br\s*\/?>/i);
    // Stripping the tags leaves a space before the colon: "SIC : 5961".
    const sic = /SIC\s*:\s*(\d{4})/.exec(stripTags(rest))?.[1];
    matches.push({ cik, name: stripTags(name), ...(sic ? { sic } : {}) });
  }
  return matches;
}

/** A legal form at the end of a name: "Corporation", "Company", "Inc.", "LLC" and the like. */
const LEGAL_SUFFIX = /[\s,]+(?:corporation|corp|company|co|incorporated|inc|limited|ltd|llc|l\.l\.c|plc|lp|l\.p)\.?$/i;

/**
 * The name without its trailing legal forms ("Ford Motor Credit Company LLC" → "Ford Motor Credit").
 * EDGAR's company index matches the start of its own short forms ("TOYOTA MOTOR CREDIT CORP"), so a
 * name written out in full ("…Corporation") matches nothing until the form is dropped.
 */
export function withoutLegalSuffix(name: string): string {
  let short = name.trim().replace(/^the\s+/i, "");
  while (LEGAL_SUFFIX.test(short)) short = short.replace(LEGAL_SUFFIX, "").trim();
  return short;
}

/** Searches the index for the name as given, then once more without its legal form if that found nothing. */
export async function searchCompanies(query: string, contact: string, signal?: AbortSignal): Promise<CompanyMatch[]> {
  const found = parseCompanySearch(await edgarFetch(companySearchUrl(query), contact, signal));
  const short = withoutLegalSuffix(query);
  if (found.length > 0 || short.length < 2 || short.toLowerCase() === query.trim().toLowerCase()) return found;
  return parseCompanySearch(await edgarFetch(companySearchUrl(short), contact, signal));
}
