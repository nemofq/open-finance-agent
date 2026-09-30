/**
 * Share basis: stock splits detected from the filer's own facts, and per-share and share-count
 * facts restated onto the basis in force at the cutoff.
 */
import { type CompanyFacts, days, entriesFor, type FactEntry, type LineKind, metricSpecs } from "./metrics";

/**
 * A stock split as the filer's own facts show it. `ratio` is new shares per old share: 10
 * for a 10-for-1 split, 0.05 for a 1-for-20 reverse split. `effective` is the earliest
 * filing date that reports on the new basis, so a fact filed before it is on the old one.
 */
export interface ShareSplit {
  effective: string;
  ratio: number;
  /**
   * `ratioConcept`: the filer tagged the split ratio. `restatement`: later filings re-reported
   * earlier periods' per-share or share-count facts at the ratio.
   */
  detectedFrom: "ratioConcept" | "restatement";
}

const splitRatioConcept = "StockholdersEquityNoteStockSplitConversionRatio1";
/** Tags whose re-reporting reveals a split: the statement's own plus their basic twins. */
const splitEvidenceTags: { kind: "eps" | "shares"; tags: readonly string[] }[] = [
  { kind: "eps", tags: [...metricSpecs.dilutedEps.tags, "EarningsPerShareBasic"] },
  { kind: "shares", tags: [...metricSpecs.dilutedShares.tags, "WeightedAverageNumberOfSharesOutstandingBasic"] },
];
/** EPS is filed to the cent, so either side of a re-report may be off by half a cent. */
const epsRounding = 0.005;
/** Share counts are filed rounded to thousands or so, never by more than this share. */
const sharesTolerance = 0.01;
/** Ratio-concept facts this close together describe the same split. */
const sameSplitDays = 366;

/** The one split ratio an interval of possible multipliers pins down: an integer ≥ 2 or its reciprocal. */
function splitRatioWithin(lo: number, hi: number): number | undefined {
  const whole = (from: number, to: number): number | undefined => {
    const first = Math.ceil(from);
    // Exactly one whole candidate and not 1: otherwise the evidence cannot tell a split from
    // no change or from a rounding accident.
    return first >= 2 && first <= to && first + 1 > to ? first : undefined;
  };
  if (!(lo > 0) || !(hi >= lo)) return undefined;
  const forward = whole(lo, hi);
  if (forward !== undefined) return forward;
  const reverse = whole(1 / hi, 1 / lo);
  return reverse !== undefined ? 1 / reverse : undefined;
}

/** One period re-reported by a later filing: the multiplier it implies, as an interval, and when. */
interface ReReport {
  lo: number;
  hi: number;
  oldFiled: string;
  newFiled: string;
}

/**
 * Each consecutive pair of filings reporting the same period of an EPS or share-count tag,
 * as the share multiplier between them: old ÷ new for EPS, new ÷ old for shares.
 */
function reReports(facts: CompanyFacts, asOf?: string): ReReport[] {
  const found: ReReport[] = [];
  for (const { kind, tags } of splitEvidenceTags) {
    for (const tag of tags) {
      const periods = new Map<string, FactEntry[]>();
      for (const entry of entriesFor(facts, "us-gaap", tag, kind)) {
        if (typeof entry.val !== "number" || !entry.end || !entry.filed) continue;
        if (asOf && entry.filed > asOf) continue;
        const key = `${entry.start ?? ""}|${entry.end}`;
        periods.set(key, [...(periods.get(key) ?? []), entry]);
      }
      for (const entries of periods.values()) {
        entries.sort((a, b) => a.filed.localeCompare(b.filed));
        for (let i = 1; i < entries.length; i++) {
          const before = entries[i - 1];
          const after = entries[i];
          if (before.filed === after.filed || before.val === 0 || after.val === 0) continue;
          if (Math.sign(before.val) !== Math.sign(after.val)) continue;
          const old = Math.abs(before.val);
          const now = Math.abs(after.val);
          let lo: number;
          let hi: number;
          if (kind === "eps") {
            if (now <= epsRounding) continue;
            lo = Math.max(0, old - epsRounding) / (now + epsRounding);
            hi = (old + epsRounding) / (now - epsRounding);
          } else {
            lo = (now / old) * (1 - sharesTolerance);
            hi = (now / old) * (1 + sharesTolerance);
          }
          found.push({ lo, hi, oldFiled: before.filed, newFiled: after.filed });
        }
      }
    }
  }
  return found;
}

/** The product of the splits that took effect after `filed`, up to and including `until`. */
function splitFactor(splits: ShareSplit[], filed: string, until?: string): number {
  let factor = 1;
  for (const split of splits) {
    if (filed < split.effective && (!until || split.effective <= until)) factor *= split.ratio;
  }
  return factor;
}

