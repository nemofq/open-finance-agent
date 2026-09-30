import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig, type ModelRef } from "@/lib/config/schema";
import { readConfig, writeConfig } from "@/lib/config/store";
import { scheduledTasksDir } from "@/lib/paths";
import { createScheduledTask, getScheduledTask } from "@/lib/scheduled/store";
import { createSession, getSession } from "@/lib/sessions/store";
import { rewriteRenamedModels } from "./model-rewrite";
import { catalogModel } from "./providers/pi-backed";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-model-rewrite-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const providers: LlmProviderConfig[] = [
  { id: "deepseek", type: "deepseek", name: "DeepSeek", apiKey: "sk-ds" },
  { id: "opencode", type: "opencode", name: "OpenCode Zen", apiKey: "sk-oc" },
  { id: "openai-codex", type: "openai-codex", name: "ChatGPT", apiKey: "", auth: "oauth" },
  // An endpoint names its own models: an id that happens to match a renamed pi model is its own.
  {
    id: "lab-a1b2",
    type: "openai-compatible",
    name: "Lab",
    apiKey: "",
    baseUrl: "https://llm.example.com/v1",
    models: [{ id: "deepseek-v4-flash" }],
  },
];

function saveConfig(defaultModel: ModelRef | null): AppConfig {
  const config = defaultConfig();
  config.llm.providers = providers;
  config.llm.defaultModel = defaultModel;
  writeConfig(config);
  return readConfig();
}

async function standalone(title: string, model: ModelRef) {
  return createScheduledTask({
    title,
    prompt: "Check AAPL",
    destination: { type: "standalone", model },
    schedule: { kind: "once", runAt: "2099-01-01T09:00:00Z", timeZone: "UTC" },
  });
}

async function taskModel(id: string): Promise<ModelRef | undefined> {
  const destination = (await getScheduledTask(id))?.destination;
  return destination?.type === "standalone" ? destination.model : undefined;
}

describe("rewriteRenamedModels", () => {
  it("moves the default model and standalone tasks to the successor, with one notice naming both prices", async () => {
    const config = saveConfig({ provider: "deepseek", model: "deepseek-v4-flash" });
    const brief = await standalone("Brief", { provider: "deepseek", model: "deepseek-v4-flash-vision-exp" });
    const free = await standalone("Free", { provider: "opencode", model: "mimo-v2.5-free" });

    await rewriteRenamedModels(config);

    const saved = readConfig();
    expect(saved.llm.defaultModel).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(await taskModel(brief.id)).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(await taskModel(free.id)).toEqual({ provider: "opencode", model: "mimo-v2.6-flash-free" });

    const flash = catalogModel("deepseek", "deepseek-flash");
    const mimo = catalogModel("opencode", "mimo-v2.6-flash-free");
    expect(saved.llm.modelNotices).toHaveLength(3);
    expect(saved.llm.modelNotices).toEqual(expect.arrayContaining([
      {
        provider: "DeepSeek",
        from: { name: "DeepSeek V4 Flash Vision Exp", pricing: { input: 0.14, output: 0.28 } },
        to: { name: flash?.name, pricing: flash?.pricing },
        uses: ["the scheduled task “Brief”"],
      },
      {
        provider: "OpenCode Zen",
        from: { name: "MiMo V2.5 Free", pricing: { input: 0, output: 0 } },
        to: { name: mimo?.name, pricing: mimo?.pricing },
        uses: ["the scheduled task “Free”"],
      },
      {
        provider: "DeepSeek",
        from: { name: "DeepSeek V4 Flash", pricing: { input: 0.14, output: 0.28 } },
        to: { name: flash?.name, pricing: flash?.pricing },
        uses: ["the default model"],
      },
    ]));
    // The successor costs more, which is what the notice exists to say.
    expect(flash?.pricing).not.toEqual({ input: 0.14, output: 0.28 });
  });

  it("groups every ref moved from one model into one notice", async () => {
    const config = saveConfig({ provider: "deepseek", model: "deepseek-v4-flash" });
    await standalone("Brief", { provider: "deepseek", model: "deepseek-v4-flash" });

    await rewriteRenamedModels(config);

    expect(readConfig().llm.modelNotices?.map((notice) => notice.uses)).toEqual([
      ["the scheduled task “Brief”", "the default model"],
    ]);
  });

  it("leaves retired models, unknown ids, endpoint models and started chats alone", async () => {
    const config = saveConfig({ provider: "openai-codex", model: "gpt-5.4" });
    const unknown = await standalone("Unknown", { provider: "deepseek", model: "deepseek-v9" });
    const endpoint = await standalone("Endpoint", { provider: "lab-a1b2", model: "deepseek-v4-flash" });
    const chat = await createSession({ model: { provider: "deepseek", model: "deepseek-v4-flash" } });

    await rewriteRenamedModels(config);

    expect(readConfig()).toEqual(config);
    expect(await taskModel(unknown.id)).toEqual({ provider: "deepseek", model: "deepseek-v9" });
    expect(await taskModel(endpoint.id)).toEqual({ provider: "lab-a1b2", model: "deepseek-v4-flash" });
    expect((await getSession(chat.id))?.model).toEqual({ provider: "deepseek", model: "deepseek-v4-flash" });
  });

  // A read-only folder refuses the write only where permissions hold: not for root, not on Windows.
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")("saves the notice before moving a task, and moves it at the next start without repeating it", async () => {
    const config = saveConfig(null);
    const brief = await standalone("Brief", { provider: "deepseek", model: "deepseek-v4-flash" });
    const uses = () => readConfig().llm.modelNotices?.map((notice) => notice.uses);

    // A task file that cannot be written: the move fails after the config is saved.
    chmodSync(scheduledTasksDir(), 0o555);
    try {
      await expect(rewriteRenamedModels(config)).rejects.toThrow();
    } finally {
      chmodSync(scheduledTasksDir(), 0o755);
    }
    expect(uses()).toEqual([["the scheduled task “Brief”"]]);
    expect(await taskModel(brief.id)).toEqual({ provider: "deepseek", model: "deepseek-v4-flash" });

    await rewriteRenamedModels(readConfig());

    expect(await taskModel(brief.id)).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(uses()).toEqual([["the scheduled task “Brief”"]]);
  });

  it("keeps earlier notices and adds none on a second start", async () => {
    await rewriteRenamedModels(saveConfig({ provider: "deepseek", model: "deepseek-v4-flash" }));
    const once = readConfig();

    await rewriteRenamedModels(once);

    expect(readConfig()).toEqual(once);
    expect(once.llm.modelNotices).toHaveLength(1);
  });
});
