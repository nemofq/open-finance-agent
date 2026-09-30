import type { CompanyFacts, FactEntry } from "./xbrl/metrics";

/**
 * A synthetic filer with two calendar fiscal years. FY2024 reports its fourth quarter
 * explicitly; FY2025 does not, which is the normal case and the one worth deriving.
 */

type Unit = "USD" | "USD/shares" | "shares";

function duration(
  start: string,
  end: string,
  val: number,
  extra: Partial<FactEntry> = {},
): FactEntry {
  const fy = Number(end.slice(0, 4));
  return {
    start,
    end,
    val,
    accn: `0000000000-${String(fy).slice(2)}-000001`,
    fy,
    fp: "FY",
    form: "10-K",
    filed: `${fy + 1}-02-15`,
    ...extra,
  };
}

const quarter = (start: string, end: string, val: number, fp: string, extra: Partial<FactEntry> = {}) =>
  duration(start, end, val, {
    fp,
    form: "10-Q",
    accn: `0000000000-${end.slice(2, 4)}-0000${fp[1]}0`,
    filed: `${end.slice(0, 4)}-${fp === "Q1" ? "04" : fp === "Q2" ? "07" : "10"}-30`,
    ...extra,
  });

function instant(end: string, val: number, extra: Partial<FactEntry> = {}): FactEntry {
  const fy = Number(end.slice(0, 4));
  return {
    end,
    val,
    accn: `0000000000-${String(fy).slice(2)}-000001`,
    fy,
    fp: "FY",
    form: "10-K",
    filed: `${fy + 1}-02-15`,
    ...extra,
  };
}

const tag = (unit: Unit, entries: FactEntry[]) => ({ units: { [unit]: entries } });

const quarters2024: [string, string, string][] = [
  ["2024-01-01", "2024-03-31", "Q1"],
  ["2024-04-01", "2024-06-30", "Q2"],
  ["2024-07-01", "2024-09-30", "Q3"],
];
const quarters2025: [string, string, string][] = [
  ["2025-01-01", "2025-03-31", "Q1"],
  ["2025-04-01", "2025-06-30", "Q2"],
  ["2025-07-01", "2025-09-30", "Q3"],
];

function flow(annual2025: number, annual2024: number, q2025: number[], q2024: number[], q4of2024: number) {
  return [
    duration("2025-01-01", "2025-12-31", annual2025),
    duration("2024-01-01", "2024-12-31", annual2024),
    ...quarters2025.map(([s, e, fp], i) => quarter(s, e, q2025[i], fp)),
    ...quarters2024.map(([s, e, fp], i) => quarter(s, e, q2024[i], fp)),
    // FY2024 reported its own Q4 in the 10-K.
    duration("2024-10-01", "2024-12-31", q4of2024, { form: "10-K" }),
  ];
}

export const fixtureFacts: CompanyFacts = {
  cik: 1234567,
  entityName: "Fixture Corp",
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: tag("USD", [
        ...flow(1_200e6, 1_000e6, [250e6, 270e6, 300e6], [200e6, 220e6, 250e6], 330e6),
        // A stale duplicate of Q1 2025: the later-filed fact must win.
        quarter("2025-01-01", "2025-03-31", 999e6, "Q1", {
          accn: "0000000000-25-000099",
          filed: "2025-02-01",
        }),
        // Year-to-date facts are not quarters.
        quarter("2025-01-01", "2025-06-30", 520e6, "Q2"),
        // A registration statement is not a periodic report.
        duration("2025-01-01", "2025-12-31", 9_999e6, { form: "S-1" }),
      ]),
      // The fallback tag covers a year the preferred tag never reported, and must lose where both exist.
      Revenues: tag("USD", [
        duration("2023-01-01", "2023-12-31", 900e6),
        duration("2024-01-01", "2024-12-31", 999e6),
      ]),
      CostOfGoodsAndServicesSold: tag("USD", flow(700e6, 600e6, [150e6, 160e6, 175e6], [125e6, 130e6, 145e6], 200e6)),
      OperatingIncomeLoss: tag("USD", flow(200e6, 160e6, [40e6, 45e6, 50e6], [30e6, 35e6, 40e6], 55e6)),
      NetIncomeLoss: tag("USD", flow(150e6, 120e6, [30e6, 35e6, 40e6], [25e6, 28e6, 30e6], 37e6)),
      EarningsPerShareDiluted: tag("USD/shares", flow(1.5, 1.2, [0.3, 0.35, 0.4], [0.25, 0.28, 0.3], 0.37)),
      WeightedAverageNumberOfDilutedSharesOutstanding: tag(
        "shares",
        flow(100e6, 100e6, [100e6, 100e6, 100e6], [100e6, 100e6, 100e6], 100e6),
      ),
      NetCashProvidedByUsedInOperatingActivities: tag(
        "USD",
        flow(250e6, 200e6, [50e6, 60e6, 65e6], [40e6, 48e6, 52e6], 60e6),
      ),
      PaymentsToAcquirePropertyPlantAndEquipment: tag(
        "USD",
        flow(50e6, 40e6, [10e6, 12e6, 13e6], [8e6, 10e6, 11e6], 11e6),
      ),
      Assets: tag("USD", [
        instant("2025-12-31", 2_000e6),
        instant("2025-09-30", 1_900e6, { form: "10-Q", fp: "Q3" }),
        instant("2024-12-31", 1_800e6),
      ]),
      Liabilities: tag("USD", [instant("2025-12-31", 1_200e6), instant("2024-12-31", 1_100e6)]),
      StockholdersEquity: tag("USD", [instant("2025-12-31", 800e6), instant("2024-12-31", 700e6)]),
      CashAndCashEquivalentsAtCarryingValue: tag("USD", [
        instant("2025-12-31", 300e6),
        instant("2024-12-31", 250e6),
      ]),
      LongTermDebtNoncurrent: tag("USD", [instant("2025-12-31", 500e6), instant("2024-12-31", 520e6)]),
    },
  },
};
