import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { defaultConfig, type OpenRouterProviderConfig, type ThinkingLevel } from "@/lib/config/schema";
import { streamModel } from "@/lib/llm/stream";
import type { LlmModelInfo } from "@/lib/llm/types";
import { cacheDir, ensureDataDirs } from "@/lib/paths";
import { openrouter } from "./openrouter";

/** The catalog is a plain HTTP call, so these two only need the shape of the runtime. */
const piModels = createModels();

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-openrouter-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const provider = (apiKey = "sk-or"): OpenRouterProviderConfig => ({
  id: "openrouter",
  type: "openrouter",
  name: "OpenRouter",
  apiKey,
});

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  context_length: 128000,
  pricing: { prompt: "0.000001", completion: "0.000002" },
  supported_parameters: ["tools"],
  ...extra,
});

function stubFetch(models: unknown[]) {
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input).includes("/models")
      ? Response.json({ data: models })
      : Response.json({ data: { label: "dev", usage: 0, limit: null } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Write a cache entry the way `cached` would, to prove which key the catalog is read from. */
function seedCache(key: string, value: unknown) {
  ensureDataDirs();
  const file = path.join(cacheDir(), `${createHash("sha1").update(key).digest("hex")}.json`);
  writeFileSync(file, JSON.stringify({ expiresAt: Date.now() + 60_000, value }));
}

describe("openrouter catalog", () => {
  it("reads image input from the architecture block, and treats a missing one as text-only", async () => {
    stubFetch([
      model("acme/vision", { architecture: { input_modalities: ["text", "image", "file"] } }),
      model("acme/text", { architecture: { input_modalities: ["text"] } }),
      model("acme/unknown"),
      model("acme/empty", { architecture: {} }),
    ]);
    const models = await openrouter.listModels(provider(), piModels);

    expect(models.map((info) => [info.id, info.supportsImages])).toEqual([
      ["acme/empty", false],
      ["acme/text", false],
      ["acme/unknown", false],
      ["acme/vision", true],
    ]);
  });

  it("offers a reasoning model pi's levels short of Off, which OpenRouter models are not sent", async () => {
    stubFetch([model("acme/reasoner", { supported_parameters: ["tools", "reasoning"] }), model("acme/plain")]);
    const [plain, reasoner] = await openrouter.listModels(provider(), piModels);
    expect(reasoner.thinkingLevels).toEqual(["minimal", "low", "medium", "high"]);
    expect(plain.thinkingLevels).toEqual(["off"]);
  });

  it("reads which reasoning models can turn thinking off, and the efforts each takes", async () => {
    stubFetch([
      model("acme/optional", { supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: false, default_enabled: true, supported_efforts: ["xhigh", "medium", "low"], default_effort: "xhigh" } }),
      model("acme/mandatory", { supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: true } }),
      model("acme/unstated", { supported_parameters: ["tools", "reasoning"] }),
    ]);
    const levels = Object.fromEntries((await openrouter.listModels(provider(), piModels)).map((info) => [info.id, info.thinkingLevels]));
    expect(levels).toEqual({
      "acme/optional": ["off", "low", "medium", "xhigh"],
      "acme/mandatory": ["minimal", "low", "medium", "high"],
      "acme/unstated": ["minimal", "low", "medium", "high"],
    });
  });

  it("ignores a catalog cached before reasoning control was recorded", async () => {
    const fetchMock = stubFetch([model("acme/optional", { supported_parameters: ["tools", "reasoning"], reasoning: { mandatory: false } })]);
    seedCache("llm-models:openrouter:v2", [
      { id: "acme/optional", name: "acme/optional", contextLength: 0, pricing: { input: 0, output: 0 }, supportsReasoning: true, supportsImages: false },
    ]);

    const [info] = await openrouter.listModels(provider(), piModels);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info.thinkingLevels).toContain("off");
  });

  it("ignores a catalog cached before image support was recorded", async () => {
    const fetchMock = stubFetch([model("acme/vision", { architecture: { input_modalities: ["text", "image"] } })]);
    seedCache("llm-models:openrouter", [
      {
        id: "acme/vision",
        name: "acme/vision",
        contextLength: 0,
        pricing: { input: 0, output: 0 },
        supportsReasoning: false,
      },
    ]);

    const [info] = await openrouter.listModels(provider(), piModels);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info).toMatchObject({ contextLength: 128000, supportsImages: true });
  });

  it("returns the fresh catalog from validate", async () => {
    stubFetch([model("acme/vision", { architecture: { input_modalities: ["text", "image"] } })]);
    const result = await openrouter.validate(provider(), piModels);
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([expect.objectContaining({ id: "acme/vision", supportsImages: true })]);
  });
});

