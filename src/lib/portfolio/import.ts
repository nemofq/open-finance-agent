import { randomUUID } from "node:crypto";
import { compareHoldings, type HoldingComparison, type LedgerPoint, replayLedger } from "./holdings";
import { findOrCreateInstrument } from "./manual";
import { validatePositions } from "./parser";
import { effectiveTransactions, EPSILON } from "./replay";
import type { Account, CommitImportInput, ImportBatch, ImportPosition, PortfolioStore, Transaction } from "./types";

/** Imports account holdings snapshots into the ledger using balance and adjustment transactions. */

export interface CommitImportResult {
  batch: ImportBatch;
  /** The records this call appended; empty when the key had already been imported. */
  transactions: Transaction[];
  reused: boolean;
}

/** `today` is the user's own date, which dates an import that gives no `importedAt`. */
export async function commitImport(store: PortfolioStore, input: CommitImportInput, today: string): Promise<CommitImportResult> {
  const account = (await store.listAccounts()).find((candidate) => candidate.id === input.accountId);
  if (!account) throw new Error(`No account ${input.accountId} to import into.`);
  validatePositions(input.positions);

  const existing = (await store.listImportBatches(account.id)).find(
    (batch) => batch.idempotencyKey === input.idempotencyKey,
  );
  if (existing) {
    const written = (await store.listTransactions(account.id)).filter(
      (transaction) => transaction.source.importBatchId === existing.id,
    );
    return { batch: existing, transactions: written, reused: true };
  }

  const importedAt = input.importedAt ?? new Date().toISOString();
  const tradeDate = input.importedAt?.slice(0, 10) ?? today;
  const { securities, cash } = groupPositions(input.positions);

  // The batch is written first: a crash between the two leaves an incomplete import that the same
  // key will not duplicate, which is safer than orphan records that a retry would double.
  const batch = await store.saveImportBatch({
    id: randomUUID(),
    accountId: account.id,
    provider: input.source,
    fetchedAt: importedAt,
    from: tradeDate,
    to: tradeDate,
    count: securities.length + cash.length,
    idempotencyKey: input.idempotencyKey,
  });

  const drafts = await planImport(store, account, batch, today, tradeDate, securities, cash);
  const transactions: Transaction[] = [];
  for (const draft of drafts) transactions.push(await store.appendTransaction(draft));
  return { batch, transactions, reused: false };
}

/**
 * What changed in one account between two of its imports, each replayed exactly as it left the
 * ledger; `null` when either id names no import of that account.
 */
export async function compareBatches(
  store: PortfolioStore,
  accountId: string,
  beforeBatchId: string,
  afterBatchId: string,
): Promise<HoldingComparison | null> {
  const batches = await store.listImportBatches(accountId);
  const before = batches.find((batch) => batch.id === beforeBatchId);
  const after = batches.find((batch) => batch.id === afterBatchId);
  if (!before || !after) return null;
  return compareHoldings(store, accountId, await batchPoint(store, before), await batchPoint(store, after));
}

/**
 * Where to replay the ledger to see the account exactly as this batch left it: on the batch's own
 * date, as of the last record it wrote.
 *
 * That record, not the batch's `fetchedAt`: `fetchedAt` is when the file was exported, and the
 * records are written after it, so cutting at `fetchedAt` would drop the very records the batch
 * appended. Two imports on the same day are told apart this way.
 */
async function batchPoint(store: PortfolioStore, batch: ImportBatch): Promise<LedgerPoint> {
  const written = (await store.listTransactions(batch.accountId)).filter(
    (transaction) => transaction.source.importBatchId === batch.id,
  );
  const recordedBy = written.reduce((latest, transaction) => (transaction.recordedAt > latest ? transaction.recordedAt : latest), batch.fetchedAt);
  return { asOf: batch.to, recordedBy };
}

/* ------------------------------------------------------------------- rows */

