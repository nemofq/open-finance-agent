import type { EvidenceEntry, EvidenceId, EvidenceLedger, EvidenceTable } from "@/lib/evidence/types";
import type {
  SandboxAssumption,
  SandboxEmitted,
  SandboxEvidence,
  SandboxResult,
  SandboxUndeclaredConstant,
} from "@/lib/sandbox/protocol";

/**
 * The bridge between the evidence ledger and the sandbox: tables go in by
 * reference, and every figure that comes out is recorded, so a calculated number in the answer
 * has an id, a formula and the entries it came from.
 */

/** `fin` returns percentages as decimals; the ledger stores what the model will write (12.4, "%"). */
export function recordedValue(value: number, unit: string | undefined): number {
  return unit === "%" ? value * 100 : value;
}

/** How a figure is shown in the tool result, so the model quotes it in the form it was recorded. */
export function displayValue(value: number, unit: string | undefined): string {
  if (unit === "%") return `${round(value * 100)}%`;
  if (unit === "x") return `${round(value)}x`;
  return unit ? `${round(value)} ${unit}` : round(value);
}

/** Enough digits to be exact for ratios and money, without printing float noise. */
function round(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && magnitude < 0.01) return value.toPrecision(4);
  return Number(value.toFixed(magnitude >= 1000 ? 2 : 4)).toString();
}

export class UnknownEvidenceError extends Error {}

/**
 * Resolve the evidence ids a calculation asked for into tables the sandbox can preload.
 *
 * Prefer the source's table. Prose and scalar entries expose value/unit/context rows,
 * so calculations reuse existing evidence instead of retyping it as assumptions.
 */
export async function resolveEvidence(
  ledger: EvidenceLedger,
  ids: string[],
): Promise<Record<string, SandboxEvidence>> {
  const out: Record<string, SandboxEvidence> = {};
  for (const id of ids) {
    const entry = ledger.get(id);
    if (!entry) throw new UnknownEvidenceError(`${id} is not in the evidence ledger. ${available(ledger)}`);
    if (entry.lookAhead) throw new UnknownEvidenceError(`${id} was unavailable at this turn's cutoff and cannot be used in a calculation.`);
    const numbers = entry.numbers?.length ? entry.numbers : typeof entry.value === "number"
      ? [{ value: entry.value, unit: entry.unit, context: entry.summary }] : [];
    const table = entry.table ?? (await loadTable(ledger, id)) ?? (numbers.length ? {
      columns: ["value", "unit", "context"],
      rows: numbers.map((number) => [number.value, number.unit ?? "", number.context]),
    } : undefined);
    if (!table) {
      throw new UnknownEvidenceError(
        `${id} (${entry.summary}) holds no numeric data, so it cannot be preloaded. ${available(ledger)}`,
      );
    }
    out[id] = {
      columns: table.columns,
      rows: table.rows,
      ...(table.index ? { index: table.index } : {}),
      meta: {
        id,
        summary: entry.summary,
        ...(entry.source ? { source: entry.source.name } : {}),
        ...(entry.asOf ? { asOf: entry.asOf } : {}),
        ...(entry.unit ? { unit: entry.unit } : {}),
        ...(entry.currency ? { currency: entry.currency } : {}),
      },
    };
  }
  return out;
}

async function loadTable(ledger: EvidenceLedger, id: EvidenceId): Promise<EvidenceTable | undefined> {
  const payload = await ledger.loadPayload<{ table?: EvidenceTable }>(id);
  return payload?.table;
}

function available(ledger: EvidenceLedger): string {
  const tabular = ledger.list().filter((entry) => !entry.lookAhead && (entry.table || entry.numbers?.length || typeof entry.value === "number"));
  if (tabular.length === 0) return "No evidence entry in this chat holds numeric data yet.";
  return `Entries with numeric data: ${tabular.map((entry) => `${entry.id} (${entry.summary})`).join("; ")}.`;
}

/** A vector or a labelled set of numbers, as a one-row-per-item table on the C entry. */
function vectorTable(value: number[] | Record<string, number>, unit: string | undefined): EvidenceTable {
  const rows: (string | number)[][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), recordedValue(item, unit)])
    : Object.entries(value).map(([label, item]) => [label, recordedValue(item, unit)]);
  return { columns: ["label", "value"], rows, index: "label" };
}

function computedEntry(emitted: SandboxEmitted, inputs: EvidenceId[], finVersion: string): Parameters<
  EvidenceLedger["add"]
>[0] {
  const common = {
    kind: "C" as const,
    name: emitted.name,
    ...(emitted.unit ? { unit: emitted.unit } : {}),
    ...(emitted.formula ? { formula: emitted.formula } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
    finVersion,
  };
  if (typeof emitted.value === "number") {
    const value = recordedValue(emitted.value, emitted.unit);
    return { ...common, value, summary: `${emitted.name} = ${displayValue(emitted.value, emitted.unit)} (calculated)` };
  }
  const table = vectorTable(emitted.value, emitted.unit);
  return { ...common, table, summary: `${emitted.name}: ${table.rows.length} calculated values` };
}

function assumptionEntry(assumption: SandboxAssumption): Parameters<EvidenceLedger["add"]>[0] {
  return {
    kind: "A",
    name: assumption.name,
    value: assumption.value,
    why: assumption.why,
    declared: true,
    summary: `${assumption.name} = ${round(assumption.value)} — ${assumption.why}`,
  };
}

function undeclaredEntry(constant: SandboxUndeclaredConstant): Parameters<EvidenceLedger["add"]>[0] {
  return {
    kind: "A",
    name: constant.snippet.slice(0, 80) || String(constant.value),
    value: constant.value,
    why: "undeclared constant in calculator code",
    declared: false,
    summary: `Undeclared constant ${constant.value} at line ${constant.line}: ${constant.snippet}`,
  };
}

/** Records emitted figures, declared assumptions, and undeclared constants into the ledger. */
export function recordResults(
  ledger: EvidenceLedger,
  result: SandboxResult,
): { computed: EvidenceEntry[]; assumed: EvidenceEntry[]; undeclared: EvidenceEntry[] } {
  const assumed = result.assumptions.map((assumption) => ledger.add(assumptionEntry(assumption)));
  const undeclared = result.undeclaredConstants.map((constant) => ledger.add(undeclaredEntry(constant)));
  const inputs = [...new Set<EvidenceId>([...result.usedEvidence as EvidenceId[], ...assumed.map((e) => e.id), ...undeclared.map((e) => e.id)])];
  return {
    computed: result.emitted.map((emitted) => ledger.add(computedEntry(emitted, inputs, result.finVersion))),
    assumed,
    undeclared,
  };
}
