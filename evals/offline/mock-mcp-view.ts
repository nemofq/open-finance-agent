import type { SourceRequest } from "@/lib/data/source-snapshot";
import type {
  CanonicalAlphaRecord,
  CanonicalCompany,
  CanonicalDatabase,
  CanonicalDocument,
  CanonicalFact,
  CanonicalFiling,
  CanonicalMarketRecord,
  CanonicalTaskScope,
} from "./mock-mcp-data";
import { normalizeSourceUrl } from "./coverage-contract";
import type { OfflineAuditEvent, OfflineAuditKind, OfflineOutcome } from "../types";

/**
 * One task's view of the offline dataset: every table filtered to what exists at the task's
 * cutoff, and the lookups the tool handlers share. The handlers live beside it, one module per
 * provider; `mock-mcp-bridge.ts` routes each tool call to one of them.
 */

export function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

/**
 * A URL as the dataset stores it (`normalizeSourceUrl`); text that is not a URL, as a model may
 * send, is only trimmed and lowercased so it can still be compared.
 */
export function cleanUrl(value: unknown): string {
  try {
    return normalizeSourceUrl(String(value));
  } catch {
    return normalize(value).replace(/\/$/, "");
  }
}

export function domainOf(value: unknown): string {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function secCikFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const pathMatch = url.pathname.match(/\/data\/(\d+)\//i);
    const queryCik = url.searchParams.get("CIK");
    return (pathMatch?.[1] ?? queryCik ?? undefined)?.replace(/^0+/, "");
  } catch {
    return undefined;
  }
}

