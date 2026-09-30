/**
 * The web as a source, whichever search provider reached it: the results carry no structure, so
 * the entry records the numbers found in the text and the best tier among the URLs behind them:
 * sec.gov and investor-relations hosts are primary, the allowlisted press is tier 3, everything
 * else is open web.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SourceTier, ToolMeta } from "@/lib/tools/contracts";
import type { EvidenceSource } from "../types";
import { entityFromArgs, extractNumbers, type Normalized, publishedDate, resultText, sourceOf, structuredOf } from "./text";

/** General tools whose results are sourced text: a figure read off a web page must be traceable. */
export const WEB_TOOLS = ["web_search", "web_fetch"];

const URL_RE = /https?:\/\/[^\s)<>"']+/g;

/** Tier 3 press. Subdomains count, so `www.reuters.com` matches. */
export const PRESS_DOMAINS: readonly string[] = [
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "barrons.com",
  "apnews.com",
  "marketwatch.com",
  "investors.com",
];

/** An investor-relations host is the issuer speaking for itself, so it is primary. */
const IR_PREFIXES = ["ir.", "investor.", "investors.", "ir-", "investorrelations."];

/** A URL's host, lower-cased and without `www.`; undefined when it does not parse. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isOrUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * The tier a web result inherits from its URL: 1 for sec.gov or an investor-relations host, 3 for
 * the allowlisted press, 4 for everything else.
 */
export function tierOfUrl(url: string): SourceTier {
  const host = hostOf(url);
  if (!host) return 4;
  if (isOrUnder(host, "sec.gov")) return 1;
  if (IR_PREFIXES.some((prefix) => host.startsWith(prefix))) return 1;
  if (PRESS_DOMAINS.some((domain) => isOrUnder(host, domain))) return 3;
  return 4;
}

interface WebDetails {
  query?: string;
  urls?: string[];
  fetched?: string[];
}

/** The URLs the tool reports, falling back to the ones printed in its text. */
export function urlsOf(result: AgentToolResult<unknown>, text: string): string[] {
  const details = (result.details ?? {}) as WebDetails;
  const listed = [...(details.urls ?? []), ...(details.fetched ?? [])].filter(
    (url): url is string => typeof url === "string",
  );
  const found = listed.length ? listed : [...text.matchAll(URL_RE)].map((match) => match[0]);
  return [...new Set(found)];
}

/** The best tier any of the result's URLs earns; an empty result is open web. */
export function bestTier(urls: string[]): SourceTier {
  return urls.reduce<SourceTier>((best, url) => (tierOfUrl(url) < best ? tierOfUrl(url) : best), 4);
}

export function normalizeWeb(
  tool: { name: string; meta: ToolMeta },
  args: unknown,
  result: AgentToolResult<unknown>,
): Normalized {
  const text = resultText(result);
  const structured = structuredOf(result.details);
  const details = (result.details ?? {}) as WebDetails;
  const urls = urlsOf(result, text);
  const hosts = [...new Set(urls.map(hostOf).filter((host): host is string => !!host))];
  const tier = bestTier(urls);

  const source: EvidenceSource = { id: "web", name: hosts.length === 1 ? hosts[0] : "Web", tier };
  const query = typeof details.query === "string" ? details.query : undefined;
  const subject = query ? `"${query}"` : hosts.slice(0, 3).join(", ") || "no pages";

  return {
    summary: `${tool.name === "web_search" ? "Web search" : "Web page"} ${subject}${urls.length ? ` — ${urls.length} URL${urls.length === 1 ? "" : "s"}, best tier ${tier}` : ""}`,
    source: sourceOf(tool.meta, structured.source) ?? source,
    entity: structured.entity ?? entityFromArgs(args),
    asOf: structured.asOf ?? publishedDate(text),
    numbers: extractNumbers(text),
    facts: structured.facts,
    table: structured.table,
  };
}
