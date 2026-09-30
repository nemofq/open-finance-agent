import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerWith } from "@/lib/evidence/testing";
import type { EvidenceDetails, EvidenceLedger } from "@/lib/evidence/types";
import { portfolioDir } from "@/lib/paths";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { commitImport } from "./import";
import { addManualPosition, addSimpleTransaction } from "./manual";
import { createPortfolioStore } from "./store";
import { portfolioModule } from "./tool";
import type { Account, PortfolioStore } from "./types";

let home: string;
let store: PortfolioStore;

/** The date the page would send with an import; later than every import below. */
const TODAY = "2026-12-31";

const brokerage: Account = {
  id: "a1",
  name: "Brokerage",
  type: "taxable",
  baseCurrency: "USD",
  costBasisMethod: "fifo",
  source: { kind: "manual" },
};

function context(evidence: EvidenceLedger = ledgerWith()): ModuleContext {
  return { log: () => {}, session: { id: "test" }, evidence, asOf: "2026-09-13", localDate: "2026-09-13" };
}

async function tool(ctx: ModuleContext): Promise<FinanceTool> {
  const [only] = await portfolioModule.createTools({ enabled: true }, ctx);
  return only;
}

interface ToolParams {
  mode?: "current" | "history" | "compare";
  accountId?: string;
  asOf?: string;
  beforeAsOf?: string;
  afterAsOf?: string;
}

