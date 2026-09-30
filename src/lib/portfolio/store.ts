import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { isMissingFile, writeJsonFile } from "@/lib/atomic-write";
import { runSerially } from "@/lib/process-state";
import { formatZodIssues } from "@/lib/utils";
import {
  accountsFileSchema,
  importsFileSchema,
  instrumentsFileSchema,
  ledgerHeaderSchema,
  PORTFOLIO_FILE_VERSION,
  transactionSchema,
} from "./schema";
import type { Account, ImportBatch, Instrument, PortfolioStore, Transaction } from "./types";

/**
 * Mutations run one at a time per data root: two saves of different accounts would otherwise both
 * read the old file and the second would drop the first one's write. The queue is the process's,
 * not the store's: every API request builds its own store. It does not lock against another
 * process writing the same directory.
 */
function serializeWrite<T>(dir: string, work: () => Promise<T>): Promise<T> {
  return runSerially(`portfolio:${path.resolve(dir)}`, work);
}

/**
 * The file-backed ledger. Accounts and instruments are small documents rewritten
 * atomically; transactions are append-only JSONL, so an edit appends a correcting record and
 * history can never be rewritten in place.
 */
export function createPortfolioStore(dir: string): PortfolioStore {
  const accountsPath = path.join(dir, "accounts.json");
  const instrumentsPath = path.join(dir, "instruments.json");
  const importsPath = path.join(dir, "imports.json");
  const ledgerPath = path.join(dir, "transactions.jsonl");

  const serialize = <T>(work: () => Promise<T>): Promise<T> => serializeWrite(dir, work);

  /** Read a JSON document, treating a missing file as empty and any other damage as an error. */
  async function readDoc<T>(file: string, schema: z.ZodType<T>, empty: T): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isMissingFile(err)) return empty;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${file} is not valid JSON`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`${file} is not valid portfolio data: ${formatZodIssues(result.error, "root")}`);
    }
    return result.data;
  }

  /** Create the ledger with its version header the first time something is appended. */
  async function ensureLedger(): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(ledgerPath, `${JSON.stringify({ version: PORTFOLIO_FILE_VERSION })}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }

  async function listAccounts(): Promise<Account[]> {
    const file = await readDoc(accountsPath, accountsFileSchema, { version: PORTFOLIO_FILE_VERSION, accounts: [] });
    return file.accounts;
  }

  async function listInstruments(): Promise<Instrument[]> {
    const file = await readDoc(instrumentsPath, instrumentsFileSchema, {
      version: PORTFOLIO_FILE_VERSION,
      instruments: [],
    });
    return file.instruments;
  }

  async function listTransactions(accountId?: string): Promise<Transaction[]> {
    let raw: string;
    try {
      raw = await readFile(ledgerPath, "utf8");
    } catch (err) {
      if (isMissingFile(err)) return [];
      throw err;
    }
    const transactions: Transaction[] = [];
    const lines = raw.split("\n");
    // Line 1 is the version header, and the file ends with a newline, so the last split is empty.
    if (lines[0].trim() !== "") checkHeader(lines[0], ledgerPath);
    for (const [index, line] of lines.entries()) {
      if (index === 0 || line.trim() === "") continue;
      transactions.push(parseLine(line, ledgerPath, index + 1));
    }
    return accountId ? transactions.filter((tx) => tx.accountId === accountId) : transactions;
  }

  async function listImportBatches(accountId?: string): Promise<ImportBatch[]> {
    const file = await readDoc(importsPath, importsFileSchema, { version: PORTFOLIO_FILE_VERSION, batches: [] });
    return accountId ? file.batches.filter((batch) => batch.accountId === accountId) : file.batches;
  }

  return {
    listAccounts,
    listInstruments,
    listTransactions,
    listImportBatches,

    saveAccount(account) {
      return serialize(async () => {
        const accounts = await listAccounts();
        const index = accounts.findIndex((existing) => existing.id === account.id);
        if (index === -1) accounts.push(account);
        else accounts[index] = account;
        await writeJsonFile(accountsPath, { version: PORTFOLIO_FILE_VERSION, accounts });
        return account;
      });
    },

    updateAccount(id, patch) {
      // Read inside the queue, so two edits of one account each keep the other's fields.
      return serialize(async () => {
        const accounts = await listAccounts();
        const index = accounts.findIndex((existing) => existing.id === id);
        if (index === -1) return null;
        accounts[index] = { ...accounts[index], ...patch };
        await writeJsonFile(accountsPath, { version: PORTFOLIO_FILE_VERSION, accounts });
        return accounts[index];
      });
    },

    /**
     * Removes the account only. Its transactions stay in the append-only ledger: deleting them
     * would rewrite history, and a replay simply skips records naming an account that is gone.
     */
    deleteAccount(id) {
      return serialize(async () => {
        const accounts = await listAccounts();
        const remaining = accounts.filter((account) => account.id !== id);
        if (remaining.length === accounts.length) return false;
        await writeJsonFile(accountsPath, { version: PORTFOLIO_FILE_VERSION, accounts: remaining });
        return true;
      });
    },

    saveInstrument(instrument) {
      return serialize(async () => {
        const instruments = await listInstruments();
        const index = instruments.findIndex((existing) => existing.id === instrument.id);
        if (index === -1) instruments.push(instrument);
        else instruments[index] = instrument;
        await writeJsonFile(instrumentsPath, { version: PORTFOLIO_FILE_VERSION, instruments });
        return instrument;
      });
    },

    appendTransaction(transaction) {
      return serialize(async () => {
        const record: Transaction = { ...transaction, id: randomUUID(), recordedAt: new Date().toISOString() };
        await ensureLedger();
        await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        return record;
      });
    },

    /** Batches are a small index of what was imported and when; the records themselves are in the ledger. */
    saveImportBatch(batch) {
      return serialize(async () => {
        const batches = await listImportBatches();
        const index = batches.findIndex((existing) => existing.id === batch.id);
        if (index === -1) batches.push(batch);
        else batches[index] = batch;
        await writeJsonFile(importsPath, { version: PORTFOLIO_FILE_VERSION, batches });
        return batch;
      });
    },
  };
}

/** The ledger's version header, so an older build refuses a ledger a newer one wrote. */
function checkHeader(line: string, file: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`${file}:1 is not valid JSON`);
  }
  const result = ledgerHeaderSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${file}:1 is not a portfolio ledger header this version can read: ${formatZodIssues(result.error, "root")}`);
  }
}

/** A damaged line names itself, so a user can fix the file by hand instead of guessing. */
function parseLine(line: string, file: string, lineNumber: number): Transaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`${file}:${lineNumber} is not valid JSON`);
  }
  const result = transactionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${file}:${lineNumber} is not a valid transaction: ${formatZodIssues(result.error, "root")}`);
  }
  return result.data;
}
