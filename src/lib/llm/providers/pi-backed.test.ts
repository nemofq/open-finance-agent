import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { catalogEntries, llmProviderCatalog } from "@/lib/llm/catalog";
import { draftModels } from "@/lib/llm/models";
import { OPENCODE_USER_AGENT } from "@/lib/llm/opencode";
import { streamDraftModel } from "@/lib/llm/stream";
import { authPath } from "@/lib/paths";
import { piAuthKinds, piBackedDefinitions, requestSettings } from "./pi-backed";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-pi-backed-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

/** The anthropic instance in both its shapes: a key pasted into Settings, and a Claude subscription. */
type AnthropicConfig = Extract<LlmProviderConfig, { type: "anthropic" }>;

const keyed = (apiKey = "sk-ant"): AnthropicConfig => ({
  id: "anthropic",
  type: "anthropic",
  name: "Anthropic",
  apiKey,
  auth: "api_key",
});

const signedIn: AnthropicConfig = {
  id: "anthropic",
  type: "anthropic",
  name: "Claude (Pro/Max)",
  apiKey: "",
  auth: "oauth",
};

/** A live-looking OAuth credential for the provider, as a finished login would leave behind. */
function storeCredential(providerId: string, access = "at"): void {
  const credential = { type: "oauth", access, refresh: "rt", expires: Date.now() + 3_600_000 };
  writeFileSync(authPath(), JSON.stringify({ version: 1, credentials: { [providerId]: credential } }));
}

const anthropic = piBackedDefinitions.anthropic;

describe("toPiProvider", () => {
  it("gives a key instance the key from config.json and no other way in", async () => {
    const { auth } = anthropic.toPiProvider(keyed());
    expect(auth.oauth).toBeUndefined();
    // Even handed an environment full of keys, the instance resolves the one that was saved.
    const ctx = { env: async () => "leaked", fileExists: async () => true };
    const resolved = await auth.apiKey?.resolve({ ctx, signal: AbortSignal.timeout(1_000) });
    expect(resolved).toEqual({ auth: { apiKey: "sk-ant" }, source: "config.json" });
  });

  it("leaves a sign-in instance with nothing but the login, so no ambient key can stand in", () => {
    const { auth } = anthropic.toPiProvider(signedIn);
    expect(auth.apiKey).toBeUndefined();
    expect(auth.oauth?.name).toBeTruthy();
  });

  it("keeps pi's own id, which is the id the credential is stored under", () => {
    expect(anthropic.toPiProvider(signedIn).id).toBe("anthropic");
  });
});

