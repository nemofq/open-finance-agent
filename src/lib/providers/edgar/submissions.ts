import { archiveUrl, edgarJson, filingIndexUrl, padCik, trimCik } from "./client";

interface RecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  form: string[];
  items: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
  isXBRL?: number[];
}

export interface Submissions {
  cik: string;
  name: string;
  tickers?: string[];
  exchanges?: string[];
  sic?: string;
  sicDescription?: string;
  fiscalYearEnd?: string;
  category?: string;
  stateOfIncorporationDescription?: string;
  filings: { recent: RecentFilings };
}

export interface Filing {
  form: string;
  filed: string;
  reportDate: string;
  accession: string;
  items: string[];
  description: string;
  /** The filing's main document, e.g. the 8-K body. */
  url: string;
  /** The index page listing every document, including exhibits. */
  indexUrl: string;
}

export async function loadSubmissions(
  cik: string,
  contact: string,
  signal?: AbortSignal,
): Promise<Submissions> {
  return edgarJson<Submissions>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`, contact, signal);
}

/**
 * A requested form matches its family: the stored form itself, or one that continues it
 * after a `-` or `/`. So `13F` matches `13F-HR` and `13F-HR/A`, and `10-K` matches `10-K/A`
 * but not `10-KT`; a bare prefix such as `13` matches nothing.
 */
export function matchesForm(form: string, forms?: string[]): boolean {
  if (!forms?.length) return true;
  const actual = form.trim().toUpperCase();
  return forms.some((requested) => {
    const wanted = requested.trim().toUpperCase();
    if (!wanted) return false;
    if (actual === wanted) return true;
    const next = actual.charAt(wanted.length);
    return actual.startsWith(wanted) && (next === "-" || next === "/");
  });
}

export interface RecentFilingsOptions {
  forms?: string[];
  limit?: number;
  /** Point-in-time cutoff (YYYY-MM-DD): filings filed after it are dropped before the limit. */
  asOf?: string;
}

/** The filer's most recent filings, newest first, optionally narrowed to some form types. */
export function recentFilings(submissions: Submissions, options: RecentFilingsOptions = {}): Filing[] {
  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber) return [];
  const cik = submissions.cik;
  const filings: Filing[] = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i] ?? "";
    if (!matchesForm(form, options.forms)) continue;
    const filed = recent.filingDate[i] ?? "";
    // Dropped before the limit, so an as-of run still returns a full page of filings.
    if (options.asOf && filed > options.asOf) continue;
    const accession = recent.accessionNumber[i];
    filings.push({
      form,
      filed,
      reportDate: recent.reportDate[i] ?? "",
      accession,
      items: (recent.items[i] ?? "").split(",").filter(Boolean),
      description: recent.primaryDocDescription[i] ?? "",
      url: archiveUrl(cik, accession, recent.primaryDocument[i] ?? ""),
      indexUrl: filingIndexUrl(cik, accession),
    });
    if (options.limit && filings.length >= options.limit) break;
  }
  return filings;
}

export function formatFilings(
  ticker: string,
  submissions: Submissions,
  filings: Filing[],
  options: { asOf?: string } = {},
): string {
  const cutoff = options.asOf
    ? [`Point in time: filings filed after ${options.asOf} are excluded.`]
    : [];
  if (filings.length === 0) {
    return [
      `No matching filings for ${ticker} (${submissions.name}). The submissions feed covers roughly the last thousand filings; widen or drop the form filter.`,
      ...cutoff,
    ].join("\n");
  }
  const rows = filings.map(
    (filing) =>
      `| ${filing.form} | ${filing.filed} | ${filing.reportDate || "—"} | ${filing.items.join(", ") || "—"} | ${filing.url} | ${filing.indexUrl} |`,
  );
  return [
    `**${submissions.name} (${ticker}) — ${filings.length} filings**`,
    "",
    "| Form | Filed | Period | Items | Primary document | Filing index |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rows,
    "",
    "Item 2.02 on an 8-K means results of operations: read the filing index to find the earnings press release, normally Exhibit 99.1.",
    ...cutoff,
  ].join("\n");
}

export function formatProfile(submissions: Submissions): string {
  const lines = [
    `**${submissions.name}**`,
    `- CIK: ${padCik(submissions.cik)} (archives use ${trimCik(submissions.cik)})`,
    `- Tickers: ${submissions.tickers?.join(", ") || "none"}`,
    `- Exchanges: ${submissions.exchanges?.join(", ") || "none"}`,
    `- Industry (SIC): ${submissions.sicDescription ?? "—"}${submissions.sic ? ` (${submissions.sic})` : ""}`,
    `- Fiscal year end: ${submissions.fiscalYearEnd ? `${submissions.fiscalYearEnd.slice(0, 2)}-${submissions.fiscalYearEnd.slice(2)} (MM-DD)` : "—"}`,
    `- Filer category: ${submissions.category ?? "—"}`,
  ];
  if (submissions.stateOfIncorporationDescription) {
    lines.push(`- Incorporated in: ${submissions.stateOfIncorporationDescription}`);
  }
  return lines.join("\n");
}
