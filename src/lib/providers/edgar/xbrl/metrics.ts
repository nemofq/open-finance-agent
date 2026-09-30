/**
 * What a filer's XBRL `companyfacts` document holds, the tags each statement metric is read from,
 * and reading one tag's facts in the filer's reporting unit.
 */

export interface FactEntry {
  /** Present on duration facts (income/cash-flow lines), absent on instants (balance sheet). */
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

export interface CompanyFacts {
  cik: number | string;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, FactEntry[]> }>>;
}

export type Period = "quarterly" | "annual";
export type StatementId = "income" | "balance" | "cashflow" | "key_metrics";
export type LineKind = "flow" | "stock" | "eps" | "shares";
export type Format = "money" | "eps" | "shares" | "percent";

/** Tags are tried in order; the first one with a value for a period wins. */
export const metricSpecs = {
  revenue: {
    kind: "flow",
    tags: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
  },
  costOfRevenue: {
    kind: "flow",
    tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"],
  },
  grossProfit: { kind: "flow", tags: ["GrossProfit"] },
  operatingIncome: { kind: "flow", tags: ["OperatingIncomeLoss"] },
  netIncome: {
    kind: "flow",
    tags: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  },
  dilutedEps: { kind: "eps", tags: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"] },
  dilutedShares: {
    kind: "shares",
    tags: [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfDilutedSharesOutstandingBasicAndDiluted",
    ],
  },
  assets: { kind: "stock", tags: ["Assets"] },
  liabilities: { kind: "stock", tags: ["Liabilities"] },
  equity: {
    kind: "stock",
    tags: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
  },
  cash: {
    kind: "stock",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  longTermDebt: {
    kind: "stock",
    tags: [
      "LongTermDebtNoncurrent",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligations",
      "LongTermDebtAndCapitalLeaseObligationsNoncurrent",
    ],
  },
  operatingCashFlow: {
    kind: "flow",
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  capex: {
    kind: "flow",
    tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  },
} as const satisfies Record<string, { kind: LineKind; tags: readonly string[] }>;

/** Standard IFRS taxonomy equivalents, kept separate from US GAAP tag priority. */
export const ifrsTags: Partial<Record<keyof typeof metricSpecs, readonly string[]>> = {
  revenue: ["RevenueFromContractsWithCustomers"],
  costOfRevenue: ["CostOfSales"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["ProfitLossFromOperatingActivities"],
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  equity: ["Equity"],
  cash: ["CashAndCashEquivalents"],
  operatingCashFlow: ["CashFlowsFromUsedInOperatingActivities"],
  capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
};

export type MetricName = keyof typeof metricSpecs;

/**
 * Lines a 10-Q tags only year to date: the cash-flow statement runs from the start of the
 * fiscal year, so Q2 and Q3 exist only as differences of consecutive cumulative facts.
 * Income lines are reported as discrete quarters and are left alone.
 */
export const yearToDateMetrics: ReadonlySet<MetricName> = new Set(["operatingCashFlow", "capex"]);

/* ------------------------------------------------------------ reading facts */

export function reportedCurrency(facts: CompanyFacts): string {
  const units = ["us-gaap", "ifrs-full"].flatMap((taxonomy) =>
    Object.values(facts.facts?.[taxonomy] ?? {}).flatMap((concept) => Object.keys(concept.units)),
  );
  return units.find((unit) => /^[A-Z]{3}$/.test(unit)) ?? "USD";
}

export function days(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

/** `10-K/A` counts as a `10-K`. */
export function baseForm(form: string): string {
  return form.split("/")[0].toUpperCase();
}

export function entriesFor(facts: CompanyFacts, taxonomyName: "us-gaap" | "ifrs-full", tag: string, kind: LineKind): FactEntry[] {
  const taxonomy = facts.facts?.[taxonomyName] ?? {};
  const units = taxonomy[tag]?.units;
  if (!units) return [];
  const currency = reportedCurrency(facts);
  const allowed = kind === "shares" ? ["shares"] : kind === "eps" ? [`${currency}/shares`] : [currency];
  for (const unit of allowed) {
    if (units[unit]?.length) return units[unit];
  }
  return [];
}
