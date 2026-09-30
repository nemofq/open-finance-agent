import { z } from "zod";

/**
 * Runtime shapes for everything that crosses a trust boundary: the files on disk (which a user
 * may edit by hand) and the bodies the portfolio page posts. `./types.ts` infers the records and
 * the inputs from these, so a shape is declared once.
 */

/** Bumped only by a breaking change to the on-disk shape, so an older build refuses a newer file. */
export const PORTFOLIO_FILE_VERSION = 1;

const fileVersion = z.literal(PORTFOLIO_FILE_VERSION);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");

export const accountTypeSchema = z.enum(["taxable", "ira", "roth_ira", "401k", "isa", "sipp", "tfsa", "other"]);
/**
 * Accounts saved when "specific" lots could be chosen read as fifo, which is what a sale naming no
 * lots came to.
 */
export const costBasisMethodSchema = z
  .enum(["fifo", "lifo", "average", "specific"])
  .transform((method) => (method === "specific" ? "fifo" : method));
export const instrumentKindSchema = z.enum(["equity", "etf", "fund", "bond", "option", "crypto", "cash"]);
const sourceKindSchema = z.enum(["manual", "csv", "api"]);

export const transactionTypeSchema = z.enum([
  "opening_balance",
  "buy",
  "sell",
  "dividend",
  "interest",
  "fee",
  "tax",
  "deposit",
  "withdrawal",
  "transfer_in",
  "transfer_out",
  "split",
  "spinoff",
  "merger",
  "symbol_change",
  "return_of_capital",
  "adjustment",
]);

/* ------------------------------------------------------------------ records */

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  institution: z.string().optional(),
  type: accountTypeSchema,
  baseCurrency: z.string(),
  costBasisMethod: costBasisMethodSchema,
  source: z.object({
    kind: sourceKindSchema,
    provider: z.string().optional(),
    connectionId: z.string().optional(),
  }),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
});

export const instrumentSchema = z.object({
  id: z.string().min(1),
  kind: instrumentKindSchema,
  symbol: z.string(),
  exchange: z.string().optional(),
  currency: z.string(),
  name: z.string().optional(),
  identifiers: z
    .object({
      cik: z.string().optional(),
      isin: z.string().optional(),
      cusip: z.string().optional(),
      figi: z.string().optional(),
    })
    .optional(),
  option: z
    .object({
      underlyingId: z.string(),
      expiry: z.string(),
      strike: z.number(),
      right: z.enum(["call", "put"]),
      multiplier: z.number(),
    })
    .optional(),
});

export const transactionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  type: transactionTypeSchema,
  /** YYYY-MM-DD */
  tradeDate: isoDate,
  settleDate: isoDate.optional(),
  instrumentId: z.string().optional(),
  quantity: z.number().optional(),
  price: z.number().optional(),
  /** Signed cash effect in `currency`: negative for a buy, positive for a sell or dividend. */
  amount: z.number(),
  currency: z.string(),
  fxRate: z.number().optional(),
  fees: z.number().optional(),
  taxes: z.number().optional(),
  source: z.object({
    kind: sourceKindSchema,
    importBatchId: z.string().optional(),
    externalId: z.string().optional(),
  }),
  note: z.string().optional(),
  /** ISO 8601 instant the record was written. */
  recordedAt: z.string(),
});

export const importBatchSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  provider: z.string(),
  fetchedAt: z.string(),
  from: z.string(),
  to: z.string(),
  count: z.number(),
  /**
   * Caller-supplied key that makes re-sending the same import a no-op. Optional because a batch
   * fetched from a broker API is identified by its provider and window instead.
   */
  idempotencyKey: z.string().optional(),
});

/* -------------------------------------------------------------------- files */

export const accountsFileSchema = z.object({ version: fileVersion, accounts: z.array(accountSchema) });
export const instrumentsFileSchema = z.object({ version: fileVersion, instruments: z.array(instrumentSchema) });
export const importsFileSchema = z.object({ version: fileVersion, batches: z.array(importBatchSchema) });
/** First line of `transactions.jsonl`; every line after it is one transaction. */
export const ledgerHeaderSchema = z.object({ version: fileVersion });

/* ---------------------------------------------------- input from the browser */

/** Currency codes are ISO 4217, so upper-casing is a normalisation, not a rewrite of user intent. */
const currencyCode = z.string().trim().min(1).max(12).toUpperCase();
const symbol = z.string().trim().min(1).max(32);
const note = z.string().trim().max(500).optional();

