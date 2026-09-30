import { EPSILON, replayTransactions } from "./replay";
import type { Account, CashBalance, Instrument, PortfolioSnapshot, PortfolioStore, Position, Transaction } from "./types";

/** Query and view generation over portfolio holdings derived from transaction replay. */

export interface AccountHolding {
  accountId: string;
  accountName: string;
  institution?: string;
  /** Currency in which the account's cost basis is recorded. */
  baseCurrency?: string;
  position: Position;
}

export interface AccountCash {
  accountId: string;
  accountName: string;
  institution?: string;
  balance: CashBalance;
}

export interface HoldingsView {
  asOf: string;
  holdings: AccountHolding[];
  cash: AccountCash[];
}

/**
 * Where to replay the ledger: holdings on the date `asOf`, counting only the records written by the
 * instant `recordedBy` when it is set, which is how two imports made on one day are told apart.
 */
export interface LedgerPoint {
  asOf: string;
  recordedBy?: string;
}

/** The snapshot of one account at a point in time, replayed from every record in the ledger. */
export async function holdingsSnapshot(store: PortfolioStore, accountId: string, point: LedgerPoint): Promise<PortfolioSnapshot> {
  const { snapshot } = await replayLedger(store, point.asOf, point.recordedBy);
  return narrow(snapshot, accountId);
}

/**
 * Positions and cash across accounts on `today`, the user's own date, each labelled with the
 * account it sits in; only the positions in `symbol` (a ticker or a custom asset's name, matched
 * case-insensitively) when given.
 */
export async function currentHoldings(store: PortfolioStore, today: string, symbol?: string): Promise<HoldingsView> {
  const { accounts, snapshot } = await replayLedger(store, today);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const wanted = symbol?.trim().toLowerCase();

  const holdings: AccountHolding[] = [];
  for (const position of snapshot.positions) {
    const account = byId.get(position.accountId);
    if (!account) continue;
    if (wanted && position.instrument.symbol.toLowerCase() !== wanted) continue;
    holdings.push({ ...label(account, { position }), baseCurrency: account.baseCurrency });
  }

  // A symbol query asks about one security, so cash is not part of the answer.
  const cash: AccountCash[] = wanted
    ? []
    : snapshot.cash.flatMap((balance) => {
        const account = byId.get(balance.accountId);
        return account ? [label(account, { balance })] : [];
      });

  return { asOf: snapshot.asOf, holdings, cash };
}

/* ------------------------------------------------------------ comparison */

export interface HoldingChange {
  instrumentId: string;
  symbol: string;
  name?: string;
  status: "added" | "removed" | "changed";
  before: { quantity: number; costBasis: number } | null;
  after: { quantity: number; costBasis: number } | null;
  quantityDelta: number;
  costBasisDelta: number;
}

export interface CashChange {
  currency: string;
  before: number;
  after: number;
  delta: number;
}

export interface HoldingComparison {
  accountId: string;
  /** The dates the two points replayed to; equal when both sides fall on the same day. */
  beforeAsOf: string;
  afterAsOf: string;
  changes: HoldingChange[];
  cash: CashChange[];
}

/**
 * What changed in one account between two points in time. Positions only: no trade is inferred and
 * no return is computed, because the ledger holds cost, not prices.
 */
export async function compareHoldings(
  store: PortfolioStore,
  accountId: string,
  beforeAt: LedgerPoint,
  afterAt: LedgerPoint,
): Promise<HoldingComparison> {
  const [before, after] = await Promise.all([
    holdingsSnapshot(store, accountId, beforeAt),
    holdingsSnapshot(store, accountId, afterAt),
  ]);

  const left = index(before.positions);
  const right = index(after.positions);
  const changes: HoldingChange[] = [];

  for (const instrumentId of new Set([...left.keys(), ...right.keys()])) {
    const from = left.get(instrumentId);
    const to = right.get(instrumentId);
    const quantityDelta = (to?.quantity ?? 0) - (from?.quantity ?? 0);
    const costBasisDelta = (to?.costBasis ?? 0) - (from?.costBasis ?? 0);
    if (from && to && Math.abs(quantityDelta) <= EPSILON && Math.abs(costBasisDelta) <= EPSILON) continue;
    const instrument = (to ?? from)?.instrument;
    changes.push({
      instrumentId,
      symbol: instrument?.symbol ?? instrumentId,
      name: instrument?.name,
      status: from && to ? "changed" : to ? "added" : "removed",
      before: from ? { quantity: from.quantity, costBasis: from.costBasis } : null,
      after: to ? { quantity: to.quantity, costBasis: to.costBasis } : null,
      quantityDelta,
      costBasisDelta,
    });
  }

  const cash: CashChange[] = [];
  const cashBefore = new Map(before.cash.map((balance) => [balance.currency, balance.amount]));
  const cashAfter = new Map(after.cash.map((balance) => [balance.currency, balance.amount]));
  for (const currency of new Set([...cashBefore.keys(), ...cashAfter.keys()])) {
    const from = cashBefore.get(currency) ?? 0;
    const to = cashAfter.get(currency) ?? 0;
    if (Math.abs(to - from) <= EPSILON) continue;
    cash.push({ currency, before: from, after: to, delta: to - from });
  }

  return {
    accountId,
    beforeAsOf: before.asOf,
    afterAsOf: after.asOf,
    changes: changes.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    cash: cash.sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/* ------------------------------------------------------------------ parts */

interface ReplayedLedger {
  accounts: Account[];
  instruments: Instrument[];
  /** Every record in the ledger, including any the cutoff left out of the snapshot. */
  transactions: Transaction[];
  snapshot: PortfolioSnapshot;
}

/** The whole ledger, every account, replayed at a `LedgerPoint`. */
export async function replayLedger(store: PortfolioStore, asOf: string, recordedBy?: string): Promise<ReplayedLedger> {
  const [accounts, instruments, transactions] = await Promise.all([
    store.listAccounts(),
    store.listInstruments(),
    store.listTransactions(),
  ]);
  const records = recordedBy ? transactions.filter((transaction) => transaction.recordedAt <= recordedBy) : transactions;
  return { accounts, instruments, transactions, snapshot: replayTransactions(records, instruments, accounts, asOf) };
}

function narrow(snapshot: PortfolioSnapshot, accountId: string): PortfolioSnapshot {
  return {
    asOf: snapshot.asOf,
    positions: snapshot.positions.filter((position) => position.accountId === accountId),
    cash: snapshot.cash.filter((balance) => balance.accountId === accountId),
    realizedGains: snapshot.realizedGains.filter((gain) => gain.accountId === accountId),
  };
}

function label<T>(account: Account, rest: T): { accountId: string; accountName: string; institution?: string } & T {
  return { accountId: account.id, accountName: account.name, institution: account.institution, ...rest };
}

function index(positions: Position[]): Map<string, Position> {
  return new Map(positions.map((position) => [position.instrument.id, position]));
}
