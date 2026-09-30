import type { CompanyFacts, Period, StatementId } from "@/lib/providers/edgar/xbrl/metrics";
import { buildStatementData } from "@/lib/providers/edgar/xbrl/statements";
import type { EvalTask } from "../types";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { EVIDENCE_CONTRACT, EVIDENCE_CONTRACT_HASH, normalizePeriod, normalizeSourceUrl, sameStatement, type TaskEvidenceContract } from "./coverage-contract";
import { companyFactsAsOf, type CanonicalDatabase } from "./mock-mcp-data";
import { atOrBeforeCutoff } from "./mock-mcp-view";

/** The same companyfacts view, on the same share basis, that the mock serves at this cutoff. */
function companyFactsFor(db: CanonicalDatabase, ticker: string, cutoff: string): CompanyFacts {
  return companyFactsAsOf(db.companies.find((item) => item.ticker === ticker), ticker, db.financialFacts, cutoff).facts;
}

function visibleMarketRecords(db: CanonicalDatabase, task: EvalTask) {
  return db.marketData.filter((record) => record.symbol.length > 0 && atOrBeforeCutoff(record.asOf, task.asOfDate, task.asOfTime));
}

const STATEMENTS = ["income", "balance", "cashflow", "key_metrics"];
const LEDGER_SOURCES = ["holdings", "quote"];

/**
 * Every scored requirement must be reachable in the compiled corpus, or a task would carry points
 * no answer can earn. Source URLs must be the canonical URL of a readable required document,
 * because reads and fetches report the canonical URL; facts must be built by the production
 * statement code from a declared statement; ledger requirements need their tool's data.
 */
function evidenceRequirementIssues(db: CanonicalDatabase, task: EvalTask, contract: TaskEvidenceContract): string[] {
  const issues: string[] = [];
  const requirements = contract.requiredEvidence ?? [];
  const points = requirements.reduce((total, requirement) => total + requirement.points, 0);
  if (requirements.length && points !== 15) {
    issues.push(`${task.id}: evidence requirement weights total ${points}; the tools component must total 15`);
  }
  const scopedDocuments = db.documents.filter((document) => document.taskIds.includes(task.id));
  for (const requirement of requirements) {
    if (!requirement.label || !(requirement.points > 0)) {
      issues.push(`${task.id}: invalid evidence requirement ${requirement.label || "(unlabelled)"}`);
      continue;
    }
    if (requirement.kind === "source") {
      if (!requirement.urls?.length) issues.push(`${task.id}: source requirement ${requirement.label} lists no URL`);
      for (const url of requirement.urls ?? []) {
        let normalized: string;
        try { normalized = normalizeSourceUrl(url); } catch {
          issues.push(`${task.id}: scored source ${url} is not a valid URL`);
          continue;
        }
        if (!(contract.documents ?? []).some((document) => {
          try { return normalizeSourceUrl(document.url) === normalized; } catch { return false; }
        })) issues.push(`${task.id}: scored source ${url} is not covered by a readable document requirement`);
        const document = scopedDocuments.find((candidate) => [candidate.canonicalUrl, ...candidate.urlAliases].some((alias) => {
          try { return normalizeSourceUrl(alias) === normalized; } catch { return false; }
        }));
        if (document && normalizeSourceUrl(document.canonicalUrl) !== normalized) {
          issues.push(`${task.id}: scored source ${url} is an alias; score its canonical URL ${document.canonicalUrl}`);
        }
      }
    } else if (requirement.kind === "fact") {
      if (!STATEMENTS.includes(requirement.statement) || !requirement.ticker || !requirement.metric) {
        issues.push(`${task.id}: invalid fact requirement ${requirement.label}`);
        continue;
      }
      const declared = (contract.financialStatements ?? []).filter((statement) =>
        statement.ticker === requirement.ticker && sameStatement(statement.statement, requirement.statement) && statement.metrics.includes(requirement.metric));
      if (declared.length === 0) {
        issues.push(`${task.id}: fact requirement ${requirement.label} (${requirement.ticker} ${requirement.statement} ${requirement.metric}) has no financialStatements entry declaring it`);
        continue;
      }
      // The requirement's own view must carry the metric, or it names a line that statement has not got.
      // (An empty build has no rows at all; that case is reported as unsatisfiable below.)
      const own = buildStatementData(companyFactsFor(db, declared[0].ticker, contract.cutoff), requirement.statement as StatementId, declared[0].period as Period, 1, { asOf: contract.cutoff });
      if (own.columns.length > 0 && !own.rows.some((row) => row.metric === requirement.metric)) {
        issues.push(`${task.id}: fact requirement ${requirement.label}: the ${requirement.statement} statement has no ${requirement.metric} line`);
        continue;
      }
      const wanted = requirement.period === undefined ? undefined : normalizePeriod(requirement.period);
      const satisfiable = declared.some((statement) => {
        const built = buildStatementData(companyFactsFor(db, statement.ticker, contract.cutoff), statement.statement as StatementId, statement.period as Period, Math.max(20, statement.minPeriods), { asOf: contract.cutoff });
        const row = built.rows.find((candidate) => candidate.metric === requirement.metric);
        return built.columns.some((column, index) => row?.cells[index]?.value !== undefined && (wanted === undefined || normalizePeriod(column) === wanted));
      });
      if (!satisfiable) {
        issues.push(`${task.id}: fact requirement ${requirement.label} cannot be satisfied: no ${requirement.ticker} ${requirement.metric}${requirement.period ? ` for ${requirement.period}` : ""} is served by the cutoff`);
      }
    } else if (requirement.kind === "ledger") {
      if (!LEDGER_SOURCES.includes(requirement.source)) {
        issues.push(`${task.id}: ledger requirement ${requirement.label} names unsupported source ${String(requirement.source)}`);
        continue;
      }
      if (requirement.source === "holdings") {
        const held = (task.holdings ?? []).filter((position) => requirement.ticker === undefined || position.symbol.toUpperCase() === requirement.ticker.toUpperCase());
        if (held.length === 0) issues.push(`${task.id}: ledger requirement ${requirement.label} needs seeded holdings${requirement.ticker ? ` in ${requirement.ticker}` : ""}`);
      } else if (requirement.ticker && !(contract.market ?? []).some((record) => record.symbol === requirement.ticker)) {
        issues.push(`${task.id}: ledger requirement ${requirement.label} needs a dated market record for ${requirement.ticker} in the contract`);
      }
    } else {
      issues.push(`${task.id}: evidence requirement ${(requirement as { label?: string }).label ?? "(unlabelled)"} has unknown kind ${String((requirement as { kind?: unknown }).kind)}`);
    }
  }
  return issues;
}

