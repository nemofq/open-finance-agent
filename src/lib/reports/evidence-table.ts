import { sameMetric } from "@/lib/evidence/metrics";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { ReportBlock } from "./spec";

type BoundTable = Extract<ReportBlock, { type: "evidence_table" }>;
type Table = Extract<ReportBlock, { type: "table" }>;

/** Copy labels, units and values together; the model selects a source, not individual cells. */
export function evidenceTable(block: BoundTable, ledger: EvidenceLedger): Table {
  const entry = ledger.get(block.source);
  if (!entry || entry.kind === "R") throw new Error(`${block.source} is not a source of figures.`);
  if (entry.lookAhead) throw new Error(`${entry.id} was not available at the turn cutoff.`);
  const entryFacts = entry.facts;
  if (entryFacts?.length) {
    const available = [...new Set(entryFacts.map((fact) => fact.metric))];
    const metrics = (block.metrics ?? available).map((name) => {
      const metric = available.find((candidate) => sameMetric(candidate, name) || candidate === name);
      if (!metric) throw new Error(`${entry.id} has no metric ${name}. Available: ${available.join(", ")}.`);
      return metric;
    });
    const periods = [...new Set(entryFacts.filter((fact) => metrics.includes(fact.metric)).map((fact) => fact.period))];
    const labels = metrics.map((metric) => metric.replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()));
    const rows = periods.map((period) => [period, ...metrics.map((metric) => {
      const facts = entryFacts.filter((fact) => fact.metric === metric && fact.period === period);
      if (facts.some((fact) => fact.value !== facts[0].value || fact.unit !== facts[0].unit)) {
        throw new Error(`${entry.id} has conflicting values for ${metric} in ${period}. Select an unambiguous source.`);
      }
      const fact = facts[0];
      return fact ? { value: fact.value, unit: fact.unit, src: entry.id, metric, period } : "not reported";
    })]);
    return { type: "table", columns: ["Period", ...labels], rows };
  }
  if (!entry.table || block.metrics?.length) throw new Error(`${entry.id} has no structured facts${block.metrics?.length ? " for metric selection" : " or table"}.`);
  const index = entry.table.index ? entry.table.columns.indexOf(entry.table.index) : -1;
  return { type: "table", columns: entry.table.columns, rows: entry.table.rows.map((row) => row.map((value, column) =>
    typeof value === "number" && column !== index ? { value, unit: entry.unit, src: entry.id } : String(value ?? "not reported"))) };
}
