import type { Period, StatementId } from "@/lib/providers/edgar/xbrl/metrics";
import { renderStatement } from "@/lib/providers/edgar/xbrl/render";
import { buildStatementData } from "@/lib/providers/edgar/xbrl/statements";
import { proseDetails, statementDetails, statementFacts } from "@/lib/providers/edgar/evidence";
import { matchesForm } from "@/lib/providers/edgar/submissions";
import { isRecord } from "@/lib/utils";
import { type CanonicalFiling, companyFactsAsOf, DatasetIntegrityError } from "./mock-mcp-data";
import {
  availableAtOrBefore,
  canonicalRecordVisible,
  type CanonicalTaskView,
  cleanUrl,
  cutoffFor,
  type MockResult,
  normalize,
  secAccessionFromUrl,
  secCikFromUrl,
  tokens,
} from "./mock-mcp-view";
import type { OfflineAuditKind, OfflineOutcome } from "../types";

/** The `edgar_*` tools over the task's filings, XBRL facts and captured filing bodies. */

/** The summary and date the production EDGAR tools give a result; the mock's own details win. */
export function edgarProse(result: MockResult): MockResult {
  return { ...result, details: { ...proseDetails(result.text), ...(isRecord(result.details) ? result.details : {}) } };
}

function formatRatio(ratio: number): string {
  return ratio >= 1 ? `${ratio}-for-1` : `1-for-${Number((1 / ratio).toPrecision(6))}`;
}

export function edgarLookup(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const query = String(args.query ?? "");
  const matches = view.companies.filter((item) => [item.ticker, item.name, ...item.aliases].some((alias) => normalize(alias).includes(normalize(query))));
  if (!matches.length) return { text: `No SEC filer matches "${query}" in the offline company directory.`, details: { empty: true }, audit: [view.audit("edgar_lookup_company", args, "out_of_scope", "no canonical company matched the query")], outcome: "out_of_scope" };
  const first = matches[0];
  const lines = [`**${first.name}**`, `- CIK: ${first.cik ?? "unknown"}`, `- Tickers: ${first.ticker}`];
  if (matches.length > 1) lines.push("", "Other matches:", ...matches.slice(1).map((item) => `- ${item.ticker} — ${item.name}`));
  return { text: lines.join("\n"), details: { entity: { ticker: first.ticker, cik: first.cik, name: first.name } } };
}

export function edgarFilings(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const company = view.companyForArgs(args);
  const forms = Array.isArray(args.forms) ? args.forms.map(String).map(normalize) : [];
  const limit = Math.min(50, Math.max(1, Number(args.limit ?? 15)));
  if (!company) {
    return { text: `No SEC filer for "${String(args.ticker ?? "")}" is in the offline company directory.`, details: { asOf: view.scope.cutoff, empty: true }, audit: [view.audit("edgar_filings", args, "out_of_scope", "company is not present in the canonical database")], outcome: "out_of_scope" };
  }
  const rows = view.filings.filter((item) => item.ticker === company.ticker && matchesForm(item.form, forms)).sort((a, b) => b.filedAt.localeCompare(a.filedAt)).slice(0, limit);
  if (!rows.length) {
    const future = view.db.filings.some((item) => item.ticker === company.ticker && matchesForm(item.form, forms) && item.filedAt > view.scope.cutoff);
    const kind: OfflineAuditKind = future ? "not_available_as_of" : "not_captured";
    const outcome: OfflineOutcome = future ? "not_available_as_of" : "not_captured";
    const reason = future ? `matching filings are only available after ${view.scope.cutoff}` : "no filing metadata was captured for this known company";
    return { text: `No matching ${company.ticker} filing metadata is available in the offline corpus${future ? ` by ${view.scope.cutoff}` : ""}. The result does not mean EDGAR has no such filing.`, details: { entity: { ticker: company.ticker, cik: company.cik, name: company.name }, asOf: view.scope.cutoff, empty: true }, audit: [view.audit("edgar_filings", args, kind, reason)], outcome };
  }
  const tableRows = rows.map((item) => {
    const hasBody = view.documents.some((document) => document.canonicalUrl === item.url || document.urlAliases.includes(item.url));
    const tables = informationTables(view, item);
    const body = tables.length > 0
      ? `${hasBody ? "cover page only" : "cover page not captured"}; holdings in information table ${tables.join(", ")}`
      : hasBody ? "yes" : "metadata only; body not captured";
    return [item.form, item.filedAt, item.reportDate || "—", item.accession, item.url, body];
  });
  const textRows = tableRows.map((row) => `| ${row.join(" | ")} |`);
  const text = `**${company.name} (${company.ticker}) — ${rows.length} filings**\n\n| Form | Filed | Period | Accession | Primary document | Readable body |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${textRows.join("\n")}\n\nPoint in time: filings filed after ${view.scope.cutoff} are excluded. Readable body means the offline corpus has actual text; metadata alone cannot support content claims.`;
  return { text, details: { entity: { ticker: company.ticker, cik: company.cik, name: company.name }, asOf: view.scope.cutoff, table: { columns: ["form", "filed", "reportDate", "accession", "url", "bodyCaptured"], rows: tableRows } } };
}