describe("toPiProvider with setup fields", () => {
  /** An environment full of values the user never saved, which no instance may pick up. */
  const leaky = { env: async (name: string) => `ambient-${name}`, fileExists: async () => true };
  const resolve = (config: LlmProviderConfig) => {
    const { auth } = piBackedDefinitions[config.type as "amazon-bedrock"].toPiProvider(config as never);
    return auth.apiKey?.resolve({ ctx: leaky, signal: AbortSignal.timeout(1_000) });
  };

  it("lets pi put a Cloudflare gateway token in the gateway's own header, with the saved ids", async () => {
    const resolved = await resolve({
      id: "cloudflare-ai-gateway",
      type: "cloudflare-ai-gateway",
      name: "Cloudflare AI Gateway",
      apiKey: "cf-token",
      settings: { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_GATEWAY_ID: "default" },
    });
    expect(resolved?.auth.headers).toMatchObject({ "cf-aig-authorization": "Bearer cf-token" });
    expect(resolved?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_GATEWAY_ID: "default" });
  });

  it("resolves nothing while a required id is missing, whatever the environment holds", async () => {
    const resolved = await resolve({
      id: "cloudflare-workers-ai",
      type: "cloudflare-workers-ai",
      name: "Cloudflare Workers AI",
      apiKey: "cf-token",
    });
    expect(resolved).toBeUndefined();
  });

  it("hands Bedrock access keys and the region to the request, and never a key left from another method", async () => {
    const resolved = await resolve({
      id: "amazon-bedrock",
      type: "amazon-bedrock",
      name: "Amazon Bedrock",
      apiKey: "stale-bearer-token",
      method: "access-keys",
      settings: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret", AWS_REGION: "eu-west-1" },
    });
    expect(resolved?.auth.apiKey).toBeUndefined();
    expect(resolved?.env).toEqual({
      AWS_BEDROCK_SKIP_AUTH: "0",
      AWS_BEDROCK_FORCE_HTTP1: "0",
      AWS_BEDROCK_FORCE_CACHE: "0",
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "eu-west-1",
    });
  });

  it("pins what pi would otherwise read from the environment, and expands a home path", async () => {
    const azure = await resolve({
      id: "azure-openai-responses",
      type: "azure-openai-responses",
      name: "Azure OpenAI",
      apiKey: "azure-key",
      settings: { AZURE_OPENAI_BASE_URL: "https://mine.openai.azure.com" },
    });
    expect(azure?.env).toMatchObject({ AZURE_OPENAI_DEPLOYMENT_NAME_MAP: ",", AZURE_OPENAI_API_VERSION: "v1" });

    const vertex = (method: string, settings: Record<string, string>) =>
      requestSettings({ id: "google-vertex", type: "google-vertex", name: "Vertex", apiKey: "", method, settings });
    const place = { GOOGLE_CLOUD_PROJECT: "p", GOOGLE_CLOUD_LOCATION: "global" };
    expect(vertex("service-account", { ...place, GOOGLE_APPLICATION_CREDENTIALS: "~/sa.json" })).toMatchObject({
      GOOGLE_APPLICATION_CREDENTIALS: path.join(homedir(), "sa.json"),
    });
    // The gcloud sign-in is pinned to gcloud's own file, so an exported service account cannot stand in.
    expect(vertex("adc", place).GOOGLE_APPLICATION_CREDENTIALS).toBe(
      path.join(homedir(), ".config", "gcloud", "application_default_credentials.json"),
    );
    expect(vertex("api-key", place)).toEqual({});
  });

  it("proves a cloud account's settings without calling a model it may not have enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      id: "amazon-bedrock",
      type: "amazon-bedrock",
      name: "Amazon Bedrock",
      apiKey: "bedrock-key",
      settings: { AWS_REGION: "us-east-1" },
    } as const;
    const result = await piBackedDefinitions["amazon-bedrock"].validate(config, draftModels(config));
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Settings complete") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a missing setting before spending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      id: "azure-openai-responses",
      type: "azure-openai-responses",
      name: "Azure OpenAI",
      apiKey: "azure-key",
    } as const;
    const definition = piBackedDefinitions["azure-openai-responses"];
    expect(await definition.validate(config, draftModels(config))).toEqual({ ok: false, error: "Add the endpoint" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listModels", () => {
  it("maps pi's catalog for an instance that is authenticated", async () => {
    const models = await anthropic.listModels(keyed(), draftModels(keyed()));
    const [first, ...rest] = anthropicProvider().getModels();
    expect(models).toHaveLength(rest.length + 1);
    expect(models[0]).toEqual({
      id: first.id,
      name: first.name,
      contextLength: first.contextWindow,
      pricing: { input: first.cost.input, output: first.cost.output },
      supportsReasoning: first.reasoning,
      thinkingLevels: getSupportedThinkingLevels(first),
      supportsImages: first.input.includes("image"),
      maxTokens: first.maxTokens,
    });
  });

  it("names the thinking levels each model accepts, as pi's catalog declares them", () => {
    const codex: Extract<LlmProviderConfig, { type: "openai-codex" }> = { id: "openai-codex", type: "openai-codex", name: "ChatGPT", apiKey: "", auth: "oauth" };
    const models = piBackedDefinitions["openai-codex"].catalogModels?.(codex) ?? [];
    const levels = (id: string) => models.find((model) => model.id === id)?.thinkingLevels;
    expect(levels("gpt-5.6-luna")).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    // pi marks it `off: null`: it cannot turn thinking off.
    expect(levels("gpt-6-astra")).not.toContain("off");
    expect(levels("gpt-6-astra")).toContain("max");
  });

  it("offers nothing for a sign-in instance that has not signed in", async () => {
    expect(await anthropic.listModels(signedIn, draftModels(signedIn))).toEqual([]);
  });

  it("offers the catalog once a credential is stored", async () => {
    storeCredential("anthropic");
    expect((await anthropic.listModels(signedIn, draftModels(signedIn))).length).toBeGreaterThan(0);
  });
});

