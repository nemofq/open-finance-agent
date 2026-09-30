/**
 * One metric's facts as a series of periods: filtered to the period type and the cutoff, put on
 * one share basis, and completed with the quarters a filer reports only as a fourth quarter or
 * year to date.
 */
import {
  baseForm,
  type CompanyFacts,
  days,
  entriesFor,
  type FactEntry,
  ifrsTags,
  type LineKind,
  type MetricName,
  metricSpecs,
  type Period,
  yearToDateMetrics,
} from "./metrics";
import { onShareBasis, type ShareBasis, type ShareSplit } from "./splits";

export interface Point {
  end: string;
  start?: string;
  val: number;
  accn: string;
  filed: string;
  /** How a quarter the filer never reported on its own was reconstructed; absent on reported facts. */
  derivation?: Derivation;
  /** Splits the value was restated for, when it was filed on an older share basis. */
  shareSplits?: ShareSplit[];
}

/**
 * `fourthQuarter`: FY minus Q1..Q3. `yearToDate`: a cumulative fact minus the one a quarter
 * earlier in the same fiscal year.
 */
export type Derivation = "fourthQuarter" | "yearToDate";

export type Series = Map<string, Point>;

const annualForms = ["10-K", "20-F", "40-F"];
const quarterlyForms = ["10-K", "10-Q"];
const durationWindows = { annual: [350, 380], quarterly: [80, 100] } as const;

function keepLatest(series: Series, point: Point): void {
  const current = series.get(point.end);
  if (!current || current.filed < point.filed || (current.filed === point.filed && current.accn < point.accn)) {
    series.set(point.end, point);
  }
}

/** One tag's facts for one period type, deduplicated by period end. */
function tagSeries(
  facts: CompanyFacts,
  taxonomy: "us-gaap" | "ifrs-full",
  tag: string,
  kind: LineKind,
  period: Period,
  basis: ShareBasis,
): Series {
  const series: Series = new Map();
  const [min, max] = durationWindows[period];
  const forms = period === "annual" ? annualForms : quarterlyForms;

  for (const entry of entriesFor(facts, taxonomy, tag, kind)) {
    if (typeof entry.val !== "number" || !entry.end) continue;
    // Point in time: a fact the filer had not filed yet on the as-of date does not exist.
    if (basis.asOf && entry.filed > basis.asOf) continue;
    if (!forms.includes(baseForm(entry.form))) continue;
    if (kind === "stock") {
      if (entry.start) continue; // balance-sheet lines are instants
    } else {
      if (!entry.start) continue;
      if (period === "annual" && entry.fp !== "FY") continue;
      const length = days(entry.start, entry.end);
      if (!(length >= min && length <= max)) continue;
    }
    // Before keepLatest, so neither it nor any derivation ever mixes two share bases.
    keepLatest(series, { ...entry, ...onShareBasis(basis, kind, entry) });
  }
  return series;
}

/** Merge a metric's tags, earlier tags winning wherever they have a value. */
function metricSeries(
  facts: CompanyFacts,
  metric: MetricName,
  period: Period,
  basis: ShareBasis,
): Series {
  const { kind, tags } = metricSpecs[metric];
  const merged: Series = new Map();
  for (const [taxonomy, taxonomyTags] of [["us-gaap", tags], ["ifrs-full", ifrsTags[metric] ?? []]] as const) {
    for (const tag of taxonomyTags) {
      for (const [end, point] of tagSeries(facts, taxonomy, tag, kind, period, basis)) {
        if (!merged.has(end)) merged.set(end, point);
      }
    }
  }
  return merged;
}

/**
 * Most filers never report the fourth quarter on its own: the 10-K only shows the
 * full year. Reconstruct it as FY minus Q1..Q3 whenever all four pieces are there.
 */
function deriveFourthQuarters(quarterly: Series, annual: Series): void {
  for (const year of annual.values()) {
    const yearStart = year.start;
    if (!yearStart || quarterly.has(year.end)) continue;
    const inside = [...quarterly.values()].filter(
      (q) => q.start !== undefined && days(yearStart, q.start) >= -5 && q.end < year.end,
    );
    if (inside.length !== 3) continue;
    const sum = inside.reduce((total, q) => total + q.val, 0);
    const shareSplits = [...new Set([year, ...inside].flatMap((point) => point.shareSplits ?? []))];
    quarterly.set(year.end, {
      end: year.end,
      start: inside.reduce((latest, q) => (q.end > latest ? q.end : latest), inside[0].end),
      val: year.val - sum,
      accn: year.accn,
      filed: year.filed,
      derivation: "fourthQuarter",
      ...(shareSplits.length ? { shareSplits } : {}),
    });
  }
}

