import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { writeFileAtomicSync } from "@/lib/atomic-write";
import { isRecord } from "@/lib/utils";
import { EVIDENCE_CONTRACT, EVIDENCE_CONTRACT_HASH, normalizeSourceUrl } from "../evals/offline/coverage-contract";
import { ALPHA_OPERATIONS } from "../evals/offline/mock-mcp-alphavantage";
import { validateDatasetTasks } from "../evals/offline/dataset";
import { type CanonicalAlphaRecord, type CanonicalCompany, type CanonicalDocument, type CanonicalFiling, type CanonicalSplit, loadCanonicalDatabase, MOCK_MCP_FORMAT_VERSION } from "../evals/offline/mock-mcp-data";
import type { TaskCapture } from "../evals/harness/capture";
import { atOrBeforeCutoff, canonicalRecordVisible, dateOnly, domainOf } from "../evals/offline/mock-mcp-view";
import { RETAIL_EVAL_TASKS } from "../evals/tasks";
import type { EvalTask } from "../evals/types";

/*
 * Maintainer-only. Compiles the offline dataset from the maintainer's capture backup (the files
 * `--fixtures record` writes, see evals/harness/capture.ts) and the pinned source materials. Every per-task
 * fact it needs (cutoff, intraday time, peer tickers, search topics, hand-captured sources) comes
 * from the task definitions in evals/tasks.ts:
 *
 *   npx tsx scripts/compile-offline-dataset.ts --source <capture backup>
 *
 * The records it writes and the captures it reads use the types their readers declare, so tsc
 * holds the writer to them. Pinned sources and older capture entries are JSON written by providers,
 * so their shapes below are what the compiler reads, cast at the parse; every field is checked or
 * coerced where it is used.
 */

type JsonObject = Record<string, unknown>;

/** One tool-level recording in an older capture. */
interface CaptureEntry {
  tool: string;
  args?: JsonObject;
  recordedAt?: string;
  result?: {
    content?: { text?: unknown }[];
    details?: {
      entity?: { ticker?: string; name?: string; cik?: string | number };
      table?: { rows?: unknown[][] };
      facts?: JsonObject[];
      statement?: unknown;
    };
  };
}

/** A capture as `--fixtures record` writes it; older ones also carry tool-level entries. */
type CaptureFile = Omit<TaskCapture, "entries"> & { entries: Record<string, CaptureEntry> };

interface FactDefinition {
  metric: string;
  statement: string;
  concepts: string[];
  unit?: string;
  namespace?: string;
}

/** What the availability rules read from any dated record. */
interface DatedRecord {
  taskIds: string[];
  provenance: string;
  sourceHash: string;
  availableAt?: string;
  availabilityBasis?: string;
  filedAt?: string;
  asOf?: string;
}

interface FilingInput {
  url?: unknown;
  accession?: unknown;
  filed?: unknown;
  filedAt?: unknown;
  ticker?: unknown;
  form?: unknown;
  reportDate?: unknown;
  period?: unknown;
  indexUrl?: unknown;
}

/** A statement fact, either as a tool reported it or as compiled from raw companyfacts. */
interface FactRecord extends DatedRecord {
  [field: string]: unknown;
}

/** A quote, a pinned daily bar or a profile row; profiles carry their provider fields as they are. */
interface MarketRecord extends DatedRecord {
  [field: string]: unknown;
  symbol: string;
  asOf: string;
  price?: number;
}

interface DocumentInput {
  url?: unknown;
  title?: unknown;
  publisher?: unknown;
  documentType?: string;
  body?: string;
  content?: unknown;
  summary?: unknown;
  publishedAt?: string;
  availableAt?: string;
  sourceTier?: 1 | 2;
  entities?: unknown[];
  topics?: unknown[];
  aliases?: unknown[];
  provenance?: string;
}

type TaskScope = ReturnType<typeof taskScopeSeed> & { hash?: string };

interface CompilerWarning {
  taskId: string;
  operation: string;
  symbol: unknown;
  reason: string;
}

/** A pinned source in one of the source-materials manifests. */
interface PinnedSource {
  file: string;
  sha256: string;
  url?: string;
  symbol: string;
  operation: string;
  args?: JsonObject;
}

interface SupplementalSource extends DocumentInput {
  id: string;
  taskId: string;
  rawFile: string;
  rawSha256: string;
  bodyFile: string;
  bodySha256: string;
  verificationFiles?: { file: string; sha256: string }[];
  filing?: FilingInput & { ticker: string; companyName?: string; cik?: string | number };
}

interface ChartSplit {
  numerator?: unknown;
  denominator?: unknown;
  date: number;
}

interface ChartQuote {
  close?: unknown[];
  open?: unknown[];
  high?: unknown[];
  low?: unknown[];
  volume?: unknown[];
}

