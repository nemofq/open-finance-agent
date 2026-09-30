import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig, type ModelRef } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { testModel } from "@/lib/llm/test-model";
import { draftModels } from "@/lib/llm/models";
import { providerDefinition } from "@/lib/llm/providers";
import { createSession } from "@/lib/sessions/store";
import { getSkill } from "@/lib/skills/loader";
import { resolveTimeContext } from "@/lib/time";
import { createAgent } from "./testing";
import { turnPrompt } from "./turn";

/**
 * End-to-end smoke of the wired agent: a real model, the EDGAR module's tools, and a skill
 * invocation. Off by default; run with `OFA_LIVE_TESTS=1` plus the keys of the providers to cover:
 * `OPENROUTER_API_KEY_TEST` for OpenRouter, and `CUSTOM_LLM_URL`, `CUSTOM_LLM_API_KEY` (optional)
 * and `CUSTOM_LLM_AVAILABLE` (comma-separated model ids; the first is used) for a custom endpoint.
 */
const openRouterKey = process.env.OPENROUTER_API_KEY_TEST;
const customUrl = process.env.CUSTOM_LLM_URL;
const customModel = process.env.CUSTOM_LLM_AVAILABLE?.split(",")[0]?.trim();
const liveIf = (ready: unknown) => (process.env.OFA_LIVE_TESTS && ready ? describe : describe.skip);

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-live-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  delete process.env.OFA_HOME;
});

/** Save a config whose only provider is `provider`, with EDGAR on and `model` as the default. */
function saveConfig(provider: LlmProviderConfig, model: ModelRef): AppConfig {
  const config = defaultConfig();
  config.llm = { ...config.llm, providers: [provider], defaultModel: model };
  config.modules.edgar = { enabled: true, contact: "Open Finance Agent dev-test@example.com" };
  writeConfig(config);
  return config;
}

/** Ask an EDGAR question on the session's model and return the tools called and the final message. */
async function askEdgar(config: AppConfig, model: ModelRef) {
  const session = await createSession({ model });
  const agent = await createAgent({ config, session, time: resolveTimeContext() });
  const toolsCalled: string[] = [];
  agent.subscribe(async (event) => {
    if (event.type === "tool_execution_start") toolsCalled.push(event.toolName);
  });

  await agent.prompt("What was $MSFT's quarterly revenue over the last 4 quarters? Use EDGAR data.");
  await agent.waitForIdle();
  return { agent, toolsCalled, last: agent.state.messages.at(-1) };
}

liveIf(openRouterKey)("agent with EDGAR tools on OpenRouter", () => {
  it("answers a revenue question by calling edgar_financials", async () => {
    const model = { provider: "openrouter", model: "openai/gpt-4o-mini" };
    const provider = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: openRouterKey! } as const;
    const config = saveConfig(provider, model);

    const { agent, toolsCalled, last } = await askEdgar(config, model);
    expect(last?.role).toBe("assistant");
    expect(toolsCalled).toContain("edgar_financials");
    expect(JSON.stringify(last)).toMatch(/\$MSFT/);
    expect(agent.state.systemPrompt).toContain("earnings-preview");
  }, 120_000);

  it("prepends a skill body on /skill invocation", async () => {
    const turn = turnPrompt({ text: "$AAPL", skill: await getSkill("earnings-preview"), timestamp: 0 });
    const prompt = typeof turn === "string" ? turn : turn.role === "skill" ? turn.prompt : "";
    expect(prompt).toContain('<skill name="earnings-preview">');
    expect(prompt).toContain("$AAPL");
    expect(turnPrompt({ text: "hi", skill: await getSkill("nope"), timestamp: 0 })).toBe("hi");
  });
});

liveIf(customUrl && customModel)("agent on a custom OpenAI-compatible endpoint", () => {
  const provider: LlmProviderConfig = {
    id: "custom",
    type: "openai-compatible",
    name: "Custom",
    apiKey: process.env.CUSTOM_LLM_API_KEY ?? "",
    baseUrl: customUrl!,
    models: [{ id: customModel! }],
  };
  const model = { provider: provider.id, model: customModel! };

  it("validates the endpoint and lists the model", async () => {
    const validation = await providerDefinition(provider).validate(provider, draftModels(provider));
    expect(validation.ok, validation.error).toBe(true);
    expect(validation.models?.map((info) => info.id)).toContain(customModel);
  }, 30_000);

  it("replies to a test prompt", async () => {
    const result = await testModel(provider, customModel!);
    expect(result.ok, result.error).toBe(true);
    expect(result.reply).not.toBe("");
  }, 90_000);

  it("answers a revenue question by calling an EDGAR tool", async () => {
    const { toolsCalled, last } = await askEdgar(saveConfig(provider, model), model);
    expect(last?.role).toBe("assistant");
    expect(toolsCalled.some((name) => name.startsWith("edgar_"))).toBe(true);
  }, 180_000);
});
