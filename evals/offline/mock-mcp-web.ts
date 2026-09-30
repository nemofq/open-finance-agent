import { formatExtractResults, formatSearchResults, type ExtractedPage, type FailedPage, type SearchHit } from "@/lib/providers/tavily/format";
import { type CanonicalDocument, DatasetIntegrityError } from "./mock-mcp-data";
import {
  availableAtOrBefore,
  canonicalRecordVisible,
  type CanonicalTaskView,
  cleanUrl,
  cutoffFor,
  domainOf,
  type MockResult,
  normalize,
  secCikFromUrl,
  tokens,
} from "./mock-mcp-view";
import type { OfflineAuditEvent, OfflineOutcome } from "../types";

/** `web_search` and `web_fetch` over the task's captured documents, in Tavily's response format. */

/** What the task's scope models: its aliases, its tickers and their companies' names. */
function modeledTokens(view: CanonicalTaskView): string[] {
  return tokens(`${view.scope.aliases.join(" ")} ${view.scope.tickers.join(" ")} ${view.scope.tickers.flatMap((ticker) => {
    const company = view.companyFor(ticker);
    return company ? [company.name, ...company.aliases] : [];
  }).join(" ")}`);
}

function explicitlyOutOfScope(view: CanonicalTaskView, query: string): boolean {
  const haystack = normalize(query);
  const unrelated = ["crypto", "cryptocurrency", "ethereum", "solana", "forex", "mortgage", "sports betting", "real estate", "weather"];
  return unrelated.some((term) => haystack.includes(term)) && !modeledTokens(view).some((token) => haystack.includes(token));
}

