import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileCredentialStore } from "@/lib/llm/credentials";
import { authPath, configPath, dataDir, sessionsDir, withDataDir } from "@/lib/paths";
import { createTaskHome, createTempHome } from "./home";

let real: string;

beforeEach(() => {
  real = mkdtempSync(path.join(tmpdir(), "ofa-real-home-"));
  process.env.OFA_HOME = real;
  writeFileSync(path.join(real, "config.json"), JSON.stringify({ marker: "developer" }));
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(real, { recursive: true, force: true });
});

describe("the run's temporary data folder", () => {
  it("points OFA_HOME at a fresh folder holding only the chosen config", () => {
    const home = createTempHome(path.join(real, "config.json"));
    try {
      expect(process.env.OFA_HOME).toBe(home.dir);
      expect(home.dir).not.toBe(real);
      expect(dataDir()).toBe(home.dir);
      expect(configPath()).toBe(path.join(home.dir, "config.json"));
      expect(sessionsDir().startsWith(home.dir)).toBe(true);
      expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ marker: "developer" });
    } finally {
      home.remove();
    }
  });

  it("deletes the folder and restores the previous OFA_HOME", () => {
    const home = createTempHome(path.join(real, "config.json"));
    const dir = home.dir;
    home.remove();

    expect(existsSync(dir)).toBe(false);
    expect(process.env.OFA_HOME).toBe(real);
  });

  it("keeps the folder but still restores OFA_HOME", () => {
    const home = createTempHome(path.join(real, "config.json"));
    try {
      home.keep();
      expect(existsSync(home.dir)).toBe(true);
      expect(process.env.OFA_HOME).toBe(real);
    } finally {
      rmSync(home.dir, { recursive: true, force: true });
    }
  });

  it("says which config it could not find instead of creating one", () => {
    expect(() => createTempHome(path.join(real, "nowhere.json"))).toThrow(/No config at/);
    expect(process.env.OFA_HOME).toBe(real);
  });
});

describe("sign-in credentials", () => {
  const credential = (access: string, refresh: string) => ({ type: "oauth" as const, access, refresh, expires: Date.now() + 3_600_000 });

  it("are read from the auth.json beside the chosen config, in place, from the run and every cell", () => {
    const home = createTempHome(path.join(real, "config.json"));
    try {
      const cell = createTaskHome(home.dir, "agent-retail-01-1");
      expect(authPath()).toBe(path.join(real, "auth.json"));
      expect(withDataDir(cell, () => authPath())).toBe(path.join(real, "auth.json"));
    } finally {
      home.remove();
    }
    // The app's own resolution is back once the run is over.
    expect(authPath()).toBe(path.join(real, "auth.json"));
  });

  it("land a token refreshed during a run in the original file, and copy it nowhere", async () => {
    const original = path.join(real, "auth.json");
    writeFileSync(original, JSON.stringify({ version: 1, credentials: { anthropic: credential("at-1", "rt-1") } }), { mode: 0o600 });
    const home = createTempHome(path.join(real, "config.json"));
    try {
      const cell = createTaskHome(home.dir, "agent-retail-01-1");
      // What pi does when a task's request finds the token expired: refresh inside `modify`.
      await withDataDir(cell, () =>
        new FileCredentialStore().modify("anthropic", async (current) => {
          expect(current).toMatchObject({ access: "at-1", refresh: "rt-1" });
          return credential("at-2", "rt-2");
        }),
      );

      expect(JSON.parse(readFileSync(original, "utf8")).credentials.anthropic).toMatchObject({ access: "at-2", refresh: "rt-2" });
      expect(readdirSync(home.dir).sort()).toEqual(["config.json", "tasks"]);
      expect(readdirSync(cell)).toEqual(["config.json"]);
    } finally {
      home.remove();
    }
  });

  it("are optional: a key-only setup copies just the config and creates no auth.json", () => {
    const home = createTempHome(path.join(real, "config.json"));
    try {
      expect(readdirSync(home.dir)).toEqual(["config.json"]);
      expect(readdirSync(createTaskHome(home.dir, "cell"))).toEqual(["config.json"]);
      expect(existsSync(path.join(real, "auth.json"))).toBe(false);
    } finally {
      home.remove();
    }
  });
});

describe("a task cell's data folder", () => {
  it("is a fresh folder inside the run's home holding only the run's config", () => {
    const home = createTempHome(path.join(real, "config.json"));
    try {
      const first = createTaskHome(home.dir, "agent-retail-01-1");
      const second = createTaskHome(home.dir, "agent-retail-01-1");

      expect(first).not.toBe(second);
      expect(path.dirname(first)).toBe(path.join(home.dir, "tasks"));
      expect(readdirSync(first)).toEqual(["config.json"]);
      expect(JSON.parse(readFileSync(path.join(first, "config.json"), "utf8"))).toEqual({ marker: "developer" });
      expect(withDataDir(first, () => configPath())).toBe(path.join(first, "config.json"));
    } finally {
      home.remove();
    }
  });
});
