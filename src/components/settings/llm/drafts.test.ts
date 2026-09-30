import { describe, expect, it } from "vitest";
import {
  type CustomModelConfig,
  type LlmProviderConfig,
  llmProviderSchema,
  type OpenAICompatibleProviderConfig,
} from "@/lib/config/schema";
import type { LlmModelInfo } from "@/lib/llm/types";
import {
  compareListed,
  currentValidations,
  customModelFromListing,
  draftProviderModels,
  isHttpUrl,
  normalizeBaseUrl,
  type ProviderCheck,
  requestProvider,
  savedProviderModels,
  validationApplies,
} from "./drafts";

const openRouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "" };

function endpoint(models: CustomModelConfig[]): OpenAICompatibleProviderConfig {
  return { id: "local-ab12", type: "openai-compatible", name: "Local", apiKey: "", baseUrl: "http://localhost:8000/v1", models };
}

function info(id: string, contextLength = 0): LlmModelInfo {
  return {
    id,
    name: id,
    contextLength,
    pricing: { input: 0, output: 0 },
    supportsReasoning: false,
    supportsImages: false,
  };
}

describe("draftProviderModels", () => {
  it("prefers OpenRouter's last validation over the saved list", () => {
    const saved = { defaultModel: null, providers: [{ provider: "openrouter", name: "OpenRouter", type: "openrouter" as const, models: [info("a")] }] };
    const [entry] = draftProviderModels([openRouter], saved, { openrouter: { ok: true, models: [info("b")] } });
    expect(entry.models.map((model) => model.id)).toEqual(["b"]);
  });

  it("falls back to the saved list, keeping its error", () => {
    const saved = {
      defaultModel: null,
      providers: [{ provider: "openrouter", name: "OpenRouter", type: "openrouter" as const, models: [], error: "Add an API key" }],
    };
    expect(draftProviderModels([openRouter], saved, {})[0]).toMatchObject({ models: [], error: "Add an API key" });
  });

  it("asks for validation when OpenRouter has no models from anywhere", () => {
    expect(draftProviderModels([openRouter], null, {})[0].error).toMatch(/Validate/);
  });

  it("says OpenRouter's saved models are loading rather than asking for a key", () => {
    const [entry] = draftProviderModels([openRouter], null, {}, { loading: true, error: null });
    expect(entry).toMatchObject({ models: [], error: "Loading models…" });
  });

  it("passes on why the saved models failed to load", () => {
    const [entry] = draftProviderModels([openRouter], null, {}, { loading: false, error: "500 Internal Server Error" });
    expect(entry.error).toBe("Models failed to load: 500 Internal Server Error");
  });

  it("lists an endpoint's draft rows with trimmed ids, skipping blank ones", () => {
    const [entry] = draftProviderModels([endpoint([{ id: " qwen " }, { id: "" }])], null, {});
    expect(entry).toMatchObject({ provider: "local-ab12", name: "Local", type: "openai-compatible" });
    expect(entry.models.map((model) => model.id)).toEqual(["qwen"]);
    expect(entry.error).toBeUndefined();
  });

  it("lists a repeated id once and names a provider whose name was cleared by its type", () => {
    const [entry] = draftProviderModels([{ ...endpoint([{ id: "qwen" }, { id: " qwen" }]), name: " " }], null, {});
    expect(entry.models.map((model) => model.id)).toEqual(["qwen"]);
    expect(entry.name).toBe("OpenAI-compatible endpoint");
  });

  it("explains an endpoint with no models", () => {
    expect(draftProviderModels([endpoint([])], null, {})[0].error).toMatch(/Add a model id/);
  });
});

describe("requestProvider", () => {
  it("turns an endpoint draft the user is still editing into one the config schema accepts", () => {
    const draft = {
      ...endpoint([{ id: "" }, { id: " qwen ", name: "Qwen" }, { id: "qwen", contextWindow: 8192 }, { id: "  " }]),
      name: "",
      baseUrl: "http://localhost:8000/v1/",
    };
    const provider = requestProvider(draft);
    expect(llmProviderSchema.safeParse(provider).success).toBe(true);
    expect(provider).toMatchObject({
      name: "OpenAI-compatible endpoint",
      baseUrl: "http://localhost:8000/v1",
      models: [{ id: "qwen", name: "Qwen" }],
    });
  });

  it("leaves a complete draft as it is", () => {
    const draft = endpoint([{ id: "qwen" }]);
    expect(requestProvider(draft)).toEqual(draft);
    expect(requestProvider({ ...openRouter, name: "" })).toEqual(openRouter);
  });
});

