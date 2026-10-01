/**
 * Automatic cross-check: when a new result reports a fact an earlier
 * one already reported, the two values are compared and the agreement or the conflict is
 * recorded on the new entry and written under its tag, where the model reads it.
 *
 * No extra calls are made to find a second source; only overlaps that happen anyway are checked.
 */
import type { EvidenceConflict, EvidenceEntity, EvidenceEntry } from "./types";
import { canonicalMetric } from "./metrics";

/** Two sources agree when they are within half a percent, or within the precision of the smaller. */
const RELATIVE_TOLERANCE = 0.005;
/** One line per disagreement is worth the context; agreements collapse into a count. */
const MAX_CONFLICT_LINES = 8;
const MAX_NAMED_AGREEMENTS = 3;
/** Conflicts are always recorded; agreements stop here so a statement does not carry 56 of them. */
const MAX_RECORDED_AGREEMENTS = 10;

/** One unit in the last reported decimal place; absorbs binary tails and source rounding. */
function precisionTolerance(value: number): number {
  const text = Math.abs(value).toString();
  if (text.includes("e")) return 0;
  const dot = text.indexOf(".");
  return 10 ** -(dot === -1 ? 0 : text.length - dot - 1);
}

function factsAgree(a: number, b: number): boolean {
  const smaller = Math.min(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(smaller * RELATIVE_TOLERANCE, precisionTolerance(smaller));
}

function sameEntity(a: EvidenceEntity | undefined, b: EvidenceEntity | undefined): boolean {
  if (a?.ticker && b?.ticker) return a.ticker.toUpperCase() === b.ticker.toUpperCase();
  if (a?.cik && b?.cik) return a.cik.replace(/^0+/, "") === b.cik.replace(/^0+/, "");
  // Macro series (CPI, treasury yields) name no entity; metric, period and unit identify them.
  return !a?.ticker && !b?.ticker && !a?.cik && !b?.cik;
}

/** Compact enough to read in a tag line: `30.04B`, `0.67`, `75.1%`. */
function formatFigure(value: number, unit?: string): string {
  if (unit === "%" || unit === "bps") return `${value.toFixed(1)}${unit === "%" ? "%" : " bps"}`;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (magnitude >= 1e3) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return String(Number(value.toFixed(4)));
}

export interface CrossCheckResult {
  conflicts: EvidenceConflict[];
  /** Lines to write under the entry's tag, conflicts first. */
  lines: string[];
}

/**
 * Compare every fact of `entry` against the facts already in `existing`, matching on entity,
 * metric, period, measurement basis and unit. Unknown bases only match other unknown bases.
 */
export function crossCheck(entry: EvidenceEntry, existing: EvidenceEntry[]): CrossCheckResult {
  const facts = entry.facts ?? [];
  if (facts.length === 0) return { conflicts: [], lines: [] };

  const conflicts: EvidenceConflict[] = [];
  const disagreements: { conflict: EvidenceConflict; unit: string }[] = [];
  const agreements: { id: string; metric: string; period: string }[] = [];

  for (const fact of facts) {
    const metric = canonicalMetric(fact.metric);
    for (const other of existing) {
      if (other.id === entry.id || other.kind !== "E") continue;
      if (!sameEntity(other.entity, entry.entity)) continue;
      const match = other.facts?.find(
        (candidate) =>
          candidate.period === fact.period &&
          candidate.periodType === fact.periodType &&
          candidate.unit === fact.unit &&
          canonicalMetric(candidate.metric) === metric,
      );
      if (!match) continue;

      const agree = factsAgree(fact.value, match.value);
      const conflict: EvidenceConflict = {
        with: other.id,
        metric,
        period: fact.period,
        value: fact.value,
        otherValue: match.value,
        agree,
      };
      if (agree) {
        agreements.push({ id: other.id, metric, period: fact.period });
        if (agreements.length <= MAX_RECORDED_AGREEMENTS) conflicts.push(conflict);
      } else {
        conflicts.push(conflict);
        disagreements.push({ conflict, unit: fact.unit });
      }
      // One counterpart per fact is enough to report; more would repeat the same line.
      break;
    }
  }

  const lines = disagreements
    .slice(0, MAX_CONFLICT_LINES)
    .map(
      ({ conflict, unit }) =>
        `CONFLICT: ${conflict.metric} ${conflict.period} — ${conflict.with} reports ${formatFigure(conflict.otherValue, unit)} vs ${formatFigure(conflict.value, unit)} here`,
    );
  if (disagreements.length > MAX_CONFLICT_LINES) {
    lines.push(`CONFLICT: ${disagreements.length - MAX_CONFLICT_LINES} further figures disagree.`);
  }

  if (agreements.length > 0 && agreements.length <= MAX_NAMED_AGREEMENTS) {
    lines.push(...agreements.map(({ id, metric, period }) => `Cross-check: ${metric} ${period} agrees with ${id}`));
  } else if (agreements.length > MAX_NAMED_AGREEMENTS) {
    const sources = [...new Set(agreements.map((agreement) => agreement.id))].join(", ");
    lines.push(`Cross-check: ${agreements.length} figures agree with ${sources}`);
  }

  return { conflicts, lines };
}
