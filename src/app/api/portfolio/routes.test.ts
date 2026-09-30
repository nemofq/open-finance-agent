import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portfolioDir } from "@/lib/paths";
import { replayLedger } from "@/lib/portfolio/holdings";
import { createPortfolioStore } from "@/lib/portfolio/store";
import type { Account, Position, Transaction } from "@/lib/portfolio/types";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-portfolio-api-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const newAccount = {
  name: "Brokerage",
  type: "taxable",
  baseCurrency: "usd",
  costBasisMethod: "fifo",
  institution: "Fidelity",
};

describe("/api/portfolio", () => {
  it("creates an account, lists it, patches it and deletes it", async () => {
    const { GET, POST } = await import("./accounts/route");
    const { DELETE, PATCH } = await import("./accounts/[id]/route");

    const created = await POST(json("http://localhost/api/portfolio/accounts", "POST", newAccount));
    expect(created.status).toBe(201);
    const { account } = (await created.json()) as { account: Account };
    expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(account.source).toEqual({ kind: "manual" });
    // Currency codes are normalised, so "usd" and "USD" cannot become two cash balances.
    expect(account.baseCurrency).toBe("USD");

    const listed = (await (await GET()).json()) as { accounts: Account[] };
    expect(listed.accounts).toEqual([account]);

    const params = { params: Promise.resolve({ id: account.id }) };
    const patched = await PATCH(
      json(`http://localhost/api/portfolio/accounts/${account.id}`, "PATCH", { name: "Renamed" }),
      params,
    );
    expect(((await patched.json()) as { account: Account }).account).toEqual({ ...account, name: "Renamed" });

    const missing = { params: Promise.resolve({ id: "nope" }) };
    expect((await PATCH(json("http://localhost/x", "PATCH", { name: "x" }), missing)).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/x"), missing)).status).toBe(404);

    const deleted = await DELETE(new Request("http://localhost/x"), params);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(((await (await GET()).json()) as { accounts: Account[] }).accounts).toEqual([]);
  });

  it("keeps both of two edits made to one account at once", async () => {
    const { POST } = await import("./accounts/route");
    const { PATCH } = await import("./accounts/[id]/route");
    const created = await POST(json("http://localhost/api/portfolio/accounts", "POST", newAccount));
    const { account } = (await created.json()) as { account: Account };
    const params = { params: Promise.resolve({ id: account.id }) };
    const url = `http://localhost/api/portfolio/accounts/${account.id}`;
    await Promise.all([
      PATCH(json(url, "PATCH", { name: "Renamed" }), params),
      PATCH(json(url, "PATCH", { institution: "Vanguard" }), params),
    ]);
    const [saved] = await createPortfolioStore(portfolioDir()).listAccounts();
    expect(saved).toMatchObject({ name: "Renamed", institution: "Vanguard" });
  });

  it("adds a position and replays the snapshot", async () => {
    const accounts = await import("./accounts/route");
    const positions = await import("./positions/route");

    const { account } = (await (
      await accounts.POST(json("http://localhost/api/portfolio/accounts", "POST", newAccount))
    ).json()) as { account: Account };

    const added = await positions.POST(
      json("http://localhost/api/portfolio/positions", "POST", {
        accountId: account.id,
        symbol: "NVDA",
        quantity: 120,
        totalCost: 42_000,
        currency: "USD",
        acquiredAt: "2024-03-01",
      }),
    );
    expect(added.status).toBe(201);
    const { transaction } = (await added.json()) as { transaction: Transaction };
    expect(transaction.type).toBe("opening_balance");

    const held = await positionsIn(account.id);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ quantity: 120, costBasis: 42_000, averageCost: 350 });
    expect(held[0].instrument.symbol).toBe("NVDA");
  });

  it("edits and removes the current position by account and instrument", async () => {
    const accounts = await import("./accounts/route");
    const positions = await import("./positions/route");
    const current = await import("./positions/current/[accountId]/[instrumentId]/route");

    const { account } = (await (
      await accounts.POST(json("http://localhost/api/portfolio/accounts", "POST", newAccount))
    ).json()) as { account: Account };
    await positions.POST(
      json("http://localhost/api/portfolio/positions", "POST", {
        accountId: account.id,
        symbol: "AAPL",
        quantity: 10,
        averagePrice: 150,
        currency: "USD",
      }),
    );
    const instrumentId = (await positionsIn(account.id))[0].instrument.id;

    const edited = await current.PATCH(
      json(`http://localhost/api/portfolio/positions/current/${account.id}/${instrumentId}`, "PATCH", {
        accountId: account.id,
        symbol: "AAPL",
        quantity: 12,
        averagePrice: 175,
        currency: "USD",
      }),
      { params: Promise.resolve({ accountId: account.id, instrumentId }) },
    );
    expect(edited.status).toBe(200);
    expect((await positionsIn(account.id))[0]).toMatchObject({
      quantity: 12,
      costBasis: 2_100,
    });

    const removed = await current.DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ accountId: account.id, instrumentId }),
    });
    expect(removed.status).toBe(200);
    expect(await positionsIn(account.id)).toEqual([]);
  });

  it("records a buy and a dividend", async () => {
    const accounts = await import("./accounts/route");
    const transactions = await import("./transactions/route");

    const { account } = (await (
      await accounts.POST(json("http://localhost/api/portfolio/accounts", "POST", newAccount))
    ).json()) as { account: Account };

    const recorded: Transaction[] = [];
    for (const body of [
      { type: "buy", tradeDate: "2024-01-10", quantity: 10, price: 100, fees: 5 },
      { type: "dividend", tradeDate: "2024-06-10", amount: 30 },
    ]) {
      const created = await transactions.POST(
        json("http://localhost/api/portfolio/transactions", "POST", {
          accountId: account.id,
          symbol: "NVDA",
          currency: "USD",
          ...body,
        }),
      );
      expect(created.status).toBe(201);
      recorded.push(((await created.json()) as { transaction: Transaction }).transaction);
    }

    expect(recorded.map((entry) => entry.type)).toEqual(["buy", "dividend"]);
    expect(recorded[0].amount).toBe(-1_005);
    const stored = await createPortfolioStore(portfolioDir()).listTransactions(account.id);
    expect(stored.map((entry) => entry.id)).toEqual(recorded.map((entry) => entry.id));
  });

  it("rejects a body the schema does not accept", async () => {
    const { POST } = await import("./accounts/route");
    const res = await POST(json("http://localhost/api/portfolio/accounts", "POST", { ...newAccount, type: "vault" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("type");
  });

  it("rejects a position with neither a cost nor a price", async () => {
    const { POST } = await import("./positions/route");
    const res = await POST(
      json("http://localhost/api/portfolio/positions", "POST", {
        accountId: "a1",
        symbol: "NVDA",
        quantity: 1,
        currency: "USD",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("totalCost");
  });

  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./accounts/route");
    const res = await POST(
      new Request("http://localhost/api/portfolio/accounts", { method: "POST", body: JSON.stringify(newAccount) }),
    );
    expect(res.status).toBe(415);
  });
});

/** The account's positions as the ledger replays them. */
async function positionsIn(accountId: string): Promise<Position[]> {
  const { snapshot } = await replayLedger(createPortfolioStore(portfolioDir()), "9999-12-31");
  return snapshot.positions.filter(
    (position) => position.accountId === accountId,
  );
}
