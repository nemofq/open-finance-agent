import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultConfig, type ModelRef } from "@/lib/config/schema";
import { readConfig, writeConfig } from "@/lib/config/store";
import { configPath } from "@/lib/paths";
import { register } from "./instrumentation";

const { ensureSandbox, startScheduler } = vi.hoisted(() => ({ ensureSandbox: vi.fn(), startScheduler: vi.fn(async () => {}) }));

vi.mock("@/lib/sandbox", () => ({ ensureSandbox }));
vi.mock("@/lib/scheduled/runner", () => ({ startScheduler }));
vi.mock("@/lib/attachments/documents", () => ({ sweepStaging: vi.fn(async () => {}) }));

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-instrumentation-"));
  vi.stubEnv("OFA_HOME", home);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

it("starts the server on a config.json that is not valid JSON, logging why and skipping the calculator", async () => {
  writeFileSync(configPath(), '{ "version": 3, "llm": { "providers": [ }');
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(register()).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledWith("[config]", expect.stringContaining("is not valid JSON"));
  expect(ensureSandbox).not.toHaveBeenCalled();
});

it("moves the default model off a renamed model before the scheduler starts", async () => {
  const config = defaultConfig();
  config.llm.providers = [{ id: "deepseek", type: "deepseek", name: "DeepSeek", apiKey: "sk-ds" }];
  config.llm.defaultModel = { provider: "deepseek", model: "deepseek-v4-flash" };
  config.modules = { python: { enabled: false } };
  writeConfig(config);
  let seen: ModelRef | null = null;
  startScheduler.mockImplementationOnce(async () => {
    seen = readConfig().llm.defaultModel;
  });

  await register();

  expect(seen).toEqual({ provider: "deepseek", model: "deepseek-flash" });
});