/**
 * Check every task's declared evidence path against the exact artifacts available to the mock.
 * This is run by both the compiler and eval preflight; it never fills missing data itself.
 */
export function validateEvidenceContract(db: CanonicalDatabase, tasks: EvalTask[]): string[] {
  const issues: string[] = [];
  if (db.coverageContractVersion !== EVIDENCE_CONTRACT.version || db.coverageContractHash !== EVIDENCE_CONTRACT_HASH) {
    issues.push("compiled dataset coverage contract version/hash does not match the checked-in task evidence contract; recompile the dataset");
  }
  const allTaskIds = Object.keys(EVIDENCE_CONTRACT.tasks);
  const activeTaskIds = RETAIL_EVAL_TASKS.map((task) => task.id);
  // Checked on every call, not only full-suite runs: a single-task run against a stale contract
  // would otherwise pass preflight while scoring against source requirements the suite no longer has.
  if (allTaskIds.length !== activeTaskIds.length || allTaskIds.some((id) => !activeTaskIds.includes(id))) {
    issues.push("evidence contract task set does not match the active benchmark task set");
  }

  for (const task of tasks) {
    const contract = EVIDENCE_CONTRACT.tasks[task.id];
    if (!contract) {
      issues.push(`${task.id}: missing versioned evidence contract`);
      continue;
    }
    const scope = db.scopes[task.id];
    if (!scope) {
      issues.push(`${task.id}: missing canonical task scope`);
      continue;
    }
    if (scope.contractHash !== EVIDENCE_CONTRACT_HASH) issues.push(`${task.id}: task scope was compiled with a different evidence contract; recompile the dataset`);
    if (contract.cutoff !== task.asOfDate || contract.cutoff !== scope.cutoff || (contract.asOfTime ?? "") !== (task.asOfTime ?? "") || (contract.asOfTime ?? "") !== (scope.asOfTime ?? "")) {
      issues.push(`${task.id}: contract, task, and compiled scope cutoffs do not agree`);
    }

    for (const ticker of contract.coreTickers) {
      if (!scope.tickers.includes(ticker)) issues.push(`${task.id}: core ticker ${ticker} is absent from the compiled task scope`);
    }

    const scopedDocuments = db.documents.filter((document) => document.taskIds.includes(task.id));
    for (const required of contract.documents ?? []) {
      let normalized: string;
      try {
        normalized = normalizeSourceUrl(required.url);
      } catch {
        issues.push(`${task.id}: contract contains an invalid document URL ${required.url}`);
        continue;
      }
      const document = scopedDocuments.find((candidate) => [candidate.canonicalUrl, ...candidate.urlAliases].some((url) => {
        try { return normalizeSourceUrl(url) === normalized; } catch { return false; }
      }));
      if (!document) {
        issues.push(`${task.id}: required ${required.kind} is not present in the scoped corpus: ${required.url}`);
        continue;
      }
      if (document.sourceTier !== 1 || !document.body.trim() || document.body.length < required.minBodyChars) {
        issues.push(`${task.id}: required ${required.kind} has no readable official body or is shorter than ${required.minBodyChars} characters: ${required.url}`);
      }
      if (!atOrBeforeCutoff(document.availableAt, contract.cutoff, contract.asOfTime) || document.publishedAt.slice(0, 10) > contract.cutoff) {
        issues.push(`${task.id}: required document is not available by its cutoff: ${required.url}`);
      }
      for (const exhibitUrl of required.exhibits ?? []) {
        const filename = decodeURIComponent(new URL(exhibitUrl).pathname.split("/").at(-1) ?? "").toLowerCase();
        if (!filename || !document.body.toLowerCase().includes(filename)) {
          issues.push(`${task.id}: filing index does not list required saved exhibit ${exhibitUrl}`);
        }
        const exhibit = scopedDocuments.find((candidate) => {
          try { return normalizeSourceUrl(candidate.canonicalUrl) === normalizeSourceUrl(exhibitUrl); } catch { return false; }
        });
        if (!exhibit?.body.trim()) issues.push(`${task.id}: required exhibit body is not readable: ${exhibitUrl}`);
      }
    }

    for (const required of contract.financialStatements ?? []) {
      const statement = buildStatementData(
        companyFactsFor(db, required.ticker, contract.cutoff),
        required.statement as StatementId,
        required.period as Period,
        Math.max(20, required.minPeriods),
        { asOf: contract.cutoff },
      );
      if (statement.columns.length < required.minPeriods) {
        issues.push(`${task.id}: ${required.ticker} ${required.statement}/${required.period} has ${statement.columns.length} usable periods; requires ${required.minPeriods}`);
      }
      for (const metric of required.metrics) {
        const row = statement.rows.find((candidate) => candidate.metric === metric);
        const available = row?.cells.filter((cell) => cell.value !== undefined).length ?? 0;
        if (available < required.minPeriods) {
          issues.push(`${task.id}: ${required.ticker} ${required.statement}/${required.period} metric ${metric} has ${available} usable periods; requires ${required.minPeriods}`);
        }
      }
    }

    const market = visibleMarketRecords(db, task);
    for (const required of contract.market ?? []) {
      const quote = market.find((record) => record.symbol === required.symbol && record.asOf.slice(0, 10) === required.date && typeof record.price === "number" && record.price > 0);
      if (!quote) issues.push(`${task.id}: required dated market record ${required.symbol} @ ${required.date} is missing or not yet available`);
      else if (quote.availableAt && !atOrBeforeCutoff(quote.availableAt, contract.cutoff, contract.asOfTime)) {
        issues.push(`${task.id}: required market record ${required.symbol} @ ${required.date} is beyond the task cutoff`);
      }
    }

    for (const symbol of contract.alpha?.daily ?? []) {
      const bars = market.filter((record) => record.symbol === symbol &&
        [record.price, record.open, record.high, record.low, record.volume].every((value) => typeof value === "number" && Number.isFinite(value)));
      if (new Set(bars.map((bar) => bar.asOf.slice(0, 10))).size < 5) {
        issues.push(`${task.id}: ${symbol} lacks five dated OHLCV bars for the offline TIME_SERIES_DAILY and GLOBAL_QUOTE projections`);
      }
    }

    const alphaFor = (operation: string, symbol: string) => db.alphaRecords.filter((record) =>
      record.taskIds.includes(task.id) && record.operation === operation && record.symbol === symbol &&
      record.availableAt && atOrBeforeCutoff(record.availableAt, contract.cutoff, contract.asOfTime));
    for (const symbol of contract.alpha?.earnings ?? []) {
      const rows = alphaFor("EARNINGS", symbol).flatMap((record) => {
        const value = record.value as { quarterlyEarnings?: Array<{ reportedDate?: string; reportedEPS?: string }> };
        return Array.isArray(value?.quarterlyEarnings) ? value.quarterlyEarnings : [];
      }).filter((row) => row.reportedDate && row.reportedDate <= contract.cutoff && row.reportedEPS !== undefined);
      if (rows.length === 0) issues.push(`${task.id}: ${symbol} has no dated Alpha Vantage earnings rows by the cutoff`);
    }
    for (const symbol of contract.alpha?.news ?? []) {
      const feed = alphaFor("NEWS_SENTIMENT", symbol).flatMap((record) => {
        const value = record.value as { feed?: Array<{ url?: string; time_published?: string }> };
        return Array.isArray(value?.feed) ? value.feed : [];
      });
      if (!feed.some((item) => item.url && item.time_published && item.time_published.slice(0, 8) <= contract.cutoff.replaceAll("-", ""))) {
        issues.push(`${task.id}: ${symbol} has no dated historical Alpha Vantage news item by the cutoff`);
      }
    }
    for (const symbol of contract.alpha?.verifiedEmptyNews ?? []) {
      const verifiedEmpty = alphaFor("NEWS_SENTIMENT", symbol).some((record) => {
        const value = record.value as { feed?: unknown[] };
        return Array.isArray(value?.feed) && value.feed.length === 0;
      });
      if (!verifiedEmpty) issues.push(`${task.id}: ${symbol} lacks a pinned historical Alpha Vantage no-match response`);
    }

    issues.push(...evidenceRequirementIssues(db, task, contract));
  }

  return issues;
}
