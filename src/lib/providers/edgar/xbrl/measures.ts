/** Statement lines the filer does not tag, computed from the ones it does. */
import type { MetricName } from "./metrics";
import type { Point } from "./series";

export interface Ctx {
  value(metric: MetricName, end: string): number | undefined;
  point(metric: MetricName, end: string): Point | undefined;
  yearAgo(end: string): string | undefined;
}

export function grossProfit(ctx: Ctx, end: string): number | undefined {
  const reported = ctx.value("grossProfit", end);
  if (reported !== undefined) return reported;
  const revenue = ctx.value("revenue", end);
  const cost = ctx.value("costOfRevenue", end);
  return revenue !== undefined && cost !== undefined ? revenue - cost : undefined;
}

export function freeCashFlow(ctx: Ctx, end: string): number | undefined {
  const operating = ctx.value("operatingCashFlow", end);
  const capex = ctx.value("capex", end);
  return operating !== undefined && capex !== undefined ? operating - capex : undefined;
}

export function margin(part: number | undefined, whole: number | undefined): number | undefined {
  return part !== undefined && whole !== undefined && whole !== 0 ? (part / whole) * 100 : undefined;
}

export function revenueGrowth(ctx: Ctx, end: string): number | undefined {
  const prior = ctx.yearAgo(end);
  if (!prior) return undefined;
  const now = ctx.value("revenue", end);
  const before = ctx.value("revenue", prior);
  return now !== undefined && before !== undefined && before !== 0
    ? ((now - before) / Math.abs(before)) * 100
    : undefined;
}
