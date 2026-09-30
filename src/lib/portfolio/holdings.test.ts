import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareHoldings, currentHoldings, holdingsSnapshot } from "./holdings";
import { commitImport, compareBatches } from "./import";
import { createPortfolioStore } from "./store";
import type { Account, ImportPosition, Instrument, PortfolioStore, Transaction } from "./types";

const NVDA: Instrument = { id: "i-nvda", kind: "equity", symbol: "NVDA", currency: "USD" };
const MSFT: Instrument = { id: "i-msft", kind: "equity", symbol: "MSFT", currency: "USD" };
const AAPL: Instrument = { id: "i-aapl", kind: "equity", symbol: "AAPL", currency: "USD" };

function account(id: string, name: string, institution?: string): Account {
  return {
    id,
    name,
    institution,
    type: "taxable",
    baseCurrency: "USD",
    costBasisMethod: "fifo",
    source: { kind: "manual" },
  };
}

let dir: string;
let store: PortfolioStore;

beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), "ofa-holdings-")), "portfolio");
  store = createPortfolioStore(dir);
});

afterEach(() => {
  rmSync(path.dirname(dir), { recursive: true, force: true });
});

type Draft = Omit<Transaction, "id" | "recordedAt">;

const append = (partial: Partial<Draft> & Pick<Draft, "accountId" | "type" | "tradeDate">): Promise<Transaction> =>
  store.appendTransaction({ amount: 0, currency: "USD", source: { kind: "manual" }, ...partial });

/** Two accounts, one position and one cash balance each, opened on different days. */
async function seed(): Promise<void> {
  await store.saveAccount(account("a1", "Brokerage", "Fidelity"));
  await store.saveAccount(account("a2", "ISA"));
  for (const instrument of [NVDA, MSFT, AAPL]) await store.saveInstrument(instrument);

  await append({
    accountId: "a1",
    type: "opening_balance",
    tradeDate: "2026-01-05",
    instrumentId: NVDA.id,
    quantity: 10,
    amount: -1_000,
  });
  await append({ accountId: "a1", type: "deposit", tradeDate: "2026-01-05", amount: 2_500 });
  await append({
    accountId: "a2",
    type: "opening_balance",
    tradeDate: "2026-02-10",
    instrumentId: MSFT.id,
    quantity: 4,
    amount: -1_200,
  });
  await append({ accountId: "a2", type: "deposit", tradeDate: "2026-02-10", amount: 500 });
}

const TODAY = "2026-06-30";

const labelled = (view: Awaited<ReturnType<typeof currentHoldings>>) =>
  view.holdings.map((holding) => [holding.accountId, holding.accountName, holding.position.instrument.symbol]);

describe("currentHoldings", () => {
  it("labels every account's positions and cash when nothing is asked for", async () => {
    await seed();
    const view = await currentHoldings(store, TODAY);

    expect(labelled(view)).toEqual([
      ["a1", "Brokerage", "NVDA"],
      ["a2", "ISA", "MSFT"],
    ]);
    expect(view.holdings[0].institution).toBe("Fidelity");
    expect(view.holdings[0].position).toMatchObject({ quantity: 10, costBasis: 1_000 });
    expect(view.cash).toEqual([
      {
        accountId: "a1",
        accountName: "Brokerage",
        institution: "Fidelity",
        balance: { accountId: "a1", currency: "USD", amount: 2_500 },
      },
      {
        accountId: "a2",
        accountName: "ISA",
        institution: undefined,
        balance: { accountId: "a2", currency: "USD", amount: 500 },
      },
    ]);
  });

  it("narrows to one ticker, case-insensitively, and answers without cash", async () => {
    await seed();
    const view = await currentHoldings(store, TODAY, "nVdA");

    expect(labelled(view)).toEqual([["a1", "Brokerage", "NVDA"]]);
    // A symbol query asks about one security, so cash is not part of the answer.
    expect(view.cash).toEqual([]);
  });
});

describe("holdingsSnapshot", () => {
  it("shows nothing before the position was opened, and the position from its trade date on", async () => {
    await seed();

    const before = await holdingsSnapshot(store, "a1", { asOf: "2026-01-04" });
    expect(before.asOf).toBe("2026-01-04");
    expect(before.positions).toEqual([]);
    expect(before.cash).toEqual([]);

    const after = await holdingsSnapshot(store, "a1", { asOf: "2026-01-05" });
    expect(after.positions).toHaveLength(1);
    expect(after.positions[0]).toMatchObject({ accountId: "a1", quantity: 10, costBasis: 1_000 });
    // One account only: the other account's holdings are not in this snapshot.
    expect(after.cash).toEqual([{ accountId: "a1", currency: "USD", amount: 2_500 }]);
  });
});

