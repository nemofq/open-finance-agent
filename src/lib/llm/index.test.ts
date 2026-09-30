import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelsError } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { providerDefinition } from "@/lib/llm/providers";
import { authPath } from "@/lib/paths";
import { isConnected, listProviderModels, resolveModel } from "./index";
import { getModels } from "./models";
import { streamModel } from "./stream";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-llm-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const openrouter = (apiKey = "sk-or"): LlmProviderConfig => ({
  id: "openrouter",
  type: "openrouter",
  name: "OpenRouter",
  apiKey,
});

const endpoint: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "",
  baseUrl: "https://llm.example.com/v1/",
  models: [{ id: "qwen-27b", contextWindow: 32768, reasoning: true }],
};

function configWith(providers: LlmProviderConfig[]): AppConfig {
  const config = defaultConfig();
  config.llm.providers = providers;
  return config;
}

const catalog = {
  data: [
    {
      id: "acme/fast",
      name: "Acme Fast",
      context_length: 128000,
      pricing: { prompt: "0.000001", completion: "0.000002" },
      supported_parameters: ["tools", "reasoning"],
    },
  ],
};

/** A provider the user signs in to, and the credential a finished login leaves in `auth.json`. */
const claude: LlmProviderConfig = { id: "anthropic", type: "anthropic", name: "Claude (Pro/Max)", apiKey: "", auth: "oauth" };

