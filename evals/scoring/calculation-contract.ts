import type { EvidenceEntry } from "@/lib/evidence/types";
import type { EvalCalculationTarget, EvalTask } from "../types";
import { normalizePeriod, normalizeSourceUrl } from "../offline/coverage-contract";

type CalculationContract = Extract<EvalTask["contracts"][number], { kind: "verified_calculation" }>;

function exactFact(entry: EvidenceEntry, ticker: string, metric: string, periodType: "quarterly" | "annual", period: string, asOfDate: string): number | undefined {
  if (entry.kind !== "E" || entry.lookAhead || entry.source?.tier !== 1 || entry.tool !== "edgar_financials" ||
      entry.entity?.ticker?.toUpperCase() !== ticker.toUpperCase()) return undefined;
  const fact = entry.facts?.find((item) => item.metric === metric && item.periodType === periodType && normalizePeriod(item.period) === normalizePeriod(period) &&
    (item.end ?? item.period).slice(0, 10) <= asOfDate && Number.isFinite(item.value));
  return fact?.value;
}

function factValue(inputs: EvidenceEntry[], ticker: string, metric: string, periodType: "quarterly" | "annual", period: string, asOfDate: string): number | undefined {
  for (const entry of inputs) {
    const value = exactFact(entry, ticker, metric, periodType, period, asOfDate);
    if (value !== undefined) return value;
  }
  return undefined;
}

function quotePrice(inputs: EvidenceEntry[], ticker: string, date: string): number | undefined {
  for (const entry of inputs) {
    if (entry.kind !== "E" || entry.lookAhead ||
        !["market_quotes", "alphavantage__GLOBAL_QUOTE", "alphavantage__TIME_SERIES_DAILY"].includes(entry.tool ?? "")) continue;
    const fact = entry.facts?.find((item) => item.period === date && item.value > 0 && item.unit === "USD" &&
      (item.metric === `${ticker} price` || (entry.entity?.ticker?.toUpperCase() === ticker && ["price", "close"].includes(item.metric))));
    if (fact) return fact.value;
  }
  return undefined;
}

function filingGrowth(inputs: EvidenceEntry[], target: Extract<EvalCalculationTarget, { kind: "filing_guidance_growth" }>): number | undefined {
  const source = inputs.find((entry) => {
    if (entry.kind !== "E" || entry.tool !== "edgar_read_filing" || entry.lookAhead || entry.source?.tier !== 1) return false;
    const url = entry.args?.url;
    return typeof url === "string" && normalizeSourceUrl(url) === normalizeSourceUrl(target.url);
  });
  if (!source) return undefined;
  // The filing must actually contain both operands. Its text normalizer may round 30.04B to
  // 30.0B, so this is only a source-presence check; the target arithmetic uses the pinned values.
  for (const value of [target.currentRevenue, target.guidedRevenue]) {
    if (!source.numbers?.some((item) => Math.abs(item.value - value) <= value * 0.005)) return undefined;
  }
  return ((target.guidedRevenue - target.currentRevenue) / target.currentRevenue) * 100;
}

function expectedValue(target: EvalCalculationTarget, task: EvalTask, inputs: EvidenceEntry[]): number | undefined {
  switch (target.kind) {
    case "fact_growth": {
      const current = factValue(inputs, target.ticker, target.metric, target.periodType, target.currentPeriod, task.asOfDate);
      const prior = factValue(inputs, target.ticker, target.metric, target.periodType, target.priorPeriod, task.asOfDate);
      return current !== undefined && prior !== undefined && prior !== 0 ? ((current - prior) / Math.abs(prior)) * 100 : undefined;
    }
    case "fact_sum": {
      const values = target.periods.map((period) => factValue(inputs, target.ticker, target.metric, target.periodType, period, task.asOfDate));
      return values.every((value) => value !== undefined) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
    }
    case "annual_income_rate": {
      const supplied = [target.principal, target.monthlyIncome].every((value) =>
        inputs.some((entry) => entry.kind === "U" && entry.origin === "message" && entry.value === value));
      return supplied ? (target.monthlyIncome * 12 / target.principal) * 100 : undefined;
    }
    case "portfolio_top_weight": {
      if (!task.holdings?.length) return undefined;
      const values: number[] = [];
      for (const holding of task.holdings) {
        const ticker = holding.symbol.toUpperCase();
        const price = quotePrice(inputs, ticker, target.quoteDate);
        const quantity = inputs.some((entry) => entry.kind === "U" && entry.origin === "holdings" &&
          entry.entity?.ticker?.toUpperCase() === ticker && entry.value === holding.quantity);
        if (price === undefined || !quantity) return undefined;
        values.push(price * holding.quantity);
      }
      const total = values.reduce((sum, value) => sum + value, 0);
      return total > 0 ? Math.max(...values) / total * 100 : undefined;
    }
    case "filing_guidance_growth":
      return filingGrowth(inputs, target);
  }
}

/** A visible C figure is credited only when independently recomputed from the task's exact inputs. */
export function verifiedCalculation(contract: CalculationContract, task: EvalTask, evidence: EvidenceEntry[], backed: Set<string>): boolean {
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  const unit = contract.target.kind === "fact_sum" ? "USD" : "%";
  return evidence.some((entry) => {
    if (entry.kind !== "C" || !backed.has(entry.id) || !Number.isFinite(entry.value) || entry.unit !== unit || !entry.inputs?.length) return false;
    const inputs = entry.inputs.map((id) => byId.get(id));
    if (inputs.some((input) => input === undefined)) return false;
    const expected = expectedValue(contract.target, task, inputs.filter((input): input is EvidenceEntry => input !== undefined));
    return expected !== undefined && Math.abs((entry.value ?? NaN) - expected) <= contract.tolerance;
  });
}
