import { evidenceLineage } from "@/lib/evidence/lineage";
import { reportReference } from "@/lib/evidence/ids";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import type { SandboxEmitted, SandboxResult } from "@/lib/sandbox/protocol";
import { displayValue } from "./evidence";

/** Formats calculator results, figures, scratch output, and undeclared constant warnings. */

/** Python's traceback trimmed to what the model can act on. */
export function formatError(error: string): string {
  const lines = error.split("\n").filter((line) => line.trim() !== "");
  // `runner.py` already drops its own frames; guard against a host error slipping through.
  return lines.filter((line) => !line.includes("/sandbox/") && !line.includes("runner.py")).join("\n") || error;
}

/** Small series are usable immediately; longer ones retain both ends and an explicit retrieval path. */
function seriesPreview(value: Exclude<SandboxEmitted["value"], number>, unit: string | undefined, id: string): string {
  const values = Object.entries(value).map(([label, number]) =>
    `${JSON.stringify(label)}: ${displayValue(number, unit)}${reportReference(id, label) ? ` (report ${reportReference(id, label)})` : ""}`);
  const preview = values.length <= 12 ? values : [...values.slice(0, 6), "…", ...values.slice(-6)];
  return `${values.length} values: ${preview.join("; ")}${values.length > 12 ? ` (middle omitted; evidence_get ${id} for the full series)` : ""}. For the whole series use evidence_table with source "${id}".`;
}

function figureLines(entries: EvidenceEntry[], result: SandboxResult): string[] {
  return entries.map((entry, index) => {
    const emitted = result.emitted[index];
    const shown =
      typeof emitted?.value === "number"
        ? `${displayValue(emitted.value, emitted.unit)} (report ${reportReference(entry.id)})`
        : emitted ? seriesPreview(emitted.value, emitted.unit, entry.id) : "no emitted value";
    const formula = entry.formula ? `  (${entry.formula})` : "";
    return `[${entry.id}] ${entry.name} = ${shown}${formula}`;
  });
}

function assumptionLines(entries: EvidenceEntry[]): string[] {
  return entries.map((entry) => `[${entry.id}] ${entry.name} = ${entry.value} — ${entry.why}`);
}

/** Warning message for numeric constants used without an explicit assumption declaration. */
export function undeclaredWarning(result: SandboxResult, entries: EvidenceEntry[]): string {
  if (result.undeclaredConstants.length === 0) return "";
  const listed = result.undeclaredConstants
    .map((constant, index) => `  [${entries[index]?.id ?? "A?"}] ${constant.value} on line ${constant.line}: ${constant.snippet}`)
    .join("\n");
  return [
    `Undeclared constants (${result.undeclaredConstants.length}). They were recorded as assumptions, and an answer that leans on them will be challenged:`,
    listed,
    "Wrap each one in assume(name, value, why), or take the figure from an evidence entry instead.",
  ].join("\n");
}

export interface ResultSections {
  computed: EvidenceEntry[];
  assumed: EvidenceEntry[];
  undeclared: EvidenceEntry[];
}

/** The whole tool result: figures, assumptions, scratch output, warnings, then any error. */
export function formatResult(result: SandboxResult, sections: ResultSections, ledger?: EvidenceLedger): string {
  const blocks: string[] = [];
  const assumptions = ledger
    ? evidenceLineage(ledger, sections.computed.map((entry) => entry.id)).filter((entry) => entry.kind === "A")
    : [...sections.assumed, ...sections.undeclared];
  if (sections.computed.length && assumptions.length) {
    blocks.push(`Calculation inputs include assumptions ${assumptions.map((entry) => `[${entry.id}]`).join(", ")}. These results are conditional on those inputs, not verification of them.`);
  }
  if (sections.computed.length > 0) blocks.push(figureLines(sections.computed, result).join("\n"));
  if (sections.assumed.length > 0) blocks.push(assumptionLines(sections.assumed).join("\n"));
  if (result.stdout.trim()) blocks.push(`Output:\n${result.stdout.trimEnd()}`);
  const warning = undeclaredWarning(result, sections.undeclared);
  if (warning) blocks.push(warning);
  if (result.error) blocks.push(`The calculation then failed:\n${formatError(result.error)}`);
  if (blocks.length === 0) {
    blocks.push("The code ran but emitted nothing. Record each result with emit(name, value, unit) so it can be cited.");
  }
  return blocks.join("\n\n");
}