export function webSearch(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("web_search query must not be empty");
  const outOfScope = explicitlyOutOfScope(view, query);
  const wanted = tokens(query);
  const includeDomains = Array.isArray(args.include_domains)
    ? args.include_domains.map((item) => domainOf(`https://${String(item)}`))
    : [];
  const maxResults = Math.min(10, Math.max(1, Number(args.max_results ?? 5)));
  const timeRange = typeof args.time_range === "string" ? args.time_range : undefined;
  const days = timeRange === "day" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 31 : timeRange === "year" ? 366 : undefined;
  const cutoff = new Date(`${view.scope.cutoff}T23:59:59.999Z`).getTime();
  const minDate = days ? cutoff - days * 86_400_000 : undefined;
  const modeled = new Set(modeledTokens(view));
  const anchoredQuery = wanted.some((token) => modeled.has(token));
  const availableDocuments = view.documentsForSearch();
  const futureDocuments = view.documents.filter((document) => !availableAtOrBefore(document, view.scope));
  const matchesTokens = (document: CanonicalDocument) => wanted.some((token) => normalize(`${document.title} ${document.body} ${document.passages.join(" ")}`).includes(token));
  const scored = (outOfScope ? [] : availableDocuments)
    .filter((document) => includeDomains.length === 0 || includeDomains.some((domain) => document.domain === domain || document.domain.endsWith(`.${domain}`)))
    .filter((document) => minDate === undefined || new Date(document.availableAt).getTime() >= minDate)
    .map((document) => {
      const title = normalize(document.title);
      const body = normalize(`${document.body} ${document.passages.join(" ")}`);
      const aliases = normalize(`${document.entities.join(" ")} ${document.topics.join(" ")} ${document.aliases.join(" ")}`);
      let score = 0;
      let overlap = 0;
      let titleOrPassageOverlap = 0;
      for (const token of wanted) {
        if (title.includes(token)) score += 3;
        if (body.includes(token)) score += 1;
        if (aliases.includes(token)) score += 4;
        if (title.includes(token) || body.includes(token) || aliases.includes(token)) overlap += 1;
        if (title.includes(token) || document.passages.some((passage) => normalize(passage).includes(token))) titleOrPassageOverlap += 1;
      }
      if (normalize(query).length > 5 && (title.includes(normalize(query)) || body.includes(normalize(query)))) score += 8;
      if (document.sourceTier === 1) score += 1;
      if (args.topic === "news") score += Math.max(0, 1 - Math.max(0, (cutoff - new Date(document.availableAt).getTime()) / 86_400_000) / 30);
      return { document, score, overlap, titleOrPassageOverlap };
    })
    // Generic exploratory queries are allowed, but an incidental body word
    // must not pull an unrelated SEC page into the result set.  Unanchored
    // queries need two substantive matches, including a title/passage hit.
    .filter((item) => item.overlap > 0 && (anchoredQuery || (item.overlap >= 2 && item.titleOrPassageOverlap > 0)))
    .sort((a, b) => b.score - a.score || b.document.availableAt.localeCompare(a.document.availableAt) || a.document.canonicalUrl.localeCompare(b.document.canonicalUrl))
    .slice(0, maxResults);
  const results = scored.map(({ document }) => {
    const queryTokens = tokens(query);
    const passage = document.passages.find((item) => queryTokens.some((token) => normalize(item).includes(token))) ?? document.passages[0] ?? document.body;
    return { title: document.title, url: document.canonicalUrl, content: passage.slice(0, 500), publishedDate: document.publishedAt };
  });
  const hits: SearchHit[] = results.map((item) => ({ title: item.title, url: item.url, content: item.content, publishedDate: item.publishedDate }));
  const searchAudits: OfflineAuditEvent[] = [];
  let outcome: OfflineOutcome = "served";
  let emptyNote = "";
  if (results.length === 0) {
    const metadataOnly = !outOfScope && view.filings.some((filing) => {
      const filingDocs = view.documents.filter((document) => {
        const accession = filing.accession.replaceAll("-", "");
        return document.canonicalUrl.includes(`/${accession}/`);
      });
      const metadata = normalize(`${filing.ticker} ${filing.form} ${filing.accession} ${filing.url} ${view.companyFor(filing.ticker)?.name ?? ""}`);
      return filingDocs.length === 0 && wanted.length > 0 && wanted.some((token) => metadata.includes(token));
    });
    const futureMatch = !outOfScope && futureDocuments.some(matchesTokens);
    if (outOfScope) {
      outcome = "out_of_scope";
      emptyNote = "\n\nOffline status: out of scope; no live search was attempted.";
      searchAudits.push(view.audit("web_search", args, "out_of_scope_query", "query is outside the task's modeled topics"));
    } else if (futureMatch) {
      outcome = "not_available_as_of";
      emptyNote = `\n\nOffline status: matching material exists only after ${view.scope.cutoff}; it is not available for this task.`;
      searchAudits.push(view.audit("web_search", args, "not_available_as_of", `matching documents are only available after ${view.scope.cutoff}`));
    } else if (availableDocuments.length === 0 || metadataOnly) {
      outcome = "not_captured";
      emptyNote = "\n\nOffline status: relevant source bodies are not captured in this task's corpus; no live search was attempted.";
      searchAudits.push(view.audit("web_search", args, "not_captured", metadataOnly ? "matching filing metadata exists but its body was not captured" : "the task has no captured web source body for this query"));
    } else {
      outcome = "empty";
      emptyNote = "\n\nOffline status: no match in the retained source corpus; this does not establish that no real-world source exists.";
      searchAudits.push(view.audit("web_search", args, "empty_result", "no captured document body matched the normalized query"));
    }
  }
  return {
    text: `${formatSearchResults(query, hits)}${emptyNote}`,
    details: { query, urls: results.map((item) => item.url) },
    ...(searchAudits.length ? { audit: searchAudits } : {}),
    outcome,
  };
}