/** Duration facts of one tag that may be year to date, from Q1 up to the full year. */
function cumulativeFacts(facts: CompanyFacts, taxonomy: "us-gaap" | "ifrs-full", tag: string, asOf?: string): FactEntry[] {
  return entriesFor(facts, taxonomy, tag, "flow").filter((entry) => {
    if (typeof entry.val !== "number" || !entry.start || !entry.end) return false;
    if (asOf && entry.filed > asOf) return false;
    if (!quarterlyForms.includes(baseForm(entry.form))) return false;
    const length = days(entry.start, entry.end);
    return length >= durationWindows.quarterly[0] && length <= durationWindows.annual[1];
  });
}

const newestFirst = (a: FactEntry, b: FactEntry) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn);

/**
 * Fill quarters a filer only reports cumulatively: YTD(this quarter end) minus YTD(the
 * previous quarter end), both measured from the same fiscal-year start. Both facts come
 * from one tag and so one unit. A same-filing pair wins over a cross-filing one, so a
 * later restatement of one side never mixes with the original of the other; without one,
 * the latest filed fact on each side is used. Reported quarters are never overwritten.
 */
function deriveYearToDateQuarters(quarterly: Series, cumulative: FactEntry[], fullYears: boolean): void {
  const [quarterMin, quarterMax] = durationWindows.quarterly;
  const [annualMin] = durationWindows.annual;
  const targets = cumulative.filter((entry): entry is FactEntry & { start: string } => {
    if (entry.start === undefined) return false;
    const length = days(entry.start, entry.end);
    // Longer than a quarter, so there is an earlier cumulative fact to subtract.
    return length > quarterMax && (length >= annualMin) === fullYears;
  });
  const periods = new Map<string, { start: string; end: string }>();
  for (const entry of targets) periods.set(`${entry.start}|${entry.end}`, { start: entry.start, end: entry.end });

  for (const { start, end } of [...periods.values()].sort((a, b) => a.end.localeCompare(b.end))) {
    if (quarterly.has(end)) continue;
    const current = targets.filter((entry) => entry.start === start && entry.end === end).sort(newestFirst);
    // The cumulative fact exactly one quarter earlier, from the same fiscal-year start.
    const earlier = cumulative.filter((entry) => {
      if (entry.start !== start || entry.end >= end) return false;
      const gap = days(entry.end, end);
      return gap >= quarterMin && gap <= quarterMax;
    });
    if (earlier.length === 0) continue;
    const priorEnd = earlier.reduce((latest, entry) => (entry.end > latest ? entry.end : latest), earlier[0].end);
    const prior = earlier.filter((entry) => entry.end === priorEnd).sort(newestFirst);

    const sameFiling = current.find((entry) => prior.some((candidate) => candidate.accn === entry.accn));
    const later = sameFiling ?? current[0];
    const before = (sameFiling && prior.find((candidate) => candidate.accn === sameFiling.accn)) ?? prior[0];
    quarterly.set(end, {
      end,
      start: priorEnd,
      val: later.val - before.val,
      accn: later.accn,
      filed: later.filed > before.filed ? later.filed : before.filed,
      derivation: "yearToDate",
    });
  }
}

export function buildSeries(facts: CompanyFacts, period: Period, basis: ShareBasis): Map<MetricName, Series> {
  const all = new Map<MetricName, Series>();
  for (const metric of Object.keys(metricSpecs) as MetricName[]) {
    const series = metricSeries(facts, metric, period, basis);
    const derivable = metricSpecs[metric].kind === "flow" || metricSpecs[metric].kind === "eps";
    // Year-to-date facts live under either taxonomy, the same way metricSeries reads them.
    const cumulative =
      period === "quarterly" && yearToDateMetrics.has(metric)
        ? ([["us-gaap", metricSpecs[metric].tags], ["ifrs-full", ifrsTags[metric] ?? []]] as const)
            .flatMap(([taxonomy, tags]) => tags.map((tag) => cumulativeFacts(facts, taxonomy, tag, basis.asOf)))
        : [];
    // Q2 and Q3 first, so the fourth-quarter path below has all three quarters to subtract.
    for (const tagFacts of cumulative) deriveYearToDateQuarters(series, tagFacts, false);
    if (period === "quarterly" && derivable) {
      deriveFourthQuarters(series, metricSeries(facts, metric, "annual", basis));
    }
    // A Q4 the sum path could not reach, say for want of Q1, is still FY minus nine months.
    for (const tagFacts of cumulative) deriveYearToDateQuarters(series, tagFacts, true);
    all.set(metric, series);
  }
  return all;
}
