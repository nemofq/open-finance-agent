/**
 * Transaction-ledger data model for portfolio accounts, instruments, and positions. Everything that
 * is also checked at runtime, on disk or in a request, is inferred from its schema in `./schema.ts`.
 */
import type { z } from "zod";
import type {
  accountInputSchema,
  accountSchema,
  accountTypeSchema,
  assetTypeSchema,
  columnMappingSchema,
  commitImportInputSchema,
  costBasisMethodSchema,
  costBasisModeSchema,
  importBatchSchema,
  importFormatSchema,
  importPositionSchema,
  instrumentKindSchema,
  instrumentSchema,
  manualPositionInputSchema,
  rawTableSchema,
  simpleTransactionInputSchema,
  transactionSchema,
  transactionTypeSchema,
} from "./schema";

export type AccountType = z.infer<typeof accountTypeSchema>;
export type CostBasisMethod = z.infer<typeof costBasisMethodSchema>;
export type InstrumentKind = z.infer<typeof instrumentKindSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export type Account = z.infer<typeof accountSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;

/* ------------------------------------------------------------- derived */

export interface Lot {
  id: string;
  accountId: string;
  instrumentId: string;
  openedAt: string;
  quantity: number;
  /** Total cost of the open quantity, in the account's base currency. */
  cost: number;
}

export interface Position {
  accountId: string;
  instrument: Instrument;
  quantity: number;
  /** Total cost basis in the account's base currency. */
  costBasis: number;
  averageCost: number;
  lots: Lot[];
}

export interface CashBalance {
  accountId: string;
  currency: string;
  amount: number;
}

export interface PortfolioSnapshot {
  asOf: string;
  positions: Position[];
  cash: CashBalance[];
  realizedGains: { accountId: string; instrumentId: string; amount: number; tradeDate: string }[];
}

/* --------------------------------------------------------- file imports */

/**
 * The vocabulary of a holdings import: a spreadsheet, a CSV or a pasted broker table becomes a
 * `RawTable`, a `ColumnMapping` gives its columns meaning, and each row is normalised into a
 * `PreviewPosition` the user can correct and then an `ImportPosition` that becomes ledger records.
 * Numbers are numbers throughout; the ledger stores no decimal strings.
 */

/** Where an imported table came from. `manual` is a table typed into the import dialog. */
export type ImportFormat = z.infer<typeof importFormatSchema>;

/**
 * A holdings table as it arrives, before any column has a meaning. `allRows` keeps the lines above
 * the header too, so the user can point at the real header row of a file that starts with a title.
 */
export type RawTable = z.infer<typeof rawTableSchema>;

export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type FieldName = keyof ColumnMapping;

/** Whether a cost column holds the cost of the whole position or the cost of a single unit. */
export type CostBasisMode = z.infer<typeof costBasisModeSchema>;

/** A row with a ticker is a security; a row without one is still a holding, just an unnamed asset. */
export type AssetType = z.infer<typeof assetTypeSchema>;

/** One source row after normalisation, carrying everything that is wrong or suspect about it. */
export interface PreviewPosition {
  /** 1-based line in the source table, counting its header, so a message can name the row. */
  rowNumber: number;
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  currency: string | null;
  assetType: AssetType;
  warnings: string[];
  errors: string[];
}

/**
 * A preview row the user accepted, ready to become ledger records. A row with a quantity becomes a
 * position; a row with only a market value becomes a cash-like balance.
 */
export type ImportPosition = z.infer<typeof importPositionSchema>;

/** `POST /api/portfolio/commit`: the reviewed rows to write onto one account as an import batch. */
export type CommitImportInput = z.infer<typeof commitImportInputSchema>;

/** Default currency for imported holdings; multi-currency conversion is not performed. */
export const DEFAULT_PORTFOLIO_CURRENCY = "USD";

/* ---------------------------------------------------------------- input */

/** Manual position entry; stored as an `opening_balance` transaction. */
export type ManualPositionInput = z.infer<typeof manualPositionInputSchema>;

/** `POST /api/portfolio/accounts`, and any subset of it for a `PATCH`. */
export type AccountInput = z.input<typeof accountInputSchema>;

/** `POST /api/portfolio/transactions`: one buy, sell or dividend; anything richer is a full `Transaction`. */
export type SimpleTransactionInput = z.input<typeof simpleTransactionInputSchema>;

/* -------------------------------------------------------------- storage */

/** Swappable storage behind the ledger; the file implementation lives in `src/lib/portfolio/store.ts`. */
export interface PortfolioStore {
  listAccounts(): Promise<Account[]>;
  saveAccount(account: Account): Promise<Account>;
  /** Merge `patch` into an account under the write queue; `null` when there is no such account. */
  updateAccount(id: string, patch: Partial<Omit<Account, "id">>): Promise<Account | null>;
  deleteAccount(id: string): Promise<boolean>;
  listInstruments(): Promise<Instrument[]>;
  saveInstrument(instrument: Instrument): Promise<Instrument>;
  /** Every transaction ever appended, in append order. */
  listTransactions(accountId?: string): Promise<Transaction[]>;
  appendTransaction(transaction: Omit<Transaction, "id" | "recordedAt">): Promise<Transaction>;
  listImportBatches(accountId?: string): Promise<ImportBatch[]>;
  saveImportBatch(batch: ImportBatch): Promise<ImportBatch>;
}
