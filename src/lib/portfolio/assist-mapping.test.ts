import type { Context } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";

/** The prompt the model was sent, and the text it answers with. */
const prompts: string[] = [];
let answer = "";

vi.mock("@/lib/llm/stream", () => ({
  streamModel: (_config: unknown, _model: unknown, context: Context) => {
    const [message] = context.messages;
    prompts.push(message && typeof message.content === "string" ? message.content : "");
    return { result: async () => ({ content: [{ type: "text", text: answer }] }) };
  },
}));

const { extractJson, keepSentHeaders, assistMapping } = await import("./assist-mapping");

/** One hand-listed model as the default, so resolving it needs no network. */
function configured(): AppConfig {
  const config = defaultConfig();
  config.llm.providers = [
    { id: "lab", type: "openai-compatible", name: "Lab", apiKey: "", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "qwen3" }] },
  ];
  config.llm.defaultModel = { provider: "lab", model: "qwen3" };
  return config;
}

const input = { headers: ["Ticker", "Shares", "Value"], samples: [["NVDA", "10", "1,800"]] };

beforeEach(() => {
  prompts.length = 0;
  answer = "";
});

describe("extractJson", () => {
  it("finds the object inside prose or a fence", () => {
    expect(extractJson('Here you go:\n```json\n{"symbol": "Ticker"}\n```')).toEqual({ symbol: "Ticker" });
  });

  it("refuses a reply with no object in it", () => {
    expect(() => extractJson("I cannot tell.")).toThrow("did not return JSON");
    expect(() => extractJson("{null}")).toThrow();
  });
});

describe("keepSentHeaders", () => {
  it("keeps only known fields mapped to a header the request sent", () => {
    expect(keepSentHeaders({ symbol: "Ticker", quantity: "Qty", price: null, account: "Shares" }, input.headers)).toEqual({ symbol: "Ticker" });
  });
});

describe("assistMapping", () => {
  it("asks the default model with the headers and samples, and returns what survives", async () => {
    answer = '{"symbol": "Ticker", "quantity": "Shares", "marketValue": "Value", "costBasis": "Invented"}';
    const result = await assistMapping(input, configured());
    expect(result).toEqual({ ok: true, mapping: { symbol: "Ticker", quantity: "Shares", marketValue: "Value" } });
    expect(prompts[0]).toContain('Headers: ["Ticker","Shares","Value"]');
    expect(prompts[0]).toContain('Sample rows: [["NVDA","10","1,800"]]');
  });

  it("refuses without a model call when no default model is set", async () => {
    const config = configured();
    config.llm.defaultModel = null;
    expect(await assistMapping(input, config)).toEqual({ ok: false, message: "Configure a default LLM before using mapping assistance." });
    expect(prompts).toEqual([]);
  });
});
