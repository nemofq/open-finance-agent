import type {
  Account,
  CashBalance,
  CostBasisMethod,
  Instrument,
  Lot,
  PortfolioSnapshot,
  Position,
  Transaction,
} from "./types";

/**
 * A record the replay has no rule for. The ledger schema accepts transfers, splits, symbol changes,
 * returns of capital, spinoffs and mergers, but nothing in the app writes one, so only a
 * hand-edited ledger holds one; applying half of it (the cash, say) would show positions that are
 * wrong without saying so, so the replay refuses the whole ledger and names the record instead.
 */
export class UnsupportedTransactionError extends Error {
  constructor(readonly transaction: Transaction) {
    super(
      `Transaction ${transaction.id} (${transaction.tradeDate}) is a ${transaction.type}, which the holdings ledger cannot ` +
        "replay yet. Record it in portfolio/transactions.jsonl as the sells, buys or adjustments it amounted to instead.",
    );
    this.name = "UnsupportedTransactionError";
  }
}

/** Below this, a quantity, an amount or a difference is floating-point dust rather than a holding. */
export const EPSILON = 1e-9;

/**
 * The records a replay applies, in the order it applies them: by trade date, then by when each was
 * written.
 *
 * `asOf` is optional: an import reads an account's whole history, dated or not.
 */
export function effectiveTransactions(transactions: Transaction[], asOf?: string): Transaction[] {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .filter(({ transaction }) => !asOf || transaction.tradeDate <= asOf)
    .sort(
      (a, b) =>
        a.transaction.tradeDate.localeCompare(b.transaction.tradeDate) ||
        a.transaction.recordedAt.localeCompare(b.transaction.recordedAt) ||
        a.index - b.index,
    )
    .map(({ transaction }) => transaction);
}

/**
 * Positions, lots, cash and realized gains derived from the ledger. Pure and
 * synchronous: the same records always produce the same snapshot, which is what makes the numbers
 * auditable.
 *
 * Money conventions, applied everywhere below:
 * - `amount` is the signed total cash effect in the transaction's own currency, already inclusive
 *   of `fees` and `taxes`. Those two are informational and are never added again.
 * - cash is tracked per (account, currency) and never converted; a EUR dividend stays EUR.
 * - lot costs are in the account's base currency, converted with `fxRate ?? 1`.
 * Nothing is rounded: the display layer decides precision.
 */