export function webFetch(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const urls = Array.isArray(args.urls) ? args.urls.map(String).slice(0, 5) : [];
  if (urls.length === 0) throw new Error("web_fetch urls must not be empty");
  const pages: ExtractedPage[] = [];
  const failed: FailedPage[] = [];
  const audits: OfflineAuditEvent[] = [];
  for (const url of urls) {
    const canonical = cleanUrl(url);
    const document = view.documentForUrl(canonical);
    if (!document) {
      const filing = view.filings.find((item) => item.url === canonical || item.indexUrl === canonical || (item.accession && canonical.includes(`/${item.accession.replaceAll("-", "")}/`)));
      if (filing) {
        failed.push({ url, error: "NotCapturedInOfflineCorpus: filing metadata is known, but its body was not captured." });
        audits.push(view.audit("web_fetch", args, "not_captured", "filing metadata exists but no readable body was captured", [canonical]));
        continue;
      }
      const futureDocument = view.db.documents.find((item) => item.canonicalUrl === canonical || item.urlAliases.includes(canonical));
      if (futureDocument && !availableAtOrBefore(futureDocument, view.scope)) {
        failed.push({ url, error: `NotAvailableAsOf:${cutoffFor(view.scope)}` });
        audits.push(view.audit("web_fetch", args, "not_available_as_of", `document is not available as of ${cutoffFor(view.scope)}`, [canonical]));
        continue;
      }
      const futureFiling = view.db.filings.find((item) => item.url === canonical || item.indexUrl === canonical || (item.accession && canonical.includes(`/${item.accession.replaceAll("-", "")}/`)));
      if (futureFiling && !canonicalRecordVisible(futureFiling, view.scope)) {
        failed.push({ url, error: `NotAvailableAsOf:${cutoffFor(view.scope)}` });
        audits.push(view.audit("web_fetch", args, "not_available_as_of", `filing is not available as of ${cutoffFor(view.scope)}`, [canonical]));
        continue;
      }
      const scopedCik = secCikFromUrl(canonical);
      const scopedCompany = view.companies.find((item) => item.cik && ((scopedCik && item.cik === scopedCik) || canonical.includes(`/data/${item.cik}`)));
      if (scopedCompany && domainOf(canonical) === "sec.gov") {
        failed.push({ url, error: `NotCapturedInOfflineCorpus: the ${scopedCompany.name} filing body was not captured.` });
        audits.push(view.audit("web_fetch", args, "not_captured", "SEC issuer is known but this document body was not captured", [canonical]));
        continue;
      }
      failed.push({ url, error: "UnavailableInOfflineCorpus" });
      audits.push(view.audit("web_fetch", args, "out_of_scope", "URL is outside the task's retained offline source corpus", [canonical]));
      continue;
    }
    if (!availableAtOrBefore(document, view.scope)) {
      failed.push({ url, error: `NotAvailableAsOf:${cutoffFor(view.scope)}` });
      audits.push(view.audit("web_fetch", args, "not_available_as_of", `document is not available as of ${cutoffFor(view.scope)}`, [canonical]));
      continue;
    }
    if (!document.body.trim()) throw new DatasetIntegrityError(view.request("web_fetch", args), `captured document body is empty: ${canonical}`);
    const query = typeof args.query === "string" ? args.query : "";
    const selected = query
      ? document.passages.filter((passage) => tokens(query).some((token) => normalize(passage).includes(token))).slice(0, 5)
      : document.passages.slice(0, 10);
    const body = (selected.length ? selected : [document.body]).join("\n\n[… ]\n\n").slice(0, query ? 7500 : 15000);
    pages.push({ url: document.canonicalUrl, title: document.title, rawContent: body });
  }
  return {
    text: formatExtractResults(pages, failed, typeof args.query === "string" ? args.query : undefined),
    details: { fetched: pages.map((page) => page.url), failed: failed.map((page) => page.url) },
    ...(audits.length ? { audit: audits } : {}),
    outcome: pages.length > 0
      ? "served"
      : audits.length > 0 && audits.every((event) => event.kind === "not_available_as_of")
        ? "not_available_as_of"
        : audits.length > 0 && audits.every((event) => event.kind === "out_of_scope")
          ? "out_of_scope"
          : "not_captured",
  };
}
