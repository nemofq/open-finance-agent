import { randomUUID } from "node:crypto";
import { resolveTimeContext } from "@/lib/time";
import { replayLedger } from "./holdings";
import type { Instrument, InstrumentKind, ManualPositionInput, PortfolioStore, SimpleTransactionInput, Transaction } from "./types";

export class CurrentPositionNotFoundError extends Error {}
export class CurrentPositionConflictError extends Error {}

/**
 * Manual entry from the portfolio page. Every write appends: a position is an `opening_balance`,
 * an edit appends an `adjustment` to the current holding, and a removal appends an `adjustment` to
 * zero. History is never rewritten, so a user can always see what they told us and when.
 */

/**
 * `today` is the user's own date, which dates a position that states no `acquiredAt`; the server's
 * date when the caller knows no better.
 */
export async function addManualPosition(
  store: PortfolioStore,
  input: ManualPositionInput,
  today = resolveTimeContext().localDate,
): Promise<Transaction> {
  return store.appendTransaction(await openingBalance(store, input, today));
}

/**
 * Replace the position currently held in an account, regardless of whether it came from a manual
 * entry or an import. The correction is appended as a dated adjustment so the old statement stays
 * available in history while today's view reflects the values the user just entered. `today` is the
 * user's own date.
 */
export async function editCurrentPosition(
  store: PortfolioStore,
  instrumentId: string,
  input: ManualPositionInput,
  today: string,
): Promise<Transaction[]> {
  const existing = await currentPosition(store, input.accountId, instrumentId, today);
  const quantity = positive(input.quantity, "quantity");
  const { totalCost, price } = positionCost(input, quantity);
  const instrument = await findOrCreateInstrument(store, await store.listInstruments(), input);
  const tradeDate = input.acquiredAt ?? today;
  const transactions: Transaction[] = [];

  if (instrument.id !== instrumentId) {
    try {
      await currentPosition(store, input.accountId, instrument.id, today);
      throw new CurrentPositionConflictError(`Account ${input.accountId} already holds ${input.symbol}.`);
    } catch (error) {
      if (!(error instanceof CurrentPositionNotFoundError)) throw error;
    }
    transactions.push(await store.appendTransaction({
      accountId: input.accountId,
      type: "adjustment",
      tradeDate,
      instrumentId,
      quantity: 0,
      amount: 0,
      currency: existing.instrument.currency,
      source: { kind: "manual" },
      note: "Position replaced from the portfolio editor",
    }));
  }

  transactions.push(await store.appendTransaction({
    accountId: input.accountId,
    type: "adjustment",
    tradeDate,
    instrumentId: instrument.id,
    quantity,
    price,
    amount: -Math.abs(totalCost),
    currency: input.currency,
    source: { kind: "manual" },
    note: "Position edited from the portfolio editor",
  }));
  return transactions;
}

/** Remove whatever position is held on `today`, the user's own date, for an account/instrument pair. */
export async function removeCurrentPosition(
  store: PortfolioStore,
  accountId: string,
  instrumentId: string,
  today: string,
): Promise<Transaction> {
  const existing = await currentPosition(store, accountId, instrumentId, today);
  return store.appendTransaction({
    accountId,
    type: "adjustment",
    tradeDate: today,
    instrumentId,
    quantity: 0,
    amount: 0,
    currency: existing.instrument.currency,
    source: { kind: "manual" },
    note: "Position removed from the portfolio editor",
  });
}

export async function addSimpleTransaction(
  store: PortfolioStore,
  input: SimpleTransactionInput,
): Promise<Transaction> {
  const instrument = await findOrCreateInstrument(store, await store.listInstruments(), input);
  // A dividend needs no quantity; a buy or a sell needs one even when the amount is given, because
  // that is what moves the lots.
  const quantity = input.type === "dividend" ? undefined : positive(input.quantity, "quantity");
  return store.appendTransaction({
    accountId: input.accountId,
    type: input.type,
    tradeDate: input.tradeDate,
    instrumentId: instrument.id,
    quantity,
    price: input.price,
    amount: cashEffect(input, quantity),
    currency: input.currency,
    fees: input.fees,
    source: { kind: "manual" },
    note: input.note,
  });
}

/* ------------------------------------------------------------------ helpers */

/** Total cash the transaction moves, inclusive of fees, so the replay never adds them twice. */
function cashEffect(input: SimpleTransactionInput, quantity: number | undefined): number {
  if (input.amount !== undefined) return input.amount;
  if (input.type === "dividend") {
    throw new Error("A dividend needs an amount: the cash received.");
  }
  const price = nonNegative(input.price, "price");
  const gross = (quantity ?? 0) * price;
  const fees = input.fees ?? 0;
  return input.type === "buy" ? -(gross + fees) : gross - fees;
}

async function openingBalance(
  store: PortfolioStore,
  input: ManualPositionInput,
  today: string,
): Promise<Omit<Transaction, "id" | "recordedAt">> {
  const quantity = positive(input.quantity, "quantity");
  const { totalCost, price } = positionCost(input, quantity);
  const instrument = await findOrCreateInstrument(store, await store.listInstruments(), input);
  return {
    accountId: input.accountId,
    type: "opening_balance",
    tradeDate: input.acquiredAt ?? today,
    instrumentId: instrument.id,
    quantity,
    price,
    // Negative by convention: this is what the position cost. An opening balance is money spent
    // before the ledger starts, so the replay reads it as cost basis and moves no cash.
    amount: -Math.abs(totalCost),
    currency: input.currency,
    source: { kind: "manual" },
    note: input.note,
  };
}

function positionCost(input: ManualPositionInput, quantity: number): { totalCost: number; price: number } {
  if (input.totalCost === undefined && input.averagePrice === undefined) {
    throw new Error("A position needs either its total cost or its average price.");
  }
  const totalCost = input.totalCost ?? nonNegative(input.averagePrice, "averagePrice") * quantity;
  return { totalCost, price: input.averagePrice ?? totalCost / quantity };
}

/**
 * The instrument a symbol names in a currency, created when there is none. Both are matched
 * case-insensitively so `nvda` and `NVDA` never become two instruments. A created instrument joins
 * `known`, so a caller resolving many rows against one list creates each instrument once.
 */
export async function findOrCreateInstrument(
  store: PortfolioStore,
  known: Instrument[],
  wanted: { symbol: string; currency: string; kind?: InstrumentKind; name?: string },
): Promise<Instrument> {
  const symbol = wanted.symbol.trim();
  const existing = known.find(
    (instrument) =>
      instrument.symbol.toLowerCase() === symbol.toLowerCase() &&
      instrument.currency.toLowerCase() === wanted.currency.toLowerCase(),
  );
  if (existing) return existing;
  const created = await store.saveInstrument({ id: randomUUID(), kind: wanted.kind ?? "equity", symbol, currency: wanted.currency, name: wanted.name });
  known.push(created);
  return created;
}

async function currentPosition(
  store: PortfolioStore,
  accountId: string,
  instrumentId: string,
  today: string,
) {
  const { accounts, snapshot } = await replayLedger(store, today);
  if (!accounts.some((account) => account.id === accountId)) {
    throw new CurrentPositionNotFoundError(`No account ${accountId} in the ledger.`);
  }
  const position = snapshot.positions.find(
    (candidate) => candidate.accountId === accountId && candidate.instrument.id === instrumentId,
  );
  if (!position) throw new CurrentPositionNotFoundError(`No current position ${instrumentId} in account ${accountId}.`);
  return position;
}

function positive(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a number greater than 0.`);
  }
  return value;
}

function nonNegative(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a number of 0 or more.`);
  }
  return value;
}
