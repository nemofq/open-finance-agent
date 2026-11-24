import { afterAll, describe, expect, it } from "vitest";
import type { StructuredDetails } from "@/lib/evidence/types";
import { disconnect } from "@/lib/mcp/client";
import { offlineContext } from "@/lib/tools/testing";
import { stockfitModule } from "./module";

/**
 * The module against the real StockFit server. Off by default so CI and offline checkouts stay green;
 * run with `OFA_LIVE_TESTS=1 STOCKFIT_API_KEY_TEST=<key> pnpm vitest run src/lib/providers/stockfit`.
 * A free key is enough.
 */
const apiKey = process.env.STOCKFIT_API_KEY_TEST;
const live = process.env.OFA_LIVE_TESTS && apiKey ? describe : describe.skip;
const config = { ...stockfitModule.defaultConfig, enabled: true, apiKey, cacheTtlSeconds: 0 };
const args = { symbol: "MSFT", period: "annual" };

afterAll(async () => {
  await disconnect("stockfit");
});

async function income(asOf?: string) {
  const tools = await stockfitModule.createTools(config, offlineContext({ asOf }));
  const tool = tools.find((candidate) => candidate.label === "financials_income_statement");
  if (!tool) throw new Error("financials_income_statement was not built");
  const result = await tool.execute("live-1", args);
  const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return { text, details: result.details as StructuredDetails };
}

live("StockFit against the real server", () => {
  it("validates the key and names its plan", async () => {
    expect(await stockfitModule.validate?.(config)).toMatchObject({ ok: true, message: expect.stringMatching(/plan: \d+ of \d+ tools/) });
  }, 60_000);

  it("returns statement facts that name the filing behind each value", async () => {
    const { details } = await income();
    const revenue = details.facts?.find((fact) => fact.metric === "revenue");
    expect(revenue?.ref).toMatch(/^\d{10}-\d{2}-\d{6}$/);
    expect(revenue?.unit).toBe("USD");
  }, 60_000);

  it("keeps only what was filed by the cutoff on a historical turn", async () => {
    const rows = JSON.parse((await income()).text.split("\n\n")[0]) as { period: string; dateFiled: string }[];
    const oldest = rows.at(-1);
    if (!oldest) throw new Error("StockFit returned no periods");

    // The request reaches back past the cutoff, so earlier periods may come too, but none later.
    const { details } = await income(oldest.dateFiled);
    expect(details.periods?.[0]).toBe(oldest.period);
    expect(details.periods?.every((period) => period <= oldest.period)).toBe(true);
    expect(details.asOf).toBe(oldest.dateFiled);
  }, 60_000);
});