describe("toPiModel", () => {
  it("hands back pi's own model, with the API and base URL only pi knows", async () => {
    const [first] = anthropicProvider().getModels();
    const info = (await anthropic.listModels(keyed(), draftModels(keyed()))).find((model) => model.id === first.id);
    if (!info) throw new Error("the catalog lost its first model");
    expect(anthropic.toPiModel(keyed(), info)).toEqual(first);
  });

  it("refuses a model the type does not have", () => {
    const info = {
      id: "gpt-9",
      name: "GPT-9",
      contextLength: 0,
      pricing: { input: 0, output: 0 },
      supportsReasoning: false,
      supportsImages: false,
    };
    expect(() => anthropic.toPiModel(keyed(), info)).toThrow(/does not offer gpt-9/);
  });
});

describe("validate", () => {
  it("asks for a key before spending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await anthropic.validate(keyed(""), draftModels(keyed("")))).toEqual({ ok: false, error: "Add an API key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spends one request on a model to prove the key, and names it when it fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "invalid x-api-key" } }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await anthropic.validate(keyed(), draftModels(keyed()));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid x-api-key");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("reports a sign-in instance as not connected until a credential is stored", async () => {
    const notConnected = await anthropic.validate(signedIn, draftModels(signedIn));
    expect(notConnected).toMatchObject({ ok: false, error: expect.stringContaining("Reconnect it") });

    storeCredential("anthropic");
    const connected = await anthropic.validate(signedIn, draftModels(signedIn));
    expect(connected).toMatchObject({ ok: true, message: expect.stringContaining("Signed in") });
    expect(connected.models?.length).toBeGreaterThan(0);
  });
});

describe("the table", () => {
  it("has a definition for every pi-backed type the catalog offers", () => {
    const listed = catalogEntries.map((entry) => entry.type).filter((type) => type !== "openrouter" && type !== "openai-compatible");
    for (const type of new Set(listed)) expect(piBackedDefinitions[type]).toBeDefined();
  });

  it("offers no way in that pi has not implemented for the type", () => {
    for (const type of Object.keys(piBackedDefinitions) as (keyof typeof piBackedDefinitions)[]) {
      const offered = llmProviderCatalog[type].authKinds;
      expect(piAuthKinds(type)).toEqual(expect.arrayContaining(offered));
    }
  });
});

describe("opencode agent requests", () => {
  const zen: LlmProviderConfig = { id: "opencode", type: "opencode", name: "OpenCode Zen", apiKey: "sk-oc", auth: "api_key" };
  const reply = () => new Response([
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""), { headers: { "content-type": "text/event-stream" } });

  async function sentHeaders(sessionId?: string): Promise<Headers> {
    const fetchMock = vi.fn<typeof fetch>(async () => reply());
    vi.stubGlobal("fetch", fetchMock);
    const model = opencodeProvider().getModels().find((entry) => entry.api === "openai-completions");
    if (!model) throw new Error("pi's OpenCode catalog lost its Chat Completions models");
    const stream = streamDraftModel(zen, model, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] }, sessionId ? { sessionId } : {});
    for await (const event of stream) if (event.type === "error") throw new Error(event.error.errorMessage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    return new Headers(input instanceof Request ? input.headers : init?.headers);
  }

  // OpenCode refuses a request without the header: "Request is missing x-opencode-session".
  it("carries the chat's id as x-opencode-session, and a fresh one for a call without a chat", async () => {
    expect((await sentHeaders("0b7c9a52-chat")).get("x-opencode-session")).toBe("0b7c9a52-chat");
    expect((await sentHeaders()).get("x-opencode-session")).toMatch(/^[0-9a-f-]{36}$/);
  });

  // OpenCode asks clients to name themselves rather than the SDK, whatever wire API a model speaks.
  it.each(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"])(
    "names the app as the user agent over %s",
    async (api) => {
      const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "stop" } }, { status: 400 }));
      vi.stubGlobal("fetch", fetchMock);
      const model = opencodeProvider().getModels().find((entry) => entry.api === api);
      if (!model) throw new Error(`pi's OpenCode catalog lost its ${api} models`);
      await streamDraftModel(zen, model, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] }).result();
      expect(fetchMock).toHaveBeenCalled();
      const [input, init] = fetchMock.mock.calls[0];
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      expect(headers.get("user-agent")).toBe(OPENCODE_USER_AGENT);
      expect(headers.get("x-opencode-session")).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("validates an OpenCode Go key with a session, on a model the plan pays for", async () => {
    const go: LlmProviderConfig = { id: "opencode-go", type: "opencode-go", name: "OpenCode Go", apiKey: "sk-go", auth: "api_key" };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "no subscription" } }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await piBackedDefinitions["opencode-go"].validate(go, draftModels(go));

    expect(fetchMock).toHaveBeenCalled();
    const [input, init] = fetchMock.mock.calls[0];
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    expect(headers.get("x-opencode-session")).toMatch(/^[0-9a-f-]{36}$/);
    // The failure names the probe. Go lists free promotional models too, which would answer a key
    // without the plan; the probe is a priced one.
    expect(result.ok).toBe(false);
    const probed = opencodeGoProvider().getModels().find((model) => result.error?.startsWith(`${model.name}: `));
    expect(probed, result.error).toBeDefined();
    expect(probed?.cost.output).toBeGreaterThan(0);
    expect(opencodeGoProvider().getModels().some((model) => model.cost.input === 0 && model.cost.output === 0)).toBe(true);
  });
});