/** One security the file lists, with every row for it already summed. */
interface SecurityLine {
  /** The ticker, or the asset's name when the row had none: what identifies the instrument. */
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  cost: number;
  /** Only from a single row: the unit price of two merged lots is not one number. */
  price?: number;
  /** The cost came from the file's market value because it stated no cost at all. */
  costFromValue: boolean;
}

/** A row with a value but no quantity: money, or an asset the file only values. */
interface CashLine {
  /** Lower-cased name and currency; the same row in a later file matches on it. */
  key: string;
  name: string;
  currency: string;
  amount: number;
}

/**
 * Rows become one line per instrument. A file that lists the same ticker twice (two lots of the
 * same security) is one position in the ledger, so the quantities and costs are summed: keeping
 * them apart would make a later import, which can only adjust the position as a whole, ambiguous.
 */
function groupPositions(positions: ImportPosition[]): { securities: SecurityLine[]; cash: CashLine[] } {
  const securities = new Map<string, SecurityLine>();
  const cash = new Map<string, CashLine>();

  for (const position of positions) {
    const currency = position.currency.toUpperCase();
    const name = position.name.trim();
    if (position.quantity === null) {
      // Validation guarantees a market value when there is no quantity.
      const amount = position.marketValue ?? 0;
      const key = `${name.toLowerCase()}|${currency}`;
      const line = cash.get(key);
      if (line) line.amount += amount;
      else cash.set(key, { key, name, currency, amount });
      continue;
    }

    const symbol = (position.symbol ?? name).trim();
    const key = `${symbol.toLowerCase()}|${currency}`;
    // What the position cost, in order of how well the file knows it: a stated cost, the cost
    // implied by the unit price, and last the stated market value. The last is a guess — it reads
    // today's value as the basis — so the record says so, and the preview already warns about it.
    const priced = position.price === null ? null : position.quantity * position.price;
    const cost = position.costBasis ?? priced ?? position.marketValue ?? 0;
    const costFromValue = position.costBasis === null && priced === null && position.marketValue !== null;
    const line = securities.get(key);
    if (line) {
      line.quantity += position.quantity;
      line.cost += cost;
      // Two lots of one security have no single unit price, so the merged line states none.
      line.price = undefined;
      line.costFromValue ||= costFromValue;
    } else {
      securities.set(key, {
        symbol,
        name,
        currency,
        quantity: position.quantity,
        cost,
        price: position.price ?? undefined,
        costFromValue,
      });
    }
  }

  return { securities: [...securities.values()], cash: [...cash.values()] };
}

/* --------------------------------------------------------------- planning */

