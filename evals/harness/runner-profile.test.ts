import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckRecord } from "@/lib/policy/types";
import { type AppConfig, defaultConfig } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { formatProfileForPrompt } from "@/lib/profile/prompt";
import { readProfile } from "@/lib/profile/store";
import type { InvestorProfile } from "@/lib/profile/types";
import { withModulesOff } from "@/lib/tools/testing";
import { AgentConfigError } from "@/lib/agent/config-error";
import { runTask } from "./runner";
import { PROFILE_PROMPTS_DIR } from "./seed";
import { RETAIL_EVAL_TASKS } from "../tasks";

/**
 * The real turn runs as far as the built agent, which is recorded with the profile the task seeded
 * and the checks its `beforeTurn` made, and then the turn is refused so no model is ever called.
 */
const built: { systemPrompt: string; profile: InvestorProfile | null; checks: CheckRecord[] }[] = [];
vi.mock("@/lib/agent/factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/factory")>();
  return {
    ...actual,
    buildAgent: async (options: Parameters<typeof actual.buildAgent>[0]) => {
      const agent = await actual.buildAgent(options);
      await agent.composed.beforeTurn(agent.agent.state.messages);
      built.push({ systemPrompt: agent.agent.state.systemPrompt, profile: await readProfile(), checks: agent.turn.checks });
      throw new AgentConfigError("recorded", "images_unsupported");
    },
  };
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-eval-profile-"));
  process.env.OFA_HOME = home;
  built.length = 0;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

function testConfig(): AppConfig {
  const config = defaultConfig();
  config.llm.providers = [
    { id: "test-provider", type: "openai-compatible", name: "Test Provider", apiKey: "", baseUrl: "http://127.0.0.1:9999/v1", models: [{ id: "test-model" }] },
  ];
  config.llm.defaultModel = { provider: "test-provider", model: "test-model" };
  withModulesOff(config);
  writeConfig(config);
  return config;
}

describe("a task with a frozen profile text", () => {
  const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === "retail-12-concentration-profile-fit");
  if (!task?.profile || !task.profilePrompt) throw new Error("retail-12 declares a profile and its frozen text");

  it("carries the file's text verbatim in place of the app's rendering, and still seeds the profile P12 reads", async () => {
    const agent = { provider: "test-provider", model: "test-model" };
    await runTask({ config: testConfig(), task, agent, judge: agent, repeat: 1, fixtureMode: "offline", policyMode: "enforce" });

    expect(built).toHaveLength(1);
    const [{ systemPrompt, profile, checks }] = built;
    const frozen = readFileSync(path.join(PROFILE_PROMPTS_DIR, task.profilePrompt as string), "utf8");
    const block = frozen.replace(/\n$/, "");
    expect(block.endsWith("\n")).toBe(false);
    expect(systemPrompt.split(block)).toHaveLength(2);
    if (!profile) throw new Error("the task's profile was not seeded");
    const rendered = formatProfileForPrompt(profile);
    if (rendered !== block) expect(systemPrompt).not.toContain(rendered);
    // The leveraged-ETF request falls outside the seeded allowed instruments.
    expect(checks.map((check) => check.rule)).toContain("P12");
  }, 60_000);
});
