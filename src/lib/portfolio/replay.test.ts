import { describe, expect, it } from "vitest";
import { effectiveTransactions, replayTransactions, UnsupportedTransactionError } from "./replay";
import type { Account, CostBasisMethod, Instrument, Transaction } from "./types";

const NVDA: Instrument = { id: "i-nvda", kind: "equity", symbol: "NVDA", currency: "USD" };
const SAP: Instrument = { id: "i-sap", kind: "equity", symbol: "SAP", currency: "EUR" };

function account(id: string, costBasisMethod: CostBasisMethod = "fifo", baseCurrency = "USD"): Account {
  return {
    id,
    name: `Account ${id}`,
    type: "taxable",
    baseCurrency,
    costBasisMethod,
    source: { kind: "manual" },
  };
}

let sequence = 0;

/** Records are written in the order they are built, which is what `recordedAt` breaks ties on. */
function tx(partial: Partial<Transaction> & Pick<Transaction, "type" | "tradeDate">): Transaction {
  sequence += 1;
  return {
    id: `t${sequence}`,
    accountId: "a1",
    amount: 0,
    currency: "USD",
    source: { kind: "manual" },
    recordedAt: `2024-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...partial,
  };
}

const buy = (id: string, tradeDate: string, quantity: number, amount: number, extra: Partial<Transaction> = {}) =>
  tx({ id, type: "buy", tradeDate, instrumentId: NVDA.id, quantity, amount, ...extra });

const open = (id: string, tradeDate: string, quantity: number, amount: number, extra: Partial<Transaction> = {}) =>
  tx({ id, type: "opening_balance", tradeDate, instrumentId: NVDA.id, quantity, amount, ...extra });

const replay = (transactions: Transaction[], accounts: Account[] = [account("a1")], asOf = "2099-12-31") =>
  replayTransactions(transactions, [NVDA, SAP], accounts, asOf);

describe("replayTransactions", () => {
  it("opens lots from an opening balance and a buy, and moves cash only for the buy", () => {
    const snapshot = replay([
      open("open", "2024-01-01", 10, -1_000),
      buy("b1", "2024-02-01", 5, -600),
    ]);

    expect(snapshot.positions).toHaveLength(1);
    const [position] = snapshot.positions;
    expect(position.instrument.symbol).toBe("NVDA");
    expect(position.quantity).toBe(15);
    expect(position.costBasis).toBe(1_600);
    expect(position.averageCost).toBeCloseTo(106.6667, 4);
    expect(position.lots.map((lot) => lot.id)).toEqual(["open", "b1"]);
    // The opening balance is money spent before the ledger begins, so only the buy touches cash.
    expect(snapshot.cash).toEqual([{ accountId: "a1", currency: "USD", amount: -600 }]);
  });

  const partialSell = (method: CostBasisMethod) =>
    replay(
      [
        buy("lot-a", "2024-01-01", 10, -100),
        buy("lot-b", "2024-02-01", 10, -200),
        tx({ type: "sell", tradeDate: "2024-03-01", instrumentId: NVDA.id, quantity: 5, amount: 150 }),
      ],
      [account("a1", method)],
    );

  it("sells fifo out of the oldest lot", () => {
    const snapshot = partialSell("fifo");
    expect(snapshot.positions[0].quantity).toBe(15);
    expect(snapshot.positions[0].costBasis).toBe(250);
    expect(snapshot.realizedGains).toEqual([
      { accountId: "a1", instrumentId: NVDA.id, amount: 100, tradeDate: "2024-03-01" },
    ]);
    // Both buys and the sale net out in cash: -100 - 200 + 150.
    expect(snapshot.cash[0].amount).toBe(-150);
  });

  it("sells lifo out of the newest lot", () => {
    const snapshot = partialSell("lifo");
    expect(snapshot.positions[0].costBasis).toBe(200);
    expect(snapshot.realizedGains[0].amount).toBe(50);
  });

  it("sells average pro-rata and leaves the average cost unchanged", () => {
    const snapshot = partialSell("average");
    const [position] = snapshot.positions;
    expect(position.quantity).toBe(15);
    expect(position.costBasis).toBeCloseTo(225, 10);
    expect(position.averageCost).toBeCloseTo(15, 10);
    expect(snapshot.realizedGains[0].amount).toBeCloseTo(75, 10);
    // Both lots shrink by the same fraction rather than one being emptied.
    expect(position.lots.map((lot) => lot.quantity)).toEqual([7.5, 7.5]);
  });

  it("consumes only what is held when more is sold than exists, without going negative", () => {
    const snapshot = replay([
      buy("lot-a", "2024-01-01", 10, -100),
      tx({ type: "sell", tradeDate: "2024-03-01", instrumentId: NVDA.id, quantity: 25, amount: 500 }),
    ]);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.realizedGains[0].amount).toBe(400);
  });

  it("moves cash only for dividends and fees", () => {
    const snapshot = replay([
      buy("lot-a", "2024-01-01", 10, -1_000),
      tx({ type: "dividend", tradeDate: "2024-03-01", instrumentId: NVDA.id, amount: 25 }),
      tx({ type: "fee", tradeDate: "2024-03-02", amount: -5 }),
    ]);
    expect(snapshot.positions[0].quantity).toBe(10);
    expect(snapshot.positions[0].costBasis).toBe(1_000);
    expect(snapshot.cash).toEqual([{ accountId: "a1", currency: "USD", amount: -980 }]);
    expect(snapshot.realizedGains).toEqual([]);
  });

  it("converts a foreign-currency buy into the account's base currency and leaves the cash in its own", () => {
    const snapshot = replay([
      tx({
        type: "buy",
        tradeDate: "2024-01-01",
        instrumentId: SAP.id,
        quantity: 10,
        amount: -1_000,
        currency: "EUR",
        fxRate: 1.1,
      }),
    ]);
    expect(snapshot.positions[0].costBasis).toBeCloseTo(1_100, 10);
    expect(snapshot.cash).toEqual([{ accountId: "a1", currency: "EUR", amount: -1_000 }]);
  });

  it("clears a position with an adjustment to zero, without moving cash", () => {
    const snapshot = replay([
      buy("lot-a", "2024-01-01", 10, -1_000),
      tx({ type: "adjustment", tradeDate: "2024-02-01", instrumentId: NVDA.id, quantity: 0, amount: 0 }),
    ]);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.cash).toEqual([{ accountId: "a1", currency: "USD", amount: -1_000 }]);
  });

  it("sets a position outright with an adjustment, replacing the lots", () => {
    const snapshot = replay([
      buy("lot-a", "2024-01-01", 10, -1_000),
      buy("lot-b", "2024-01-02", 10, -1_000),
      tx({ type: "adjustment", tradeDate: "2024-02-01", instrumentId: NVDA.id, quantity: 7, amount: -700 }),
    ]);
    expect(snapshot.positions[0].quantity).toBe(7);
    expect(snapshot.positions[0].costBasis).toBe(700);
    expect(snapshot.positions[0].lots).toHaveLength(1);
  });

  it("moves cash for an adjustment that names no instrument", () => {
    const snapshot = replay([tx({ type: "adjustment", tradeDate: "2024-02-01", amount: -40 })]);
    expect(snapshot.cash).toEqual([{ accountId: "a1", currency: "USD", amount: -40 }]);
  });

  it("excludes trades after the as-of date and reports that date", () => {
    const snapshot = replay(
      [buy("lot-a", "2024-01-01", 10, -1_000), buy("lot-b", "2024-07-01", 10, -2_000)],
      [account("a1")],
      "2024-06-30",
    );
    expect(snapshot.asOf).toBe("2024-06-30");
    expect(snapshot.positions[0].quantity).toBe(10);
    expect(snapshot.positions[0].costBasis).toBe(1_000);
  });

  it.each(["transfer_in", "transfer_out", "split", "symbol_change", "return_of_capital", "merger", "spinoff"] as const)("refuses a ledger holding a %s rather than applying part of it", (type) => {
    const transactions = [
      buy("lot-a", "2024-01-01", 10, -1_000),
      tx({ id: `corporate-${type}`, type, tradeDate: "2024-04-01", instrumentId: NVDA.id, amount: 300 }),
    ];
    expect(() => replay(transactions)).toThrow(UnsupportedTransactionError);
    expect(() => replay(transactions)).toThrow(`Transaction corporate-${type} (2024-04-01) is a ${type}`);
    // Before its trade date the record is not replayed, so an earlier snapshot still works.
    expect(replay(transactions, undefined, "2024-03-31").positions[0].quantity).toBe(10);
  });

  it("skips records of an account that no longer exists", () => {
    const snapshot = replay([
      tx({ accountId: "gone", type: "buy", tradeDate: "2024-01-01", instrumentId: NVDA.id, quantity: 5, amount: -50 }),
    ]);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.cash).toEqual([]);
  });

  it("shows a holding whose instrument record is missing rather than dropping it", () => {
    const snapshot = replay([
      tx({ type: "buy", tradeDate: "2024-01-01", instrumentId: "i-unknown", quantity: 5, amount: -50 }),
    ]);
    expect(snapshot.positions[0].instrument).toEqual({
      id: "i-unknown",
      kind: "equity",
      symbol: "i-unknown",
      currency: "USD",
    });
  });

  it("orders by trade date, then by when the record was written", () => {
    const late = buy("late", "2024-01-02", 1, -20);
    const early = buy("early", "2024-01-01", 1, -10);
    expect(effectiveTransactions([late, early]).map((record) => record.id)).toEqual(["early", "late"]);
  });
});