export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: accountTypeSchema,
  baseCurrency: currencyCode,
  costBasisMethod: costBasisMethodSchema,
  institution: z.string().trim().max(120).optional(),
  /** YYYY-MM-DD */
  openedAt: isoDate.optional(),
});

/** PATCH accepts any subset; an empty body leaves the account untouched. */
export const accountPatchSchema = accountInputSchema.partial();

export const manualPositionInputSchema = z
  .object({
    accountId: z.string().min(1),
    symbol,
    kind: instrumentKindSchema.optional(),
    quantity: z.number().positive(),
    /** Either the total cost or the average price; one is required. */
    totalCost: z.number().nonnegative().optional(),
    averagePrice: z.number().nonnegative().optional(),
    currency: currencyCode,
    acquiredAt: isoDate.optional(),
    note,
  })
  .refine((input) => input.totalCost !== undefined || input.averagePrice !== undefined, {
    error: "either totalCost or averagePrice is required",
    path: ["totalCost"],
  });

export const simpleTransactionInputSchema = z
  .object({
    accountId: z.string().min(1),
    type: z.enum(["buy", "sell", "dividend"]),
    symbol,
    kind: instrumentKindSchema.optional(),
    /** YYYY-MM-DD */
    tradeDate: isoDate,
    quantity: z.number().positive().optional(),
    price: z.number().nonnegative().optional(),
    /** Signed cash effect; derived from quantity, price and fees when absent. A dividend needs it. */
    amount: z.number().optional(),
    currency: currencyCode,
    fees: z.number().nonnegative().optional(),
    note,
  })
  // The form can send either the amount or the numbers it is computed from, but a trade always
  // needs its quantity: that is what moves the lots.
  .refine((input) => input.type === "dividend" || input.quantity !== undefined, {
    error: "quantity is required for a buy or a sell",
    path: ["quantity"],
  })
  .refine((input) => input.amount !== undefined || (input.type !== "dividend" && input.price !== undefined), {
    error: "amount is required (a buy or a sell may send quantity and price instead)",
    path: ["amount"],
  });

/* --------------------------------------------------- input from an import */

/** A parsed number or an empty cell; the parser never sends a string here. */
const importNumber = z.number().finite().nullable();

export const importFormatSchema = z.enum(["csv", "xlsx", "paste", "manual"]);
export const costBasisModeSchema = z.enum(["total", "per_unit"]);
export const assetTypeSchema = z.enum(["security", "custom"]);

export const rawTableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  allRows: z.array(z.array(z.string())).optional(),
  source: importFormatSchema,
  sheetName: z.string().optional(),
});

/**
 * The fields an import can fill, each naming the source column that carries it. Only these, so a
 * stray key cannot become a column name.
 */
export const columnMappingSchema = z.object({
  symbol: z.string().optional(),
  name: z.string().optional(),
  quantity: z.string().optional(),
  price: z.string().optional(),
  marketValue: z.string().optional(),
  costBasis: z.string().optional(),
});

export const fieldNames = columnMappingSchema.keyof().options;

export const previewInputSchema = z.object({
  table: rawTableSchema,
  mapping: columnMappingSchema,
  costBasisMode: costBasisModeSchema,
  excludedRows: z.array(z.number().int().nonnegative()).optional(),
});

export const importPositionSchema = z.object({
  rowNumber: z.number().int().positive().optional(),
  symbol: z.string().trim().min(1).max(32).nullable(),
  name: z.string().trim().min(1).max(200),
  quantity: importNumber,
  price: importNumber,
  marketValue: importNumber,
  costBasis: importNumber,
  currency: currencyCode,
  assetType: assetTypeSchema,
});

export const commitImportInputSchema = z.object({
  accountId: z.string().min(1),
  positions: z.array(importPositionSchema),
  /** Where the table came from ("csv", "xlsx", "paste", "manual"); kept as the batch's provider. */
  source: z.string().trim().min(1).max(80),
  /**
   * Re-sending the same key for the same account returns the first batch and writes nothing. Long
   * enough that a retry of the same import collides and a new one never does.
   */
  idempotencyKey: z.string().trim().min(8).max(120),
  /** ISO 8601 instant the file describes; defaults to now. */
  importedAt: z.string().datetime().optional(),
});

/** The two imports of one account to compare. */
export const compareInputSchema = z.object({
  accountId: z.string().min(1),
  beforeBatchId: z.string().min(1),
  afterBatchId: z.string().min(1),
});

export const assistMappingInputSchema = z.object({
  headers: z.array(z.string()).min(1).max(80),
  samples: z.array(z.array(z.string())).max(5),
});
