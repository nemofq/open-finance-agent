/**
 * No variable left in the environment changes a request the user configured in Settings. Each
 * test sends one request through the real pi stack with only `fetch` stubbed, sets the variable,
 * shows that pi or its SDK alone would have changed the request, then shows that the app's request
 * matches the one sent without it. A name cleared at startup is set again before the app's request,
 * as `next dev` puts it back whenever a `.env` file or a route changes.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Api, type AssistantMessageEventStream, type Context, createModels, type Model, type Models, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleVertexProvider } from "@earendil-works/pi-ai/providers/google-vertex";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { authPath } from "@/lib/paths";
import { resetProcessSingletons } from "@/lib/process-state";
import { CACHE_RETENTION, CLEARED_PROVIDER_ENV, clearProviderEnv } from "./ambient-env";
import { credentialStore } from "./credentials";
import { probeContext } from "./probe";
import { draftModels, getModels } from "./models";
import { providerDefinition } from "./providers";
import { piBackedDefinitions } from "./providers/pi-backed";
import { streamDraftModel } from "./stream";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-ambient-env-"));
  process.env.OFA_HOME = home;
  resetProcessSingletons("llm.models");
  // Every clear below is undone by unstubAllEnvs, so a variable set on this machine survives the file.
  for (const name of CLEARED_PROVIDER_ENV) vi.stubEnv(name, undefined);
  vi.stubEnv("PI_CACHE_RETENTION", undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
  resetProcessSingletons("llm.models");
});

describe("clearProviderEnv", () => {
  const exceptions = {
    HTTP_PROXY: "http://proxy.test:3128",
    HTTPS_PROXY: "http://proxy.test:3128",
    ALL_PROXY: "http://proxy.test:3128",
    NO_PROXY: "localhost",
    http_proxy: "http://proxy.test:3128",
    https_proxy: "http://proxy.test:3128",
    all_proxy: "http://proxy.test:3128",
    no_proxy: "localhost",
    ws_proxy: "http://proxy.test:3128",
    wss_proxy: "http://proxy.test:3128",
    AWS_PROFILE: "work",
    AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
    AWS_SESSION_TOKEN: "session-token",
    GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json",
    // Only where a sign-in's local callback server listens, as in a container.
    PI_OAUTH_CALLBACK_HOST: "0.0.0.0",
  };

  it("removes exactly the listed names, and leaves the proxy and cloud-profile exceptions alone", () => {
    const env: Record<string, string | undefined> = { ...exceptions, OFA_HOME: "/data" };
    for (const name of CLEARED_PROVIDER_ENV) env[name] = `set-${name}`;

    expect(clearProviderEnv(env)).toEqual([...CLEARED_PROVIDER_ENV]);
    expect(env).toEqual({ ...exceptions, OFA_HOME: "/data" });
  });

  it("names what it cleared once, never a value, and says nothing when nothing was set", () => {
    const log = vi.mocked(console.log);
    clearProviderEnv({ OPENAI_ORG_ID: "org-secret", KIMI_OAUTH_HOST: "https://kimi.test" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("OPENAI_ORG_ID, KIMI_OAUTH_HOST");
    expect(log.mock.calls[0][0]).not.toMatch(/org-secret|kimi\.test/);

    log.mockClear();
    expect(clearProviderEnv({ HTTPS_PROXY: "http://proxy.test:3128" })).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it("clears process.env by default", () => {
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "x-leak: 1");
    vi.stubEnv("AWS_PROFILE", "work");
    clearProviderEnv();
    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(process.env.AWS_PROFILE).toBe("work");
  });

  it("runs again whenever a pi collection is handed out, so a name restored after startup is cleared", () => {
    vi.stubEnv("OPENAI_ORG_ID", "org-ambient");
    getModels(defaultConfig());
    expect(process.env.OPENAI_ORG_ID).toBeUndefined();

    vi.stubEnv("OPENAI_ORG_ID", "org-ambient");
    draftModels(endpoint);
    expect(process.env.OPENAI_ORG_ID).toBeUndefined();
  });
});

/** What one request carried; the SDKs' telemetry headers describe the machine and are left out. */
interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Records every request and refuses it with a 400, which no SDK retries. */
function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (!key.startsWith("x-stainless-")) headers[key] = value;
    });
    const text = await request.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A form or an empty body stays as text.
    }
    sent.push({ method: request.method, url: request.url, headers, body });
    return Response.json({ error: { message: "Stubbed refusal" } }, { status: 400 });
  });
  return sent;
}

