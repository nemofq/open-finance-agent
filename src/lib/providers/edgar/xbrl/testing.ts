import type { CompanyFacts, Period, StatementId } from "./metrics";
import { renderStatement } from "./render";
import { buildStatementData } from "./statements";

/** The rendered statement, for tests that only read the text. */
export function buildStatement(
  facts: CompanyFacts,
  statement: StatementId,
  period: Period,
  limit = 8,
  options: { asOf?: string } = {},
): string {
  return renderStatement(buildStatementData(facts, statement, period, limit, options));
}

/** Read one row of a markdown table back as its cells. */
export function row(table: string, label: string): string[] {
  const line = table.split("\n").find((candidate) => candidate.startsWith(`| ${label} |`));
  if (!line) throw new Error(`no row "${label}" in:\n${table}`);
  return line.split("|").slice(2, -1).map((cell) => cell.trim());
}

export function columns(table: string): string[] {
  const header = table.split("\n").find((line) => line.startsWith("| Line |"));
  if (!header) throw new Error(`no header in:\n${table}`);
  return header.split("|").slice(2, -1).map((cell) => cell.trim());
}
