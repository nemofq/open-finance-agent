import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/config/schema";
import { SECRET_MASK } from "@/lib/config/secrets";
import { loginSessions } from "@/lib/llm/oauth/sessions";
import { authPath } from "@/lib/paths";

const disconnect = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>(async () => {}));
vi.mock("@/lib/mcp/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/mcp/client")>()), disconnect }));

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-settings-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const put = (body: unknown) =>
  new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET/PUT /api/settings", () => {
  it("creates a default config, round-trips edits and never leaks a secret", async () => {
    const { GET, PUT } = await import("./route");

    const initial = (await (await GET()).json()) as AppConfig;
    expect(initial.version).toBe(3);
    expect(initial.llm).toEqual({ providers: [], defaultModel: null, thinkingLevel: "off" });

    const openRouter = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-live" };
    const endpoint = {
      id: "local-ab12",
      type: "openai-compatible",
      name: "Local",
      apiKey: "local-key",
      baseUrl: "http://localhost:4000/v1",
      models: [{ id: "qwen" }],
    };
    const saved = (await (
      await PUT(put({ llm: { providers: [openRouter, endpoint], defaultModel: { provider: "local-ab12", model: "qwen" } } }))
    ).json()) as AppConfig;
    expect(saved.llm.providers.map((provider) => provider.apiKey)).toEqual([SECRET_MASK, SECRET_MASK]);
    expect(saved.llm.defaultModel).toEqual({ provider: "local-ab12", model: "qwen" });
    expect(JSON.stringify(saved)).not.toMatch(/sk-live|local-key/);

    const reordered = [saved.llm.providers[1], saved.llm.providers[0]];
    const kept = (await (await PUT(put({ llm: { providers: reordered, thinkingLevel: "high" } }))).json()) as AppConfig;
    expect(kept.llm.providers.map((provider) => provider.id)).toEqual(["local-ab12", "openrouter"]);
    expect(kept.llm.defaultModel).toEqual({ provider: "local-ab12", model: "qwen" });
    expect(kept.llm.thinkingLevel).toBe("high");
    expect(JSON.stringify(await (await GET()).json())).not.toMatch(/sk-live|local-key/);

    const { readConfig } = await import("@/lib/config/store");
    expect(readConfig().llm.providers.map((provider) => provider.apiKey)).toEqual(["local-key", "sk-live"]);

    const deleted = (await (await PUT(put({ llm: { providers: [kept.llm.providers[1]] } }))).json()) as AppConfig;
    expect(deleted.llm.defaultModel).toBeNull();
    expect(readConfig().llm.providers).toEqual([openRouter]);
  });

  it("forgets what a deleted provider was signed in with", async () => {
    const { PUT } = await import("./route");
    const codex = { id: "openai-codex", type: "openai-codex", name: "ChatGPT (Codex)", apiKey: "", auth: "oauth" };
    await PUT(put({ llm: { providers: [codex] } }));
    const credential = { type: "oauth", access: "at", refresh: "rt", expires: Date.now() + 3_600_000 };
    writeFileSync(authPath(), JSON.stringify({ version: 1, credentials: { "openai-codex": credential } }));

    await PUT(put({ llm: { providers: [] } }));
    // A token left behind would answer for the provider the next time its type is added.
    expect(JSON.parse(readFileSync(authPath(), "utf8")).credentials).toEqual({});
  });

  it("stops a sign-in still in progress for a deleted provider", async () => {
    const { PUT } = await import("./route");
    const codex = { id: "openai-codex", type: "openai-codex", name: "ChatGPT (Codex)", apiKey: "", auth: "oauth" };
    await PUT(put({ llm: { providers: [codex] } }));
    // A login the user is still walking through; left running, it would write a token back.
    const { id } = loginSessions().start("openai-codex", () => new Promise(() => {}));

    await PUT(put({ llm: { providers: [] } }));
    expect(loginSessions().has(id)).toBe(false);
  });

  it("rejects a body the schema does not accept", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(put({ llm: { thinkingLevel: "extreme" } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("thinkingLevel");
  });

  it("rejects a body that is not a JSON object", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(put(["nope"]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/JSON object/);
  });

  it("disconnects an MCP server that a save removes or turns off, and only those", async () => {
    const { PUT } = await import("./route");
    const server = (id: string, enabled = true) => ({ id, name: id, enabled, transport: "stdio", command: "node" });
    await PUT(put({ mcp: { servers: [server("gone"), server("off"), server("kept"), server("idle", false)] } }));
    disconnect.mockClear();

    const res = await PUT(put({ mcp: { servers: [server("off", false), server("kept"), server("idle", false)] } }));
    expect(res.status).toBe(200);
    expect(disconnect.mock.calls.map(([id]) => id).sort()).toEqual(["gone", "off"]);
  });

  it("rejects a malformed JSON body, and one not declared JSON", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    const plain = await PUT(new Request("http://localhost/api/settings", { method: "PUT", body: "{}" }));
    expect(plain.status).toBe(415);
  });
});

describe("/api/settings/modules", () => {
  it("lists the registered modules", async () => {
    const { GET } = await import("./modules/route");
    const body = (await (await GET()).json()) as { modules: { id: string }[] };
    expect(Array.isArray(body.modules)).toBe(true);
  });

  it("404s validation for a module that is not registered", async () => {
    const { POST } = await import("./modules/[id]/validate/route");
    const res = await POST(
      new Request("http://localhost/api/settings/modules/nope/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: {} }),
      }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });

  it("refuses a validation request that is not declared JSON", async () => {
    const { POST } = await import("./modules/[id]/validate/route");
    const res = await POST(
      new Request("http://localhost/api/settings/modules/tavily/validate", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ config: { apiKey: "attacker" } }),
      }),
      { params: Promise.resolve({ id: "tavily" }) },
    );
    expect(res.status).toBe(415);
  });
});

describe("GET /api/mcp/servers/[id]/tools", () => {
  it("returns 404 for a server that is not configured", async () => {
    const { GET } = await import("@/app/api/mcp/servers/[id]/tools/route");
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("serves saved servers only: no draft probe, and no Alpha Vantage preset by id", async () => {
    const route = await import("@/app/api/mcp/servers/[id]/tools/route");
    // A draft could name a command to spawn, or carry masked headers to a URL.
    expect("POST" in route).toBe(false);
    const res = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "alphavantage" }) });
    expect(res.status).toBe(404);
  });
});