describe("validations", () => {
  const validation = { ok: true, message: "Reachable · 1 models listed", models: [info("qwen")] };

  it("still apply after edits Validate does not look at", () => {
    const validated = endpoint([]);
    expect(validationApplies(validated, { ...endpoint([{ id: "qwen" }]), name: "Renamed", baseUrl: "http://localhost:8000/v1/" })).toBe(true);
  });

  it("stop applying once the key or the base URL changes", () => {
    const validated = endpoint([]);
    expect(validationApplies(validated, { ...validated, baseUrl: "http://10.0.0.9:11434/v1" })).toBe(false);
    expect(validationApplies(validated, { ...validated, apiKey: "sk-new" })).toBe(false);
    expect(validationApplies({ ...openRouter, apiKey: "sk-old" }, openRouter)).toBe(false);
  });

  it("keep only the results that match each provider's current draft", () => {
    const moved = { ...endpoint([]), baseUrl: "http://10.0.0.9:11434/v1" };
    // Hosted provider IDs match their type; unknown providers represent endpoints.
    const checks: Record<string, ProviderCheck> = {
      "local-ab12": { provider: endpoint([]), validation },
      openrouter: { provider: openRouter, validation },
      removed: { provider: { ...endpoint([]), id: "removed" }, validation },
    };
    expect(currentValidations([openRouter, endpoint([])], checks)).toEqual({ openrouter: validation, "local-ab12": validation });
    expect(currentValidations([openRouter, moved], checks)).toEqual({ openrouter: validation });
  });
});

describe("endpoint URLs", () => {
  it("normalizes whitespace and trailing slashes", () => {
    expect(normalizeBaseUrl("  https://api.example.com/v1// ")).toBe("https://api.example.com/v1");
  });

  it("accepts only http(s) URLs", () => {
    expect(isHttpUrl("http://localhost:8000/v1/")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("example.com/v1")).toBe(false);
  });
});

describe("compareListed", () => {
  it("splits configured ids the endpoint misses from listed models to add", () => {
    const result = compareListed([{ id: "a" }, { id: " b " }, { id: "" }], [info("b"), info("c")]);
    expect(result.missing).toEqual(["a"]);
    expect(result.toAdd.map((model) => model.id)).toEqual(["c"]);
  });

  it("keeps a listed context window when importing", () => {
    expect(customModelFromListing(info("c", 32768))).toEqual({ id: "c", contextWindow: 32768 });
    expect(customModelFromListing(info("d"))).toEqual({ id: "d" });
  });
});

describe("savedProviderModels", () => {
  const listed = { provider: "openrouter", name: "OpenRouter", type: "openrouter" as const, models: [info("a")] };
  const idle = { loading: false, error: null };

  it("offers the saved list, not an endpoint's unsaved rows", () => {
    const saved = { defaultModel: null, providers: [listed, { ...listed, provider: "local-ab12", name: "Local", type: "openai-compatible" as const, models: [] }] };
    const entries = savedProviderModels([openRouter, endpoint([{ id: "qwen" }])], saved, idle);
    expect(entries.map((entry) => entry.models.map((model) => model.id))).toEqual([["a"], []]);
  });

  it("leaves out providers no longer saved and shows one saved since the list loaded as loading", () => {
    const saved = { defaultModel: null, providers: [{ ...listed, provider: "removed" }] };
    expect(savedProviderModels([openRouter], saved, { loading: true, error: null })).toEqual([
      { provider: "openrouter", name: "OpenRouter", type: "openrouter", models: [], error: "Loading models…" },
    ]);
  });

  it("passes on why the list failed to load", () => {
    expect(savedProviderModels([openRouter], null, { loading: false, error: "boom" })[0].error).toBe("Models failed to load: boom");
  });
});
