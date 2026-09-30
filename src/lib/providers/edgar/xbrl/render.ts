/** A statement as the markdown table the model reads, with its source, share-basis and cutoff notes. */
import type { Derivation } from "./series";
import type { ShareSplit } from "./splits";
import { type Statement, statementTitles } from "./statements";

const derivationNotes: Record<Derivation, string> = {
  fourthQuarter: "Q4 derived from FY − Q1..Q3",
  yearToDate: "quarter derived as year-to-date − prior year-to-date",
};

interface Cited {
  accn: string;
  derivations: Set<Derivation>;
}

function sourceLine(columns: string[], used: Map<string, Cited>): string {
  const parts = columns.map((end) => {
    const entry = used.get(end);
    if (!entry) return `${end}: n/a`;
    const notes = (Object.keys(derivationNotes) as Derivation[])
      .filter((kind) => entry.derivations.has(kind))
      .map((kind) => derivationNotes[kind]);
    return `${end}: ${entry.accn}${notes.length ? ` (${notes.join("; ")})` : ""}`;
  });
  return `Source: accession numbers per column — ${parts.join("; ")}`;
}

function formatRatio(ratio: number): string {
  const round = (value: number) => Number(value.toPrecision(6));
  return ratio >= 1 ? `${round(ratio)}-for-1` : `1-for-${round(1 / ratio)}`;
}

function shareBasisLine(splits: ShareSplit[], asOf?: string): string {
  const described = splits.map(
    (split) =>
      `the ${formatRatio(split.ratio)} split first reported on ${split.effective} (${split.detectedFrom === "ratioConcept" ? "tagged split ratio" : "detected from restated comparatives"})`,
  );
  return `Share basis: per-share and share-count facts filed before ${described.join(" and ")} are restated to the basis in force ${asOf ? `on ${asOf}` : "today"}, as later filings restate comparatives. Money amounts are as filed.`;
}

function cutoffLine(asOf: string): string {
  return `Point in time: facts filed after ${asOf} are excluded, so the newest periods may be missing.`;
}

/** The accession to cite per column: the first row that reported one, with every way a cell was derived. */
function citedAccessions(statement: Statement): Map<string, Cited> {
  const used = new Map<string, Cited>();
  for (const row of statement.rows) {
    row.cells.forEach((cell, index) => {
      if (cell.value === undefined || cell.accession === undefined) return;
      const end = statement.columns[index];
      const current = used.get(end) ?? { accn: cell.accession, derivations: new Set<Derivation>() };
      if (cell.derivation) current.derivations.add(cell.derivation);
      used.set(end, current);
    });
  }
  return used;
}

/**
 * A markdown table of one statement, newest period first. Money and share counts are
 * in millions with one decimal; EPS carries two.
 */
export function renderStatement(statement: Statement): string {
  const { columns, entity, period } = statement;
  const currency = statement.rows.find((row) => row.unit.length === 3)?.unit ?? "USD";
  const title = statementTitles[statement.statement];
  if (columns.length === 0) {
    const empty = `No ${title.toLowerCase()} facts found for ${entity} (${period}). The filer may not report XBRL financial statements to the SEC.`;
    return statement.asOf ? `${empty}\n\n${cutoffLine(statement.asOf)}` : empty;
  }

  const unitNote =
    statement.statement === "key_metrics"
      ? `${currency} millions, margins and growth in percent`
      : statement.statement === "income"
        ? `${currency} millions except EPS; shares in millions`
        : `${currency} millions`;

  const lines = [
    `**${entity} — ${title}** (${period}, as reported; ${unitNote})`,
    "",
    `| Line | ${columns.join(" | ")} |`,
    `| :--- | ${columns.map(() => "---:").join(" | ")} |`,
    ...statement.rows.map((row) => `| ${row.label} | ${row.cells.map((cell) => cell.formatted).join(" | ")} |`),
    "",
    sourceLine(columns, citedAccessions(statement)),
  ];
  if (statement.shareBasis?.length) lines.push("", shareBasisLine(statement.shareBasis, statement.asOf));
  if (statement.asOf) lines.push("", cutoffLine(statement.asOf));
  return lines.join("\n");
}
