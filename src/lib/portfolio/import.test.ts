import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitImport } from "./import";
import { addManualPosition } from "./manual";
import { replayTransactions } from "./replay";
import { createPortfolioStore } from "./store";
import type { Account, ImportPosition, PortfolioSnapshot, PortfolioStore, Position } from "./types";

/** Later than every import below, so the ledger is replayed whole. */
const TODAY = "2026-12-31";

const ACCOUNT: Account = {
  id: "a1",
  name: "Brokerage",
  type: "taxable",
  baseCurrency: "USD",
  costBasisMethod: "fifo",
  source: { kind: "manual" },
};

let dir: string;
let store: PortfolioStore;

beforeEach(async () => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), "ofa-import-")), "portfolio");
  store = createPortfolioStore(dir);
  await store.saveAccount(ACCOUNT);
});

afterEach(() => {
  rmSync(path.dirname(dir), { recursive: true, force: true });
});

/** A row the file gives a ticker and a quantity: it becomes a position. */
function security(symbol: string, quantity: number, extra: Partial<ImportPosition> = {}): ImportPosition {
  return {
    symbol,
    name: symbol,
    quantity,
    price: null,
    marketValue: null,
    costBasis: null,
    currency: "USD",
    assetType: "security",
    ...extra,
  };
}

/** A row with a value and no quantity: money, or an asset the file only values. */
function valueRow(name: string, marketValue: number, extra: Partial<ImportPosition> = {}): ImportPosition {
  return {
    symbol: null,
    name,
    quantity: null,
    price: null,
    marketValue,
    costBasis: null,
    currency: "USD",
    assetType: "custom",
    ...extra,
  };
}

/** The whole ledger replayed, which is where an import's numbers actually show up. */
async function snapshot(asOf = TODAY): Promise<PortfolioSnapshot> {
  const [accounts, instruments, transactions] = await Promise.all([
    store.listAccounts(),
    store.listInstruments(),
    store.listTransactions(),
  ]);
  return replayTransactions(transactions, instruments, accounts, asOf);
}

const held = (snap: PortfolioSnapshot, symbol: string): Position | undefined =>
  snap.positions.find((position) => position.instrument.symbol === symbol);

const sizes = (snap: PortfolioSnapshot) =>
  snap.positions.map((position) => [position.instrument.symbol, position.quantity, position.costBasis]);