// A deliberately small standard XBRL vocabulary.  The recordings contain
// complete raw companyfacts JSON; compiling these concepts means the canonical
// DB is not limited to whichever statements a previous agent happened to ask
// for.  Values remain one-source records, never fused task answers.
const FACT_DEFINITIONS: FactDefinition[] = [
  { metric: "revenue", statement: "income", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"] },
  { metric: "cost_of_revenue", statement: "income", concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"] },
  { metric: "gross_profit", statement: "income", concepts: ["GrossProfit"] },
  { metric: "operating_income", statement: "income", concepts: ["OperatingIncomeLoss"] },
  { metric: "net_income", statement: "income", concepts: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] },
  { metric: "eps", statement: "income", concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"], unit: "USD/shares" },
  { metric: "diluted_shares", statement: "income", concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstandingBasicAndDiluted"], unit: "shares" },
  { metric: "assets", statement: "balance", concepts: ["Assets"] },
  { metric: "liabilities", statement: "balance", concepts: ["Liabilities"] },
  { metric: "stockholders_equity", statement: "balance", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { metric: "cash", statement: "balance", concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  { metric: "inventory", statement: "balance", concepts: ["InventoryNet"] },
  { metric: "accounts_receivable", statement: "balance", concepts: ["AccountsReceivableNetCurrent"] },
  { metric: "long_term_debt", statement: "balance", concepts: ["LongTermDebtNoncurrent", "LongTermDebtCurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"] },
  { metric: "operating_cash_flow", statement: "cashflow", concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { metric: "capital_expenditures", statement: "cashflow", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { metric: "shares_outstanding", statement: "key_metrics", concepts: ["EntityCommonStockSharesOutstanding"], namespace: "dei" },
  { metric: "revenue", statement: "income", concepts: ["RevenueFromContractsWithCustomers"], namespace: "ifrs-full" },
  { metric: "cost_of_revenue", statement: "income", concepts: ["CostOfSales"], namespace: "ifrs-full" },
  { metric: "gross_profit", statement: "income", concepts: ["GrossProfit"], namespace: "ifrs-full" },
  { metric: "operating_income", statement: "income", concepts: ["ProfitLossFromOperatingActivities"], namespace: "ifrs-full" },
  { metric: "net_income", statement: "income", concepts: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"], namespace: "ifrs-full" },
  { metric: "assets", statement: "balance", concepts: ["Assets"], namespace: "ifrs-full" },
  { metric: "liabilities", statement: "balance", concepts: ["Liabilities"], namespace: "ifrs-full" },
  { metric: "stockholders_equity", statement: "balance", concepts: ["Equity"], namespace: "ifrs-full" },
  { metric: "cash", statement: "balance", concepts: ["CashAndCashEquivalents"], namespace: "ifrs-full" },
  { metric: "operating_cash_flow", statement: "cashflow", concepts: ["CashFlowsFromUsedInOperatingActivities"], namespace: "ifrs-full" },
  { metric: "capital_expenditures", statement: "cashflow", concepts: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], namespace: "ifrs-full" },
];

const HISTORICAL_MARKET_MANIFEST = path.resolve("evals/source-materials/market-2024/manifest.json");
const HISTORICAL_EARNINGS_MANIFEST = path.resolve("evals/source-materials/alpha-2024/manifest.json");

/**
 * The scope a task starts from before any capture is read: its cutoff and what its definition
 * declares. Compiling then adds the tickers, filings and documents the captures show.
 */
export function taskScopeSeed(task: EvalTask, contractHash: string = EVIDENCE_CONTRACT_HASH) {
  return {
    taskId: task.id,
    cutoff: task.asOfDate,
    asOfTime: task.asOfTime,
    contractHash,
    tickers: [] as string[],
    peerTickers: [...task.dataset.peerTickers],
    documentIds: [] as string[],
    filingIds: [] as string[],
    topics: [...task.dataset.searchTopics],
    aliases: [...task.dataset.searchTopics],
  };
}

/** The hand-captured source manifests the tasks declare, in task order. */
export function sourceMaterialManifests(tasks: EvalTask[], root: string = path.resolve("evals/source-materials")): { taskId: string; file: string }[] {
  return tasks
    .filter((task) => task.dataset.sourceMaterials)
    .map((task) => ({ taskId: task.id, file: path.join(root, task.dataset.sourceMaterials as string, "manifest.json") }));
}

const textOf = (entry: CaptureEntry): string => {
  const block = entry?.result?.content?.[0];
  return block && typeof block.text === "string" ? block.text : "";
};
// A capture's text that is not a URL keeps its own fallback: without NFKC, unlike the mock's.
const cleanUrl = (value: unknown): string => {
  try {
    return normalizeSourceUrl(String(value));
  } catch {
    return String(value ?? "").trim().replace(/\/$/, "").toLowerCase();
  }
};
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const truncate = (value: unknown, limit = 15000): string => {
  const text = String(value ?? "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}\n\n[truncated]`;
};

const FUTURE_DATE_FIELDS = new Set([
  "date", "fiscalDateEnding", "reportedDate", "time_published", "latestTradingDay", "latest trading day",
  "07. latest trading day", "3. Last Refreshed", "lastRefreshed",
]);

function pruneFuture(value: unknown, cutoff: string, asOfTime?: string, key = ""): unknown {
  if (typeof value === "string") {
    if (FUTURE_DATE_FIELDS.has(key) && /^\d{4}-\d{2}-\d{2}/.test(value) && !atOrBeforeCutoff(value, cutoff, asOfTime)) return undefined;
    const embeddedDate = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (embeddedDate && embeddedDate[0] > cutoff && !value.trim().startsWith("{")) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => pruneFuture(item, cutoff, asOfTime)).filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return value;
  const output: JsonObject = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (/^\d{4}-\d{2}-\d{2}/.test(childKey) && !atOrBeforeCutoff(childKey, cutoff, asOfTime)) continue;
    const cleaned = pruneFuture(child, cutoff, asOfTime, childKey);
    if (cleaned !== undefined) output[childKey] = cleaned;
  }
  if (Array.isArray(output.feed)) output.items = String(output.feed.length);
  return output;
}

/** The same value with every object's keys sorted, so the compiled file is byte-stable. */
function stable<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stable) as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) as T;
  return value;
}

function addUnique<T>(list: T[], item: T, key: (value: T) => string = JSON.stringify): void {
  const signature = key(item);
  if (!list.some((existing) => key(existing) === signature)) list.push(item);
}

const companies: CanonicalCompany[] = [];
const filings: CanonicalFiling[] = [];
const financialFacts: FactRecord[] = [];
const marketData: MarketRecord[] = [];
const documents: CanonicalDocument[] = [];
const alphaRecords: CanonicalAlphaRecord[] = [];
const scopes: Record<string, TaskScope> = {};
const compilerWarnings: CompilerWarning[] = [];
const companyByTicker = new Map<string, CanonicalCompany>();
const filingByUrl = new Map<string, CanonicalFiling>();
const documentByUrl = new Map<string, CanonicalDocument>();

function addCompany(ticker: unknown, name: unknown, cik: unknown, taskId: string): void {
  const symbol = String(ticker ?? "").trim().toUpperCase();
  if (!symbol) return;
  const existing = companyByTicker.get(symbol);
  if (existing) {
    if (cik && !existing.cik) existing.cik = String(cik).replace(/^0+/, "");
    if (name && existing.name === symbol) existing.name = String(name);
    existing.aliases = [...new Set([...existing.aliases, symbol, String(name || symbol)])];
    existing.sourceHash = hash({ ticker: existing.ticker, cik: existing.cik, name: existing.name, aliases: existing.aliases });
    existing.provenance = existing.provenance || "recorded";
    addUnique(existing.taskIds, taskId);
    return;
  }
  const item: CanonicalCompany = { ticker: symbol, cik: cik ? String(cik).replace(/^0+/, "") : undefined, name: String(name || symbol), aliases: [symbol, String(name || symbol)], taskIds: [taskId], provenance: "recorded", sourceHash: hash({ ticker: symbol, cik, name: String(name || symbol) }) };
  companyByTicker.set(symbol, item);
  companies.push(item);
}

function addFiling(item: FilingInput, taskId: string, cutoff: string, asOfTime?: string): CanonicalFiling | undefined {
  if (!item?.url || !item?.accession) return;
  const filedAt = dateOnly(item.filed || item.filedAt);
  if (!atOrBeforeCutoff(filedAt, cutoff, asOfTime)) return;
  const url = cleanUrl(item.url);
  const existing = filingByUrl.get(url);
  if (existing) {
    addUnique(existing.taskIds, taskId);
    return existing;
  }
  const filing: CanonicalFiling = {
    id: String(item.accession),
    ticker: String(item.ticker || "").toUpperCase(),
    form: String(item.form || ""),
    filedAt,
    reportDate: dateOnly(item.reportDate || item.period),
    accession: String(item.accession),
    url,
    indexUrl: item.indexUrl ? cleanUrl(item.indexUrl) : undefined,
    taskIds: [taskId],
    provenance: "recorded",
    availableAt: filedAt,
    availabilityBasis: "filed",
    sourceHash: hash(item),
  };
  filingByUrl.set(url, filing);
  filings.push(filing);
  return filing;
}

function addDocument(item: DocumentInput, taskId: string): CanonicalDocument | undefined {
  if (!item?.url) return;
  const url = cleanUrl(item.url);
  if (!url) return;
  const existing = documentByUrl.get(url);
  if (existing) {
    addUnique(existing.taskIds, taskId);
    if (item.body && item.body.length > existing.body.length) existing.body = item.body;
    if (item.publishedAt && (!existing.publishedAt || item.publishedAt < existing.publishedAt)) existing.publishedAt = item.publishedAt;
    // A document is available from the earliest moment any task saw it; a later task's as-of
    // must not push a shared document past an earlier task's cutoff.
    if (item.availableAt && (!existing.availableAt || item.availableAt < existing.availableAt)) existing.availableAt = item.availableAt;
    return existing;
  }
  const body = truncate(item.body || item.content || item.summary || "");
  if (!body) return;
  const document: CanonicalDocument = {
    id: `doc-${documents.length + 1}`,
    canonicalUrl: url,
    urlAliases: [url],
    domain: domainOf(url),
    title: String(item.title || url),
    publisher: String(item.publisher || domainOf(url)),
    documentType: item.documentType || (url.includes("sec.gov") ? "regulatory" : "news"),
    publishedAt: dateOnly(item.publishedAt || item.availableAt || ""),
    availableAt: item.availableAt || item.publishedAt || "",
    sourceTier: item.sourceTier || (url.includes("sec.gov") || url.includes(".gov") || item.documentType === "company_release" ? 1 : 2),
    entities: [...new Set((item.entities || []).map((value) => String(value).toUpperCase()))],
    topics: [...new Set((item.topics || []).map(String))],
    aliases: [...new Set((item.aliases || []).map(String))],
    body,
    passages: body.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 80),
    sourceHash: hash({ url, body, publishedAt: item.publishedAt, availableAt: item.availableAt }),
    provenance: item.provenance || "recorded",
    taskIds: [taskId],
  };
  documentByUrl.set(url, document);
  documents.push(document);
  return document;
}

function readPinnedSourceFile(root: string, file: string, expectedSha256: string): string {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Supplemental source path escapes its source directory: ${file}`);
  const content = readFileSync(resolved);
  const actualSha256 = sha256(content);
  if (actualSha256 !== expectedSha256) throw new Error(`Supplemental source checksum mismatch for ${file}: expected ${expectedSha256}, got ${actualSha256}`);
  return content.toString("utf8");
}

function addQuote(symbol: unknown, value: unknown, taskId: string, cutoff: string, asOfTime?: string, sourceUrl?: string): void {
  if (!symbol || !isRecord(value)) return;
  const ticker = String(symbol).trim().toUpperCase();
  const price = Number(value.price ?? value.regularMarketPrice ?? value["05. price"] ?? value["4. close"]);
  if (!Number.isFinite(price) || price <= 0) return;
  const timestamp = String(value.asOf || value.date || value["07. latest trading day"] || cutoff || "");
  if (!atOrBeforeCutoff(timestamp, cutoff, asOfTime)) return;
  const record: MarketRecord = {
    symbol: ticker,
    asOf: timestamp,
    price,
    previousClose: Number(value.previousClose ?? value.regularMarketPreviousClose ?? value["08. previous close"] ?? price),
    change: Number(value.change ?? value.regularMarketChange ?? value["09. change"] ?? 0),
    changePercent: Number(value.changePercent ?? value.regularMarketChangePercent ?? String(value["10. change percent"] ?? "0").replace(/%$/, "")),
    currency: String(value.currency || "USD").toUpperCase(),
    sector: value.sector,
    industry: value.industry,
    sourceUrl: sourceUrl || value.sourceUrl,
    taskIds: [taskId],
    provenance: "recorded",
    availableAt: timestamp,
    availabilityBasis: "market_timestamp",
    sourceHash: hash(value),
  };
  const existing = marketData.find((item) => item.symbol === ticker && item.asOf === timestamp);
  if (existing) {
    addUnique(existing.taskIds, taskId);
    if (existing.price === undefined) Object.assign(existing, record);
    return;
  }
  marketData.push(record);
}

function alphaDate(value: unknown): string {
  const text = String(value || "");
  const iso = text.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

function addAlpha(operation: string, args: JsonObject, value: unknown, taskId: string, cutoff: string, asOfTime?: string, recordedAt?: string): void {
  if (!ALPHA_OPERATIONS.includes(operation) || value === undefined) return;
  const symbol = String(args?.symbol || args?.keywords || args?.tickers || "").toUpperCase();
  const key = `${taskId}:${operation}:${symbol}:${hash(args)}`;
  if (alphaRecords.some((item) => item.key === key)) return;
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch (error) {
      throw new Error(`Captured Alpha Vantage ${operation} response for ${symbol || "unknown symbol"} is not valid JSON`, { cause: error });
    }
  }
  if (!isRecord(parsed)) return;

  let cleaned: unknown;
  let availableAt: string | undefined;
  let availabilityBasis: NonNullable<CanonicalAlphaRecord["availabilityBasis"]> = "snapshot";
  if (operation === "TIME_SERIES_DAILY") {
    const field = Object.keys(parsed).find((candidate) => candidate.startsWith("Time Series (Daily)"));
    const series = field && isRecord(parsed[field]) ? parsed[field] : undefined;
    if (!series) return;
    const rows = Object.fromEntries(Object.entries(series).filter(([date]) => atOrBeforeCutoff(alphaDate(date), cutoff, asOfTime)));
    if (!Object.keys(rows).length) return;
    const dates = Object.keys(rows).map(alphaDate).sort();
    cleaned = pruneFuture({ ...parsed, [field as string]: rows }, cutoff, asOfTime);
    availableAt = dates.at(-1);
    availabilityBasis = "market_timestamp";
  } else if (operation === "EARNINGS") {
    const visibleEntries = (entries: unknown): JsonObject[] => (Array.isArray(entries) ? entries : []).filter((entry): entry is JsonObject => {
      if (!isRecord(entry)) return false;
      const periodEnd = alphaDate(entry.fiscalDateEnding);
      const reported = alphaDate(entry.reportedDate);
      return Boolean(periodEnd && reported && periodEnd <= cutoff && atOrBeforeCutoff(reported, cutoff, asOfTime));
    });
    const annualEarnings = visibleEntries(parsed.annualEarnings);
    const quarterlyEarnings = visibleEntries(parsed.quarterlyEarnings);
    const reportedDates = [...annualEarnings, ...quarterlyEarnings].map((entry) => alphaDate(entry.reportedDate)).sort();
    if (!reportedDates.length) return;
    cleaned = { ...parsed, annualEarnings, quarterlyEarnings };
    availableAt = reportedDates.at(-1);
    availabilityBasis = "published";
  } else if (operation === "NEWS_SENTIMENT") {
    const feed = (Array.isArray(parsed.feed) ? parsed.feed : []).filter((item): item is JsonObject => {
      if (!isRecord(item) || typeof item.url !== "string") return false;
      const date = alphaDate(item.time_published);
      return Boolean(date && atOrBeforeCutoff(date, cutoff, asOfTime) && /^https:\/\//.test(item.url));
    });
    const timeTo = alphaDate(args?.time_to || cutoff);
    if (timeTo > cutoff) return;
    cleaned = { ...parsed, feed, items: String(feed.length) };
    availableAt = feed.map((item) => alphaDate(item.time_published)).sort().at(-1) ?? timeTo;
    availabilityBasis = "published";
  } else {
    // Latest-state endpoints have no historical field. Keep them only when the
    // captured response itself predates the task cutoff.
    const captured = alphaDate(recordedAt);
    if (!captured || !atOrBeforeCutoff(captured, cutoff, asOfTime)) return;
    cleaned = parsed;
    availableAt = captured;
  }
  if (!cleaned || !availableAt) return;
  alphaRecords.push({ key, operation, symbol, args, value: cleaned, taskIds: [taskId], provenance: "recorded", availableAt, availabilityBasis, sourceHash: hash(cleaned) });
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

function addRawCompanyFacts(rawValue: unknown, ticker: string, taskId: string, cutoff: string, asOfTime?: string, sourceUrl?: unknown): void {
  const raw = parsedJson(rawValue);
  if (!isRecord(raw) || !isRecord(raw.facts) || !ticker) return;
  for (const definition of FACT_DEFINITIONS) {
    const concepts = raw.facts[definition.namespace || "us-gaap"];
    if (!isRecord(concepts)) continue;
    for (const conceptName of definition.concepts) {
      const concept = concepts[conceptName];
      if (!isRecord(concept) || !isRecord(concept.units)) continue;
      for (const [unit, unitFacts] of Object.entries(concept.units)) {
        if (!Array.isArray(unitFacts)) continue;
        for (const item of unitFacts) {
          if (!isRecord(item) || typeof item.end !== "string" || !Number.isFinite(Number(item.val))) continue;
          const filedAt = dateOnly(item.filed || item.end);
          if (!atOrBeforeCutoff(filedAt, cutoff, asOfTime)) continue;
          const start = typeof item.start === "string" ? item.start : undefined;
          const durationDays = start ? (Date.parse(item.end) - Date.parse(start)) / 86_400_000 : 0;
          const record: FactRecord = {
            ticker,
            statement: definition.statement,
            metric: definition.metric,
            taxonomy: definition.namespace || "us-gaap",
            concept: conceptName,
            period: item.end,
            ...(start ? { start } : {}),
            end: item.end,
            value: Number(item.val),
            unit: definition.unit || unit,
            form: String(item.form || ""),
            periodType: durationDays >= 300 ? "annual" : "quarterly",
            ref: item.accn,
            accession: item.accn,
            filedAt,
            fiscalQuarter: item.fp,
            fiscalYear: item.fy,
            sourceUrl,
            taskIds: [taskId],
            provenance: "recorded",
            availableAt: filedAt,
            availabilityBasis: "filed",
            sourceHash: hash({ sourceUrl, conceptName, item }),
          };
          addUnique(financialFacts, record, (value) => `${value.ticker}:${value.concept}:${value.start || "instant"}:${value.end}:${value.ref}:${value.unit}`);
        }
      }
    }
  }
}

function compile(tasks: EvalTask[], source: string, output: string): void {
  const taskIds = tasks.map((task) => task.id);
  const taskFiles = readdirSync(source)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(source, file))
    .filter((file) => taskIds.includes(path.basename(file, ".json")))
    .sort();

  if (taskFiles.length !== taskIds.length) {
    const found = new Set(taskFiles.map((file) => path.basename(file, ".json")));
    throw new Error(`Expected ${taskIds.length} task captures; missing ${taskIds.filter((id) => !found.has(id)).join(", ")}`);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  for (const file of taskFiles) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CaptureFile;
    const task = taskById.get(path.basename(file, ".json")) as EvalTask;
    // The capture and the definition must describe the same task at the same cutoff.
    if (parsed.taskId !== task.id || parsed.asOf !== task.asOfDate) {
      throw new Error(`${file} captures ${parsed.taskId} as of ${parsed.asOf}; the task definition is ${task.id} as of ${task.asOfDate}`);
    }
    const scope = taskScopeSeed(task);
    const taskId = scope.taskId;
    const asOf = scope.cutoff;
    scopes[taskId] = scope;
    const entries = Object.values(parsed.entries || {});
    const entityByCik = new Map<string, NonNullable<NonNullable<CaptureEntry["result"]>["details"]>["entity"]>();
    for (const entry of entries) {
      const entryEntity = entry.result?.details?.entity;
      if (entryEntity?.cik) entityByCik.set(String(entryEntity.cik).replace(/^0+/, ""), entryEntity);
    }
    const futureFilingUrls = new Set<string>();
    for (const entry of entries) {
      if (entry.tool !== "edgar_filings" || !Array.isArray(entry.result?.details?.table?.rows)) continue;
      for (const row of entry.result.details.table.rows) {
        const [, filed, , , url] = row;
        if (url && !atOrBeforeCutoff(dateOnly(filed), asOf, scope.asOfTime)) futureFilingUrls.add(cleanUrl(url));
      }
    }

    for (const entry of entries) {
      const tool = entry.tool;
      const argsForTool = entry.args || {};
      const details = entry.result?.details || {};
      const entity = details.entity;
      if (entity?.ticker) addCompany(entity.ticker, entity.name, entity.cik, taskId);
      for (const ticker of [argsForTool.ticker, argsForTool.symbol, ...(Array.isArray(argsForTool.symbols) ? argsForTool.symbols : [])]) {
        if (ticker) addCompany(ticker, ticker, undefined, taskId);
      }
      if (tool === "edgar_filings" && Array.isArray(details.table?.rows)) {
        for (const row of details.table.rows) {
          const [form, filed, reportDate, accession, url] = row;
          const filing = addFiling({ ticker: entity?.ticker || argsForTool.ticker, form, filed, reportDate, accession, url }, taskId, asOf, scope.asOfTime);
          if (filing) addUnique(scope.filingIds, filing.id);
        }
      }
      if (tool === "edgar_financials" && Array.isArray(details.facts)) {
        for (const fact of details.facts) {
          const factDate = dateOnly(fact.period || fact.end);
          if (!factDate || !atOrBeforeCutoff(factDate, asOf, scope.asOfTime)) continue;
          const record: FactRecord = { ...fact, ticker: entity?.ticker || argsForTool.ticker, statement: details.statement, taskIds: [taskId], provenance: "recorded", availableAt: (fact.filedAt || asOf) as string, availabilityBasis: fact.filedAt ? "filed" : "snapshot", sourceHash: hash(fact) };
          addUnique(financialFacts, record, (value) => `${value.ticker}:${value.statement}:${value.metric}:${value.period}:${value.ref}:${value.value}`);
        }
      }
      if (tool === "edgar_read_filing") {
        if (futureFilingUrls.has(cleanUrl(argsForTool.url))) continue;
        const doc = addDocument({ url: argsForTool.url, title: argsForTool.url, publisher: "SEC EDGAR", documentType: "regulatory", body: textOf(entry), publishedAt: asOf, availableAt: asOf, sourceTier: 1, provenance: "recorded" }, taskId);
        if (doc) addUnique(scope.documentIds, doc.id);
      }
      if (tool.startsWith("alphavantage__")) {
        const operation = tool.slice("alphavantage__".length);
        let value: unknown = textOf(entry);
        try { value = JSON.parse(value as string); } catch (error) {
          compilerWarnings.push({ taskId, operation, symbol: argsForTool.symbol || argsForTool.tickers || "", reason: `captured tool text is not a parseable provider JSON payload (${(error as Error).message})` });
          continue;
        }
        addAlpha(operation, argsForTool, value, taskId, asOf, scope.asOfTime, entry.recordedAt);
        if (operation === "GLOBAL_QUOTE" && isRecord((value as JsonObject | undefined)?.["Global Quote"])) addQuote(argsForTool.symbol, (value as JsonObject)["Global Quote"], taskId, asOf, scope.asOfTime);
      }
    }

    for (const resource of Object.values(parsed.resources || {})) {
      const request = resource.request || {};
      const value = resource.value;
      if (request.source === "edgar" && request.operation === "tickers") {
        const tickerRows = parsedJson(value);
        if (isRecord(tickerRows)) {
          for (const row of Object.values(tickerRows)) {
            if (!isRecord(row) || !row.ticker || !scope.peerTickers.includes(String(row.ticker).toUpperCase())) continue;
            addCompany(row.ticker, row.title, row.cik_str, taskId);
          }
        }
      }
      if (request.source === "edgar" && request.operation === "companyfacts") {
        const raw = parsedJson(value);
        const cikFromUrl = String(request.args?.url || "").match(/CIK(\d+)\.json/i)?.[1]?.replace(/^0+/, "");
        const rawCik = (raw as JsonObject | undefined)?.cik ? String((raw as JsonObject).cik).replace(/^0+/, "") : cikFromUrl;
        const entity = rawCik ? entityByCik.get(rawCik) : undefined;
        const fallbackCompany = rawCik ? companies.find((item) => item.cik === rawCik && item.taskIds.includes(taskId)) : undefined;
        const ticker = entity?.ticker || fallbackCompany?.ticker;
        if (ticker) addRawCompanyFacts(value, ticker, taskId, asOf, scope.asOfTime, request.args?.url);
      }
      if (request.source === "yahoo-finance" && request.operation === "quotes" && isRecord(value)) {
        for (const [symbol, quote] of Object.entries(value)) {
          addQuote(symbol, quote, taskId, asOf, scope.asOfTime);
          addUnique(scope.tickers, String(symbol).toUpperCase());
        }
      }
      if (request.source === "yahoo-finance" && request.operation === "profiles" && isRecord(value)) {
        const profileCaptureDate = dateOnly(resource.recordedAt);
        if (!profileCaptureDate || !atOrBeforeCutoff(profileCaptureDate, asOf, scope.asOfTime)) continue;
        for (const [symbol, profile] of Object.entries(value)) {
          if (isRecord(profile)) {
            addCompany(symbol, profile.name || symbol, undefined, taskId);
            // A Yahoo profile is a first-class production response even when the
            // recording did not include a quote for the same symbol.  Keep a
            // separate date-pinned profile row: merging it into a live quote would
            // make the profile disappear under the task's historical cutoff.
            marketData.push({
              symbol: String(symbol).toUpperCase(),
              asOf,
              ...profile,
              taskIds: [taskId],
              provenance: "recorded",
              availableAt: asOf,
              availabilityBasis: "market_timestamp",
              sourceHash: hash(profile),
            });
          }
          addUnique(scope.tickers, String(symbol).toUpperCase());
        }
      }
      if (request.source === "mcp:alphavantage" && ALPHA_OPERATIONS.includes(request.operation as string)) {
        addAlpha(request.operation as string, request.args || {}, value, taskId, asOf, scope.asOfTime, resource.recordedAt);
        if (request.operation === "GLOBAL_QUOTE" && isRecord((value as JsonObject | undefined)?.["Global Quote"])) addQuote(request.args?.symbol, (value as JsonObject)["Global Quote"], taskId, asOf, scope.asOfTime);
        if (request.operation === "TIME_SERIES_DAILY" && isRecord(value)) {
          const series = value["Time Series (Daily)"] || value["Time Series (Daily Adjusted)"];
          if (isRecord(series)) for (const [date, row] of Object.entries(series)) if (isRecord(row)) addQuote(request.args?.symbol, { ...row, price: row["4. close"], asOf: date }, taskId, asOf, scope.asOfTime);
        }
      }
      if (request.source === "tavily" && request.operation === "search" && isRecord(value)) {
        for (const hit of Array.isArray(value.results) ? value.results : []) {
          if (!isRecord(hit) || typeof hit.url !== "string") continue;
          const publishedAt = dateOnly(hit.publishedDate);
          if (!publishedAt || publishedAt > asOf) continue;
          const body = typeof hit.rawContent === "string" && hit.rawContent.trim() ? hit.rawContent : hit.content;
          const doc = addDocument({
            url: hit.url,
            title: hit.title,
            publisher: domainOf(hit.url),
            documentType: "news",
            body: body as string,
            publishedAt,
            availableAt: publishedAt,
            entities: scope.tickers,
            topics: scope.topics,
            aliases: scope.aliases,
            sourceTier: ["sec.gov", "nvidianews.nvidia.com", "about.nike.com", "constellationenergy.com", "intc.com", "apple.com", "yieldmaxetfs.com"].some((domain) => domainOf(hit.url).endsWith(domain)) ? 1 : 2,
            provenance: "recorded",
          }, taskId);
          if (doc) addUnique(scope.documentIds, doc.id);
        }
      }
      if (request.source === "tavily" && request.operation === "extract" && isRecord(value)) {
        for (const page of Array.isArray(value.results) ? value.results : []) {
          if (!isRecord(page) || typeof page.url !== "string") continue;
          const doc = addDocument({ url: page.url, title: page.title, publisher: domainOf(page.url), documentType: "news", body: page.rawContent as string, publishedAt: asOf, availableAt: asOf, entities: scope.tickers, topics: scope.topics, aliases: scope.aliases, sourceTier: 2, provenance: "recorded" }, taskId);
          if (doc) addUnique(scope.documentIds, doc.id);
        }
    }
  }

    for (const profile of marketData.filter((item) => item.taskIds.includes(taskId) && item.price === undefined)) {
      const quote = marketData.find((item) => item.taskIds.includes(taskId) && item.symbol === profile.symbol && item.asOf === profile.asOf && item.price !== undefined);
      if (quote) Object.assign(quote, { sector: profile.sector, industry: profile.industry, name: profile.name });
    }

    for (const item of companies) if (item.taskIds.includes(taskId)) addUnique(scope.tickers, item.ticker);
    for (const item of filings) if (item.taskIds.includes(taskId)) addUnique(scope.filingIds, item.id);
  }

  const marketManifest = JSON.parse(readFileSync(HISTORICAL_MARKET_MANIFEST, "utf8")) as { version?: unknown; kind?: unknown; sources: (PinnedSource & { url: string })[] };
  if (marketManifest.version !== 1 || marketManifest.kind !== "yahoo_chart") throw new Error("Unsupported historical market manifest");
  const marketRoot = path.dirname(HISTORICAL_MARKET_MANIFEST);
  const latestCutoff = Object.values(scopes).map((scope) => scope.cutoff).sort().at(-1) as string;
  const marketBySymbolAndDate = new Map(marketData.map((record) => [`${record.symbol}:${record.asOf}`, record]));
  const rounded = (value: number): number => Number(value.toFixed(6));
  const splitsBySymbol = new Map<string, CanonicalSplit[]>();
  for (const sourceRecord of marketManifest.sources) {
    const raw = readPinnedSourceFile(marketRoot, sourceRecord.file, sourceRecord.sha256);
    const chart = JSON.parse(raw)?.chart?.result?.[0];
    if (chart?.meta?.symbol !== sourceRecord.symbol || !Array.isArray(chart.timestamp) || !isRecord(chart.indicators?.quote?.[0])) {
      throw new Error(`Invalid historical chart capture for ${sourceRecord.symbol}`);
    }
    const quote = chart.indicators.quote[0] as ChartQuote;
    const splits = (Object.values(chart.events?.splits || {}) as ChartSplit[]).map((split) => {
      const ratio = Number(split.numerator) / Number(split.denominator);
      if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(split.date)) throw new Error(`Invalid split in ${sourceRecord.file}`);
      return { timestamp: split.date, ratio };
    });
    if (splits.length > 0) {
      splitsBySymbol.set(sourceRecord.symbol, splits
        .map((split) => ({ date: new Date(split.timestamp * 1000).toISOString().slice(0, 10), ratio: split.ratio, sourceUrl: sourceRecord.url }))
        .sort((a, b) => a.date.localeCompare(b.date)));
    }
    let previousBar: { timestamp: number; price: number } | undefined;
    for (let index = 0; index < chart.timestamp.length; index++) {
      const timestamp = chart.timestamp[index] as number;
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      if (date < "2024-01-01" || date > latestCutoff) continue;
      const close = Number(quote.close?.[index]);
      const open = Number(quote.open?.[index]);
      const high = Number(quote.high?.[index]);
      const low = Number(quote.low?.[index]);
      const volume = Number(quote.volume?.[index]);
      if (![close, open, high, low, volume].every(Number.isFinite) || close <= 0 || open <= 0 || high <= 0 || low <= 0 || volume < 0) continue;
      // Yahoo's chart retroactively adjusts OHLC for later splits. Undo only
      // splits after this bar so the dataset presents the price seen in 2024.
      const futureSplitRatio = splits.filter((split) => split.timestamp > timestamp).reduce((factor, split) => factor * split.ratio, 1);
      const price = rounded(close * futureSplitRatio);
      const sameDaySplitRatio = previousBar
        ? splits.filter((split) => split.timestamp > (previousBar as { timestamp: number }).timestamp && split.timestamp <= timestamp).reduce((factor, split) => factor * split.ratio, 1)
        : 1;
      const previousClose = previousBar ? rounded(previousBar.price / sameDaySplitRatio) : undefined;
      const change = previousClose === undefined ? undefined : rounded(price - previousClose);
      const record: MarketRecord = {
        symbol: sourceRecord.symbol,
        asOf: date,
        price,
        open: rounded(open * futureSplitRatio),
        high: rounded(high * futureSplitRatio),
        low: rounded(low * futureSplitRatio),
        volume: Math.round(volume / futureSplitRatio),
        ...(previousClose === undefined ? {} : { previousClose, change, changePercent: rounded((change as number) / previousClose * 100) }),
        currency: chart.meta.currency || "USD",
        sourceUrl: sourceRecord.url,
        taskIds: [],
        provenance: "refreshed",
        availableAt: date,
        availabilityBasis: "market_timestamp",
        sourceHash: hash({ capture: sourceRecord.sha256, date, price, open, high, low, volume, futureSplitRatio }),
      };
      const key = `${record.symbol}:${record.asOf}`;
      const existing = marketBySymbolAndDate.get(key);
      if (existing) Object.assign(existing, record, { taskIds: existing.taskIds, sector: existing.sector, industry: existing.industry });
      else { marketData.push(record); marketBySymbolAndDate.set(key, record); }
      previousBar = { timestamp, price };
    }
  }

  // Split events from the same pinned charts, recorded on the issuer so the mock can keep an XBRL
  // per-share or share-count series on one share basis at each cutoff (see CanonicalCompany.splits).
  for (const company of companies) {
    const splits = splitsBySymbol.get(company.ticker);
    if (!splits) continue;
    company.splits = splits;
    company.sourceHash = hash({ ticker: company.ticker, cik: company.cik, name: company.name, aliases: company.aliases, splits });
  }

  const earningsManifest = JSON.parse(readFileSync(HISTORICAL_EARNINGS_MANIFEST, "utf8")) as { version?: unknown; kind?: unknown; sources: (PinnedSource & { args: JsonObject })[] };
  if (earningsManifest.version !== 1 || earningsManifest.kind !== "alphavantage") throw new Error("Unsupported historical Alpha Vantage manifest");
  const earningsRoot = path.dirname(HISTORICAL_EARNINGS_MANIFEST);
  for (const sourceRecord of earningsManifest.sources) {
    const raw = readPinnedSourceFile(earningsRoot, sourceRecord.file, sourceRecord.sha256);
    const payload = JSON.parse(raw) as JsonObject;
    if (sourceRecord.operation === "EARNINGS" && (payload.symbol !== sourceRecord.symbol || !Array.isArray(payload.quarterlyEarnings))) {
      throw new Error(`Invalid Alpha Vantage earnings capture for ${sourceRecord.symbol}`);
    }
    if (sourceRecord.operation === "NEWS_SENTIMENT" && !Array.isArray(payload.feed)) {
      throw new Error(`Invalid Alpha Vantage news capture for ${sourceRecord.symbol}`);
    }
    for (const scope of Object.values(scopes)) {
      if (scope.tickers.includes(sourceRecord.symbol) || scope.peerTickers.includes(sourceRecord.symbol)) {
        addAlpha(sourceRecord.operation, sourceRecord.args, payload, scope.taskId, scope.cutoff, scope.asOfTime, "");
      }
    }
  }

  for (const { taskId: owner, file: supplementalSourcesPath } of sourceMaterialManifests(tasks)) {
    const supplementalSourceManifest = JSON.parse(readFileSync(supplementalSourcesPath, "utf8")) as { version?: unknown; cutoff?: unknown; sources?: SupplementalSource[] };
    const supplementalSourceRoot = path.dirname(supplementalSourcesPath);
    if (supplementalSourceManifest.version !== 1) throw new Error(`Unsupported supplemental source manifest version ${supplementalSourceManifest.version}`);
    for (const sourceRecord of supplementalSourceManifest.sources || []) {
      const scope = scopes[sourceRecord.taskId];
      if (!scope) throw new Error(`Supplemental source ${sourceRecord.id} references unknown task ${sourceRecord.taskId}`);
      if (sourceRecord.taskId !== owner) throw new Error(`Supplemental source ${sourceRecord.id} belongs to ${sourceRecord.taskId} but is listed by ${owner}`);
      if (scope.cutoff !== supplementalSourceManifest.cutoff) throw new Error(`Supplemental source manifest cutoff does not match ${sourceRecord.taskId}`);
      const raw = readPinnedSourceFile(supplementalSourceRoot, sourceRecord.rawFile, sourceRecord.rawSha256);
      const body = readPinnedSourceFile(supplementalSourceRoot, sourceRecord.bodyFile, sourceRecord.bodySha256);
      if (!raw.trim() || !body.trim()) throw new Error(`Supplemental source ${sourceRecord.id} has an empty raw capture or extracted body`);
      for (const verificationFile of sourceRecord.verificationFiles || []) {
        readPinnedSourceFile(supplementalSourceRoot, verificationFile.file, verificationFile.sha256);
      }
      if (sourceRecord.filing) {
        addCompany(sourceRecord.filing.ticker, sourceRecord.filing.companyName, sourceRecord.filing.cik, sourceRecord.taskId);
        addUnique(scope.tickers, String(sourceRecord.filing.ticker).toUpperCase());
        const filing = addFiling(sourceRecord.filing, sourceRecord.taskId, scope.cutoff, scope.asOfTime);
        if (filing) addUnique(scope.filingIds, filing.id);
      }
      const document = addDocument({ ...sourceRecord, body }, sourceRecord.taskId);
      if (!document) throw new Error(`Supplemental source ${sourceRecord.id} did not produce a readable document`);
      addUnique(scope.documentIds, document.id);
    }
  }

  // An EDGAR document body is recorded under the as-of of the task that read it, which is only an
  // upper bound on when it existed. The accession number in its URL names the filing, whose filed
  // date is the true availability; use it so a shared filing is readable by every task after it.
  const accessionOf = (url: string): string | undefined => {
    const match = /\/Archives\/edgar\/data\/\d+\/(\d{10})(\d{2})(\d{6})\//.exec(url);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
  };
  const filingByAccession = new Map(filings.map((item) => [item.accession, item]));
  for (const document of documents) {
    const filing = filingByAccession.get(accessionOf(document.canonicalUrl) ?? "");
    if (!filing?.filedAt || filing.filedAt >= document.availableAt) continue;
    document.availableAt = filing.filedAt;
    document.publishedAt = filing.filedAt;
  }

  // A URL can be shared by tasks with different cutoffs. Keep the originating
  // taskIds so a known-but-future document can produce NotAvailableAsOf without
  // exposing its body. Search/fetch enforce each task's temporal boundary.
  for (const taskScope of Object.values(scopes)) {
    taskScope.documentIds = taskScope.documentIds.filter((id) => {
      const document = documents.find((item) => item.id === id);
      return document?.taskIds.includes(taskScope.taskId);
    });
  }

  const db = stable({ version: MOCK_MCP_FORMAT_VERSION, coverageContractVersion: EVIDENCE_CONTRACT.version, coverageContractHash: EVIDENCE_CONTRACT_HASH, generatedAt: "2024-01-01T00:00:00.000Z", companies, filings, financialFacts, marketData, documents, alphaRecords, scopes });
  const missingAvailability: { table: string; item: { availableAt?: string; availabilityBasis?: string; ticker?: unknown; symbol?: unknown; id?: unknown } }[] = [
    ...db.filings.map((item) => ({ table: "filings", item })),
    ...db.financialFacts.map((item) => ({ table: "financialFacts", item })),
    ...db.marketData.map((item) => ({ table: "marketData", item })),
  ].filter(({ item }) => !item.availableAt || !item.availabilityBasis);
  if (missingAvailability.length > 0) throw new Error(`Canonical records missing availability metadata: ${missingAvailability.slice(0, 5).map(({ table, item }) => `${table}:${item.ticker || item.symbol || item.id}`).join(", ")}`);
  const urlOwners = new Map<string, string>();
  for (const document of db.documents) {
    for (const url of [document.canonicalUrl, ...(document.urlAliases || [])].map(cleanUrl)) {
      const owner = urlOwners.get(url);
      if (owner && owner !== document.id) throw new Error(`Canonical URL alias collision: ${url}`);
      urlOwners.set(url, document.id);
    }
  }
  for (const scope of Object.values(db.scopes)) {
    scope.hash = hash({
      scope,
      companies: db.companies,
      filings: db.filings.filter((item) => canonicalRecordVisible(item, scope)),
      facts: db.financialFacts.filter((item) => canonicalRecordVisible(item, scope)),
      documents: db.documents.filter((item) => item.taskIds.includes(scope.taskId)),
      marketData: db.marketData.filter((item) => canonicalRecordVisible(item, scope)),
      alphaRecords: db.alphaRecords.filter((item) => item.taskIds.includes(scope.taskId)),
    });
  }

  mkdirSync(output, { recursive: true });
  const body = Buffer.from(JSON.stringify(db));
  const compressed = gzipSync(body, { level: 9 });
  writeFileAtomicSync(path.join(output, "db.json.gz"), compressed);
  // Validate the file just written, read back the way the benchmark reads it.
  const coverageIssues = validateDatasetTasks(tasks, loadCanonicalDatabase(path.join(output, "db.json.gz")));
  const manifest = {
    version: MOCK_MCP_FORMAT_VERSION,
    coverageContractVersion: EVIDENCE_CONTRACT.version,
    coverageContractHash: EVIDENCE_CONTRACT_HASH,
    taskCount: taskIds.length,
    taskIds,
    dbHash: hash(db),
    taskHashes: Object.fromEntries(Object.entries(db.scopes).map(([id, scope]) => [id, scope.hash])),
    counts: { companies: db.companies.length, filings: db.filings.length, financialFacts: db.financialFacts.length, marketData: db.marketData.length, documents: db.documents.length, alphaRecords: db.alphaRecords.length },
    coverageIssues,
    compilerWarnings,
  };
  writeFileAtomicSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`compiled ${taskIds.length} canonical task views`);
  console.log(`companies=${db.companies.length} filings=${db.filings.length} facts=${db.financialFacts.length} marketData=${db.marketData.length} documents=${db.documents.length} alpha=${db.alphaRecords.length}`);
  console.log(`wrote ${path.join(output, "db.json.gz")} (${(compressed.byteLength / 1024 / 1024).toFixed(1)} MiB)`);
  if (compilerWarnings.length) console.warn(`excluded ${compilerWarnings.length} Alpha Vantage tool-output item(s) that were not provider JSON; source details are recorded in manifest.json`);
  if (coverageIssues.length) {
    console.error(`coverage contract failed with ${coverageIssues.length} issue(s):\n- ${coverageIssues.join("\n- ")}`);
    process.exitCode = 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const source = path.resolve(value("--source", path.resolve("evals/fixtures")));
  const output = path.resolve(value("--output", path.resolve("evals/dataset")));
  compile(RETAIL_EVAL_TASKS, source, output);
}

// Importing this module (the neutrality test does) must not compile anything.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
