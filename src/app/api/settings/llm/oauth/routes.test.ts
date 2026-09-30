import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuthInteraction, Models, OAuthCredential } from "@earendil-works/pi-ai";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { loginSessions } from "@/lib/llm/oauth/sessions";
import type { OAuthStartResponse, OAuthStreamMessage } from "@/lib/llm/oauth/types";

/** The flow the fake `Models.login` runs; each test sets the one it needs. */
let login: (interaction: AuthInteraction) => Promise<OAuthCredential>;

const credential: OAuthCredential = { type: "oauth", access: "top-secret", refresh: "top-secret", expires: 0 };

/** Only the three members the routes touch; pi's own login is covered by its own tests. */
const models = {
  getProvider: (id: string) => (id === "openrouter" ? { auth: { oauth: {} } } : { auth: { apiKey: {} } }),
  login: (_provider: string, _type: string, interaction: AuthInteraction) => login(interaction),
} as unknown as Models;

vi.mock(import("@/lib/llm/models"), async (importOriginal) => ({ ...(await importOriginal()), getModels: () => models }));

let home: string;

const openrouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-or" };
const endpoint: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "",
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
};

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-oauth-routes-"));
  process.env.OFA_HOME = home;
  const config = defaultConfig();
  config.llm.providers = [openrouter, endpoint];
  writeConfig(config);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const started: string[] = [];

afterEach(() => {
  // The manager is a process-wide singleton, so a session left running would leak into the next test.
  for (const id of started.splice(0)) loginSessions().abort(id);
});

const post = (url: string, body: unknown, contentType = "application/json") =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function start(provider: string): Promise<Response> {
  const { POST } = await import("./route");
  const res = await POST(post("/api/settings/llm/oauth", { provider }));
  if (res.ok) started.push(((await res.clone().json()) as OAuthStartResponse).id);
  return res;
}

/** The frames of a closed SSE stream, as the dialog's `EventSource` would see them. */
async function frames(res: Response): Promise<OAuthStreamMessage[]> {
  return (await res.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as OAuthStreamMessage);
}

describe("POST /api/settings/llm/oauth", () => {
  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(post("/api/settings/llm/oauth", { provider: "openrouter" }, "text/plain"));
    expect(res.status).toBe(415);
  });

  it("refuses a provider that is not configured", async () => {
    login = () => Promise.resolve(credential);
    const res = await start("anthropic");
    expect(res.status).toBe(404);
  });

  it("refuses a provider that has no sign-in", async () => {
    login = () => Promise.resolve(credential);
    const res = await start(endpoint.id);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("does not support");
  });

  it("starts one login per provider and hands back its id", async () => {
    login = (interaction) =>
      new Promise(() => interaction.notify({ type: "progress", message: "Waiting for approval" }));

    const res = await start("openrouter");
    expect(((await res.json()) as OAuthStartResponse).id).toMatch(/^[0-9a-f-]{36}$/);

    const second = await start("openrouter");
    expect(second.status).toBe(409);
  });
});

describe("GET /api/settings/llm/oauth/[id]/events", () => {
  it("refuses a sign-in that is not running", async () => {
    const { GET } = await import("./[id]/events/route");
    expect((await GET(new Request("http://localhost"), params("nobody"))).status).toBe(404);
  });

  it("replays what the login has said, then streams the rest and closes on the terminal message", async () => {
    login = async (interaction) => {
      interaction.notify({ type: "auth_url", url: "https://example.com/authorize" });
      await interaction.prompt({ type: "manual_code", message: "Paste the redirect URL" });
      return credential;
    };
    const { id } = (await (await start("openrouter")).json()) as OAuthStartResponse;

    const { GET } = await import("./[id]/events/route");
    const res = await GET(new Request("http://localhost"), params(id));
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const body = frames(res);

    const { POST } = await import("./[id]/answer/route");
    expect((await POST(post(`/api/settings/llm/oauth/${id}/answer`, { value: "code-42" }), params(id))).status).toBe(200);

    expect(await body).toEqual([
      { type: "event", event: { type: "auth_url", url: "https://example.com/authorize" } },
      { type: "prompt", prompt: { id: "p1", type: "manual_code", message: "Paste the redirect URL" } },
      { type: "done" },
    ]);
  });

  it("never carries the credential", async () => {
    login = () => Promise.resolve(credential);
    const { id } = (await (await start("openrouter")).json()) as OAuthStartResponse;
    const { GET } = await import("./[id]/events/route");
    const res = await GET(new Request("http://localhost"), params(id));

    expect(await res.text()).not.toContain("top-secret");
  });
});

describe("POST /api/settings/llm/oauth/[id]/answer", () => {
  it("refuses a body that is not declared JSON", async () => {
    const { POST } = await import("./[id]/answer/route");
    const res = await POST(post("/api/settings/llm/oauth/x/answer", { value: "y" }, "text/plain"), params("x"));
    expect(res.status).toBe(415);
  });

  it("refuses an unknown sign-in, and one that is not waiting for an answer", async () => {
    login = () => new Promise(() => {});
    const { id } = (await (await start("openrouter")).json()) as OAuthStartResponse;
    const { POST } = await import("./[id]/answer/route");

    expect((await POST(post("/x", { value: "y" }), params("nobody"))).status).toBe(404);
    const res = await POST(post("/x", { value: "y" }), params(id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("not waiting");
  });
});

describe("DELETE /api/settings/llm/oauth/[id]", () => {
  it("aborts a running login once", async () => {
    login = (interaction) => new Promise((_resolve, reject) => interaction.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const { id } = (await (await start("openrouter")).json()) as OAuthStartResponse;

    const { DELETE } = await import("./[id]/route");
    expect((await DELETE(new Request("http://localhost", { method: "DELETE" }), params(id))).status).toBe(200);
    expect((await DELETE(new Request("http://localhost", { method: "DELETE" }), params(id))).status).toBe(404);
  });
});
