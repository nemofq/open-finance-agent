import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";
import { withModulesOff } from "@/lib/tools/testing";
import { writeConfig } from "@/lib/config/store";
import { configPath, dataDir, portfolioDir, withDataDir } from "@/lib/paths";
import { createPortfolioStore } from "@/lib/portfolio/store";
import { readProfile } from "@/lib/profile/store";
import { runBenchmark, runTask } from "./runner";
import { configHash } from "../reporting/summary";
import { EVAL_TRANSIENT_PROVIDER_RETRIES } from "./turn-bounds";
import { RETAIL_EVAL_TASKS } from "../tasks";

/**
 * Offline by design: the provider points at a port nothing listens on, so the run fails at the
 * model call and the harness has to report that cleanly rather than throw.
 */

let home: string;

/**
 * The transient-retry backoff (1 s doubling per retry) is about a minute of real waiting against a
 * dead endpoint. These tests collapse exactly those delays to zero and record them, so the schedule
 * itself is asserted without the suite sleeping through it. Every other timer runs unchanged.
 */
const BACKOFF_DELAYS_MS = new Set(Array.from({ length: EVAL_TRANSIENT_PROVIDER_RETRIES }, (_, retry) => 1_000 * 2 ** retry));
let backoffWaits: number[];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-eval-runner-"));
  process.env.OFA_HOME = home;
  backoffWaits = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms !== undefined && BACKOFF_DELAYS_MS.has(ms)) {
      backoffWaits.push(ms);
      return realSetTimeout(handler, 0, ...args);
    }
    return realSetTimeout(handler, ms, ...args);
  }) as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

function testConfig(): AppConfig {
  const config = defaultConfig();
  config.llm.providers = [
    {
      id: "test-provider",
      type: "openai-compatible",
      name: "Test Provider",
      apiKey: "test-key-not-a-real-secret",
      baseUrl: "http://127.0.0.1:9999/v1",
      models: [{ id: "test-model" }],
    },
  ];
  config.llm.defaultModel = { provider: "test-provider", model: "test-model" };
  withModulesOff(config);
  writeConfig(config);
  return config;
}

describe("runTask", () => {
  it("retries transient connection failures and excludes exhausted provider outages from model scores", async () => {
    const config = testConfig();
    const agent = { provider: "test-provider", model: "test-model" };

    const summary = await runBenchmark({
      config,
      agents: [agent],
      judge: agent,
      tasks: [RETAIL_EVAL_TASKS[0]],
      repeat: 1,
      fixtureMode: "offline",
      policyMode: "enforce",
    });

    const outcome = summary.results[0];
    expect(outcome.task.id).toBe("retail-01-nvda-beat-and-drop");
    expect(outcome.agent).toBe("test-provider/test-model");
    expect(outcome.error).toBeDefined();
    expect(outcome.deterministicCheck.maxScore).toBe(40);
    expect(outcome.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    // A provider connection outage is retried, then retained as an unscored
    // infrastructure failure rather than being attributed to the model.
    expect(outcome.status).toBe("infra_error");
    expect(outcome.valid).toBe(false);
    // Six retries backing off 1, 2, 4, 8, 16, 32 s: about a minute before the cell is given up.
    expect(outcome.providerRetries).toBe(6);
    expect(backoffWaits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(backoffWaits.reduce((total, ms) => total + ms, 0)).toBe(63_000);
    expect(outcome.totalScore).toBeUndefined();
    expect(outcome.judgeResult).toBeUndefined();
    expect(summary.agentSummaries[0].infrastructureErrors).toBe(1);
    expect(summary.agentSummaries[0].perTask[0].runs).toBe(0);
  }, 60_000);

  it("keeps the run inside the temporary data folder", async () => {
    const config = testConfig();
    const agent = { provider: "test-provider", model: "test-model" };
    await runTask({
      config,
      task: RETAIL_EVAL_TASKS[0],
      agent,
      judge: agent,
      repeat: 1,
      fixtureMode: "offline",
      policyMode: "enforce",
    });

    expect(process.env.OFA_HOME).toBe(home);
  }, 60_000);

  it("gives every task its own data folder, so no profile or holdings carry into the next", async () => {
    const config = testConfig();
    const agent = { provider: "test-provider", model: "test-model" };
    const withUserData = RETAIL_EVAL_TASKS.find((task) => task.id === "retail-12-concentration-profile-fit");
    if (!withUserData) throw new Error("missing profile fixture");

    await runBenchmark({
      config,
      agents: [agent],
      judge: agent,
      tasks: [withUserData, RETAIL_EVAL_TASKS[0]],
      repeat: 1,
      fixtureMode: "offline",
      policyMode: "enforce",
    });

    // Each cell's folder holds its own seeded user data and nothing of the other's.
    const cells = readdirSync(path.join(home, "tasks")).map((name) => path.join(home, "tasks", name));
    expect(cells).toHaveLength(2);
    const [profiled, plain] = await Promise.all(["retail-12", "retail-01"].map((prefix) => {
      const dir = cells.find((cell) => path.basename(cell).includes(prefix));
      if (!dir) throw new Error(`no folder for ${prefix}`);
      return withDataDir(dir, async () => ({
        profile: await readProfile(),
        accounts: await createPortfolioStore(portfolioDir()).listAccounts(),
        config: existsSync(configPath()),
      }));
    }));
    expect(profiled.profile).not.toBeNull();
    expect(profiled.accounts.length).toBeGreaterThan(0);
    expect(plain.profile).toBeNull();
    expect(plain.accounts).toEqual([]);
    expect(profiled.config && plain.config).toBe(true);
    // The run's own folder never held either task's user data.
    expect(await readProfile()).toBeNull();
    expect(dataDir()).toBe(home);
  }, 60_000);
});

describe("configHash", () => {
  it("is stable for the same settings and blind to the API key", () => {
    const first = defaultConfig();
    first.llm.providers = [{ id: "openrouter", type: "openrouter", name: "P", apiKey: "key-one" }];
    const second = structuredClone(first);
    second.llm.providers = [{ id: "openrouter", type: "openrouter", name: "P", apiKey: "key-two" }];

    expect(configHash(first)).toBe(configHash(second));
  });

  it("changes when a setting changes", () => {
    const first = defaultConfig();
    const second = structuredClone(first);
    second.llm.thinkingLevel = first.llm.thinkingLevel === "off" ? "high" : "off";
    expect(configHash(first)).not.toBe(configHash(second));
  });
});
