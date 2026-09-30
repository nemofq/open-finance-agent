import { factsFor } from "@/lib/evidence/metrics";
import type { EvidenceEntry, EvidenceId } from "@/lib/evidence/types";
import { formatCell, formatMagnitude } from "../format";

/**
 * Where a printed figure came from, in words. One builder serves both places the reader can see
 * it: the popover behind every marker, and the Figures appendix at the end of the report. They
 * are written from the same parts so the two can never drift apart.
 */

export interface OriginParts {
  id: EvidenceId;
  /** What the figure is: its name, or for a retrieved entry its source, tier and as-of date. */
  head: string;
  /** The value the entry holds, as the report prints it. */
  value?: string;
  /** `= fin.growth(revenue)`, when the calculator recorded one, with its magnitudes scaled. */
  formula?: string;
  /** The formula exactly as the calculator recorded it. */
  rawFormula?: string;
  /** The rest, in reading order: inputs, the reason, where it came from, the fact behind a marker. */
  notes: string[];
}

export type OriginLineKind = "head" | "value" | "formula" | "note";

export interface OriginLine {
  kind: OriginLineKind;
  text: string;
  /** The unrewritten text, when the line shows a tidied form of it. */
  title?: string;
}

/**
 * A number in a formula, never a digit inside an identifier: `3.31839e+11` and `65585000000`
 * match, the `1` of `q1` and the `.75` of `1.75` do not.
 */
const FORMULA_NUMBER = /(?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/g;

/** Below this a number is already readable, so only its exponent form is rewritten. */
const SCALE_FROM = 1e6;

/**
 * The calculator writes its formulas with raw magnitudes in them — `(3.31839e+11 - 2.81724e+11)`
 * — which no reader can size at a glance. Those become the figures the report prints elsewhere;
 * identifiers, operators and numbers small enough to read stay exactly as they were written.
 */
export function formatFormula(formula: string): string {
  return formula.replace(FORMULA_NUMBER, (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return raw;
    if (!raw.includes("e") && !raw.includes("E") && Math.abs(value) < SCALE_FROM) return raw;
    return formatMagnitude(value);
  });
}

/** A formula or summary long enough to fill the popover is cut rather than allowed to wrap on. */
const MAX_LINE = 160;

function clamp(text: string, limit = MAX_LINE): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function label(entry: EvidenceEntry): string {
  return clamp(entry.name ?? entry.summary);
}

function printedValue(entry: EvidenceEntry): string | undefined {
  return typeof entry.value === "number" ? formatCell(entry.value, entry.unit) : undefined;
}

const ORIGINS: Record<NonNullable<EvidenceEntry["origin"]>, string> = {
  message: "from your message",
  profile: "from your profile",
  holdings: "from your holdings",
  attachment: "from a file you attached",
};

/** Where a retrieved entry came from: `SEC EDGAR · tier 1 · as of 2026-08-01`. */
export function sourceHead(entry: EvidenceEntry): string {
  const parts = [entry.source?.name ?? entry.tool ?? "retrieved"];
  if (entry.source !== undefined) parts.push(`tier ${entry.source.tier}`);
  if (entry.asOf !== undefined) parts.push(`as of ${entry.asOf}`);
  return parts.join(" · ");
}

/** Everything the reader needs to judge one figure, split into the lines that show it. */
export function originParts(entry: EvidenceEntry, period?: string): OriginParts {
  const base = { id: entry.id, value: printedValue(entry) };
  switch (entry.kind) {
    case "C":
      return {
        ...base,
        head: label(entry),
        formula: entry.formula === undefined ? undefined : clamp(formatFormula(entry.formula)),
        rawFormula: entry.formula,
        notes: entry.inputs?.length ? [`from ${entry.inputs.join(", ")}`] : [],
      };
    case "E": {
      // The fact a retrieved marker points at, when the cell named the period it was printed for.
      const fact = period === undefined ? undefined : factsFor(entry, period)[0];
      return {
        ...base,
        head: sourceHead(entry),
        notes: [clamp(entry.summary), ...(fact === undefined ? [] : [`${fact.metric} ${fact.period}`])],
      };
    }
    case "A": {
      const why =
        entry.why ?? (entry.declared === false ? "undeclared constant, recorded by the calculator" : undefined);
      return { ...base, head: label(entry), notes: why === undefined ? [] : [clamp(why)] };
    }
    case "U":
      return {
        ...base,
        head: label(entry),
        notes: [entry.origin === undefined ? "provided by you" : ORIGINS[entry.origin]],
      };
    case "R":
      return { ...base, head: "report", notes: [clamp(entry.report?.title ?? entry.summary)] };
  }
}

/** The popover's lines, the id leading the first one so the marker names itself. */
export function originLines(parts: OriginParts): OriginLine[] {
  const lines: OriginLine[] = [{ kind: "head", text: `${parts.id} · ${parts.head}` }];
  if (parts.value !== undefined) lines.push({ kind: "value", text: parts.value });
  if (parts.formula !== undefined) {
    lines.push({ kind: "formula", text: `= ${parts.formula}`, title: parts.rawFormula });
  }
  for (const note of parts.notes) lines.push({ kind: "note", text: note });
  return lines;
}

/** The same origin on one line, for the Figures appendix; the id is written by the caller. */
export function originLine(parts: OriginParts): string {
  const head = parts.value === undefined ? parts.head : `${parts.head}: ${parts.value}`;
  const rest = [parts.formula, ...parts.notes].filter((part) => part !== undefined);
  return [head, ...rest].join(" — ");
}
