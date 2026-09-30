import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPortfolioStore } from "./store";
import type { Account, Instrument, PortfolioStore } from "./types";

let dir: string;
let store: PortfolioStore;

beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), "ofa-portfolio-")), "portfolio");
  store = createPortfolioStore(dir);
});

afterEach(() => {
  rmSync(path.dirname(dir), { recursive: true, force: true });
});

const account = (id: string, name: string): Account => ({
  id,
  name,
  type: "taxable",
  baseCurrency: "USD",
  costBasisMethod: "fifo",
  source: { kind: "manual" },
});

const instrument: Instrument = { id: "i1", kind: "equity", symbol: "NVDA", currency: "USD" };

const mode = (file: string): number => statSync(file).mode & 0o777;

describe("createPortfolioStore", () => {
  it("starts empty without creating anything", async () => {
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.listInstruments()).toEqual([]);
    expect(await store.listTransactions()).toEqual([]);
    expect(await store.listImportBatches()).toEqual([]);
  });

  it("round-trips accounts and instruments through versioned, owner-only files", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    await store.saveInstrument(instrument);

    expect(await store.listAccounts()).toEqual([account("a1", "Brokerage")]);
    expect(await store.listInstruments()).toEqual([instrument]);

    const accountsFile = JSON.parse(readFileSync(path.join(dir, "accounts.json"), "utf8")) as unknown;
    expect(accountsFile).toEqual({ version: 1, accounts: [account("a1", "Brokerage")] });
    expect(mode(path.join(dir, "accounts.json"))).toBe(0o600);
    expect(mode(path.join(dir, "instruments.json"))).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });

  it("reads an account saved with specific lots as fifo", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    const file = path.join(dir, "accounts.json");
    writeFileSync(file, readFileSync(file, "utf8").replace('"fifo"', '"specific"'));
    expect((await store.listAccounts())[0].costBasisMethod).toBe("fifo");
  });

  it("replaces an existing record instead of adding a second one", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    await store.saveAccount(account("a1", "Renamed"));
    expect(await store.listAccounts()).toEqual([account("a1", "Renamed")]);
  });

  it("serializes concurrent writes so neither is lost", async () => {
    await Promise.all([store.saveAccount(account("a1", "One")), store.saveAccount(account("a2", "Two"))]);
    expect((await store.listAccounts()).map((saved) => saved.id).sort()).toEqual(["a1", "a2"]);
  });

  it("serializes concurrent writes across store instances on the same directory", async () => {
    // Each API request builds its own store, so the queue has to be shared per data root. One
    // instance names the directory by a different spelling of the same path.
    const stores = [store, createPortfolioStore(dir), createPortfolioStore(path.join(dir, "..", "portfolio"))];
    const ids = Array.from({ length: 12 }, (_, index) => `a${index}`);
    await Promise.all(ids.map((id, index) => stores[index % stores.length].saveAccount(account(id, id))));
    expect((await store.listAccounts()).map((saved) => saved.id).sort()).toEqual([...ids].sort());
  });

  it("appends transactions under a version header, assigning the id and the write time", async () => {
    const first = await store.appendTransaction({
      accountId: "a1",
      type: "buy",
      tradeDate: "2024-01-01",
      instrumentId: "i1",
      quantity: 10,
      amount: -1_000,
      currency: "USD",
      source: { kind: "manual" },
    });
    const second = await store.appendTransaction({
      accountId: "a2",
      type: "dividend",
      tradeDate: "2024-02-01",
      amount: 25,
      currency: "USD",
      source: { kind: "manual" },
    });

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(Number.isNaN(Date.parse(first.recordedAt))).toBe(false);

    const ledger = path.join(dir, "transactions.jsonl");
    const lines = readFileSync(ledger, "utf8").split("\n");
    expect(JSON.parse(lines[0]) as unknown).toEqual({ version: 1 });
    expect(lines).toHaveLength(4); // header, two records, trailing newline
    expect(mode(ledger)).toBe(0o600);

    expect(await store.listTransactions()).toEqual([first, second]);
    expect(await store.listTransactions("a2")).toEqual([second]);
  });

  it("keeps the ledger when an account is deleted, and reports an unknown id", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    await store.appendTransaction({
      accountId: "a1",
      type: "buy",
      tradeDate: "2024-01-01",
      amount: -10,
      currency: "USD",
      source: { kind: "manual" },
    });

    expect(await store.deleteAccount("nope")).toBe(false);
    expect(await store.deleteAccount("a1")).toBe(true);
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.listTransactions()).toHaveLength(1);
  });

  it("names the line a damaged ledger fails on", async () => {
    await store.appendTransaction({
      accountId: "a1",
      type: "buy",
      tradeDate: "2024-01-01",
      amount: -10,
      currency: "USD",
      source: { kind: "manual" },
    });
    const ledger = path.join(dir, "transactions.jsonl");
    writeFileSync(ledger, `${readFileSync(ledger, "utf8")}{"id":"x"}\n`);
    await expect(store.listTransactions()).rejects.toThrow(/transactions\.jsonl:3/);
  });

  it("refuses a ledger whose header a newer version wrote", async () => {
    const ledger = path.join(dir, "transactions.jsonl");
    await store.appendTransaction({
      accountId: "a1",
      type: "buy",
      tradeDate: "2024-01-01",
      amount: -10,
      currency: "USD",
      source: { kind: "manual" },
    });
    writeFileSync(ledger, readFileSync(ledger, "utf8").replace('{"version":1}', '{"version":2}'));
    await expect(store.listTransactions()).rejects.toThrow(/transactions\.jsonl:1 is not a portfolio ledger header this version can read/);
    writeFileSync(ledger, readFileSync(ledger, "utf8").replace('{"version":2}', "not json"));
    await expect(store.listTransactions()).rejects.toThrow(/transactions\.jsonl:1 is not valid JSON/);
  });

  it("refuses a file that is not portfolio data", async () => {
    await store.saveAccount(account("a1", "Brokerage"));
    writeFileSync(path.join(dir, "accounts.json"), '{"version":1,"accounts":[{"id":""}]}');
    await expect(store.listAccounts()).rejects.toThrow(/accounts\.json is not valid portfolio data/);
  });
});