/**
 * A 13F's primary document, as EDGAR names it, is the cover page: it carries the filer and the
 * portfolio total, not one holding. The holdings are in the information table filed alongside
 * it. These are the captured information-table bodies of the filing, rendered form first, so
 * the listing can say where the readable holdings are rather than only name the cover.
 */
function informationTables(view: CanonicalTaskView, filing: CanonicalFiling): string[] {
  if (!normalize(filing.form).startsWith("13f")) return [];
  const primary = cleanUrl(filing.url);
  return view.documents
    .filter((document) => availableAtOrBefore(document, view.scope) && secAccessionFromUrl(document.canonicalUrl) === filing.accession &&
      document.canonicalUrl !== primary && /\.xml$/i.test(document.canonicalUrl) && !/primary_doc\.xml$/i.test(document.canonicalUrl))
    .map((document) => document.canonicalUrl)
    .sort((a, b) => Number(!/\/xslform13f_x02\//i.test(a)) - Number(!/\/xslform13f_x02\//i.test(b)) || a.localeCompare(b));
}

export function edgarFinancials(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const company = view.companyForArgs(args);
  const statement = String(args.statement ?? "key_metrics") as StatementId;
  const period = String(args.period ?? "quarterly") as Period;
  const limit = Math.min(20, Math.max(1, Number(args.limit ?? 8)));
  if (!company) {
    return { text: `No SEC filer for "${String(args.ticker ?? "")}" is in the offline company directory.`, details: { statement, period, asOf: view.scope.cutoff, facts: [], empty: true }, audit: [view.audit("edgar_financials", args, "out_of_scope", "company is not present in the canonical database")], outcome: "out_of_scope" };
  }
  const { facts: companyFacts, splits } = companyFactsAsOf(company, company.ticker, view.facts, view.scope.cutoff);
  const result = buildStatementData(companyFacts, statement, period, limit, { asOf: view.scope.cutoff });
  const rows = result.rows.map((row) => [row.label, ...row.cells.map((cell) => cell.value ?? null)]);
  const facts = statementFacts(result);
  const details = {
    statement,
    period,
    entity: { ticker: company.ticker, cik: company.cik, name: company.name },
    asOf: view.scope.cutoff,
    periods: result.columns,
    facts,
    table: { columns: ["Line", ...result.columns], rows, index: "Line" },
  };
  if (result.columns.length) {
    // The filings themselves print the older basis, so name the splits the series was restated for.
    const basis = splits.length === 0 ? "" : `\n\nShare basis: per-share and share-count figures filed before ${splits.map((split) => `the ${split.date} ${formatRatio(split.ratio)} split`).join(" and ")} are restated to the basis in force on ${view.scope.cutoff}, as later filings restate comparatives.`;
    const text = `${renderStatement(result)}${basis}`;
    const served = { ...details, summary: statementDetails(result, company.ticker, text).summary, currency: "USD" };
    return { text, details: served, outcome: "served" };
  }

  const knownFacts = view.db.financialFacts.filter((item) => item.ticker === company.ticker && item.concept);
  const futureFacts = knownFacts.some((item) => !canonicalRecordVisible(item, view.scope));
  const outcome: OfflineOutcome = futureFacts ? "not_available_as_of" : "not_captured";
  const kind: OfflineAuditKind = futureFacts ? "not_available_as_of" : "not_captured";
  return {
    text: `No ${statement} ${period} statement could be built from captured SEC companyfacts for ${company.ticker}. Offline status: ${futureFacts ? `available facts are after ${view.scope.cutoff}` : "required XBRL facts were not captured"}; this is not a claim that the filer has no such facts.`,
    details: { ...details, empty: true },
    audit: [view.audit("edgar_financials", args, kind, futureFacts ? `all matching facts postdate ${view.scope.cutoff}` : "captured companyfacts cannot satisfy this statement request")],
    outcome,
  };
}

export function edgarRead(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const url = cleanUrl(args.url);
  const document = view.documentForUrl(url);
  if (!document) {
    const filing = view.filings.find((item) => item.url === url || item.indexUrl === url || (item.accession && url.includes(`/${item.accession.replaceAll("-", "")}/`)));
    if (filing) {
      return {
        text: `${filing.url}\n\nSEC filing ${filing.form} (accession ${filing.accession}) filed ${filing.filedAt}, reporting period ${filing.reportDate}. Offline status: filing metadata is retained, but this document body was not captured. No content claims can be made from it.`,
        details: { url: filing.url, accession: filing.accession, form: filing.form, filedAt: filing.filedAt, entity: { ticker: filing.ticker }, empty: true },
        audit: [view.audit("edgar_read_filing", args, "not_captured", "filing metadata exists but the requested document body was not captured", [url])],
        outcome: "not_captured",
      };
    }
    const knownFutureFiling = view.db.filings.find((item) => item.url === url || item.indexUrl === url || (item.accession && url.includes(`/${item.accession.replaceAll("-", "")}/`)));
    if (knownFutureFiling && !canonicalRecordVisible(knownFutureFiling, view.scope)) {
      return { text: `${url}\n\nNotAvailableAsOf:${cutoffFor(view.scope)}`, details: { url, empty: true }, audit: [view.audit("edgar_read_filing", args, "not_available_as_of", `filing is not available as of ${cutoffFor(view.scope)}`, [url])], outcome: "not_available_as_of" };
    }
    const knownFutureDocument = view.db.documents.find((item) => item.canonicalUrl === url || item.urlAliases.includes(url));
    if (knownFutureDocument && !availableAtOrBefore(knownFutureDocument, view.scope)) {
      return { text: `${url}\n\nNotAvailableAsOf:${cutoffFor(view.scope)}`, details: { url, empty: true }, audit: [view.audit("edgar_read_filing", args, "not_available_as_of", `document is not available as of ${cutoffFor(view.scope)}`, [url])], outcome: "not_available_as_of" };
    }
    const scopedCik = secCikFromUrl(url);
    const scopedCompany = view.companies.find((item) => item.cik && ((scopedCik && item.cik === scopedCik) || url.includes(`/data/${item.cik}`)));
    if (scopedCompany) {
      return {
        text: `${url}\n\nOffline status: this is a ${scopedCompany.name} SEC URL, but its body was not captured. No text claims are available from this URL.`,
        details: { url, entity: { ticker: scopedCompany.ticker, cik: scopedCompany.cik }, empty: true },
        audit: [view.audit("edgar_read_filing", args, "not_captured", "known issuer URL has no captured document body", [url])],
        outcome: "not_captured",
      };
    }
    return { text: `${url}\n\nOffline status: this URL is outside the retained task source corpus; no live fetch was attempted.`, details: { url, empty: true }, audit: [view.audit("edgar_read_filing", args, "out_of_scope", "URL is not present in the task source corpus", [url])], outcome: "out_of_scope" };
  }
  if (!availableAtOrBefore(document, view.scope)) {
    return { text: `${url}\n\nNotAvailableAsOf:${cutoffFor(view.scope)}`, details: { url, empty: true }, audit: [view.audit("edgar_read_filing", args, "not_available_as_of", `document is not available as of ${cutoffFor(view.scope)}`, [url])], outcome: "not_available_as_of" };
  }
  if (!document.body.trim()) throw new DatasetIntegrityError(view.request("edgar_read_filing", args), `captured document body is empty: ${url}`);
  const query = typeof args.query === "string" ? args.query : "";
  const passages = query ? document.passages.filter((item) => tokens(query).some((token) => normalize(item).includes(token))).slice(0, 8) : document.passages.slice(0, 16);
  const matched = !query || passages.length > 0;
  const text = passages.length
    ? passages.join("\n\n")
    : query
      ? `No passage in this document mentions "${query}". Retry without a query to read the document from the top.`
      : document.body;
  return {
    text: `${document.canonicalUrl}\n\n${text.slice(0, Number(args.maxChars ?? 20000))}`,
    details: { url: document.canonicalUrl, entity: { ticker: document.entities[0] } },
    ...(matched ? { outcome: "served" } : {
      audit: [view.audit("edgar_read_filing", args, "empty_result", "captured filing body has no passage matching the requested query", [document.canonicalUrl])],
      outcome: "empty",
    }),
  };
}

export function edgarSearchFilings(view: CanonicalTaskView, args: Record<string, unknown>): MockResult {
  const rawQuery = String(args.query ?? "").trim();
  const query = normalize(rawQuery);
  const forms = Array.isArray(args.forms) ? args.forms.map((value) => normalize(value)) : [];
  const from = String(args.from ?? "0000-01-01");
  const to = [String(args.to ?? view.scope.cutoff), view.scope.cutoff].sort()[0];
  const queryTokens = tokens(query);
  const docs = view.documentsForSearch();
  const matches = docs.flatMap((document) => {
    const body = normalize(document.body);
    if (queryTokens.length && !queryTokens.every((token) => body.includes(token))) return [];
    const accession = secAccessionFromUrl(document.canonicalUrl);
    const filing = view.filings.find((candidate) => candidate.accession === accession || candidate.url === document.canonicalUrl || candidate.indexUrl === document.canonicalUrl);
    if (forms.length && (!filing || !matchesForm(filing.form, forms))) return [];
    const filedAt = filing?.filedAt ?? document.publishedAt;
    if (filedAt < from || filedAt > to) return [];
    return [{ document, filing, filedAt }];
  })
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt) || a.document.canonicalUrl.localeCompare(b.document.canonicalUrl))
    .slice(0, Math.min(20, Math.max(1, Number(args.limit ?? 10))));
  if (matches.length) {
    const hits = matches.map(({ document, filing, filedAt }) => ({
      url: document.canonicalUrl,
      title: document.title,
      ticker: filing?.ticker ?? document.entities[0] ?? "unknown",
      form: filing?.form ?? document.documentType,
      filedAt,
      excerpt: document.passages.find((passage) => queryTokens.every((token) => normalize(passage).includes(token)))?.slice(0, 500) ?? document.body.slice(0, 500),
    }));
    return {
      text: `EDGAR full-text search for "${rawQuery}" — ${hits.length} matching captured document bodies.\n\n${hits.map((hit) => `- ${hit.ticker} ${hit.form} filed ${hit.filedAt} — ${hit.title} — ${hit.url}\n  ${hit.excerpt}`).join("\n")}`,
      details: { hits, urls: hits.map((hit) => hit.url) },
      outcome: "served",
    };
  }

  const metadataOnly = queryTokens.length > 0 && view.filings.some((filing) => {
    if (!matchesForm(filing.form, forms) || filing.filedAt < from || filing.filedAt > to) return false;
    const hasBody = view.documents.some((document) => secAccessionFromUrl(document.canonicalUrl) === filing.accession);
    const company = view.companyFor(filing.ticker);
    const metadata = normalize(`${filing.ticker} ${filing.form} ${filing.accession} ${filing.url} ${company?.name ?? ""} ${company?.aliases.join(" ") ?? ""}`);
    return !hasBody && queryTokens.every((token) => metadata.includes(token));
  });
  // Material "exists only after the cutoff" when a later document would have matched this very
  // search: every query token, and a filing of a requested form. A later body that shares one
  // word with the query, or is not of the requested form, is not matching material, so the
  // search reports a genuine no-match instead of a false promise of future material.
  const futureMatch = queryTokens.length > 0 && view.db.documents.some((document) => {
    if (availableAtOrBefore(document, view.scope)) return false;
    const body = normalize(document.body);
    if (!queryTokens.every((token) => body.includes(token))) return false;
    if (forms.length === 0) return true;
    const accession = secAccessionFromUrl(document.canonicalUrl);
    const filing = view.db.filings.find((candidate) => candidate.accession === accession || candidate.url === document.canonicalUrl || candidate.indexUrl === document.canonicalUrl);
    return filing !== undefined && matchesForm(filing.form, forms);
  });
  let outcome: OfflineOutcome;
  let kind: OfflineAuditKind;
  let reason: string;
  let note: string;
  if (futureMatch) {
    outcome = "not_available_as_of";
    kind = "not_available_as_of";
    reason = `matching document bodies are only available after ${view.scope.cutoff}`;
    note = `Matching material exists only after ${view.scope.cutoff}.`;
  } else if (metadataOnly || docs.length === 0) {
    outcome = "not_captured";
    kind = "not_captured";
    reason = metadataOnly ? "matching filing metadata exists but no body was captured" : "no filing body was captured for this task";
    note = "Filing metadata may match, but no readable body for it is in the offline corpus.";
  } else {
    outcome = "empty";
    kind = "empty_result";
    reason = "no captured filing body matched the full-text query";
    note = "No match was found in the retained filing bodies; this does not establish that no real-world filing mentions the terms.";
  }
  return {
    text: `EDGAR full-text search for "${rawQuery}" — no matching captured body.\n${note}`,
    details: { hits: [], urls: [], coverageState: outcome },
    audit: [view.audit("edgar_search_filings", args, kind, reason)],
    outcome,
  };
}