/** Splits the filer tagged with the ratio concept, dated by the first filing that carried it. */
function taggedSplits(facts: CompanyFacts, reports: ReReport[], asOf?: string): ShareSplit[] {
  const entries: FactEntry[] = [];
  for (const taxonomy of ["us-gaap", "dei"]) {
    for (const list of Object.values(facts.facts?.[taxonomy]?.[splitRatioConcept]?.units ?? {})) {
      for (const entry of list) {
        if (typeof entry.val !== "number" || !Number.isFinite(entry.val) || entry.val <= 0) continue;
        if (Math.abs(entry.val - 1) < 1e-9 || !entry.end || !entry.filed) continue;
        if (asOf && entry.filed > asOf) continue;
        // A split announced but not yet in effect when the filing went in.
        if (entry.filed < entry.end) continue;
        entries.push(entry);
      }
    }
  }
  entries.sort((a, b) => a.end.localeCompare(b.end));

  const magnitude = (value: number) => (value >= 1 ? value : 1 / value);
  const groups: { end: string; filed: string; value: number }[] = [];
  for (const entry of entries) {
    const group = groups.find(
      (candidate) =>
        Math.abs(magnitude(candidate.value) / magnitude(entry.val) - 1) < 0.01 && days(candidate.end, entry.end) <= sameSplitDays,
    );
    if (!group) groups.push({ end: entry.end, filed: entry.filed, value: entry.val });
    else if (entry.filed < group.filed) group.filed = entry.filed;
  }

  return groups.map((group) => {
    const size = magnitude(group.value);
    // Re-reports across this split say which way it went, and may show the new basis earlier
    // than the first filing that tagged the ratio.
    const across = reports.filter((report) => report.oldFiled < group.filed && report.newFiled >= group.end);
    const forward = across.filter((report) => report.lo <= size * 1.01 && report.hi >= size * 0.99);
    const reverse = across.filter((report) => report.lo <= (1 / size) * 1.01 && report.hi >= (1 / size) * 0.99);
    const ratio = forward.length === reverse.length ? group.value : forward.length > reverse.length ? size : 1 / size;
    const supporting = ratio >= 1 ? forward : reverse;
    const effective = supporting.reduce((earliest, report) => (report.newFiled < earliest ? report.newFiled : earliest), group.filed);
    return { effective, ratio, detectedFrom: "ratioConcept" as const };
  });
}

/**
 * Every split the filer's facts reveal, as of the cutoff. Tagged splits come first; then,
 * one at a time, the largest cluster of re-reports that the known splits do not explain
 * and that all imply the same integer ratio (or its reciprocal) becomes a split dated by
 * its earliest new-basis filing. Two re-reports at least, so one restated EPS that
 * happens to halve is not a split; a ratio that is not a whole multiple never is.
 */
export function detectSplits(facts: CompanyFacts, asOf?: string): ShareSplit[] {
  const reports = reReports(facts, asOf);
  const splits = taggedSplits(facts, reports, asOf);

  for (let round = 0; round < 20; round++) {
    const clusters: { ratio: number; effective: string; members: ReReport[] }[] = [];
    for (const report of [...reports].sort((a, b) => a.newFiled.localeCompare(b.newFiled))) {
      const factor = splitFactor(splits, report.oldFiled, report.newFiled);
      const ratio = splitRatioWithin(report.lo / factor, report.hi / factor);
      if (ratio === undefined) continue;
      // Same ratio, and the old side predates the cluster's first new-basis filing.
      const cluster = clusters.findLast(
        (candidate) => Math.abs(candidate.ratio / ratio - 1) < 1e-9 && report.oldFiled < candidate.effective,
      );
      if (cluster) cluster.members.push(report);
      else clusters.push({ ratio, effective: report.newFiled, members: [report] });
    }
    const best = clusters
      .filter((cluster) => cluster.members.length >= 2)
      .sort((a, b) => b.members.length - a.members.length || a.effective.localeCompare(b.effective))[0];
    if (!best) break;
    splits.push({ effective: best.effective, ratio: best.ratio, detectedFrom: "restatement" });
  }
  return splits.sort((a, b) => a.effective.localeCompare(b.effective));
}

/** The splits a filer's facts reveal, and the cutoff whose share basis every fact is put on. */
export interface ShareBasis {
  splits: ShareSplit[];
  asOf?: string;
}

/**
 * A per-share or share-count fact on the basis in force at the cutoff: divided (EPS) or
 * multiplied (shares) by every split that took effect after it was filed and by the
 * cutoff. A later split is ignored, and money is never touched.
 */
export function onShareBasis(
  basis: ShareBasis,
  kind: LineKind,
  entry: FactEntry,
): { val: number; shareSplits?: ShareSplit[] } {
  if (kind !== "eps" && kind !== "shares") return { val: entry.val };
  const used = basis.splits.filter(
    (split) => entry.filed < split.effective && (!basis.asOf || split.effective <= basis.asOf),
  );
  if (used.length === 0) return { val: entry.val };
  const factor = used.reduce((product, split) => product * split.ratio, 1);
  const val = Number((kind === "eps" ? entry.val / factor : entry.val * factor).toPrecision(12));
  return { val, shareSplits: used };
}