describe("compareHoldings", () => {
  it("reports what was added, removed and changed between two dates, and the cash that moved", async () => {
    await seed();
    // A second position held on the earlier date, so that the later date can lose it.
    await append({
      accountId: "a1",
      type: "opening_balance",
      tradeDate: "2026-01-05",
      instrumentId: MSFT.id,
      quantity: 4,
      amount: -400,
    });
    await append({
      accountId: "a1",
      type: "buy",
      tradeDate: "2026-03-01",
      instrumentId: NVDA.id,
      quantity: 5,
      amount: -600,
    });
    await append({
      accountId: "a1",
      type: "buy",
      tradeDate: "2026-03-01",
      instrumentId: AAPL.id,
      quantity: 2,
      amount: -300,
    });
    await append({
      accountId: "a1",
      type: "adjustment",
      tradeDate: "2026-03-01",
      instrumentId: MSFT.id,
      quantity: 0,
      amount: 0,
    });
    await append({ accountId: "a1", type: "dividend", tradeDate: "2026-03-01", amount: 100 });

    const comparison = await compareHoldings(store, "a1", { asOf: "2026-02-01" }, { asOf: "2026-03-31" });

    expect(comparison).toMatchObject({ accountId: "a1", beforeAsOf: "2026-02-01", afterAsOf: "2026-03-31" });
    expect(comparison.changes).toEqual([
      {
        instrumentId: AAPL.id,
        symbol: "AAPL",
        name: undefined,
        status: "added",
        before: null,
        after: { quantity: 2, costBasis: 300 },
        quantityDelta: 2,
        costBasisDelta: 300,
      },
      {
        instrumentId: MSFT.id,
        symbol: "MSFT",
        name: undefined,
        status: "removed",
        before: { quantity: 4, costBasis: 400 },
        after: null,
        quantityDelta: -4,
        costBasisDelta: -400,
      },
      {
        instrumentId: NVDA.id,
        symbol: "NVDA",
        name: undefined,
        status: "changed",
        before: { quantity: 10, costBasis: 1_000 },
        after: { quantity: 15, costBasis: 1_600 },
        quantityDelta: 5,
        costBasisDelta: 600,
      },
    ]);
    // 2500 to start, then two buys and a dividend: -600 - 300 + 100.
    expect(comparison.cash).toEqual([{ currency: "USD", before: 2_500, after: 1_700, delta: -800 }]);
  });

  it("separates two imports made on the same day by when each finished writing", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    const row = (quantity: number, costBasis: number): ImportPosition => ({
      symbol: "NVDA",
      name: "NVDA",
      quantity,
      price: null,
      marketValue: null,
      costBasis,
      currency: "USD",
      assetType: "security",
    });

    const morning = await commitImport(store, {
      accountId: "a1",
      positions: [row(10, 1_000)],
      source: "csv",
      idempotencyKey: "same-day-morning-0001",
    }, "2026-03-02");
    // `recordedAt` is the real write time, so the two imports need a gap to be told apart.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const evening = await commitImport(store, {
      accountId: "a1",
      positions: [row(14, 1_500)],
      source: "csv",
      idempotencyKey: "same-day-evening-0001",
    }, "2026-03-02");

    const comparison = await compareBatches(store, "a1", morning.batch.id, evening.batch.id);
    expect(comparison?.changes).toHaveLength(1);
    expect(comparison?.changes[0]).toMatchObject({
      symbol: "NVDA",
      status: "changed",
      before: { quantity: 10, costBasis: 1_000 },
      after: { quantity: 14, costBasis: 1_500 },
      quantityDelta: 4,
      costBasisDelta: 500,
    });
    // Each side replays on its batch's own date.
    expect(comparison).toMatchObject({ beforeAsOf: "2026-03-02", afterAsOf: "2026-03-02" });
    expect(await compareBatches(store, "a1", morning.batch.id, "nope")).toBeNull();

    // The date alone cannot tell them apart: both sides see the end of the day.
    const sameDate = await compareHoldings(store, "a1", { asOf: "2026-03-02" }, { asOf: "2026-03-02" });
    expect(sameDate.changes).toEqual([]);
  });
});
