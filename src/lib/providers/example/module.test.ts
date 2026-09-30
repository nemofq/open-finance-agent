/**
 * The data-connection recipe, walked end to end with the unregistered Acme example: the module
 * meets the contract every built-in module meets, its tool honours `supportsAsOf`, and its result
 * goes through `registerToolResult`, the function `afterToolCall` runs, into indexed evidence.
 * A new provider's own test can start as a copy of this file.
 *
 * `fetch` is replaced by a fake, so nothing touches the network.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { registerToolResult } from "@/lib/evidence/register";
import type { TimeContext } from "@/lib/time/types";
import type { FinanceTool } from "@/lib/tools/contracts";
import { builtinModules } from "@/lib/tools/registry";
import { moduleProblems, offlineConfig, offlineContext, toolProblems } from "@/lib/tools/testing";
import { acmeModule } from "./module";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Acme's answer for NVDA, including a day after the as-of date a historical turn will ask for. */
const closes = [
  { date: "2024-08-26", close: 126.46 },
  { date: "2024-08-27", close: 128.3 },
  { date: "2024-08-28", close: 125.61 },
  { date: "2024-08-29", close: 117.59 },
];

const fixed: TimeContext = {
  mode: "fixed",
  timeZone: "America/New_York",
  localDate: "2024-08-28",
  asOf: "2024-08-28",
  market: { session: "after_hours", lastCompletedSession: "2024-08-28", nextOpen: "2024-08-29T09:30:00-04:00" },
};

let home: string;
let requests: { url: string; authorization: string | null; signal: AbortSignal | null | undefined }[];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-acme-"));
  requests = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), authorization: headers.get("Authorization"), signal: init?.signal });
    if (headers.get("Authorization") !== "Bearer good-key") return new Response("unauthorized", { status: 401 });
    return Response.json(closes);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

async function acmeTool(apiKey: string, asOf?: string): Promise<FinanceTool> {
  const [tool] = await acmeModule.createTools({ ...acmeModule.defaultConfig, enabled: true, apiKey }, offlineContext({ asOf }));
  if (!tool) throw new Error("acme_prices was not built");
  return tool;
}

describe("the Acme example provider", () => {
  it("meets the module contract", async () => {
    expect(moduleProblems(acmeModule)).toEqual([]);
    const tools = await acmeModule.createTools(offlineConfig(acmeModule), offlineContext());
    expect(tools.map((tool) => tool.name)).toEqual(["acme_prices"]);
    expect(toolProblems(tools)).toEqual([]);
  });

  it("contributes no tool until it has a key", async () => {
    expect(await acmeModule.createTools(acmeModule.defaultConfig, offlineContext())).toEqual([]);
  });

  it("is an example, not a built-in", () => {
    expect(builtinModules.map((module) => module.id)).not.toContain(acmeModule.id);
  });

  it("drops rows dated after the as-of date and passes the abort signal", async () => {
    const tool = await acmeTool("good-key", "2024-08-28");
    const signal = new AbortController().signal;
    const result = await tool.execute("call-1", { ticker: "$nvda" }, signal);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.acme.test/v1/prices?symbol=NVDA&before=2024-08-28");
    expect(requests[0]?.signal).toBe(signal);
    const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    expect(text).toContain("2024-08-28 | 125.61");
    expect(text).not.toContain("2024-08-29");
    expect(result.details).toMatchObject({ asOf: "2024-08-28", entity: { ticker: "NVDA" } });
  });

  it("names the fix when the key is rejected", async () => {
    const tool = await acmeTool("bad-key");
    await expect(tool.execute("call-1", { ticker: "NVDA" })).rejects.toThrow(/rejected the API key.*Settings/);
    expect(await acmeModule.validate?.({ apiKey: "bad-key" })).toMatchObject({ ok: false });
    expect(await acmeModule.validate?.({ apiKey: "good-key" })).toMatchObject({ ok: true });
  });

  it("registers its result as indexed evidence", async () => {
    const tool = await acmeTool("good-key", fixed.asOf);
    const args = { ticker: "NVDA" };
    const result = await tool.execute("call-1", args);
    const ledger = createLedger({ sessionId: "chat-1", dataDir: home });

    const { entry, content } = await registerToolResult({ ledger, tool, toolCallId: "call-1", args, result, isError: false, time: fixed });

    expect(entry).toMatchObject({
      id: "E1",
      kind: "E",
      tool: "acme_prices",
      source: { id: "acme", name: "Acme", tier: 2 },
      entity: { ticker: "NVDA" },
      asOf: "2024-08-28",
      unit: "USD",
    });
    expect(entry?.lookAhead).toBeUndefined();
    expect(entry?.facts).toHaveLength(3);
    expect(ledger.findFacts({ entity: { ticker: "NVDA" }, metric: "close", period: "2024-08-27" }).map(({ fact }) => fact))
      .toEqual([expect.objectContaining({ metric: "close", period: "2024-08-27", value: 128.3, unit: "USD" })]);
    // The model reads the result under its evidence tag, with the calculator frame it can load.
    const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
    expect(text).toMatch(/^\[E1/);
    expect(text).toContain("Calculator frame E1");
  });
});

describe("docs/extending.md", () => {
  it("quotes the example verbatim", () => {
    const doc = readFileSync(path.join(here, "../../../../docs/extending.md"), "utf8");
    const source = readFileSync(path.join(here, "module.ts"), "utf8");
    const section = doc.slice(doc.indexOf("## Data connection or tool module"), doc.indexOf("## Tool on an existing capability"));
    const blocks = [...section.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(source, "update the excerpt in docs/extending.md").toContain(block);
  });
});
