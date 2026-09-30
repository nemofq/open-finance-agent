/**
 * What each EDGAR tool attaches to its result `details`, so the evidence ledger indexes
 * exact figures instead of parsing them back out of the markdown we just rendered: a summary
 * line, the filer, the dates, and for a statement its facts and table.
 * Pure: everything here maps already-fetched data onto `StructuredDetails`.
 */

import { latestDate, publishedDate } from "@/lib/evidence/normalizers/text";
import type { EvidenceFact, EvidenceSource, EvidenceTable, StructuredDetails } from "@/lib/evidence/types";
import { padCik } from "./client";
import type { FilingRead } from "./filing";
import type { FilingHit } from "./search";
import type { Filing, Submissions } from "./submissions";
import type { StatementId } from "./xbrl/metrics";
import { type Statement, statementTitles } from "./xbrl/statements";

const edgarSource: EvidenceSource = { id: "edgar", name: "SEC EDGAR", tier: 1 };

/** Filings and XBRL facts are reported in dollars. */
const currency = "USD";

/**
 * The summary and date of a result the model reads as prose (a profile, a filings list, search
 * hits, a document): `SEC EDGAR — <its first line>`, and the date we know, else the one it states.
 */
export function proseDetails(text: string, asOf?: string): Pick<StructuredDetails, "summary" | "asOf"> {
  const headline = text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "SEC EDGAR result";
  const dated = asOf ?? publishedDate(text);
  return { summary: `SEC EDGAR — ${headline.replace(/\*\*/g, "").slice(0, 120)}`, ...(dated ? { asOf: dated } : {}) };
}

/* ------------------------------------------------------ edgar_lookup_company */

export function lookupDetails(text: string, filer?: { ticker: string; submissions: Submissions }): StructuredDetails {
  const prose = proseDetails(text);
  if (!filer) return { ...prose, source: edgarSource };
  return {
    ...prose,
    source: edgarSource,
    entity: { ticker: filer.ticker, cik: padCik(filer.submissions.cik), name: filer.submissions.name },
  };
}

/* ------------------------------------------------------------ edgar_filings */

export function filingsDetails(text: string, ticker: string, submissions: Submissions, filings: Filing[]): StructuredDetails {
  const table: EvidenceTable = {
    columns: ["form", "filed", "reportDate", "accession", "url"],
    rows: filings.map((filing) => [filing.form, filing.filed, filing.reportDate, filing.accession, filing.url]),
  };
  const filed = latestDate(filings.map((filing) => filing.filed));
  return {
    ...proseDetails(text, filed),
    entity: { ticker, cik: padCik(submissions.cik), name: submissions.name },
    availableAt: filed,
    table,
  };
}

/* --------------------------------------------------------- edgar_financials */

export interface FinancialsDetails extends StructuredDetails {
  statement: StatementId;
}

/** One fact per cell that has a value, keyed by the row's stable metric id. */
export function statementFacts(statement: Statement): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  for (const row of statement.rows) {
    row.cells.forEach((cell, index) => {
      if (cell.value === undefined) return;
      const period = statement.columns[index];
      facts.push({
        metric: row.metric,
        period,
        periodType: statement.statement === "balance" ? "instant" : statement.period,
        value: cell.value,
        unit: row.unit,
        ref: cell.accession,
        end: period,
      });
    });
  }
  return facts;
}

/** The statement as a table the calculator can load: one row per line, base units, `null` for a gap. */
function statementTable(statement: Statement): EvidenceTable {
  return {
    columns: ["metric", ...statement.columns],
    rows: statement.rows.map((row) => [row.metric, ...row.cells.map((cell) => cell.value ?? null)]),
    index: "metric",
  };
}

/**
 * `EDGAR income statement, quarterly, $NVDA, 8 periods (latest 2024-07-28)` and the date of the
 * newest filing behind it; an empty statement is described like prose, from `text`.
 */
export function statementDetails(statement: Statement, ticker: string, text: string): Pick<StructuredDetails, "summary" | "asOf"> {
  const { columns, period } = statement;
  if (columns.length === 0) return proseDetails(text, statement.latestFiled);
  const latest = columns.reduce((max, column) => (column > max ? column : max));
  const title = statementTitles[statement.statement].toLowerCase();
  return {
    summary: `EDGAR ${title}, ${period}, $${ticker}, ${columns.length} period${columns.length === 1 ? "" : "s"} (latest ${latest})`,
    asOf: statement.latestFiled ?? latest,
  };
}

export function financialsDetails(
  text: string,
  statement: Statement,
  filer: { ticker: string; cik: string },
): FinancialsDetails {
  return {
    ...statementDetails(statement, filer.ticker, text),
    statement: statement.statement,
    entity: { ticker: filer.ticker, cik: padCik(filer.cik), name: statement.entity },
    availableAt: statement.latestFiled,
    periods: statement.columns,
    unit: currency,
    currency,
    facts: statementFacts(statement),
    table: statementTable(statement),
  };
}

/* ----------------------------------------------------- edgar_search_filings */

export function searchDetails(text: string, result: { hits: FilingHit[] }): StructuredDetails {
  // Filed under the filer of the top hit, as a search across filers leads with one.
  const cik = result.hits[0]?.cik;
  return {
    ...proseDetails(text, latestDate(result.hits.map((hit) => hit.filed))),
    ...(cik ? { entity: { cik } } : {}),
  };
}

/* ------------------------------------------------------- edgar_read_filing */

export interface ReadFilingDetails extends StructuredDetails {
  url: string;
}

export function readFilingDetails(url: string, read: FilingRead): ReadFilingDetails {
  return {
    ...proseDetails(read.text, read.asOf),
    url,
    ...(read.cik ? { entity: { cik: read.cik } } : {}),
    ...(read.asOf ? { availableAt: read.asOf } : {}),
  };
}
