import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ApiKeyCredential, Credential, OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authPath } from "@/lib/paths";
import { FileCredentialStore } from "./credentials";

let home: string;
let store: FileCredentialStore;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-auth-"));
  process.env.OFA_HOME = home;
  store = new FileCredentialStore();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const key = (value: string): ApiKeyCredential => ({ type: "api_key", key: value });
const token = (expires: number): OAuthCredential => ({ type: "oauth", access: "a", refresh: "r", expires });

const readFileJson = async () => JSON.parse(await readFile(authPath(), "utf8")) as unknown;

describe("FileCredentialStore", () => {
  it("writes owner-only and reads back what it stored", async () => {
    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.modify("anthropic", async () => token(42))).toEqual(token(42));

    expect(await store.read("anthropic")).toEqual(token(42));
    expect(statSync(authPath()).mode & 0o777).toBe(0o600);
    expect(await readFileJson()).toEqual({ version: 1, credentials: { anthropic: token(42) } });
  });

  it("lists stored credentials without exposing the secrets", async () => {
    await store.modify("anthropic", async () => token(42));
    await store.modify("openrouter", async () => key("sk-or"));

    expect(await store.list()).toEqual([
      { providerId: "anthropic", type: "oauth" },
      { providerId: "openrouter", type: "api_key" },
    ]);
  });

  it("leaves the entry alone when the callback returns undefined", async () => {
    await store.modify("anthropic", async () => token(42));
    expect(await store.modify("anthropic", async () => undefined)).toEqual(token(42));
    expect(await store.read("anthropic")).toEqual(token(42));
  });

  it("deletes one provider and keeps the rest", async () => {
    await store.modify("anthropic", async () => token(42));
    await store.modify("openrouter", async () => key("sk-or"));
    await store.delete("anthropic");

    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.read("openrouter")).toEqual(key("sk-or"));
    // Deleting what is not there is not an error, and writes nothing.
    await expect(store.delete("anthropic")).resolves.toBeUndefined();
  });

  /** The refresh pattern: pi reads the current token inside `modify` and writes the rotated one. */
  it("serialises concurrent writes to one provider, so no refresh is lost", async () => {
    await store.modify("anthropic", async () => token(0));
    const rotate = () =>
      store.modify("anthropic", async (current) => {
        const expires = (current as OAuthCredential).expires;
        await delay(5); // the network call a real refresh makes
        return token(expires + 1);
      });

    await Promise.all([rotate(), rotate(), rotate()]);
    expect(await store.read("anthropic")).toEqual(token(3));
  });

  it("serialises concurrent writes to different providers, so neither is dropped", async () => {
    await Promise.all([
      store.modify("anthropic", async () => token(42)),
      store.modify("openrouter", async () => key("sk-or")),
      store.modify("openai", async () => key("sk-oai")),
    ]);

    expect(await readFileJson()).toMatchObject({
      credentials: { anthropic: token(42), openrouter: key("sk-or"), openai: key("sk-oai") },
    });
  });

  it("leaves no temporary file behind, so the store is never half-written", async () => {
    await store.modify("anthropic", async () => token(42));
    expect(readdirSync(home)).toEqual(["auth.json"]);
  });

  it("waits for a lock another process holds, then writes", async () => {
    const lockFile = `${authPath()}.lock`;
    writeFileSync(lockFile, "");
    const pending = store.modify("anthropic", async () => token(42));

    await delay(60);
    expect(await store.read("anthropic")).toBeUndefined();
    rmSync(lockFile);

    expect(await pending).toEqual(token(42));
  });

  it("breaks a lock left behind by a process that died holding it", async () => {
    const lockFile = `${authPath()}.lock`;
    await writeFile(lockFile, "");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockFile, longAgo, longAgo);

    expect(await store.modify("anthropic", async () => token(42))).toEqual(token(42));
  });

  it("reads a missing, corrupt or foreign file as empty rather than failing a login", async () => {
    for (const body of ["not json", '{"credentials": "nope"}', "[]"]) {
      await writeFile(authPath(), body);
      expect(await store.read("anthropic")).toBeUndefined();
      expect(await store.list()).toEqual([]);
    }

    // And a write on top of the rubbish still produces a well-formed store.
    const stored: Credential = key("sk-or");
    expect(await store.modify("openrouter", async () => stored)).toEqual(stored);
    expect(await readFileJson()).toEqual({ version: 1, credentials: { openrouter: stored } });
  });
});