describe("commitImport", () => {
  it("opens a balance per position and records the batch", async () => {
    const result = await commitImport(store, {
      accountId: "a1",
      positions: [
        security("NVDA", 10, { costBasis: 1_200 }),
        // No cost column: the cost is the quantity times the price the file states.
        security("MSFT", 4, { price: 300 }),
        // Both columns present: the stated cost wins over quantity times price.
        security("AAPL", 2, { price: 100, costBasis: 250 }),
      ],
      source: "csv",
      idempotencyKey: "first-import-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    expect(result.reused).toBe(false);
    expect(result.batch).toMatchObject({
      accountId: "a1",
      provider: "csv",
      fetchedAt: "2026-03-02T15:04:05.000Z",
      from: "2026-03-02",
      to: "2026-03-02",
      count: 3,
      idempotencyKey: "first-import-0001",
    });
    expect(await store.listImportBatches("a1")).toEqual([result.batch]);

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((transaction) => transaction.type)).toEqual([
      "opening_balance",
      "opening_balance",
      "opening_balance",
    ]);
    expect(result.transactions.map((transaction) => transaction.tradeDate)).toEqual([
      "2026-03-02",
      "2026-03-02",
      "2026-03-02",
    ]);
    expect(result.transactions.map((transaction) => transaction.source)).toEqual([
      { kind: "csv", importBatchId: result.batch.id, externalId: "NVDA" },
      { kind: "csv", importBatchId: result.batch.id, externalId: "MSFT" },
      { kind: "csv", importBatchId: result.batch.id, externalId: "AAPL" },
    ]);
    // Negative by convention: the amount of an opening balance is what the position cost.
    expect(result.transactions.map((transaction) => transaction.amount)).toEqual([-1_200, -1_200, -250]);

    const snap = await snapshot();
    expect(sizes(snap)).toEqual([
      ["AAPL", 2, 250],
      ["MSFT", 4, 1_200],
      ["NVDA", 10, 1_200],
    ]);
    // An opening balance is money spent before the ledger begins, so no cash moved.
    expect(snap.cash).toEqual([]);
  });

  it("returns the first batch and writes nothing when the same key is sent again", async () => {
    const positions = [security("NVDA", 10, { costBasis: 1_200 }), security("MSFT", 4, { costBasis: 900 })];
    const input = {
      accountId: "a1",
      positions,
      source: "csv",
      idempotencyKey: "retried-import-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    };

    const first = await commitImport(store, input, TODAY);
    const again = await commitImport(store, input, TODAY);

    expect(again.reused).toBe(true);
    expect(again.batch).toEqual(first.batch);
    expect(again.transactions).toEqual(first.transactions);
    expect(await store.listTransactions("a1")).toHaveLength(2);
    expect(await store.listImportBatches("a1")).toHaveLength(1);
    expect((await snapshot()).positions).toHaveLength(2);
  });

  it("adjusts, opens and retires positions on a re-import instead of double counting", async () => {
    await commitImport(store, {
      accountId: "a1",
      positions: [security("NVDA", 10, { costBasis: 1_200 }), security("MSFT", 4, { costBasis: 900 })],
      source: "csv",
      idempotencyKey: "march-statement-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    const second = await commitImport(store, {
      accountId: "a1",
      positions: [
        security("NVDA", 12, { costBasis: 1_500 }), // in both files: adjusted to the new numbers
        security("AAPL", 5, { costBasis: 800 }), // new: opened
      ],
      source: "csv",
      idempotencyKey: "june-statement-0001",
      importedAt: "2026-06-01T15:04:05.000Z",
    }, TODAY);

    expect(second.reused).toBe(false);
    expect(second.transactions.map((transaction) => [transaction.type, transaction.source.externalId])).toEqual([
      ["adjustment", "NVDA"],
      ["opening_balance", "AAPL"],
      ["adjustment", undefined], // MSFT: only in the old file, so it is retired
    ]);
    const [nvda, , retired] = second.transactions;
    expect(nvda).toMatchObject({ tradeDate: "2026-06-01", quantity: 12, amount: -1_500 });
    expect(nvda.note).toContain("Set to the 2026-06-01 import");
    expect(retired).toMatchObject({ quantity: 0, amount: 0, currency: "USD" });
    expect(retired.note).toContain("Not in the 2026-06-01 import");

    // The account now holds exactly what the second file says: NVDA is 12, not 10 + 12.
    expect(sizes(await snapshot())).toEqual([
      ["AAPL", 5, 800],
      ["NVDA", 12, 1_500],
    ]);
    // And because the re-import appended dated adjustments rather than rewriting the old records,
    // the day of the first import still replays to the first file.
    expect(sizes(await snapshot("2026-03-02"))).toEqual([
      ["MSFT", 4, 900],
      ["NVDA", 10, 1_200],
    ]);
  });

  it("overrides a hand-typed position it lists and leaves one it does not alone", async () => {
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 5,
      totalCost: 500,
      currency: "USD",
      acquiredAt: "2026-01-05",
    });
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "TSLA",
      quantity: 3,
      totalCost: 900,
      currency: "USD",
      acquiredAt: "2026-01-05",
    });

    const { transactions } = await commitImport(store, {
      accountId: "a1",
      positions: [security("NVDA", 10, { costBasis: 1_200 })],
      source: "csv",
      idempotencyKey: "broker-statement-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    // The statement is the better source, so the hand-typed lot is replaced, not added to.
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ type: "adjustment", quantity: 10, amount: -1_200 });
    expect(sizes(await snapshot())).toEqual([
      ["NVDA", 10, 1_200],
      ["TSLA", 3, 900], // a partial CSV never removes someone's own entry
    ]);
    // The same instrument, not a second NVDA.
    expect((await store.listInstruments()).map((instrument) => instrument.symbol).sort()).toEqual(["NVDA", "TSLA"]);
  });

  it("turns a value-only row into cash rather than a position", async () => {
    const { transactions } = await commitImport(store, {
      accountId: "a1",
      positions: [security("NVDA", 1, { costBasis: 100 }), valueRow("Cash", 2_500)],
      source: "csv",
      idempotencyKey: "cash-row-import-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    const cashRecord = transactions[1];
    // No instrument: that is what makes the replay read the record as money.
    expect(cashRecord.instrumentId).toBeUndefined();
    expect(cashRecord).toMatchObject({
      type: "opening_balance",
      amount: 2_500,
      currency: "USD",
      source: { kind: "csv", externalId: "Cash" },
    });
    expect(cashRecord.note).toContain("Cash: 2500 USD in the 2026-03-02 import");

    const snap = await snapshot();
    expect(sizes(snap)).toEqual([["NVDA", 1, 100]]);
    expect(snap.cash).toEqual([{ accountId: "a1", currency: "USD", amount: 2_500 }]);
  });

  it("moves a value-only row with a dated difference and zeroes it when a later file omits it", async () => {
    const holding = security("NVDA", 1, { costBasis: 100 });
    await commitImport(store, {
      accountId: "a1",
      positions: [holding, valueRow("Cash", 2_500)],
      source: "csv",
      idempotencyKey: "cash-march-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    const second = await commitImport(store, {
      accountId: "a1",
      positions: [holding, valueRow("Cash", 3_000)],
      source: "csv",
      idempotencyKey: "cash-april-0001",
      importedAt: "2026-04-02T15:04:05.000Z",
    }, TODAY);
    const moved = second.transactions.find((transaction) => transaction.source.externalId === "Cash");
    // The record is the difference, so the balance on an earlier date stays what it was.
    expect(moved).toMatchObject({ type: "adjustment", amount: 500, tradeDate: "2026-04-02" });
    expect((await snapshot()).cash).toEqual([{ accountId: "a1", currency: "USD", amount: 3_000 }]);
    expect((await snapshot("2026-03-02")).cash).toEqual([{ accountId: "a1", currency: "USD", amount: 2_500 }]);

    const third = await commitImport(store, {
      accountId: "a1",
      positions: [holding],
      source: "csv",
      idempotencyKey: "cash-may-0001",
      importedAt: "2026-05-02T15:04:05.000Z",
    }, TODAY);
    const gone = third.transactions.find((transaction) => transaction.source.externalId === "Cash");
    expect(gone).toMatchObject({ type: "adjustment", amount: -3_000, tradeDate: "2026-05-02" });
    expect(gone?.note).toContain("Cash: not in the 2026-05-02 import");
    expect((await snapshot()).cash).toEqual([]);
    expect((await snapshot("2026-04-02")).cash).toEqual([{ accountId: "a1", currency: "USD", amount: 3_000 }]);
  });

  it("sums the rows of a file that lists the same security twice", async () => {
    const result = await commitImport(store, {
      accountId: "a1",
      positions: [
        security("NVDA", 10, { costBasis: 1_200 }),
        security("nvda", 5, { costBasis: 700 }), // the same security, in the file's own casing
        security("MSFT", 1, { costBasis: 50 }),
      ],
      source: "xlsx",
      idempotencyKey: "two-lots-import-0001",
      importedAt: "2026-03-02T15:04:05.000Z",
    }, TODAY);

    // Two positions, not three: a later import can only adjust a position as a whole.
    expect(result.batch.count).toBe(2);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ quantity: 15, amount: -1_900 });
    expect((await store.listInstruments()).filter((instrument) => instrument.symbol === "NVDA")).toHaveLength(1);
    expect(held(await snapshot(), "NVDA")).toMatchObject({ quantity: 15, costBasis: 1_900 });
  });

  it("refuses an unknown account", async () => {
    await expect(
      commitImport(store, {
        accountId: "nope",
        positions: [security("NVDA", 10, { costBasis: 1_200 })],
        source: "csv",
        idempotencyKey: "unknown-account-0001",
      }, TODAY),
    ).rejects.toThrow(/No account nope to import into/);
    expect(await store.listTransactions()).toEqual([]);
    expect(await store.listImportBatches()).toEqual([]);
  });

  it("refuses a row that states neither a quantity nor a value, before writing anything", async () => {
    await expect(
      commitImport(store, {
        accountId: "a1",
        positions: [
          security("NVDA", 10, { costBasis: 1_200 }),
          security("MSFT", 0, { rowNumber: 4, quantity: null, marketValue: null }),
        ],
        source: "csv",
        idempotencyKey: "empty-row-import-0001",
      }, TODAY),
    ).rejects.toThrow(/Row 4 needs quantity or market value/);
    expect(await store.listTransactions()).toEqual([]);
    expect(await store.listImportBatches()).toEqual([]);
  });
});
