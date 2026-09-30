import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authPath, dataDir, portfolioDir, profilePath, runtimeDir, setCredentialsFile, withDataDir } from "@/lib/paths";
import { addManualPosition } from "@/lib/portfolio/manual";
import { createPortfolioStore } from "@/lib/portfolio/store";
import { readProfile, writeProfile } from "@/lib/profile/store";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ofa-paths-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("the data folder", () => {
  it("is OFA_HOME, or the default folder without it, when nothing scopes the call", () => {
    vi.stubEnv("OFA_HOME", root);
    expect(dataDir()).toBe(root);
    expect(profilePath()).toBe(path.join(root, "profile.json"));

    vi.stubEnv("OFA_HOME", "");
    expect(dataDir()).toBe(path.join(homedir(), ".open-finance-agent"));
  });

  it("is the scoped folder inside withDataDir, across awaits, and OFA_HOME again after it", async () => {
    vi.stubEnv("OFA_HOME", root);
    const scoped = path.join(root, "scoped");

    const seen = await withDataDir(scoped, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { data: dataDir(), portfolio: portfolioDir() };
    });

    expect(seen).toEqual({ data: scoped, portfolio: path.join(scoped, "portfolio") });
    expect(dataDir()).toBe(root);
    expect(process.env.OFA_HOME).toBe(root);
  });

  it("keeps two scoped folders' profiles and holdings apart, even run concurrently", async () => {
    vi.stubEnv("OFA_HOME", root);
    const first = path.join(root, "first");
    const second = path.join(root, "second");

    await Promise.all([
      withDataDir(first, async () => {
        await writeProfile({ risk: { tolerance: "very_high" } });
        const store = createPortfolioStore(portfolioDir());
        await store.saveAccount({ id: "brokerage", name: "Brokerage", type: "taxable", baseCurrency: "USD", costBasisMethod: "fifo", source: { kind: "manual" } });
        await addManualPosition(store, { accountId: "brokerage", symbol: "AAPL", kind: "equity", quantity: 10, averagePrice: 150, currency: "USD" });
      }),
      withDataDir(second, async () => {
        await writeProfile({ risk: { tolerance: "low" } });
      }),
    ]);

    const firstView = await withDataDir(first, async () => ({
      profile: await readProfile(),
      accounts: await createPortfolioStore(portfolioDir()).listAccounts(),
    }));
    const secondView = await withDataDir(second, async () => ({
      profile: await readProfile(),
      accounts: await createPortfolioStore(portfolioDir()).listAccounts(),
    }));

    expect(firstView.profile?.risk?.tolerance).toBe("very_high");
    expect(firstView.accounts.map((account) => account.id)).toEqual(["brokerage"]);
    expect(secondView.profile?.risk?.tolerance).toBe("low");
    expect(secondView.accounts).toEqual([]);
    // Neither wrote into the process's folder.
    expect(await readProfile()).toBeNull();
  });

  it("keeps the calculator runtime in the process's folder, since the runtime outlives any scope", () => {
    vi.stubEnv("OFA_HOME", root);
    expect(withDataDir(path.join(root, "scoped"), () => runtimeDir())).toBe(path.join(root, "runtime"));
  });
  it("keeps credentials in the process's folder, since a sign-in is not one task's", () => {
    vi.stubEnv("OFA_HOME", root);
    expect(authPath()).toBe(path.join(root, "auth.json"));
    expect(withDataDir(path.join(root, "scoped"), () => authPath())).toBe(path.join(root, "auth.json"));
  });

  it("keeps credentials at the file set for the process until it is cleared", () => {
    vi.stubEnv("OFA_HOME", root);
    const elsewhere = path.join(root, "real", "auth.json");
    expect(setCredentialsFile(elsewhere)).toBeUndefined();
    try {
      expect(authPath()).toBe(elsewhere);
      expect(withDataDir(path.join(root, "scoped"), () => authPath())).toBe(elsewhere);
    } finally {
      expect(setCredentialsFile(undefined)).toBe(elsewhere);
    }
    expect(authPath()).toBe(path.join(root, "auth.json"));
  });
});
