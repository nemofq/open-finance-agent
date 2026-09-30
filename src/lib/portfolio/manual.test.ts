import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManualPosition, addSimpleTransaction, editCurrentPosition, removeCurrentPosition } from "./manual";
import { replayTransactions } from "./replay";
import { createPortfolioStore } from "./store";
import type { Account, PortfolioSnapshot, PortfolioStore } from "./types";

const brokerage: Account = {
  id: "a1",
  name: "Brokerage",
  type: "taxable",
  baseCurrency: "USD",
  costBasisMethod: "fifo",
  source: { kind: "manual" },
};

let root: string;
let store: PortfolioStore;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "ofa-manual-"));
  store = createPortfolioStore(path.join(root, "portfolio"));
  await store.saveAccount(brokerage);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The user's date when they edit: later than every position below, some of which the server dates today. */
const TODAY = "2099-12-31";

async function snapshot(): Promise<PortfolioSnapshot> {
  const [accounts, instruments, transactions] = await Promise.all([
    store.listAccounts(),
    store.listInstruments(),
    store.listTransactions(),
  ]);
  return replayTransactions(transactions, instruments, accounts, TODAY);
}

describe("addManualPosition", () => {
  it("stores a position as an opening balance and derives the price from the total cost", async () => {
    const transaction = await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 120,
      totalCost: 42_000,
      currency: "USD",
      acquiredAt: "2024-03-01",
    });

    expect(transaction.type).toBe("opening_balance");
    expect(transaction.tradeDate).toBe("2024-03-01");
    expect(transaction.price).toBe(350);
    expect(transaction.amount).toBe(-42_000);
    expect(transaction.source).toEqual({ kind: "manual" });

    const [instrument] = await store.listInstruments();
    expect(instrument).toMatchObject({ kind: "equity", symbol: "NVDA", currency: "USD" });
    expect(transaction.instrumentId).toBe(instrument.id);

    const [position] = (await snapshot()).positions;
    expect(position.quantity).toBe(120);
    expect(position.costBasis).toBe(42_000);
    expect(position.averageCost).toBe(350);
  });

  it("derives the total cost from an average price", async () => {
    const transaction = await addManualPosition(store, {
      accountId: "a1",
      symbol: "AAPL",
      quantity: 10,
      averagePrice: 150,
      currency: "USD",
    });
    expect(transaction.amount).toBe(-1_500);
    expect((await snapshot()).positions[0].costBasis).toBe(1_500);
  });

  it("reuses the instrument whatever case the symbol is typed in", async () => {
    await addManualPosition(store, { accountId: "a1", symbol: "NVDA", quantity: 1, totalCost: 10, currency: "USD" });
    await addManualPosition(store, { accountId: "a1", symbol: "nvda", quantity: 1, totalCost: 20, currency: "USD" });
    expect(await store.listInstruments()).toHaveLength(1);
    expect((await snapshot()).positions).toHaveLength(1);
  });

  it("refuses a position with neither a total cost nor an average price", async () => {
    await expect(
      addManualPosition(store, { accountId: "a1", symbol: "NVDA", quantity: 1, currency: "USD" }),
    ).rejects.toThrow(/total cost or its average price/);
  });
});

describe("current portfolio position edits", () => {
  it("adjusts and removes a position without rewriting its history", async () => {
    const original = await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 120,
      totalCost: 42_000,
      currency: "USD",
      acquiredAt: "2024-03-01",
    });

    const edited = await editCurrentPosition(store, original.instrumentId as string, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 100,
      averagePrice: 350,
      currency: "USD",
    }, TODAY);
    expect(edited).toHaveLength(1);
    expect(edited[0].type).toBe("adjustment");
    expect((await snapshot()).positions[0]).toMatchObject({ quantity: 100, costBasis: 35_000 });
    expect(await store.listTransactions()).toHaveLength(2);

    const removed = await removeCurrentPosition(store, "a1", original.instrumentId as string, TODAY);
    expect(removed.type).toBe("adjustment");
    expect((await snapshot()).positions).toEqual([]);
    expect(await store.listTransactions()).toHaveLength(3);
  });
});

describe("addSimpleTransaction", () => {
  it("derives a buy's cash effect from quantity, price and fees", async () => {
    const buy = await addSimpleTransaction(store, {
      accountId: "a1",
      type: "buy",
      symbol: "NVDA",
      tradeDate: "2024-01-10",
      quantity: 10,
      price: 100,
      fees: 5,
      currency: "USD",
    });
    expect(buy.amount).toBe(-1_005);
    const [position] = (await snapshot()).positions;
    expect(position.quantity).toBe(10);
    // The fee is part of the amount, so it capitalises into the basis and is never added twice.
    expect(position.costBasis).toBe(1_005);
  });

  it("derives a sell's proceeds net of fees and realizes the gain", async () => {
    await addSimpleTransaction(store, {
      accountId: "a1",
      type: "buy",
      symbol: "NVDA",
      tradeDate: "2024-01-10",
      quantity: 10,
      price: 100,
      currency: "USD",
    });
    const sell = await addSimpleTransaction(store, {
      accountId: "a1",
      type: "sell",
      symbol: "NVDA",
      tradeDate: "2024-02-10",
      quantity: 4,
      price: 150,
      fees: 10,
      currency: "USD",
    });
    expect(sell.amount).toBe(590);

    const after = await snapshot();
    expect(after.positions[0].quantity).toBe(6);
    expect(after.positions[0].costBasis).toBe(600);
    expect(after.realizedGains[0].amount).toBe(190);
    expect(after.cash[0].amount).toBe(-410);
  });

  it("needs an amount for a dividend and a quantity for a trade", async () => {
    await expect(
      addSimpleTransaction(store, {
        accountId: "a1",
        type: "dividend",
        symbol: "NVDA",
        tradeDate: "2024-04-01",
        currency: "USD",
      }),
    ).rejects.toThrow(/dividend needs an amount/);

    await expect(
      addSimpleTransaction(store, {
        accountId: "a1",
        type: "buy",
        symbol: "NVDA",
        tradeDate: "2024-04-01",
        price: 10,
        currency: "USD",
      }),
    ).rejects.toThrow(/quantity must be a number greater than 0/);
  });
});