export function secAccessionFromUrl(value: string): string | undefined {
  try {
    const path = new URL(value).pathname;
    const match = path.match(/\/(\d{10}-\d{2}-\d{6}|\d{18})\//);
    if (!match) return undefined;
    const accession = match[1];
    if (accession.includes("-")) return accession;
    return `${accession.slice(0, 10)}-${accession.slice(10, 12)}-${accession.slice(12)}`;
  } catch {
    return undefined;
  }
}

export function dateOnly(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export function tokens(value: unknown): string[] {
  return [...new Set(normalize(value).match(/[\p{L}\p{N}$][\p{L}\p{N}$.'-]*/gu) ?? [])]
    .filter((token) => token.length > 1 && !new Set(["about", "after", "before", "from", "into", "latest", "news", "that", "their", "this", "what", "when", "where", "which", "with"]).has(token));
}

/** A task's `asOfDate` and `asOfTime` as an instant, read as eastern daylight time (see `EvalTask.asOfTime`). */
export function cutoffInstant(date: string, time: string): string {
  return `${date}T${time}:00-04:00`;
}

export function cutoffFor(scope: CanonicalTaskScope): string {
  return scope.asOfTime ? cutoffInstant(scope.cutoff, scope.asOfTime) : `${scope.cutoff}T23:59:59.999Z`;
}

/**
 * The benchmark's point-in-time rule, which the compiler, the mock and the coverage check share: a
 * value dated before the cutoff day is visible; on the cutoff day it is visible all day, or, at an
 * intraday cutoff, only when it carries a time at or before that instant.
 */
export function atOrBeforeCutoff(value: unknown, cutoff: string, asOfTime?: string): boolean {
  const date = dateOnly(value);
  if (!date || date > cutoff) return false;
  if (date < cutoff || !asOfTime) return true;
  return String(value).length > 10 && Date.parse(String(value)) <= Date.parse(cutoffInstant(cutoff, asOfTime));
}

export function availableAtOrBefore(document: CanonicalDocument, scope: CanonicalTaskScope): boolean {
  return atOrBeforeCutoff(document.availableAt, scope.cutoff, scope.asOfTime);
}

export function canonicalRecordVisible(
  record: { taskIds: string[]; availableAt?: string; availabilityBasis?: string; filedAt?: string; asOf?: string },
  scope: Pick<CanonicalTaskScope, "taskId" | "cutoff" | "asOfTime">,
): boolean {
  const availableAt = record.availableAt || record.filedAt || record.asOf;
  const basis = record.availabilityBasis || (record.filedAt ? "filed" : record.asOf ? "market_timestamp" : undefined);
  if (basis === "snapshot") return record.taskIds.includes(scope.taskId) && atOrBeforeCutoff(availableAt, scope.cutoff, scope.asOfTime);
  if (!basis || !["filed", "published", "market_timestamp"].includes(basis)) return false;
  return atOrBeforeCutoff(availableAt, scope.cutoff, scope.asOfTime);
}

export type MockResult = { text: string; details?: unknown; audit?: OfflineAuditEvent[]; outcome?: OfflineOutcome };

export class CanonicalTaskView {
  readonly scope: CanonicalTaskScope;
  readonly companies: CanonicalCompany[];
  readonly filings: CanonicalFiling[];
  readonly facts: CanonicalFact[];
  readonly market: CanonicalMarketRecord[];
  readonly documents: CanonicalDocument[];
  readonly alphaData: CanonicalAlphaRecord[];

  constructor(readonly db: CanonicalDatabase, taskId: string) {
    const scope = db.scopes[taskId];
    if (!scope) throw new Error(`Canonical mock MCP has no task scope for ${taskId}`);
    this.scope = scope;
    // Issuers and market/SEC records are globally queryable.  taskIds remain
    // provenance only; the task's as-of boundary is the access boundary.
    this.companies = db.companies;
    this.filings = db.filings.filter((item) => canonicalRecordVisible(item, scope));
    this.facts = db.financialFacts.filter((item) => canonicalRecordVisible(item, scope));
    this.market = db.marketData.filter((item) => canonicalRecordVisible(item, scope));
    this.documents = db.documents.filter((item) => item.taskIds.includes(taskId));
    this.alphaData = db.alphaRecords.filter((item) => item.taskIds.includes(taskId) && canonicalRecordVisible(item, scope));
  }

  request(tool: string, args: Record<string, unknown>): SourceRequest {
    return { source: "mock-mcp", operation: tool, args };
  }

  companyFor(query: unknown): CanonicalCompany | undefined {
    const wanted = normalize(query);
    const wantedSymbol = wanted.replace(/[.\-]/g, "");
    return this.companies.find((item) =>
      normalize(item.ticker).replace(/[.\-]/g, "") === wantedSymbol ||
      [item.name, ...item.aliases].some((alias) => normalize(alias) === wanted || normalize(alias).includes(wanted) || wanted.includes(normalize(alias))),
    );
  }

  companyForArgs(args: Record<string, unknown>): CanonicalCompany | undefined {
    return this.companyFor(args.ticker ?? args.symbol);
  }

  audit(tool: string, args: Record<string, unknown>, kind: OfflineAuditKind, reason: string, urls?: string[]): OfflineAuditEvent {
    return { tool, kind, normalizedRequest: { ...args }, ...(urls ? { urls } : {}), reason };
  }

  documentsForSearch(): CanonicalDocument[] {
    return this.documents.filter((document) => availableAtOrBefore(document, this.scope));
  }

  documentForUrl(url: string): CanonicalDocument | undefined {
    const canonical = cleanUrl(url);
    const direct = this.documents.find((item) => item.canonicalUrl === canonical || item.urlAliases.includes(canonical));
    if (direct) return direct;

    let requested: URL;
    try { requested = new URL(canonical); } catch { return undefined; }
    if (domainOf(canonical) !== "sec.gov" || !/\/(?:index\.html?|\d{10}-\d{2}-\d{6}-index\.htm)$/i.test(requested.pathname)) return undefined;
    const accession = secAccessionFromUrl(canonical);
    if (!accession) return undefined;
    return this.documents.find((item) => {
      if (secAccessionFromUrl(item.canonicalUrl) !== accession) return false;
      try { return /-index\.htm$/i.test(new URL(item.canonicalUrl).pathname); } catch { return false; }
    });
  }
}
