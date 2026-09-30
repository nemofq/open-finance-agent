import { archiveUrl, edgarJson, filingIndexUrl, padCik } from "./client";

const searchUrl = "https://efts.sec.gov/LATEST/search-index";

interface RawHit {
  _id: string;
  _source: {
    ciks?: string[];
    display_names?: string[];
    file_date?: string;
    form?: string;
    file_type?: string;
    file_description?: string;
    period_ending?: string;
    items?: string[];
    adsh?: string;
  };
}

interface RawResponse {
  hits?: { total?: { value?: number }; hits?: RawHit[] };
}

export interface FilingHit {
  entity: string;
  cik: string;
  form: string;
  /** The exhibit type of the matching document, e.g. `EX-99.1`. */
  fileType: string;
  filed: string;
  periodEnding?: string;
  items: string[];
  accession: string;
  document: string;
  url: string;
  indexUrl: string;
}

export interface SearchFilingsParams {
  query: string;
  forms?: string[];
  from?: string;
  to?: string;
  limit?: number;
}

function toHit(raw: RawHit): FilingHit | null {
  const [accession, document] = raw._id.split(":");
  const cik = raw._source.ciks?.[0];
  if (!accession || !document || !cik) return null;
  return {
    entity: (raw._source.display_names?.[0] ?? "Unknown filer").replace(/\s+/g, " ").trim(),
    cik: padCik(cik),
    form: raw._source.form ?? "",
    fileType: raw._source.file_type ?? raw._source.file_description ?? "",
    filed: raw._source.file_date ?? "",
    periodEnding: raw._source.period_ending || undefined,
    items: raw._source.items ?? [],
    accession,
    document,
    url: archiveUrl(cik, accession, document),
    indexUrl: filingIndexUrl(cik, accession),
  };
}

/**
 * Point in time: the search must not reach past the as-of date, so `to` is pulled back to it
 * whenever the model asked for a later one or none at all.
 */
export function capSearchToAsOf(
  params: SearchFilingsParams,
  asOf?: string,
): { params: SearchFilingsParams; capped: boolean } {
  if (!asOf || (params.to !== undefined && params.to <= asOf)) return { params, capped: false };
  return { params: { ...params, to: asOf }, capped: true };
}

/** EFTS rejects `+` for a space, so the query string is built by hand rather than with URLSearchParams. */
export function buildSearchUrl(params: SearchFilingsParams): string {
  const query: [string, string][] = [["q", `"${params.query.replace(/"/g, "")}"`]];
  if (params.forms?.length) query.push(["forms", params.forms.join(",")]);
  if (params.from || params.to) {
    query.push(["dateRange", "custom"]);
    if (params.from) query.push(["startdt", params.from]);
    if (params.to) query.push(["enddt", params.to]);
  }
  return `${searchUrl}?${query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** EDGAR full-text search over filing documents from 2001 onwards. */
export async function searchFilings(
  params: SearchFilingsParams,
  contact: string,
  signal?: AbortSignal,
): Promise<{ total: number; hits: FilingHit[] }> {
  const response = await edgarJson<RawResponse>(buildSearchUrl(params), contact, signal);
  const hits = (response.hits?.hits ?? [])
    .map(toHit)
    .filter((hit): hit is FilingHit => hit !== null)
    .slice(0, params.limit ?? 10);
  return { total: response.hits?.total?.value ?? hits.length, hits };
}

export function formatFilingHits(
  params: SearchFilingsParams,
  result: { total: number; hits: FilingHit[] },
  options: { cappedTo?: string } = {},
): string {
  const cutoff = options.cappedTo
    ? [`Point in time: the search was capped at ${options.cappedTo}; filings filed later are excluded.`]
    : [];
  if (result.hits.length === 0) {
    return [
      `EDGAR full-text search found nothing for "${params.query}"${params.forms?.length ? ` in ${params.forms.join(", ")}` : ""}. Full-text search only covers filings from 2001 onwards and matches the exact phrase.`,
      ...cutoff,
    ].join("\n");
  }
  const rows = result.hits.map(
    (hit) =>
      `| ${hit.entity} | ${hit.form}${hit.fileType && hit.fileType !== hit.form ? ` / ${hit.fileType}` : ""} | ${hit.filed} | ${hit.periodEnding ?? "—"} | ${hit.items.join(", ") || "—"} | ${hit.url} |`,
  );
  return [
    `EDGAR full-text search for "${params.query}" — ${result.total} matching documents, showing ${result.hits.length}.`,
    "",
    "| Filer | Form | Filed | Period | Items | Document URL |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rows,
    "",
    "Read any of these with edgar_read_filing.",
    ...cutoff,
  ].join("\n");
}
