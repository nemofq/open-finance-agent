import { afterEach, describe, expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import type { OpenAICompatibleProviderConfig } from "@/lib/config/schema";
import { draftModels } from "@/lib/llm/models";
import { openAICompatible } from "./openai-compatible";

/** Both calls read the config alone, so they only need the shape of the runtime. */
const piModels = createModels();

/** The key the pi provider resolves for a request, which is what `streamModel` ends up sending. */
async function resolvedKey(config: OpenAICompatibleProviderConfig): Promise<string | undefined> {
  return (await draftModels(config).getAuth(config.id))?.auth.apiKey;
}

const provider = (apiKey = "sk-lab"): OpenAICompatibleProviderConfig => ({
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey,
  baseUrl: " https://llm.example.com/v1/ ",
  models: [],
});

function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai-compatible validate", () => {
  it("lists the endpoint's models on 200", async () => {
    const fetchMock = stubFetch(() =>
      Response.json({
        object: "list",
        data: [
          { id: "qwen-27b", object: "model", max_model_len: 32768 },
          { id: "kimi", context_length: 128000 },
          { id: "bare", context_window: "big" },
        ],
      }),
    );
    const result = await openAICompatible.validate(provider(), piModels);

    expect(result).toMatchObject({ ok: true, message: "Reachable · 3 models listed" });
    expect(result.models).toEqual([
      // A `/models` listing says nothing about vision, so every listed model comes back text-only.
      expect.objectContaining({
        id: "qwen-27b",
        name: "qwen-27b",
        contextLength: 32768,
        supportsImages: false,
      }),
      expect.objectContaining({ id: "kimi", contextLength: 128000, supportsReasoning: false }),
      expect.objectContaining({ id: "bare", contextLength: 0, supportsImages: false }),
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.example.com/v1/models");
    expect(init?.headers).toEqual({ Authorization: "Bearer sk-lab" });
  });

  it("sends no Authorization header without a key", async () => {
    const fetchMock = stubFetch(() => Response.json({ data: [] }));
    expect(await openAICompatible.validate(provider(""), piModels)).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({});
  });

  it("explains a rejected key", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    expect(await openAICompatible.validate(provider(), piModels)).toEqual({
      ok: false,
      error: "The endpoint rejected the key (401)",
    });
  });

  it("asks for a key when the endpoint refuses a request sent without one", async () => {
    stubFetch(() => new Response("nope", { status: 403 }));
    expect(await openAICompatible.validate(provider(""), piModels)).toEqual({
      ok: false,
      error: "The endpoint requires an API key (403)",
    });
  });

  it("points at the base URL on 404", async () => {
    stubFetch(() => new Response("missing", { status: 404 }));
    const result = await openAICompatible.validate(provider(), piModels);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No model list at https://llm.example.com/v1/models (404)");
    expect(result.error).toContain("/v1");
  });

  it("names the other statuses", async () => {
    stubFetch(() => new Response("oops", { status: 500, statusText: "Internal Server Error" }));
    const result = await openAICompatible.validate(provider(), piModels);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("500");
  });

  it("surfaces the cause of a network error", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8000") });
    });
    const result = await openAICompatible.validate(provider(), piModels);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("accepts a bare array of models and skips entries without an id", async () => {
    stubFetch(() => Response.json([{ id: "meta-llama/Llama-3.3-70B", context_length: 131072 }, { name: "no id" }, "junk"]));
    const result = await openAICompatible.validate(provider(), piModels);
    expect(result).toMatchObject({ ok: true, message: "Reachable · 1 models listed" });
    expect(result.models).toEqual([expect.objectContaining({ id: "meta-llama/Llama-3.3-70B", contextLength: 131072 })]);
  });

  it("names the timeout it gave the endpoint", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect((await openAICompatible.validate(provider(), piModels)).error).toBe(
      "No response from https://llm.example.com/v1/models within 15 s",
    );
  });

  it("rejects a body that is not a model list", async () => {
    stubFetch(() => Response.json({ models: ["a"] }));
    const result = await openAICompatible.validate(provider(), piModels);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("model list");
  });
});

describe("openai-compatible models", () => {
  it("lists the configured models without a request and keys a keyless endpoint with a placeholder", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    const config = { ...provider(""), models: [{ id: "qwen-27b", name: "Qwen", maxTokens: 4096 }] };
    const [info] = await openAICompatible.listModels(config, piModels);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAICompatible.toPiModel(config, info)).toMatchObject({ name: "Qwen", maxTokens: 4096 });
    expect(await resolvedKey(config)).toBe("not-needed");
    expect(await resolvedKey(provider())).toBe("sk-lab");
  });

  it("offers the thinking levels the model's declared mapping gives it in pi-ai", async () => {
    const config = {
      ...provider(),
      models: [
        { id: "plain" },
        { id: "reasoner", reasoning: true },
        { id: "deep", reasoning: true, thinking: { levels: { xhigh: "very-high" }, off: "none" as const } },
      ],
    };
    const [plain, reasoner, deep] = await openAICompatible.listModels(config, piModels);
    expect(plain.thinkingLevels).toEqual(["off"]);
    expect(reasoner.thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
    expect(deep.thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
    expect(openAICompatible.toPiModel(config, deep).thinkingLevelMap).toEqual({ xhigh: "very-high", off: "none" });
  });

  it("offers image input to pi-ai only for a model the user marked as accepting it", async () => {
    const config = { ...provider(), models: [{ id: "qwen-vl", images: true }, { id: "qwen-27b" }] };
    const [vision, text] = await openAICompatible.listModels(config, piModels);
    expect(openAICompatible.toPiModel(config, vision).input).toEqual(["text", "image"]);
    expect(openAICompatible.toPiModel(config, text).input).toEqual(["text"]);
  });
});
