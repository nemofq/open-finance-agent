import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { SourceRequest } from "@/lib/data/source-snapshot";
import type { CompanyFacts, FactEntry } from "@/lib/providers/edgar/xbrl/metrics";

/**
 * The compiled offline dataset: its record types, its integrity error, and loading it from disk.
 * Every table is global; a task sees it through `CanonicalTaskView`, which applies the cutoff.
 */

export const MOCK_MCP_FORMAT_VERSION = "mock-mcp-v5";

export interface CanonicalCompany {
  ticker: string;
  cik?: string;
  name: string;
  aliases: string[];
  taskIds: string[];
  sourceHash?: string;
  provenance?: "recorded" | "refreshed" | "derived-summary";
  /** Stock splits from the pinned market captures: effective (ex) date and new shares per old share. */
  splits?: CanonicalSplit[];
}

export interface CanonicalSplit {
  date: string;
  ratio: number;
  sourceUrl?: string;
}

export interface CanonicalFiling {
  id: string;
  ticker: string;
  form: string;
  filedAt: string;
  reportDate: string;
  accession: string;
  url: string;
  indexUrl?: string;
  taskIds: string[];
  sourceHash: string;
  provenance?: "recorded" | "refreshed" | "derived-summary";
  availableAt?: string;
  availabilityBasis?: "filed" | "published" | "market_timestamp" | "snapshot";
}

export interface CanonicalFact {
  ticker: string;
  statement?: string;
  metric: string;
  period: string;
  periodType?: "quarterly" | "annual";
  value: number | null;
  unit?: string;
  taxonomy?: string;
  start?: string;
  ref?: string;
  end?: string;
  concept?: string;
  form?: string;
  filedAt?: string;
  accession?: string;
  sourceUrl?: string;
  fiscalQuarter?: string;
  fiscalYear?: number;
  provenance?: "recorded" | "refreshed" | "derived-summary";
  availableAt?: string;
  availabilityBasis?: "filed" | "published" | "market_timestamp" | "snapshot";
  taskIds: string[];
  sourceHash: string;
}

export interface CanonicalMarketRecord {
  symbol: string;
  asOf: string;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  currency?: string;
  sector?: string;
  industry?: string;
  sourceUrl?: string;
  taskIds: string[];
  sourceHash: string;
  provenance?: "recorded" | "refreshed" | "derived-summary";
  availableAt?: string;
  availabilityBasis?: "filed" | "published" | "market_timestamp" | "snapshot";
}

export interface CanonicalDocument {
  id: string;
  canonicalUrl: string;
  urlAliases: string[];
  domain: string;
  title: string;
  publisher: string;
  documentType: string;
  publishedAt: string;
  availableAt: string;
  sourceTier: 1 | 2;
  entities: string[];
  topics: string[];
  aliases: string[];
  body: string;
  passages: string[];
  sourceHash: string;
  provenance: string;
  taskIds: string[];
}

export interface CanonicalAlphaRecord {
  key: string;
  operation: string;
  symbol: string;
  args: Record<string, unknown>;
  value: unknown;
  taskIds: string[];
  sourceHash: string;
  provenance?: "recorded" | "refreshed" | "derived-summary";
  availableAt?: string;
  availabilityBasis?: "filed" | "published" | "market_timestamp" | "snapshot";
}

export interface CanonicalTaskScope {
  taskId: string;
  cutoff: string;
  asOfTime?: string;
  tickers: string[];
  /** Explicitly permitted peer entities for cross-company comparison. */
  peerTickers: string[];
  documentIds: string[];
  filingIds: string[];
  topics: string[];
  aliases: string[];
  hash: string;
  contractHash?: string;
}

export interface CanonicalDatabase {
  version: string;
  coverageContractVersion?: number;
  coverageContractHash?: string;
  companies: CanonicalCompany[];
  filings: CanonicalFiling[];
  financialFacts: CanonicalFact[];
  marketData: CanonicalMarketRecord[];
  documents: CanonicalDocument[];
  alphaRecords: CanonicalAlphaRecord[];
  scopes: Record<string, CanonicalTaskScope>;
}