export function replayTransactions(
  transactions: Transaction[],
  instruments: Instrument[],
  accounts: Account[],
  asOf: string,
): PortfolioSnapshot {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const instrumentsById = new Map(instruments.map((instrument) => [instrument.id, instrument]));

  const lots: Lot[] = [];
  const cash = new Map<string, CashBalance>();
  const realizedGains: PortfolioSnapshot["realizedGains"] = [];

  function addCash(accountId: string, currency: string, amount: number): void {
    if (amount === 0) return;
    const key = `${accountId} ${currency}`;
    const balance = cash.get(key);
    if (balance) balance.amount += amount;
    else cash.set(key, { accountId, currency, amount });
  }

  function lotsOf(accountId: string, instrumentId: string): Lot[] {
    return lots.filter((lot) => lot.accountId === accountId && lot.instrumentId === instrumentId);
  }

  function discard(lot: Lot): void {
    const index = lots.indexOf(lot);
    if (index !== -1) lots.splice(index, 1);
  }

  /** The lot id is the opening transaction's id. */
  function openLot(transaction: Transaction, instrumentId: string, quantity: number, cost: number): void {
    lots.push({
      id: transaction.id,
      accountId: transaction.accountId,
      instrumentId,
      openedAt: transaction.tradeDate,
      quantity,
      cost,
    });
  }

  /** Consumption order. */
  function ordered(open: Lot[], method: CostBasisMethod): Lot[] {
    const fifo = [...open].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    return method === "lifo" ? fifo.reverse() : fifo;
  }

  /** Take `quantity` out of the open lots and return the cost basis that left with it. */
  function consume(account: Account, instrumentId: string, quantity: number): number {
    const open = lotsOf(account.id, instrumentId);
    const held = open.reduce((sum, lot) => sum + lot.quantity, 0);
    // Selling more than is held must not create a negative lot; the shortfall carries no basis.
    let remaining = Math.min(quantity, held);
    if (remaining <= EPSILON) return 0;

    if (account.costBasisMethod === "average") {
      // Pro-rata across every lot, so the average cost of what stays behind is unchanged.
      const fraction = remaining / held;
      let cost = 0;
      for (const lot of open) {
        const share = lot.cost * fraction;
        lot.quantity -= lot.quantity * fraction;
        lot.cost -= share;
        cost += share;
        if (lot.quantity <= EPSILON) discard(lot);
      }
      return cost;
    }

    let cost = 0;
    for (const lot of ordered(open, account.costBasisMethod)) {
      if (remaining <= EPSILON) break;
      const take = Math.min(remaining, lot.quantity);
      const share = lot.quantity > 0 ? lot.cost * (take / lot.quantity) : 0;
      lot.quantity -= take;
      lot.cost -= share;
      remaining -= take;
      cost += share;
      if (lot.quantity <= EPSILON) discard(lot);
    }
    return cost;
  }

  for (const transaction of effectiveTransactions(transactions, asOf)) {
    const account = accountsById.get(transaction.accountId);
    // The ledger keeps the records of a deleted account; a replay simply has nowhere to put them.
    if (!account) continue;
    const rate = transaction.fxRate ?? 1;
    const quantity = transaction.quantity ?? 0;
    const instrumentId = transaction.instrumentId;

    switch (transaction.type) {
      case "opening_balance":
      case "buy":
        // The cost includes the fees the amount already carries: fees capitalise into the basis.
        if (instrumentId && quantity > 0) {
          openLot(transaction, instrumentId, quantity, Math.abs(transaction.amount) * rate);
        }
        break;

      case "sell":
        if (instrumentId && quantity > 0) {
          const cost = consume(account, instrumentId, quantity);
          realizedGains.push({
            accountId: account.id,
            instrumentId,
            amount: transaction.amount * rate - cost,
            tradeDate: transaction.tradeDate,
          });
        }
        break;

      case "adjustment":
        // Sets the position outright: this is how a manual position is corrected, and `quantity: 0`
        // is how it is removed. `amount` is the new cost basis here, not a cash movement.
        if (instrumentId) {
          for (const lot of lotsOf(account.id, instrumentId)) discard(lot);
          if (quantity > EPSILON) {
            openLot(transaction, instrumentId, quantity, Math.abs(transaction.amount) * rate);
          }
        }
        break;

      case "transfer_in":
      case "transfer_out":
      case "split":
      case "symbol_change":
      case "return_of_capital":
      case "spinoff":
      case "merger":
        throw new UnsupportedTransactionError(transaction);

      default:
        // dividend, interest, fee, tax, deposit, withdrawal: cash only.
        break;
    }

    // `amount` is the cash effect of every record except the two that use it as a cost basis:
    // an instrument adjustment, and an opening balance that opens a position. The cash for an
    // opening position was spent before this ledger begins, so charging it here would invent a
    // debt the user never took on; an `opening_balance` with no instrument is an opening *cash*
    // balance and does move cash.
    const setsBasis =
      Boolean(instrumentId) && (transaction.type === "adjustment" || transaction.type === "opening_balance");
    if (!setsBasis) addCash(account.id, transaction.currency, transaction.amount);
  }

  return {
    asOf,
    positions: derivePositions(lots, accountsById, instrumentsById),
    cash: [...cash.values()]
      .filter((balance) => Math.abs(balance.amount) > EPSILON)
      .sort((a, b) => a.accountId.localeCompare(b.accountId) || a.currency.localeCompare(b.currency)),
    realizedGains,
  };
}

function derivePositions(
  lots: Lot[],
  accountsById: Map<string, Account>,
  instrumentsById: Map<string, Instrument>,
): Position[] {
  const groups = new Map<string, Lot[]>();
  for (const lot of lots) {
    const key = `${lot.accountId} ${lot.instrumentId}`;
    const group = groups.get(key);
    if (group) group.push(lot);
    else groups.set(key, [lot]);
  }

  const positions: Position[] = [];
  for (const group of groups.values()) {
    const quantity = group.reduce((sum, lot) => sum + lot.quantity, 0);
    if (Math.abs(quantity) <= EPSILON) continue;
    const costBasis = group.reduce((sum, lot) => sum + lot.cost, 0);
    const { accountId, instrumentId } = group[0];
    positions.push({
      accountId,
      // An unknown instrument id still shows as a holding: dropping a position because its
      // instrument record went missing would be worse than showing the id as the symbol.
      instrument: instrumentsById.get(instrumentId) ?? {
        id: instrumentId,
        kind: "equity",
        symbol: instrumentId,
        currency: accountsById.get(accountId)?.baseCurrency ?? "USD",
      },
      quantity,
      costBasis,
      averageCost: quantity === 0 ? 0 : costBasis / quantity,
      lots: [...group].sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    });
  }
  return positions.sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.instrument.symbol.localeCompare(b.instrument.symbol),
  );
}
