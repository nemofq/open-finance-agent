import type { EvidenceLedger } from "@/lib/evidence/types";
import { createLedger } from "@/lib/evidence/ledger";

/**
 * A ledger holding the kinds of entry a report draws on: a filing with facts, a vendor series,
 * a quote with loose numbers, a computed figure, an assumption and a user-provided number.
 */
export function fixtureLedger(): EvidenceLedger {
  const ledger = createLedger({ sessionId: "fixture" });

  ledger.add({
    kind: "E",
    summary: "EDGAR income statement, quarterly, $ACME, 8 periods",
    tool: "edgar_financials",
    source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
    entity: { ticker: "ACME", cik: "0000012345", name: "Acme Corporation" },
    asOf: "2026-08-01",
    currency: "USD",
    facts: [
      { metric: "revenue", period: "FY26 Q2", value: 4_318_000_000, unit: "USD", end: "2026-06-30" },
      { metric: "revenue", period: "FY25 Q2", value: 3_883_000_000, unit: "USD", end: "2025-06-30" },
      { metric: "dilutedEps", period: "FY26 Q2", value: 1.79, unit: "USD/share" },
    ],
  });

  ledger.add({
    kind: "E",
    summary: "Alpha Vantage EARNINGS, $ACME",
    tool: "alphavantage__EARNINGS",
    source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
    entity: { ticker: "ACME" },
    asOf: "2026-09-10",
    facts: [
      { metric: "eps_estimate", period: "FY26 Q3", value: 1.87, unit: "USD/share" },
      { metric: "eps_actual", period: "FY26 Q2", value: 1.79, unit: "USD/share" },
    ],
  });

  ledger.add({
    kind: "E",
    summary: "Alpha Vantage GLOBAL_QUOTE, $ACME",
    tool: "alphavantage__GLOBAL_QUOTE",
    source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
    entity: { ticker: "ACME" },
    asOf: "2026-09-10",
    numbers: [{ value: 214.6, unit: "USD", context: "last price 214.60" }],
  });

  ledger.add({
    kind: "C",
    summary: "Year-over-year revenue growth, FY26 Q2",
    name: "yoy revenue growth",
    value: 11.2,
    unit: "%",
    formula: "fin.growth(revenue)",
    inputs: ["E1"],
  });

  ledger.add({
    kind: "A",
    summary: "Weighted average cost of capital",
    name: "WACC",
    value: 8.5,
    unit: "%",
    why: "peer median cost of capital, no company disclosure",
    declared: true,
  });

  ledger.add({
    kind: "U",
    summary: "Position size stated in chat",
    name: "position",
    value: 250,
    unit: "shares",
    origin: "message",
  });

  return ledger;
}
