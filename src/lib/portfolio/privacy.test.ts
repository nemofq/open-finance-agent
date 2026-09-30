import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManualPosition, removeCurrentPosition } from "./manual";
import { portfolioPrivacySummary } from "./privacy";
import { createPortfolioStore } from "./store";
import type { PortfolioStore } from "./types";

let root: string;
let store: PortfolioStore;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "ofa-privacy-"));
  store = createPortfolioStore(path.join(root, "portfolio"));
  await store.saveAccount({
    id: "a1",
    name: "Fidelity brokerage",
    type: "taxable",
    baseCurrency: "USD",
    costBasisMethod: "fifo",
    source: { kind: "manual" },
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Later than every position below, some of which the server dates today. */
const TODAY = "2099-12-31";

describe("portfolioPrivacySummary", () => {
  it("is empty for an empty ledger apart from the account names", async () => {
    expect(await portfolioPrivacySummary(store, TODAY)).toEqual({
      accountNames: ["Fidelity brokerage"],
      quantities: [],
      costs: [],
      symbols: [],
    });
  });

  it("returns the quantities, cost bases, average costs and symbols a leak would expose", async () => {
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 120,
      totalCost: 42_000,
      currency: "USD",
    });
    const summary = await portfolioPrivacySummary(store, TODAY);

    expect(summary.accountNames).toEqual(["Fidelity brokerage"]);
    expect(summary.quantities).toEqual([120]);
    // The total and the average are equally identifying, so rule P3 matches on both.
    expect(summary.costs).toEqual([42_000, 350]);
    expect(summary.symbols).toEqual(["NVDA"]);
  });

  it("de-duplicates repeated values and drops anything that rounds to nothing", async () => {
    const ten = { accountId: "a1", quantity: 10, averagePrice: 10, currency: "USD" };
    await addManualPosition(store, { ...ten, symbol: "NVDA" });
    await addManualPosition(store, { ...ten, symbol: "AAPL" });
    await addManualPosition(store, { accountId: "a1", symbol: "FREE", quantity: 10, totalCost: 0, currency: "USD" });

    const summary = await portfolioPrivacySummary(store, TODAY);
    expect(summary.quantities).toEqual([10]);
    expect(summary.costs).toEqual([100, 10]);
    expect(summary.symbols).toEqual(["AAPL", "FREE", "NVDA"]);
  });

  it("forgets a position once it is removed", async () => {
    const position = await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 120,
      totalCost: 42_000,
      currency: "USD",
      acquiredAt: "2026-01-02",
    });
    await removeCurrentPosition(store, "a1", position.instrumentId as string, "2026-01-02");

    const summary = await portfolioPrivacySummary(store, TODAY);
    expect(summary.quantities).toEqual([]);
    expect(summary.costs).toEqual([]);
    expect(summary.symbols).toEqual([]);
  });
});