describe("meta", () => {
  type MetaConfig = Extract<LlmProviderConfig, { type: "meta" }>;
  const metaKey: MetaConfig = { id: "meta", type: "meta", name: "Meta", apiKey: "meta-key", auth: "api_key" };
  const metaSignIn: MetaConfig = { id: "meta", type: "meta", name: "Meta (Muse)", apiKey: "", auth: "oauth" };
  const meta = piBackedDefinitions.meta;

  it("lists pi's Muse Spark models for a key instance, with their real context and image input", async () => {
    const models = await meta.listModels(metaKey, draftModels(metaKey));
    expect(models.map((model) => model.id)).toEqual(metaProvider().getModels().map((model) => model.id));
    expect(models.map((model) => model.id)).toContain("muse-spark-1.3");
    for (const model of models) {
      expect(model).toMatchObject({ contextLength: 1_048_576, supportsImages: true, supportsReasoning: true });
      // pi marks every Muse Spark model `off: null`: it cannot turn thinking off.
      expect(model.thinkingLevels).not.toContain("off");
    }
  });

  /** Where one agent-shaped request goes and what it authenticates with; the stub refuses it without retry. */
  async function sentRequest(config: MetaConfig): Promise<{ url: string; headers: Headers }> {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "Stubbed refusal" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const model = metaProvider().getModels().find((entry) => entry.id === "muse-spark-1.3");
    if (!model) throw new Error("pi's Meta catalog lost muse-spark-1.3");
    const stream = streamDraftModel(config, model, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] });
    for await (const event of stream) if (event.type === "done") throw new Error("the stub should have refused the request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const url = input instanceof Request ? input.url : String(input);
    return { url, headers: new Headers(input instanceof Request ? input.headers : init?.headers) };
  }

  it("sends a key instance's request to Meta's Responses API with the saved key", async () => {
    const { url, headers } = await sentRequest(metaKey);
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect(headers.get("authorization")).toBe("Bearer meta-key");
  });

  it("sends a sign-in instance's request with the Model API key its login minted", async () => {
    storeCredential("meta", "minted-model-key");
    const { url, headers } = await sentRequest(metaSignIn);
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect(headers.get("authorization")).toBe("Bearer minted-model-key");
  });

  it("offers the sign-in pi implements, marked experimental in the dialog", () => {
    expect(piAuthKinds("meta")).toEqual(["api_key", "oauth"]);
    expect(meta.toPiProvider(metaSignIn).auth.apiKey).toBeUndefined();
    expect(catalogEntries.find((entry) => entry.id === "meta:oauth")).toMatchObject({ group: "signin", experimental: true });
  });
});