describe("openrouter toPiModel", () => {
  it("offers image input to pi-ai only for a model that accepts it", () => {
    const base = {
      id: "acme/fast",
      name: "Acme Fast",
      contextLength: 128000,
      pricing: { input: 1, output: 2 },
      supportsReasoning: false,
    };
    expect(openrouter.toPiModel(provider(), { ...base, supportsImages: true }).input).toEqual(["text", "image"]);
    expect(openrouter.toPiModel(provider(), { ...base, supportsImages: false }).input).toEqual(["text"]);
  });
});

describe("openrouter agent requests", () => {
  const reply = () => new Response([
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "acme/fast", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""), { headers: { "content-type": "text/event-stream" } });

  /** The headers of the one request a completion sent, through the same seam as an agent turn. */
  async function sentHeaders(sessionId?: string): Promise<Headers> {
    const fetchMock = vi.fn<typeof fetch>(async () => reply());
    vi.stubGlobal("fetch", fetchMock);
    const config = defaultConfig();
    config.llm.providers = [provider()];
    const model = openrouter.toPiModel(provider(), { id: "acme/fast", name: "Acme Fast", contextLength: 128000, pricing: { input: 1, output: 2 }, supportsReasoning: false, supportsImages: false });
    const stream = streamModel(config, model, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] }, sessionId ? { sessionId } : {});
    for await (const event of stream) if (event.type === "error") throw new Error(event.error.errorMessage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    return new Headers(input instanceof Request ? input.headers : init?.headers);
  }

  /** The `reasoning` field of the one request a turn at `level` sent; Off reaches pi as no level, as in a turn. */
  async function sentReasoning(control: Partial<LlmModelInfo>, level?: Exclude<ThinkingLevel, "off">): Promise<unknown> {
    const fetchMock = vi.fn<typeof fetch>(async () => reply());
    vi.stubGlobal("fetch", fetchMock);
    const config = defaultConfig();
    config.llm.providers = [provider()];
    const model = openrouter.toPiModel(provider(), { id: "acme/fast", name: "Acme Fast", contextLength: 128000, pricing: { input: 1, output: 2 }, supportsReasoning: true, supportsImages: false, ...control });
    const stream = streamModel(config, model, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] }, level ? { reasoning: level } : {});
    for await (const event of stream) if (event.type === "error") throw new Error(event.error.errorMessage);
    const [input, init] = fetchMock.mock.calls[0];
    const body = input instanceof Request ? await input.text() : String(init?.body);
    return (JSON.parse(body) as { reasoning?: unknown }).reasoning;
  }

  it("turns thinking off with effort none where the catalog says it is optional", async () => {
    expect(await sentReasoning({ reasoningControl: { mandatory: false } })).toEqual({ effort: "none" });
  });

  it("sends no reasoning at Off where thinking is mandatory or the catalog does not say", async () => {
    expect(await sentReasoning({ reasoningControl: { mandatory: true } })).toBeUndefined();
    expect(await sentReasoning({})).toBeUndefined();
  });

  it("sends a level the model does not list as the nearest effort it does", async () => {
    expect(await sentReasoning({ reasoningControl: { mandatory: false, efforts: ["xhigh", "medium", "low"] } }, "high")).toEqual({ effort: "xhigh" });
  });

  // pi turns session affinity on for OpenRouter, so a chat keeps to one backend and its prompt cache.
  it("carries the chat's id as x-session-id", async () => {
    expect((await sentHeaders("0b7c9a52-chat")).get("x-session-id")).toBe("0b7c9a52-chat");
  });

  it("carries no session header for a call without a chat", async () => {
    const headers = await sentHeaders();
    expect(headers.get("x-session-id")).toBeNull();
    expect(headers.get("x-session-affinity")).toBeNull();
  });
});
