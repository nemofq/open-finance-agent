import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { evidenceOf } from "@/lib/evidence/ids";
import { createLedger } from "@/lib/evidence/ledger";
import { portfolioModule } from "@/lib/portfolio/tool";
import { portfolioDir } from "@/lib/paths";
import { addManualPosition } from "@/lib/portfolio/manual";
import { createPortfolioStore } from "@/lib/portfolio/store";
import { createToolSeam } from "./tool-seam";
import { RETAIL_EVAL_TASKS } from "../tasks";

const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-12-concentration-profile-fit")!;
let home: string;
const fetch = vi.fn(() => { throw new Error("Local holdings must not access the network"); });

beforeEach(async () => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-fixture-portfolio-"));
  vi.stubEnv("OFA_HOME", home);
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
  const store = createPortfolioStore(portfolioDir());
  for (const position of task.holdings!) {
    await store.saveAccount({ id: position.accountId, name: "Benchmark brokerage", type: "taxable",
      baseCurrency: position.currency, costBasisMethod: "fifo", source: { kind: "manual" } });
    await addManualPosition(store, position);
  }
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

async function run(params: Record<string, unknown> = {}, existing = false) {
  const ledger = createLedger({ sessionId: "test", dataDir: home });
  if (existing) ledger.add({ kind: "U", value: 123, summary: "Existing user input", origin: "message" });
  const [tool] = await portfolioModule.createTools({ enabled: true }, {
    log: () => {}, session: { id: "test" }, evidence: ledger, asOf: task.asOfDate,
  });
  const wrapper = createToolSeam({ taskId: task.id, mode: "offline", asOf: task.asOfDate });
  const result = await wrapper.wrapTool(tool).execute("holdings", params);
  return { ledger, entries: evidenceOf(result.details), result, wrapper };
}

it.each([{}, { mode: "current" }])("registers the seeded holdings offline for %j", async (params) => {
  const { ledger, entries, wrapper } = await run(params);
  expect(entries).toHaveLength(task.holdings!.length * 2);
  expect(ledger.list("U")).toEqual(entries);
  for (const holding of task.holdings!) {
    expect(entries.find((entry) => entry.name === `${holding.symbol} quantity`)?.value).toBe(holding.quantity);
    expect(entries.find((entry) => entry.name === `${holding.symbol} cost basis`)?.value)
      .toBeCloseTo(holding.totalCost ?? holding.quantity * holding.averagePrice!);
  }
  expect(entries.every((entry) => entry.origin === "holdings")).toBe(true);
  expect(wrapper.stats()).toMatchObject({ hits: 0, recorded: 0 });
});

it("allocates holdings ids after existing evidence instead of importing recorded ids", async () => {
  const { ledger, entries } = await run({}, true);
  expect(ledger.get("U1")?.value).toBe(123);
  expect(entries.map((entry) => entry.id)).toEqual(Array.from({ length: task.holdings!.length * 2 }, (_, i) => `U${i + 2}`));
  expect(ledger.list("U")).toHaveLength(task.holdings!.length * 2 + 1);
  for (const entry of entries) expect(ledger.get(entry.id)).toEqual(entry);
});

it("honors an explicit date before the seeded acquisitions", async () => {
  const { ledger, entries, result } = await run({ mode: "current", asOf: "2000-01-01" });
  expect(entries).toEqual([]);
  expect(ledger.list("U")).toEqual([]);
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("2000-01-01") })]));
});

it("reads only the isolated active store, with no recorded or other-store holdings", async () => {
  vi.stubEnv("OFA_HOME", path.join(home, "empty-run"));
  const { ledger, entries, result } = await run();
  expect(ledger.list("U")).toEqual([]);
  expect(entries).toEqual([]);
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("No accounts yet") })]));
});