export class DatasetIntegrityError extends Error {
  readonly request: SourceRequest;

  constructor(request: SourceRequest, message: string) {
    super(`Offline dataset integrity error for ${request.source}/${request.operation}: ${message}`);
    this.name = "DatasetIntegrityError";
    this.request = request;
  }
}

/** Restates per-share and share-count XBRL facts for splits effective on or before the cutoff date. */
export function shareBasisAsOf(company: CanonicalCompany | undefined, row: CanonicalFact, cutoff: string): { value: number; splits: CanonicalSplit[] } {
  const value = row.value ?? Number.NaN;
  const unit = row.unit ?? "";
  const perShare = /\/shares?$/i.test(unit);
  const shareCount = /^shares$/i.test(unit);
  const filed = (row.filedAt ?? row.availableAt ?? "").slice(0, 10);
  if ((!perShare && !shareCount) || !filed || !company?.splits?.length) return { value, splits: [] };
  const splits = company.splits.filter((split) => filed < split.date && split.date <= cutoff);
  const factor = splits.reduce((product, split) => product * split.ratio, 1);
  if (factor === 1) return { value, splits };
  return { value: Number((perShare ? value / factor : value * factor).toPrecision(12)), splits };
}

/** The production companyfacts shape for one issuer's canonical XBRL rows, on the cutoff's share basis. */
export function companyFactsAsOf(company: CanonicalCompany | undefined, ticker: string, rows: CanonicalFact[], cutoff: string): { facts: CompanyFacts; splits: CanonicalSplit[] } {
  const facts: CompanyFacts = { cik: company?.cik ?? "", entityName: company ? `${company.name} (${company.ticker})` : ticker, facts: { "us-gaap": {}, dei: {} } };
  const applied = new Map<string, CanonicalSplit>();
  for (const row of rows) {
    if (row.ticker !== ticker || !row.concept || row.value === null || row.value === undefined) continue;
    const taxonomy = row.taxonomy ?? (row.concept === "EntityCommonStockSharesOutstanding" ? "dei" : "us-gaap");
    const concepts = facts.facts[taxonomy] ?? (facts.facts[taxonomy] = {});
    const concept = concepts[row.concept] ?? (concepts[row.concept] = { units: {} });
    const unit = row.unit ?? "USD";
    const entries = concept.units[unit] ?? (concept.units[unit] = []);
    const basis = shareBasisAsOf(company, row, cutoff);
    for (const split of basis.splits) applied.set(split.date, split);
    const entry: FactEntry = {
      ...(row.start ? { start: row.start } : {}),
      end: row.end ?? row.period,
      val: basis.value,
      accn: row.accession ?? row.ref ?? "",
      ...(row.fiscalYear !== undefined ? { fy: row.fiscalYear } : {}),
      ...(row.fiscalQuarter ? { fp: row.fiscalQuarter } : {}),
      form: row.form ?? "",
      filed: row.filedAt ?? row.availableAt ?? "",
    };
    entries.push(entry);
  }
  return { facts, splits: [...applied.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Read and check a compiled dataset; `evals/offline/dataset.ts` knows where the committed one lives. */
export function loadCanonicalDatabase(file: string): CanonicalDatabase {
  const parsed = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as CanonicalDatabase;
  const arrays = [parsed.companies, parsed.filings, parsed.financialFacts, parsed.marketData, parsed.documents, parsed.alphaRecords];
  if (parsed.version !== MOCK_MCP_FORMAT_VERSION || !parsed.scopes || arrays.some((value) => !Array.isArray(value))) {
    throw new Error(`Unsupported canonical mock MCP database at ${file}`);
  }
  for (const record of [...parsed.filings, ...parsed.financialFacts, ...parsed.marketData]) {
    if (!record.availableAt || !record.availabilityBasis) throw new Error(`Canonical mock MCP database has a record without availability metadata at ${file}`);
  }
  return parsed;
}
