import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/config/schema";
import { SECRET_MASK } from "@/lib/config/secrets";
import { readConfig, writeConfig } from "@/lib/config/store";
import type { Module } from "@/lib/tools/contracts";

/** A module whose secret is not called `apiKey`, which a mask keyed on the name would miss. */
const vault = vi.hoisted(
  (): Module => ({
    id: "vault",
    name: "Vault",
    kind: "data-provider",
    description: "A provider signed in with a token.",
    settings: [
      { key: "token", label: "Token", type: "secret" },
      { key: "region", label: "Region", type: "text" },
    ],
    defaultConfig: { enabled: false, token: "", region: "" },
    createTools: async () => [],
  }),
);

vi.mock("@/lib/tools/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/registry")>();
  return { ...actual, builtinModules: [...actual.builtinModules, vault] };
});

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-settings-secrets-"));
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

describe("/api/settings module secrets", () => {
  it("masks a module's secret field by its type, not its name, and restores it on save", async () => {
    const { GET, PUT } = await import("./route");
    const config = readConfig();
    writeConfig({ ...config, modules: { ...config.modules, vault: { enabled: true, token: "vault-secret", region: "eu" } } });

    const shown = (await (await GET()).json()) as AppConfig;
    expect(shown.modules.vault).toEqual({ enabled: true, token: SECRET_MASK, region: "eu" });
    expect(JSON.stringify(shown)).not.toContain("vault-secret");

    const saved = (await (
      await PUT(put({ modules: { vault: { ...shown.modules.vault, region: "us" } } }))
    ).json()) as AppConfig;
    expect(saved.modules.vault).toEqual({ enabled: true, token: SECRET_MASK, region: "us" });
    expect(readConfig().modules.vault).toEqual({ enabled: true, token: "vault-secret", region: "us" });
  });
});