function signIn(providerId = claude.id): void {
  const credential = { type: "oauth", access: "at", refresh: "rt", expires: Date.now() + 3_600_000 };
  writeFileSync(authPath(), JSON.stringify({ version: 1, credentials: { [providerId]: credential } }));
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("resolveModel", () => {
  it("is not configured without a model reference", async () => {
    const result = await resolveModel(configWith([endpoint]), null);
    expect(result).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("reports a provider that is no longer saved", async () => {
    const result = await resolveModel(configWith([endpoint]), { provider: "gone", model: "x" });
    expect(result).toMatchObject({ ok: false, reason: "provider_missing" });
    expect(!result.ok && result.message).toContain("gone");
    expect(!result.ok && result.message).toContain("Pick another model in Settings › LLM.");
  });

  it("reports a model the provider does not list", async () => {
    const result = await resolveModel(configWith([endpoint]), { provider: endpoint.id, model: "llama" });
    expect(result).toMatchObject({ ok: false, reason: "model_missing" });
    expect(!result.ok && result.message).toContain("Lab");
    expect(!result.ok && result.message).toContain("llama");
  });

  it("sends a chat fixed to a model that is gone to a new chat, not to Settings", async () => {
    const config = configWith([endpoint]);
    for (const ref of [{ provider: "gone", model: "x" }, { provider: endpoint.id, model: "llama" }]) {
      const result = await resolveModel(config, ref, { heldBy: "chat" });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain("start a new chat");
      expect(!result.ok && result.message).not.toContain("Settings");
    }
  });

  it("sends a scheduled task on a model that is gone to editing the task", async () => {
    const config = configWith([endpoint]);
    for (const ref of [{ provider: "gone", model: "x" }, { provider: endpoint.id, model: "llama" }]) {
      const result = await resolveModel(config, ref, { heldBy: "task" });
      expect(!result.ok && result.message).toContain("Edit the task to pick another model.");
      expect(!result.ok && result.message).not.toContain("Settings");
    }
  });

  it("refuses a model pi removed, retired or renamed, and never stands its successor in", async () => {
    signIn("openai-codex");
    const fetchMock = stubFetch(() => Response.json({}));
    const codex: LlmProviderConfig = { id: "openai-codex", type: "openai-codex", name: "ChatGPT", apiKey: "", auth: "oauth" };
    const deepseek: LlmProviderConfig = { id: "deepseek", type: "deepseek", name: "DeepSeek", apiKey: "sk-ds" };
    const config = configWith([codex, deepseek]);

    const retired = await resolveModel(config, { provider: "openai-codex", model: "gpt-5.4" });
    expect(retired).toEqual({
      ok: false,
      reason: "model_missing",
      message: "ChatGPT does not offer gpt-5.4 any more. Pick another model in Settings › LLM.",
    });
    // A started chat stays on the model it began with, even one that has a successor.
    const renamed = await resolveModel(config, { provider: "deepseek", model: "deepseek-v4-flash" }, { heldBy: "chat" });
    expect(renamed).toEqual({
      ok: false,
      reason: "model_missing",
      message: "DeepSeek does not offer deepseek-v4-flash any more. A chat keeps the model it started with; start a new chat to use another model.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports models that cannot be loaded", async () => {
    stubFetch(() => new Response("down", { status: 502, statusText: "Bad Gateway" }));
    const result = await resolveModel(configWith([openrouter()]), { provider: "openrouter", model: "acme/fast" });
    expect(result).toMatchObject({ ok: false, reason: "models_unavailable" });
    expect(!result.ok && result.message).toContain("502");
  });

  it("treats a keyed provider without a key as unavailable, without a request", async () => {
    const fetchMock = stubFetch(() => Response.json(catalog));
    const result = await resolveModel(configWith([openrouter("")]), { provider: "openrouter", model: "acme/fast" });
    expect(result).toMatchObject({ ok: false, reason: "models_unavailable" });
    expect(!result.ok && result.message).toContain("Add an API key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds a custom endpoint model offline, without consulting the endpoint", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    const result = await resolveModel(configWith([endpoint]), { provider: endpoint.id, model: "qwen-27b" });
    expect(fetchMock).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.message);
    expect(result.model).toMatchObject({
      id: "qwen-27b",
      api: "openai-completions",
      provider: endpoint.id,
      baseUrl: "https://llm.example.com/v1",
      reasoning: true,
      contextWindow: 32768,
      maxTokens: 16384,
    });
    // No request format is guessed from the model's name; a model declares its thinking in config.
    expect(result.model.compat).toBeUndefined();
    expect(result.model.thinkingLevelMap).toBeUndefined();
  });

  it("asks a provider that is not signed in to be reconnected, without a request", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    const result = await resolveModel(configWith([claude]), { provider: "anthropic", model: "claude-opus-4-5" });

    expect(result).toMatchObject({ ok: false, reason: "reauth_required" });
    expect(!result.ok && result.message).toContain("Claude (Pro/Max)");
    expect(!result.ok && result.message).toContain("Reconnect it in Settings › LLM.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a model of a signed-in provider offline, from pi's own catalog", async () => {
    signIn();
    const fetchMock = stubFetch(() => Response.json({}));
    const [first] = await providerDefinition(claude).listModels(claude, getModels(configWith([claude])));
    const result = await resolveModel(configWith([claude]), { provider: "anthropic", model: first.id });

    if (!result.ok) throw new Error(result.message);
    expect(result.model).toMatchObject({ provider: "anthropic", api: "anthropic-messages" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a sign-in pi could not refresh as one to renew, not as a broken provider", async () => {
    signIn();
    vi.spyOn(providerDefinition(claude), "listModels").mockRejectedValue(
      new ModelsError("oauth", "OAuth refresh failed for anthropic"),
    );
    const result = await resolveModel(configWith([claude]), { provider: "anthropic", model: "claude-opus-4-5" });

    expect(result).toMatchObject({ ok: false, reason: "reauth_required" });
    expect(!result.ok && result.message).toContain("Reconnect it");
    // The pi wording never reaches the user; the banner and the card share this one sentence.
    expect(!result.ok && result.message).not.toContain("OAuth refresh failed");
  });

  it("builds an OpenRouter model from its catalog", async () => {
    stubFetch(() => Response.json(catalog));
    const result = await resolveModel(configWith([openrouter()]), { provider: "openrouter", model: "acme/fast" });
    if (!result.ok) throw new Error(result.message);
    expect(result.info.pricing).toEqual({ input: 1, output: 2 });
    expect(result.model).toMatchObject({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      thinkingLevelMap: { off: null },
      compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
    });
  });
});

describe("isConnected", () => {
  it("is what auth.json holds, not what config.json says", async () => {
    expect(await isConnected("anthropic")).toBe(false);
    signIn();
    expect(await isConnected("anthropic")).toBe(true);
    expect(await isConnected("openai-codex")).toBe(false);
  });
});

describe("listProviderModels", () => {
  it("keeps the catalog of a provider that is not signed in, marked with the gap", async () => {
    stubFetch(() => Response.json({}));
    const result = await listProviderModels(configWith([claude, endpoint]));
    // The models come from pi's static list, so a chat set to one of them can still name it and be
    // told to reconnect, rather than being told its model has gone.
    expect(result[0]).toMatchObject({
      provider: "anthropic",
      error: expect.stringContaining("Reconnect it"),
      authGap: "reauth_required",
    });
    expect(result[0].models.length).toBeGreaterThan(0);
    expect(result[1].models.map((model) => model.id)).toEqual(["qwen-27b"]);
  });

  it("lists nothing for a provider still waiting on a key, whose catalog needs that key", async () => {
    stubFetch(() => Response.json({}));
    const [entry] = await listProviderModels(configWith([openrouter("")]));
    expect(entry).toMatchObject({ models: [], error: "Add an API key", authGap: "missing_key" });
  });


  it("lists every provider in order and captures each failure", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const second = { ...endpoint, id: "second-c3d4", name: "Second", models: [] };
    const result = await listProviderModels(configWith([openrouter(""), endpoint, second]));
    expect(result).toEqual([
      {
        provider: "openrouter",
        name: "OpenRouter",
        type: "openrouter",
        models: [],
        error: "Add an API key",
        authGap: "missing_key",
      },
      {
        provider: endpoint.id,
        name: "Lab",
        type: "openai-compatible",
        models: [expect.objectContaining({ id: "qwen-27b", supportsReasoning: true })],
      },
      { provider: "second-c3d4", name: "Second", type: "openai-compatible", models: [] },
    ]);

    const [failing] = await listProviderModels(configWith([openrouter()]));
    expect(failing).toMatchObject({ provider: "openrouter", models: [], error: "fetch failed" });
  });

  it("gives up on an OpenRouter catalog that does not answer, as that provider's error", async () => {
    const fetchMock = stubFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const [entry] = await listProviderModels(configWith([openrouter()]));
    expect(fetchMock.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) })]);
    expect(entry).toMatchObject({ models: [], error: expect.stringContaining("did not respond within 15 s") });
  });

  it("serves the OpenRouter catalog from the cache", async () => {
    const fetchMock = stubFetch(() => Response.json(catalog));
    const config = configWith([openrouter()]);
    await listProviderModels(config);
    await listProviderModels(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamModel", () => {
  it("fails the stream for a model API the provider has no implementation for", async () => {
    const config = configWith([endpoint]);
    const resolved = await resolveModel(config, { provider: endpoint.id, model: "qwen-27b" });
    if (!resolved.ok) throw new Error(resolved.message);
    const reply = await streamModel(config, { ...resolved.model, api: "carrier-pigeon" }, { messages: [] }).result();
    expect(reply.stopReason).toBe("error");
    expect(reply.errorMessage).toContain('no API implementation for "carrier-pigeon"');
  });

  it("refuses to stream a model whose provider is no longer saved", async () => {
    const config = configWith([endpoint]);
    const resolved = await resolveModel(config, { provider: endpoint.id, model: "qwen-27b" });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(() => streamModel(configWith([]), resolved.model, { messages: [] })).toThrow("no longer saved");
  });
});

describe("declared thinking on an endpoint model", () => {
  /** The request body one completion sends at `level` for a model declared as `entry`. */
  async function sentBody(entry: Record<string, unknown>, level?: "low" | "medium" | "high"): Promise<Record<string, unknown>> {
    const fetchMock = stubFetch(
      () =>
        new Response(
          [
            `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\n`,
            "data: [DONE]\n\n",
          ].join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const provider = { ...endpoint, models: [{ id: "m", ...entry }] } as LlmProviderConfig;
    const config = configWith([provider]);
    const resolved = await resolveModel(config, { provider: provider.id, model: "m" });
    if (!resolved.ok) throw new Error(resolved.message);
    await streamModel(config, resolved.model, { messages: [] }, level ? { reasoning: level } : undefined).result();
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    return JSON.parse(String(init.body));
  }

  it("carries the declared level names as pi-ai's level map", async () => {
    const provider = { ...endpoint, models: [{ id: "m", reasoning: true, thinking: { levels: { high: "xhigh", low: "min" }, off: "none" as const } }] };
    const resolved = await resolveModel(configWith([provider]), { provider: provider.id, model: "m" });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.model.thinkingLevelMap).toEqual({ low: "min", high: "xhigh", off: "none" });
  });

  it("sends the server's name for a level", async () => {
    const body = await sentBody({ reasoning: true, thinking: { levels: { high: "xhigh" } } }, "high");
    expect(body.reasoning_effort).toBe("xhigh");
    expect(await sentBody({ reasoning: true, thinking: { levels: { high: "xhigh" } } }, "low")).toMatchObject({ reasoning_effort: "low" });
  });

  it("switches off through the chat template, and levels through reasoning_effort", async () => {
    const off = await sentBody({ reasoning: true, thinking: { off: "chat-template" } });
    expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(off).not.toHaveProperty("reasoning_effort");

    const medium = await sentBody({ reasoning: true, thinking: { off: "chat-template" } }, "medium");
    expect(medium.reasoning_effort).toBe("medium");
    expect(medium).not.toHaveProperty("chat_template_kwargs");
  });

  it("switches off with reasoning_effort none when declared", async () => {
    expect(await sentBody({ reasoning: true, thinking: { off: "none" } })).toMatchObject({ reasoning_effort: "none" });
  });

  it("sends nothing at off by default", async () => {
    const body = await sentBody({ reasoning: true });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });

  it("does not detect a model by its name", async () => {
    const provider = { ...endpoint, name: "Qwen box", models: [{ id: "qwen-anything", reasoning: true }] };
    const fetchMock = stubFetch(() => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    const config = configWith([provider]);
    const resolved = await resolveModel(config, { provider: provider.id, model: "qwen-anything" });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.model).not.toHaveProperty("compat");
    await streamModel(config, resolved.model, { messages: [] }, { reasoning: "high" }).result();
    await streamModel(config, resolved.model, { messages: [] }).result();
    const [high, off] = (fetchMock.mock.calls as unknown[][]).map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(high.reasoning_effort).toBe("high");
    expect(high).not.toHaveProperty("chat_template_kwargs");
    expect(off).not.toHaveProperty("reasoning_effort");
    expect(off).not.toHaveProperty("chat_template_kwargs");
  });

  it("sends no thinking fields for a model not marked for reasoning, whatever it declares", async () => {
    const body = await sentBody({ thinking: { levels: { high: "xhigh" }, off: "none" } }, "high");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(await sentBody({ thinking: { off: "chat-template" } })).not.toHaveProperty("chat_template_kwargs");
  });
});