async function run(ctx: ModuleContext, params: ToolParams = {}) {
  const result = await (await tool(ctx)).execute("call-1", params);
  const [first] = result.content;
  // The registry holds tools with their detail type erased; this is the one `portfolio_get`
  // declares, and the assertions below are what hold it to it.
  return { text: first.type === "text" ? first.text : "", details: result.details as EvidenceDetails };
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-portfolio-tool-"));
  process.env.OFA_HOME = home;
  store = createPortfolioStore(portfolioDir());
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

describe("portfolio_get", () => {
  it("declares itself a general read tool", async () => {
    const only = await tool(context());
    expect(only.name).toBe("portfolio_get");
    expect(only.meta).toEqual({ class: "general", effect: "read", supportsAsOf: true });
  });

  it("reads a live turn's holdings on the turn's own date", async () => {
    await store.saveAccount(brokerage);
    // 08:30 on 28 September in Tokyo is still the 27th in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T23:30:00Z"));
    try {
      const { text } = await run({ log: () => {}, session: { id: "test" }, evidence: ledgerWith(), localDate: "2026-09-28" });
      expect(text).toContain("Holdings as of 2026-09-28");
    } finally {
      vi.useRealTimers();
    }
  });

  it("points the user at the Portfolio page when there are no accounts", async () => {
    const { text } = await run(context(ledgerWith()));
    expect(text).toContain("No accounts yet");
    expect(text).toContain("Portfolio page");
  });

  it("reports positions, weights and cash, and registers two U entries per position", async () => {
    await store.saveAccount({
      id: "a1",
      name: "Brokerage",
      type: "taxable",
      baseCurrency: "USD",
      costBasisMethod: "fifo",
      source: { kind: "manual" },
    });
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 120,
      totalCost: 42_000,
      currency: "USD",
      acquiredAt: "2024-03-01",
    });
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "AAPL",
      quantity: 100,
      totalCost: 14_000,
      currency: "USD",
      acquiredAt: "2024-03-01",
    });
    await addSimpleTransaction(store, {
      accountId: "a1",
      type: "dividend",
      symbol: "NVDA",
      tradeDate: "2024-06-01",
      amount: 60,
      currency: "USD",
    });

    const ledger = ledgerWith();
    const { text, details } = await run(context(ledger));

    expect(text).toContain("Holdings as of 2026-09-13");
    expect(text).toContain("NVDA  120 shares [U3]  cost USD 42,000.00 [U4]  avg USD 350.00 75.0% of account cost");
    expect(text).toContain("AAPL  100 shares [U1]  cost USD 14,000.00 [U2]  avg USD 140.00 25.0% of account cost");
    expect(text).toContain("Cash: USD 60.00");
    expect(text).toContain("Total cost basis: USD 56,000.00");
    expect(text).toContain("No market prices or valuations");

    const entries = ledger.list("U");
    expect(entries.map((entry) => entry.name)).toEqual([
      "AAPL quantity",
      "AAPL cost basis",
      "NVDA quantity",
      "NVDA cost basis",
    ]);
    expect(entries.map((entry) => entry.value)).toEqual([100, 14_000, 120, 42_000]);
    expect(entries.every((entry) => entry.origin === "holdings" && entry.asOf === "2026-09-13")).toBe(true);
    expect(details).toEqual({ evidence: entries });
  });

  it("answers for one account and says so when the id is unknown", async () => {
    await store.saveAccount({
      id: "a1",
      name: "Brokerage",
      type: "taxable",
      baseCurrency: "USD",
      costBasisMethod: "fifo",
      source: { kind: "manual" },
    });
    await store.saveAccount({
      id: "a2",
      name: "ISA",
      type: "isa",
      baseCurrency: "GBP",
      costBasisMethod: "average",
      source: { kind: "manual" },
    });
    await addManualPosition(store, {
      accountId: "a2",
      symbol: "VUSA",
      quantity: 10,
      totalCost: 800,
      currency: "GBP",
      acquiredAt: "2024-03-01",
    });

    const { text } = await run(context(ledgerWith()), { accountId: "a2" });
    expect(text).toContain("ISA");
    expect(text).not.toContain("Brokerage");
    expect(text).toContain("VUSA  10 shares [U1]  cost GBP 800.00 [U2]");

    const unknown = await run(context(ledgerWith()), { accountId: "nope" });
    expect(unknown.text).toContain("No account with id nope");
  });

  it("honours an explicit as-of date over the turn's", async () => {
    await store.saveAccount({
      id: "a1",
      name: "Brokerage",
      type: "taxable",
      baseCurrency: "USD",
      costBasisMethod: "fifo",
      source: { kind: "manual" },
    });
    await addManualPosition(store, {
      accountId: "a1",
      symbol: "NVDA",
      quantity: 5,
      totalCost: 500,
      currency: "USD",
      acquiredAt: "2025-01-01",
    });

    const { text } = await run(context(ledgerWith()), { asOf: "2024-12-31" });
    expect(text).toContain("Holdings as of 2024-12-31");
    expect(text).toContain("No open positions");
  });

  it("lists the holdings files that were imported, and says when there were none", async () => {
    await store.saveAccount(brokerage);
    await commitImport(store, {
      accountId: "a1",
      positions: [
        { symbol: "NVDA", name: "NVIDIA", quantity: 120, price: null, marketValue: null, costBasis: 42_000, currency: "USD", assetType: "security" },
      ],
      source: "csv",
      idempotencyKey: "history-mode-0001",
      importedAt: "2026-08-01T12:00:00.000Z",
    }, TODAY);

    const { text, details } = await run(context(ledgerWith()), { mode: "history" });
    expect(text).toContain("Holdings imports in the user's own ledger.");
    expect(text).toContain("2026-08-01 — 1 position from csv");
    // A date and a row count identify nobody, so history registers no evidence.
    expect(details).toEqual({});

    await store.saveAccount({ ...brokerage, id: "a2", name: "ISA" });
    expect((await run(context(), { mode: "history", accountId: "a2" })).text).toContain("No imports");
  });

  it("compares two dates as quantity and cost differences, and registers one U entry per change", async () => {
    await store.saveAccount(brokerage);
    const position = (quantity: number, costBasis: number) => ({
      symbol: "NVDA",
      name: "NVIDIA",
      quantity,
      price: null,
      marketValue: null,
      costBasis,
      currency: "USD",
      assetType: "security" as const,
    });
    await commitImport(store, {
      accountId: "a1",
      positions: [position(120, 42_000)],
      source: "csv",
      idempotencyKey: "compare-mode-first",
      importedAt: "2026-08-01T12:00:00.000Z",
    }, TODAY);
    await commitImport(store, {
      accountId: "a1",
      positions: [position(140, 49_000)],
      source: "csv",
      idempotencyKey: "compare-mode-second",
      importedAt: "2026-09-01T12:00:00.000Z",
    }, TODAY);

    const ledger = ledgerWith();
    const { text, details } = await run(context(ledger), {
      mode: "compare",
      beforeAsOf: "2026-08-15",
      afterAsOf: "2026-09-15",
    });
    expect(text).toContain("Change in the user's own holdings between 2026-08-15 and 2026-09-15.");
    expect(text).toContain("NVDA  changed: 120 → 140 (+20) [U1]  cost USD 42,000.00 → USD 49,000.00");
    expect(text).toContain("not trades");

    const [entry] = ledger.list("U");
    expect(entry).toMatchObject({ name: "NVDA quantity change", value: 20, origin: "holdings", asOf: "2026-09-15" });
    expect(details).toEqual({ evidence: [entry] });
  });

  it("asks for both dates before it compares", async () => {
    await store.saveAccount(brokerage);
    const { text } = await run(context(ledgerWith()), { mode: "compare", beforeAsOf: "2026-08-15" });
    expect(text).toContain("needs both beforeAsOf and afterAsOf");
  });
});