const context: Context = {
  systemPrompt: "You are a finance research agent.",
  messages: [{ role: "user", content: "Hi", timestamp: 0 }],
};

/** Every request one model call makes, which the stub refuses. */
async function capture(stream: () => AssistantMessageEventStream): Promise<Sent[]> {
  const sent = stubFetch();
  for await (const event of stream()) if (event.type === "done") throw new Error("the stub should have refused the request");
  if (sent.length === 0) throw new Error("nothing was sent");
  return sent;
}

/** One app-side model call, through `streamDraftModel` as Validate and Test do. */
function send(provider: LlmProviderConfig, model: Model<Api>, options: SimpleStreamOptions = {}): Promise<Sent[]> {
  return capture(() => streamDraftModel(provider, model, context, { sessionId: "chat-1", ...options }));
}

/**
 * The instance's pi collection built as `models.ts` builds it, but without clearing the
 * environment: what pi and its SDKs alone would do with a variable.
 */
function piModels(provider: LlmProviderConfig): Models {
  const models = createModels({ credentials: credentialStore(), authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(providerDefinition(provider).toPiProvider(provider));
  return models;
}

/** The same call made to pi directly, without what `stream.ts` and `models.ts` add. */
function sendThroughPi(provider: LlmProviderConfig, model: Model<Api>, options: SimpleStreamOptions = {}): Promise<Sent[]> {
  const apiKey = provider.apiKey ? { apiKey: provider.apiKey } : {};
  return capture(() => piModels(provider).streamSimple(model, context, { sessionId: "chat-1", ...apiKey, ...options }));
}

function catalogModel(models: readonly Model<Api>[], id: string): Model<Api> {
  const model = models.find((entry) => entry.id === id);
  if (!model) throw new Error(`pi's catalog lost ${id}`);
  return model;
}

const endpoint: LlmProviderConfig = {
  id: "lab",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "sk-lab",
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
};

function endpointModel(): Model<Api> {
  const config = defaultConfig();
  config.llm.providers = [endpoint];
  const [model] = getModels(config).getModels("lab");
  if (!model) throw new Error("the endpoint lost its model");
  return model;
}

const anthropic: Extract<LlmProviderConfig, { type: "anthropic" }> = { id: "anthropic", type: "anthropic", name: "Anthropic", apiKey: "sk-ant", auth: "api_key" };
const claude = () => catalogModel(anthropicProvider().getModels(), "claude-sonnet-4-6");
const openai: LlmProviderConfig = { id: "openai", type: "openai", name: "OpenAI", apiKey: "sk-openai", auth: "api_key" };
const gpt = () => catalogModel(openaiProvider().getModels(), "gpt-5.4");
const gemini: LlmProviderConfig = { id: "google", type: "google", name: "Google Gemini", apiKey: "g-key", auth: "api_key" };
const geminiModel = () => catalogModel(googleProvider().getModels(), "gemini-2.5-flash");
const vertex: LlmProviderConfig = { id: "google-vertex", type: "google-vertex", name: "Vertex", apiKey: "vx-key", method: "api-key" };
const vertexModel = () => catalogModel(googleVertexProvider().getModels(), "gemini-2.5-flash");

/** A signed-in instance, which no per-request setting reaches: only the explicit option can. */
function storeCredential(providerId: string, expires: number): void {
  const credential = { type: "oauth", access: "at", refresh: "rt", expires };
  writeFileSync(authPath(), JSON.stringify({ version: 1, credentials: { [providerId]: credential } }));
}

const claudeSignIn: LlmProviderConfig = { id: "anthropic", type: "anthropic", name: "Claude (Pro/Max)", apiKey: "", auth: "oauth" };

interface ClearedCase {
  name: (typeof CLEARED_PROVIDER_ENV)[number];
  value: string;
  label: string;
  config: LlmProviderConfig;
  model: () => Model<Api>;
}

const cleared: ClearedCase[] = [
  { name: "OPENAI_ORG_ID", value: "org-ambient", label: "an OpenAI-compatible endpoint", config: endpoint, model: endpointModel },
  { name: "OPENAI_PROJECT_ID", value: "proj-ambient", label: "an OpenAI-compatible endpoint", config: endpoint, model: endpointModel },
  { name: "OPENAI_CUSTOM_HEADERS", value: "x-ambient: 1", label: "an OpenAI-compatible endpoint", config: endpoint, model: endpointModel },
  { name: "OPENAI_CUSTOM_HEADERS", value: "x-ambient: 1", label: "OpenAI", config: openai, model: gpt },
  { name: "ANTHROPIC_CUSTOM_HEADERS", value: "x-ambient: 1", label: "Anthropic", config: anthropic, model: claude },
  { name: "GOOGLE_GENAI_USE_VERTEXAI", value: "true", label: "Gemini", config: gemini, model: geminiModel },
  { name: "GOOGLE_GENAI_USE_ENTERPRISE", value: "true", label: "Gemini", config: gemini, model: geminiModel },
  { name: "GOOGLE_VERTEX_BASE_URL", value: "https://vertex.ambient.test", label: "Vertex", config: vertex, model: vertexModel },
];

/** The server's startup, then `next dev` putting the environment it started with back. */
function clearedThenRestored(name: string, value: string): void {
  vi.stubEnv(name, value);
  clearProviderEnv();
  expect(process.env[name]).toBeUndefined();
  vi.stubEnv(name, value);
}

describe("a name cleared at startup", () => {
  it.each(cleared)("$name, even restored after startup, does not change a request to $label", async ({ name, value, config, model }) => {
    const piModel = model();
    const baseline = await send(config, piModel);
    const piBaseline = await sendThroughPi(config, piModel, { cacheRetention: CACHE_RETENTION });

    clearedThenRestored(name, value);
    const piAlone = await sendThroughPi(config, piModel, { cacheRetention: CACHE_RETENTION });
    expect(piAlone, `${name} is read by pi or its SDK`).not.toEqual(piBaseline);
    expect(await send(config, piModel)).toEqual(baseline);
  });

  it.each(["KIMI_CODE_OAUTH_HOST", "KIMI_OAUTH_HOST"] as const)("%s, even restored after startup, does not move a Kimi sign-in's token refresh", async (name) => {
    const kimi: LlmProviderConfig = { id: "kimi-coding", type: "kimi-coding", name: "Kimi", apiKey: "", auth: "oauth" };
    const model = kimiCodingProvider().getModels()[0];
    const expired = () => storeCredential("kimi-coding", Date.now() - 60_000);
    expired();
    const baseline = await send(kimi, model);
    expect(baseline[0].url).toBe("https://auth.kimi.com/api/oauth/token");

    clearedThenRestored(name, "https://kimi.ambient.test");
    expired();
    expect((await sendThroughPi(kimi, model))[0].url, `${name} is read by pi`).toBe("https://kimi.ambient.test/api/oauth/token");
    expired();
    expect(await send(kimi, model)).toEqual(baseline);
  });
});

describe("PI_CACHE_RETENTION", () => {
  const cases = [
    { provider: "an OpenAI-compatible endpoint", config: endpoint, model: endpointModel },
    { provider: "OpenAI", config: openai, model: gpt },
    { provider: "Anthropic", config: anthropic, model: claude },
    { provider: "a Claude sign-in", config: claudeSignIn, model: claude },
  ];

  it.each(cases)("does not change a request to $provider", async ({ config, model }) => {
    if (config.auth === "oauth") storeCredential(config.id, Date.now() + 3_600_000);
    const baseline = await send(config, model());
    // What is sent is pi's default, as pi sends it with the variable unset.
    expect(await sendThroughPi(config, model())).toEqual(baseline);

    vi.stubEnv("PI_CACHE_RETENTION", "long");
    expect(await sendThroughPi(config, model()), "pi alone would ask for a longer cache").not.toEqual(baseline);
    expect(await send(config, model())).toEqual(baseline);
  });

  it("does not change the request that proves a key", async () => {
    const validate = async () => {
      const sent = stubFetch();
      const result = await piBackedDefinitions.anthropic.validate(anthropic, draftModels(anthropic));
      expect(result.ok).toBe(false);
      return sent;
    };
    const baseline = await validate();
    expect(baseline).toHaveLength(1);
    const probed = baseline[0].body as { model: string };
    const probe = catalogModel(anthropicProvider().getModels(), probed.model);

    // The same probe as pi alone would send it, with the variable set: its cache is kept an hour.
    vi.stubEnv("PI_CACHE_RETENTION", "long");
    const piAlone = await capture(() => piModels(anthropic).streamSimple(probe, probeContext(), { apiKey: anthropic.apiKey, maxTokens: 32 }));
    expect(JSON.stringify(piAlone[0].body)).toContain('"ttl":"1h"');
    expect(JSON.stringify(baseline[0].body)).not.toContain('"ttl"');

    expect(await validate()).toEqual(baseline);
  });
});

describe("Bedrock", () => {
  const bedrock: LlmProviderConfig = {
    id: "amazon-bedrock",
    type: "amazon-bedrock",
    name: "Amazon Bedrock",
    apiKey: "",
    method: "access-keys",
    settings: { AWS_ACCESS_KEY_ID: "AKIATEST", AWS_SECRET_ACCESS_KEY: "secret", AWS_REGION: "eu-west-1" },
  };
  // The AWS SDK's own settings, from this machine's environment and ~/.aws, are kept out of the baseline.
  beforeEach(() => {
    vi.stubEnv("AWS_CONFIG_FILE", path.join(home, "aws-config"));
    vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", path.join(home, "aws-credentials"));
    for (const name of ["AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK", "AWS_SESSION_TOKEN", "AWS_USE_FIPS_ENDPOINT", "AWS_USE_DUALSTACK_ENDPOINT"]) {
      vi.stubEnv(name, undefined);
    }
  });

  const bedrockClaude = () => catalogModel(amazonBedrockProvider().getModels(), "anthropic.claude-sonnet-4-6");
  const bedrockOther = () => {
    const model = amazonBedrockProvider().getModels().find((entry) => !/claude/i.test(`${entry.id} ${entry.name}`));
    if (!model) throw new Error("pi's Bedrock catalog lists only Claude");
    return model;
  };

  /** The Converse payload pi built, caught before anything is sent. */
  async function payload(model: Model<Api>, options: SimpleStreamOptions = {}): Promise<unknown> {
    let caught: unknown;
    const stream = streamDraftModel(bedrock, model, context, {
      ...options,
      onPayload: (body) => {
        caught = body;
        throw new Error("caught before sending");
      },
    });
    for await (const event of stream) if (event.type === "done") throw new Error("the payload should have been caught");
    if (caught === undefined) throw new Error("pi built no payload");
    return caught;
  }

  it("ignores AWS_BEDROCK_FORCE_CACHE, which adds cache points for a model pi does not know caches", async () => {
    const model = bedrockOther();
    const baseline = await payload(model);
    expect(await payload(model, { env: { AWS_BEDROCK_FORCE_CACHE: "1" } }), "pi reads the switch").not.toEqual(baseline);

    vi.stubEnv("AWS_BEDROCK_FORCE_CACHE", "1");
    expect(await payload(model)).toEqual(baseline);
  });

  it("ignores PI_CACHE_RETENTION, which asks for an hour-long cache on Claude", async () => {
    const model = bedrockClaude();
    const baseline = await payload(model);
    vi.stubEnv("PI_CACHE_RETENTION", "long");
    expect(await payload(model)).toEqual(baseline);
    expect(JSON.stringify(baseline)).toContain("cachePoint");
    expect(JSON.stringify(baseline)).not.toContain("ttl");
  });

  /**
   * A local server stands in for the network: as an HTTP proxy it records where the AWS SDK
   * connects (CONNECT host:port, or an absolute URL for plain HTTP), and as a plain HTTP endpoint
   * it records whether a request arrived over HTTP/1.1 at all.
   */
  async function localServer(): Promise<{ url: string; seen: string[]; close: () => Promise<void> }> {
    const seen: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((req: IncomingMessage, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(400, { "content-type": "application/json" }).end("{}");
    });
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("connect", (req: IncomingMessage, socket: Socket) => {
      seen.push(`CONNECT ${req.url}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    server.on("clientError", (_err, socket: Socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const close = () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
    return { url: `http://127.0.0.1:${port}`, seen, close };
  }

  async function run(model: Model<Api>, options: SimpleStreamOptions = {}, stream = streamDraftModel(bedrock, model, context, options)): Promise<void> {
    for await (const event of stream) {
      if (event.type === "done") throw new Error("the local server should have refused the request");
    }
  }

  it.each(["AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME"] as const)(
    "%s, even restored after startup, does not send a signed request to another host",
    async (name) => {
      vi.stubEnv("AWS_MAX_ATTEMPTS", "1");
      const proxy = await localServer();
      const through = { env: { HTTPS_PROXY: proxy.url, HTTP_PROXY: proxy.url } };
      try {
        await run(bedrockClaude(), through);
        expect(proxy.seen).toEqual(["CONNECT bedrock-runtime.eu-west-1.amazonaws.com:443"]);

        clearedThenRestored(name, "http://bedrock.ambient.test:8080");
        proxy.seen.length = 0;
        await run(bedrockClaude(), through, piModels(bedrock).streamSimple(bedrockClaude(), context, through));
        expect(proxy.seen[0], `${name} is read by the AWS SDK`).toMatch(/^POST http:\/\/bedrock\.ambient\.test:8080\//);

        proxy.seen.length = 0;
        await run(bedrockClaude(), through);
        expect(proxy.seen).toEqual(["CONNECT bedrock-runtime.eu-west-1.amazonaws.com:443"]);
      } finally {
        await proxy.close();
      }
    },
  );

  it("ignores AWS_BEDROCK_FORCE_HTTP1, which swaps the HTTP/2 client for HTTP/1.1", async () => {
    vi.stubEnv("AWS_MAX_ATTEMPTS", "1");
    const server = await localServer();
    // A custom endpoint, so the request reaches the local server without a proxy.
    const model = { ...bedrockClaude(), baseUrl: server.url };
    try {
      await run(model, { timeoutMs: 2_000 });
      expect(server.seen, "the default client speaks HTTP/2, which an HTTP/1.1 server never parses").toEqual([]);

      await run(model, { env: { AWS_BEDROCK_FORCE_HTTP1: "1" } });
      expect(server.seen, "pi reads the switch").toHaveLength(1);

      server.seen.length = 0;
      vi.stubEnv("AWS_BEDROCK_FORCE_HTTP1", "1");
      await run(model, { timeoutMs: 2_000 });
      expect(server.seen).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
