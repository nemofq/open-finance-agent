/**
 * StockFit MCP responses for a synthetic filer, FIXT, shaped like the real server's. Revenue for the
 * June quarter was revised by the September 10-Q, and the September quarter's D&A is reconstructed
 * from the nine-month and half-year figures, as StockFit marks it.
 */

const Q2_10Q = "0001234567-25-000030";
const Q3_10Q = "0001234567-25-000050";
const FY_10K = "0001234567-25-000010";

export const fixtAccessions = { Q2_10Q, Q3_10Q, FY_10K };

/** `financials_income_statement` with `period=quarter`, newest first. */
export const incomeQuarterly = [
  {
    period: "2025-09-30",
    fiscalYear: 2025,
    fiscalPeriod: "Q3",
    dateFiled: "2025-10-30",
    acceptedAt: "2025-10-30T16:05:00Z",
    facts: { revenue: 1200, netIncome: 150, depreciationAndAmortization: 40, eps: 0.75, epsDiluted: 0.74, weightedAverageSharesOutstandingDiluted: 203, ebitda: 260 },
    sources: {
      [Q3_10Q]: { type: "10-Q", dateFiled: "2025-10-30", acceptedAt: "2025-10-30T16:05:00Z", amendment: false, facts: { revenue: {}, netIncome: {}, eps: {}, epsDiluted: {}, weightedAverageSharesOutstandingDiluted: {} } },
      "Q3-Recon-9M-H1": { type: "Q3-Recon", amendment: false, facts: { depreciationAndAmortization: {} } },
    },
    derived: ["ebitda"],
  },
  {
    period: "2025-06-30",
    fiscalYear: 2025,
    fiscalPeriod: "Q2",
    dateFiled: "2025-07-30",
    acceptedAt: "2025-07-30T16:02:00Z",
    facts: { revenue: 1000, netIncome: 120, depreciationAndAmortization: 38, eps: 0.6, epsDiluted: 0.59, weightedAverageSharesOutstandingDiluted: 202, ebitda: 230 },
    sources: {
      [Q2_10Q]: { type: "10-Q", dateFiled: "2025-07-30", acceptedAt: "2025-07-30T16:02:00Z", amendment: false, facts: { revenue: {}, netIncome: {}, depreciationAndAmortization: {}, eps: {}, epsDiluted: {}, weightedAverageSharesOutstandingDiluted: {} } },
      [Q3_10Q]: { type: "10-Q", dateFiled: "2025-10-30", acceptedAt: "2025-10-30T16:05:00Z", amendment: false, facts: { revenue: { before: 990 } } },
    },
    derived: ["ebitda"],
  },
];

/** `financials_balance_sheet` with `period=annual`; one cash figure the server could not convert to USD. */
export const balanceAnnual = [
  {
    period: "2024-12-31",
    fiscalYear: 2024,
    fiscalPeriod: "FY",
    dateFiled: "2025-02-15",
    acceptedAt: "2025-02-15T21:30:00Z",
    facts: { assets: 9000, liabilities: 5000, stockholdersEquity: 4000, cash: 700, longTermDebt: 2100, sharesOutstanding: 200 },
    sources: {
      [FY_10K]: { type: "10-K", dateFiled: "2025-02-15", acceptedAt: "2025-02-15T21:30:00Z", amendment: false, facts: { assets: {}, liabilities: {}, stockholdersEquity: {}, cash: {}, longTermDebt: {}, sharesOutstanding: {} } },
    },
    fx: { targetCurrency: "USD", originalCurrencies: ["USD", "EUR"], rates: [], unconverted: { EUR: ["cash"] } },
  },
];

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** `price_history` at daily resolution, adjusted closes. */
export const priceHistory = {
  cik: 1234567,
  delayNotice: "Data delayed 15 minutes",
  symbol: "FIXT",
  resolution: "1d",
  adjustedAsOf: "2025-07-02T22:00:00.000Z",
  data: [
    [day("2025-06-27"), 99],
    [day("2025-06-30"), 100],
    [day("2025-07-01"), 101.5],
  ],
  latestQuote: { ts: "2025-07-01T00:00:00.000Z", open: 100.2, high: 102, low: 99.8, close: 101.5, adjClose: 101.5, volume: 1200000 },
};

const selector = { symbol: { type: "string" }, cik: { type: "integer" } };

/** What `tools/list` returns for the fixture tools: their argument names, which `prepareArgs` reads. */
export const fixtureTools = [
  { name: "financials_income_statement", inputSchema: { type: "object", properties: { ...selector, period: { type: "string" }, limit: { type: "integer" }, currency: { type: "string" }, splitAdjust: { type: "boolean" } } } },
  { name: "financials_balance_sheet", inputSchema: { type: "object", properties: { ...selector, period: { type: "string" }, currency: { type: "string" }, splitAdjust: { type: "boolean" } } } },
  { name: "price_history", inputSchema: { type: "object", properties: { ...selector, from: { type: "string" }, to: { type: "string" }, adjusted: { type: "boolean" } } } },
  { name: "company_details", inputSchema: { type: "object", properties: selector } },
];

/** The fixture body for one tool call, as the server's text. */
export function fixtureBody(toolName: string): string | undefined {
  const bodies: Record<string, unknown> = {
    financials_income_statement: incomeQuarterly,
    financials_balance_sheet: balanceAnnual,
    price_history: priceHistory,
    company_details: { symbol: "FIXT", name: "Fixture Corp", cik: 1234567, exchange: "NASDAQ" },
  };
  return toolName in bodies ? JSON.stringify(bodies[toolName]) : undefined;
}
