import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { resetProcessSingletons } from "@/lib/process-state";
import { resolveModel } from "./index";
import { draftModels, getModels } from "./models";
import { streamModel } from "./stream";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-models-"));
  process.env.OFA_HOME = home;
  resetProcessSingletons("llm.models");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
  resetProcessSingletons("llm.models");
});

const openrouter = (apiKey = "sk-or"): LlmProviderConfig => ({
  id: "openrouter",
  type: "openrouter",
  name: "OpenRouter",
  apiKey,
});

const endpoint = (apiKey = ""): LlmProviderConfig => ({
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey,
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
});

function configWith(providers: LlmProviderConfig[]): AppConfig {
  const config = defaultConfig();
  config.llm.providers = providers;
  return config;
}

describe("getModels", () => {
  it("registers one pi provider per saved instance, under its config id", () => {
    const models = getModels(configWith([openrouter(), endpoint()]));
    expect(models.getProviders().map((provider) => provider.id)).toEqual(["openrouter", "lab-a1b2"]);
    // The endpoint's hand-listed models are its whole catalog, so pi knows them up front.
    expect(models.getModels("lab-a1b2").map((model) => model.id)).toEqual(["qwen-27b"]);
  });

  it("serves one collection per provider list, and drops it when the list changes", () => {
    const first = getModels(configWith([openrouter()]));
    expect(getModels(configWith([openrouter()]))).toBe(first);

    // A changed key is a changed instance, so the provider that holds it is rebuilt.
    expect(getModels(configWith([openrouter("sk-other")]))).not.toBe(first);
    expect(getModels(configWith([openrouter(), endpoint()]))).not.toBe(first);
  });

});

describe("auth resolution", () => {
  it("takes the key from config.json and never from the environment", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-from-the-environment");
    const configured = await getModels(configWith([openrouter()])).getAuth("openrouter");
    expect(configured?.auth.apiKey).toBe("sk-or");

    // Nothing saved means not connected, even with a key of that name lying around the machine.
    resetProcessSingletons("llm.models");
    expect(await getModels(configWith([openrouter("")])).getAuth("openrouter")).toBeUndefined();
    expect(await getModels(configWith([openrouter("")])).checkAuth("openrouter")).toBeUndefined();
  });

  it("gives a keyless endpoint the placeholder its client insists on", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-from-the-environment");
    const auth = await draftModels(endpoint()).getAuth("lab-a1b2");
    expect(auth?.auth.apiKey).toBe("not-needed");
  });

  it("sends the configured key on the request itself, so pi resolves nothing of its own", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse());
    vi.stubGlobal("fetch", fetchMock);
    const config = configWith([endpoint("sk-lab")]);
    const resolved = await resolveModel(config, { provider: "lab-a1b2", model: "qwen-27b" });
    if (!resolved.ok) throw new Error(resolved.message);

    await streamModel(config, resolved.model, { messages: [] }).result();
    expect(authorizationOf(fetchMock)).toBe("Bearer sk-lab");
  });
});

/** One assistant turn on the Chat Completions wire, enough for a stream to complete. */
function sse(): Response {
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(`${chunk({ role: "assistant", content: "OK" })}${chunk({}, "stop")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function authorizationOf(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string | null | undefined {
  const [url, init] = fetchMock.mock.calls[0];
  if (url instanceof Request) return url.headers.get("authorization");
  const { headers } = init ?? {};
  return headers instanceof Headers ? headers.get("authorization") : (headers as Record<string, string>).Authorization;
}

describe("the agent seam", () => {
  /**
   * `Models.streamSimple` is what `factory.ts` hands the `Agent` as its `streamFn`: same arguments,
   * same `AssistantMessageEventStream`. pi's faux provider proves the two contracts still line up.
   */
  it("streams a pi Agent turn through a Models collection", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("hello from the agent")]);

    const agent = new Agent({
      initialState: { systemPrompt: "s", model: faux.getModel(), tools: [] },
      streamFn: (model, context, options) => models.streamSimple(model, context, options),
    });
    await agent.prompt("hi");
    await agent.waitForIdle();

    expect(agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hello from the agent" }],
    });
  });
});
