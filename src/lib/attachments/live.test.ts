import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTurn } from "@/lib/agent/turn";
import { type AppConfig, defaultConfig, type LlmProviderConfig, type ModelRef } from "@/lib/config/schema";
import { withModulesOff } from "@/lib/tools/testing";
import { writeConfig } from "@/lib/config/store";
import { isSandboxAvailable } from "@/lib/sandbox";
import { createSession, updateSession } from "@/lib/sessions/store";
import { resolveTimeContext } from "@/lib/time";
import { attachDocument, docxOf } from "./testing";

/**
 * The model path against a real model: a long docx is
 * digested rather than inlined and read back by query, and a spreadsheet is computed through the
 * calculator with a `U` → `C` chain.
 *
 * Off by default; run with `OFA_LIVE_TESTS=1` and a 32k endpoint in `CUSTOM_LLM_URL`,
 * `CUSTOM_LLM_API_KEY` and `CUSTOM_LLM_AVAILABLE` (comma-separated ids; the first is used).
 */
const customUrl = process.env.CUSTOM_LLM_URL;
const customModel = process.env.CUSTOM_LLM_AVAILABLE?.split(",")[0]?.trim();
const live = process.env.OFA_LIVE_TESTS && customUrl && customModel ? describe : describe.skip;

let home: string;
let restoreFetch: typeof globalThis.fetch | undefined;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-attachments-live-"));
  process.env.OFA_HOME = home;
  // The endpoint sits behind Cloudflare, which refuses a request that names no client at all.
  restoreFetch = globalThis.fetch;
  const inner = restoreFetch;
  globalThis.fetch = ((input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("user-agent")) headers.set("user-agent", "open-finance-agent/live-test");
    return inner(input, { ...init, headers });
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  delete process.env.OFA_HOME;
  if (restoreFetch) globalThis.fetch = restoreFetch;
});

/** The endpoint's model, with the window it really has: the budget is derived from it. */
function saveConfig(): { config: AppConfig; model: ModelRef } {
  const provider: LlmProviderConfig = {
    id: "custom",
    type: "openai-compatible",
    name: "Custom",
    apiKey: process.env.CUSTOM_LLM_API_KEY ?? "",
    baseUrl: customUrl!,
    models: [{ id: customModel!, contextWindow: 32_768 }],
  };
  const config = defaultConfig();
  config.llm = { ...config.llm, providers: [provider], defaultModel: { provider: "custom", model: customModel! } };
  withModulesOff(config, ["attachments", "python", "evidence"]);
  writeConfig(config);
  return { config, model: { provider: "custom", model: customModel! } };
}

const toolCalls = (messages: AgentMessage[]): string[] =>
  messages.flatMap((message) =>
    message.role === "assistant" ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : [])) : [],
  );

/** A memo long enough that a 32k model's fifth of a window cannot hold it. */
async function longDocx(): Promise<Uint8Array> {
  const filler = "The segment performed in line with the plan for the period under review. ".repeat(60);
  return docxOf([
    { heading: "Overview", paragraphs: [filler, filler] },
    { heading: "Gaming", paragraphs: [filler, filler] },
    { heading: "Data center", paragraphs: ["Data center revenue reached $30,040 million in the third quarter.", filler] },
    { heading: "Outlook", paragraphs: [filler, filler] },
  ]);
}

live("the model path on a 32k endpoint model", () => {
  it("digests a long docx and reads it back by query", async () => {
    const { config, model } = saveConfig();
    const session = await createSession({ model });
    const memo = await attachDocument(session.id, "annual review.docx", await longDocx());
    expect(memo.tokens).toBeGreaterThan(6_553);

    const result = await runTurn({
      config,
      session,
      text: "The attached file was too long to include in full. Use read_attachment with a query to find what the Data center section says, then tell me the revenue figure it states.",
      documents: [memo],
      time: resolveTimeContext(),
      store: { update: updateSession },
      titles: false,
    });

    expect(result.error).toBeUndefined();
    expect(toolCalls(result.messages)).toContain("read_attachment");
    expect(result.finalText).toMatch(/30[,.]?040|30\.0/);
  }, 300_000);

  it("computes a csv through the calculator, from the U entry to a C entry", async () => {
    expect(isSandboxAvailable(), "the calculator sandbox is not ready on this machine").toBe(true);
    const { config, model } = saveConfig();
    const session = await createSession({ model });
    const csv = ["ticker,shares,price", "NVDA,400,180.00", "MSFT,120,410.00", "AAPL,50,220.00"].join("\n");
    const book = await attachDocument(session.id, "holdings.csv", csv);

    const result = await runTurn({
      config,
      session,
      text: "The attached spreadsheet is loaded as evidence. Use financial_calculator with that evidence id to compute the total market value of the holdings (shares × price, summed) and emit it. Then state the total with its tag.",
      documents: [book],
      time: resolveTimeContext(),
      store: { update: updateSession },
      titles: false,
    });

    expect(result.error).toBeUndefined();
    expect(toolCalls(result.messages)).toContain("financial_calculator");
    const computed = result.evidence.filter((entry) => entry.kind === "C");
    expect(computed.length, `no C entry; evidence was ${JSON.stringify(result.evidence.map((e) => e.id))}`).toBeGreaterThan(0);
    // The chain the enforcement layer exists for: a computed figure naming the file it came from.
    expect(computed.some((entry) => entry.inputs?.some((id) => id.startsWith("U")))).toBe(true);
    expect(computed.some((entry) => typeof entry.value === "number" && Math.abs(entry.value - 132_200) < 1)).toBe(true);
  }, 300_000);
});
