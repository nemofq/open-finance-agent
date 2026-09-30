import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuthCheck, Models } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultConfig, type LlmProviderConfig } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { credentialStore } from "@/lib/llm/credentials";
import type { ProviderAuthStatus } from "@/lib/llm/oauth/types";

/** What pi reports about each provider's auth; the token itself comes from the real store below. */
const checks: Record<string, AuthCheck | undefined> = {
  openrouter: { type: "oauth", source: "OAuth" },
  "lab-a1b2": { type: "api_key", source: "config.json" },
  "lab-c3d4": undefined,
};

const logout = vi.fn(async () => {});
const models = {
  checkAuth: async (providerId: string) => checks[providerId],
  logout,
} as unknown as Models;

vi.mock(import("@/lib/llm/models"), async (importOriginal) => ({ ...(await importOriginal()), getModels: () => models }));

let home: string;

const connected: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "" };
const keyed: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "sk-lab-saved",
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
};
const unconfigured: LlmProviderConfig = { ...keyed, id: "lab-c3d4", name: "Spare", apiKey: "" };

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-llm-auth-"));
  process.env.OFA_HOME = home;
  const config = defaultConfig();
  config.llm.providers = [connected, keyed, unconfigured];
  writeConfig(config);
  await credentialStore().modify(connected.id, async () => ({
    type: "oauth",
    access: "sk-ant-oat-top-secret",
    refresh: "refresh-top-secret",
    expires: 1_800_000_000_000,
  }));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

describe("GET /api/settings/llm/auth", () => {
  it("reports how each provider is connected, and never its key or token", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as ProviderAuthStatus[];

    expect(body).toEqual([
      { provider: "openrouter", connected: true, type: "oauth", expires: 1_800_000_000_000 },
      { provider: "lab-a1b2", connected: true, type: "api_key" },
      { provider: "lab-c3d4", connected: false },
    ]);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("sk-lab-saved");
  });
});

describe("DELETE /api/settings/llm/auth", () => {
  const request = (url: string) => new Request(`http://localhost${url}`, { method: "DELETE" });

  it("asks which provider to sign out of", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(request("/api/settings/llm/auth"));
    expect(res.status).toBe(400);
  });

  it("signs out through pi, which is what removes the stored token", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(request("/api/settings/llm/auth?provider=openrouter"));

    expect(res.status).toBe(200);
    expect(logout).toHaveBeenCalledWith("openrouter");
  });
});