async function planImport(
  store: PortfolioStore,
  account: Account,
  batch: ImportBatch,
  today: string,
  tradeDate: string,
  securities: SecurityLine[],
  cash: CashLine[],
): Promise<Omit<Transaction, "id" | "recordedAt">[]> {
  // What the account holds right now, whoever entered it: the file is authoritative for the
  // positions it lists, so an adjustment replaces a hand-typed position rather than adding to it.
  const { instruments, transactions: allTransactions, snapshot } = await replayLedger(store, today);
  const history = effectiveTransactions(allTransactions.filter((entry) => entry.accountId === account.id));
  const fromImports = history.filter((entry) => entry.source.kind === "csv");

  const held = new Set(
    snapshot.positions.filter((position) => position.accountId === account.id).map((p) => p.instrument.id),
  );
  const previouslyImported = new Set(
    fromImports.map((entry) => entry.instrumentId).filter((id): id is string => id !== undefined),
  );

  const drafts: Omit<Transaction, "id" | "recordedAt">[] = [];
  const seen = new Set<string>();

  for (const line of securities) {
    // An import knows a ticker and a name, never an asset class, so everything it creates is an
    // equity until the user says otherwise.
    const instrument = await findOrCreateInstrument(store, instruments, {
      symbol: line.symbol,
      currency: line.currency,
      name: line.name === line.symbol ? undefined : line.name,
    });
    seen.add(instrument.id);
    const replaces = held.has(instrument.id) || previouslyImported.has(instrument.id);
    drafts.push({
      accountId: account.id,
      type: replaces ? "adjustment" : "opening_balance",
      tradeDate,
      instrumentId: instrument.id,
      quantity: line.quantity,
      price: line.price,
      // Negative by convention: this is what the position cost. The replay reads it as the cost
      // basis of the position rather than as cash, for both record types.
      amount: -Math.abs(line.cost),
      currency: line.currency,
      source: { kind: "csv", importBatchId: batch.id, externalId: line.symbol },
      note: securityNote(line, tradeDate, batch.provider, replaces),
    });
  }

  for (const instrumentId of previouslyImported) {
    if (seen.has(instrumentId) || !held.has(instrumentId)) continue;
    const retired = instruments.find((instrument) => instrument.id === instrumentId);
    drafts.push({
      accountId: account.id,
      type: "adjustment",
      tradeDate,
      instrumentId,
      quantity: 0,
      amount: 0,
      currency: retired?.currency ?? account.baseCurrency,
      source: { kind: "csv", importBatchId: batch.id },
      note: `Not in the ${tradeDate} import of ${batch.provider}`,
    });
  }

  drafts.push(...planCash(account, batch, tradeDate, cash, fromImports));
  return drafts;
}

function securityNote(line: SecurityLine, tradeDate: string, provider: string, replaces: boolean): string | undefined {
  const parts: string[] = [];
  if (replaces) parts.push(`Set to the ${tradeDate} import of ${provider}`);
  if (line.costFromValue) parts.push("cost basis taken from the stated market value, which the file did not give");
  return parts.length > 0 ? parts.join("; ") : undefined;
}

/**
 * A value-only row is a cash-like balance: an `opening_balance` with no instrument, which the
 * replay reads as money rather than as a position. A later file moves it with a dated `adjustment`
 * for the difference, so the balance on an earlier date stays what it was; the record's note keeps
 * the value the file actually stated, which the delta alone would not show.
 */
function planCash(
  account: Account,
  batch: ImportBatch,
  tradeDate: string,
  cash: CashLine[],
  fromImports: Transaction[],
): Omit<Transaction, "id" | "recordedAt">[] {
  const previous = new Map<string, { amount: number; externalId: string; currency: string }>();
  for (const entry of fromImports) {
    if (entry.instrumentId || !entry.source.externalId) continue;
    const key = `${entry.source.externalId.toLowerCase()}|${entry.currency}`;
    const running = previous.get(key);
    if (running) running.amount += entry.amount;
    else previous.set(key, { amount: entry.amount, externalId: entry.source.externalId, currency: entry.currency });
  }

  const drafts: Omit<Transaction, "id" | "recordedAt">[] = [];
  for (const line of cash) {
    const before = previous.get(line.key);
    previous.delete(line.key);
    const delta = line.amount - (before?.amount ?? 0);
    if (before && Math.abs(delta) <= EPSILON) continue;
    drafts.push({
      accountId: account.id,
      type: before ? "adjustment" : "opening_balance",
      tradeDate,
      amount: delta,
      currency: line.currency,
      source: { kind: "csv", importBatchId: batch.id, externalId: line.name },
      note: `${line.name}: ${line.amount} ${line.currency} in the ${tradeDate} import of ${batch.provider}`,
    });
  }

  for (const gone of previous.values()) {
    if (Math.abs(gone.amount) <= EPSILON) continue;
    drafts.push({
      accountId: account.id,
      type: "adjustment",
      tradeDate,
      amount: -gone.amount,
      currency: gone.currency,
      source: { kind: "csv", importBatchId: batch.id, externalId: gone.externalId },
      note: `${gone.externalId}: not in the ${tradeDate} import of ${batch.provider}`,
    });
  }

  return drafts;
}
