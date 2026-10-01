import { cached } from "@/lib/cache";
import { limiterFor } from "@/lib/data/rate-limit";
import { sourceRequest } from "@/lib/data/source-snapshot";

/** SEC asks for ≤10 requests/second; we stay under it with one window shared by every EDGAR call. */
const rateLimit = { calls: 8, windowMs: 1000 };

/** How long each kind of EDGAR response stays usable. */
const ttlSeconds = {
  tickers: 24 * 60 * 60,
  submissions: 6 * 60 * 60,
  companyfacts: 24 * 60 * 60,
  document: 7 * 24 * 60 * 60,
  search: 60 * 60,
} as const;

export type EdgarResource = keyof typeof ttlSeconds;

/** Which TTL applies, inferred from the endpoint. */
export function resourceOf(url: string): EdgarResource {
  if (url.includes("company_tickers")) return "tickers";
  if (url.includes("/submissions/")) return "submissions";
  if (url.includes("/companyfacts/")) return "companyfacts";
  if (new URL(url).hostname === "efts.sec.gov") return "search";
  return "document";
}

function userAgent(contact: string): string {
  return `open-finance-agent/1.0 (${contact})`;
}

function describeStatus(status: number, url: string): string {
  if (status === 403) {
    return `SEC EDGAR refused the request (403) for ${url}. It requires a descriptive User-Agent with a contact, e.g. "Jane Doe jane@example.com" — check the contact in Settings › Data connections › SEC EDGAR.`;
  }
  if (status === 404) {
    return `SEC EDGAR has nothing at ${url} (404). The CIK, accession number or document name is probably wrong.`;
  }
  if (status === 429) {
    return `SEC EDGAR rate-limited the request (429) for ${url}. Wait a moment and try again.`;
  }
  return `SEC EDGAR request failed with HTTP ${status} for ${url}.`;
}

/** Fetch an EDGAR URL as text: throttled, cached on disk, with errors worth reading. */
export async function edgarFetch(url: string, contact: string, signal?: AbortSignal, accept?: string): Promise<string> {
  return sourceRequest({ source: "edgar", operation: resourceOf(url), args: { url } }, () =>
    cached(`edgar:${url}`, ttlSeconds[resourceOf(url)], async () => {
      await limiterFor("edgar", rateLimit).acquire(signal);
      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent": userAgent(contact),
          "Accept-Encoding": "gzip, deflate",
          ...(accept ? { Accept: accept } : {}),
        },
      });
      if (!response.ok) throw new Error(describeStatus(response.status, url));
      return response.text();
    }),
  );
}

/** Same as `edgarFetch`, parsed as JSON. */
export async function edgarJson<T>(url: string, contact: string, signal?: AbortSignal): Promise<T> {
  const body = await edgarFetch(url, contact, signal, "application/json");
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`SEC EDGAR returned a response that is not JSON for ${url}.`);
  }
}

/** EDGAR keys companies by a ten-digit zero-padded CIK. */
export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/** Archive paths use the CIK without padding. */
export function trimCik(cik: string | number): string {
  return String(Number(String(cik).replace(/\D/g, "")));
}

/** `https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/<file>` */
export function archiveUrl(cik: string | number, accession: string, file: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${trimCik(cik)}/${accession.replace(/-/g, "")}/${file}`;
}

/** The human-readable index page that lists every document in a filing. */
export function filingIndexUrl(cik: string | number, accession: string): string {
  return archiveUrl(cik, accession, `${accession}-index.htm`);
}
