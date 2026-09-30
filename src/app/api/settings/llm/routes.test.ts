import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { SECRET_MASK } from "@/lib/config/secrets";
import { writeConfig } from "@/lib/config/store";
import type { LlmModelsResponse, ProviderValidation } from "@/lib/llm/types";

let home: string;

const openrouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-or-saved" };
/** Saved with no credential in `auth.json`, which is what "not connected" looks like. */
const codex: LlmProviderConfig = { id: "openai-codex", type: "openai-codex", name: "ChatGPT (Codex)", apiKey: "", auth: "oauth" };
const endpoint: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "sk-lab-saved",
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
};

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-settings-llm-"));
  process.env.OFA_HOME = home;
  const config = defaultConfig();
  config.llm.providers = [openrouter, endpoint];
  config.llm.defaultModel = { provider: endpoint.id, model: "qwen-27b" };
  writeConfig(config);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const post = (url: string, body: unknown, contentType = "application/json") =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });

/** Answers every request with an empty model list and records the Authorization header sent. */
function stubModelList() {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  return () => (fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>).Authorization;
}

describe("GET /api/settings/llm/models", () => {
  it("returns the default model and every provider's models without a key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { GET } = await import("./models/route");
    const res = await GET();
    const body = (await res.json()) as LlmModelsResponse;

    expect(body.defaultModel).toEqual({ provider: endpoint.id, model: "qwen-27b" });
    expect(body.providers.map((provider) => provider.provider)).toEqual(["openrouter", endpoint.id]);
    expect(body.providers[0]).toMatchObject({ models: [], error: expect.stringContaining("503") });
    expect(body.providers[1].models.map((model) => model.id)).toEqual(["qwen-27b"]);
    expect(JSON.stringify(body)).not.toContain("saved");
  });
});

describe("POST /api/settings/llm/validate", () => {
  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./validate/route");
    const res = await POST(post("/api/settings/llm/validate", { provider: endpoint }, "text/plain"));
    expect(res.status).toBe(415);
  });

  it("rejects an invalid draft", async () => {
    const { POST } = await import("./validate/route");
    const res = await POST(post("/api/settings/llm/validate", { provider: { ...endpoint, baseUrl: "ftp://x" } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("baseUrl");
  });

  it("validates with the saved key when the draft keeps it masked, even at a new URL", async () => {
    const authorization = stubModelList();
    const { POST } = await import("./validate/route");
    const draft = { ...endpoint, apiKey: SECRET_MASK, baseUrl: "https://moved.example.com/v1" };
    const res = await POST(post("/api/settings/llm/validate", { provider: draft }));

    expect((await res.json()) as ProviderValidation).toMatchObject({ ok: true });
    expect(authorization()).toBe("Bearer sk-lab-saved");
  });

  it("refuses a draft endpoint that claims a built-in provider id", async () => {
    stubModelList();
    const { POST } = await import("./validate/route");
    const draft = { ...endpoint, id: "openrouter", apiKey: SECRET_MASK, baseUrl: "https://evil.example.com/v1" };
    const res = await POST(post("/api/settings/llm/validate", { provider: draft }));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("reserved");
    // Refused before the request, so the saved OpenRouter key never went to the drafted URL either.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings/llm/test", () => {
  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./test/route");
    const res = await POST(post("/api/settings/llm/test", { provider: endpoint, model: "qwen-27b" }, "text/plain"));
    expect(res.status).toBe(415);
  });

  it("refuses to test without a model", async () => {
    const { POST } = await import("./test/route");
    const res = await POST(post("/api/settings/llm/test", { provider: endpoint, model: " " }));
    expect(res.status).toBe(400);
  });

  it("asks for a key a provider requires", async () => {
    const { POST } = await import("./test/route");
    const res = await POST(post("/api/settings/llm/test", { provider: { ...openrouter, apiKey: "" }, model: "acme/fast" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add an API key" });
  });

  it("asks a provider that signs in to be connected first, rather than for a key", async () => {
    const { POST } = await import("./test/route");
    const res = await POST(post("/api/settings/llm/test", { provider: codex, model: "gpt-5-codex" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Reconnect it in Settings › LLM");
  });
});
