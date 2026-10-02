import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppConfig, defaultConfig, thinkingLevels } from "@/lib/config/schema";
import { modelRefKey } from "@/lib/llm/catalog";
import { baselinePreflight, type CliOptions, parseArgs, selectTasks } from "./cli";
import { parseModelSpec, resolveModelSpec, thinkingTransmitted } from "./models";
import { RETAIL_EVAL_TASKS } from "./tasks";

function options(argv: string[]): CliOptions {
  const parsed = parseArgs(argv);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.options;
}

function configWith(...providerIds: string[]): AppConfig {
  const config = defaultConfig();
  config.llm.providers = providerIds.map((id) => ({
    id,
    type: "openai-compatible" as const,
    name: id,
    apiKey: "",
    baseUrl: "http://127.0.0.1:9999/v1",
    models: [],
  }));
  return config;
}

describe("parseArgs", () => {
  it("defaults to the offline dataset, one repeat and enforce mode", () => {
    const parsed = options(["--agent", "prov/model-a", "--judge", "prov/model-b"]);
    expect(parsed.fixtures).toBe("offline");
    expect(parsed.repeat).toBe(1);
    expect(parsed.observe).toBe(false);
    expect(parsed.keep).toBe(false);
    expect(parsed.agents).toEqual(["prov/model-a"]);
    expect(parsed.judge).toBe("prov/model-b");
  });

  it("takes several agents as a comma list or repeated flags", () => {
    expect(options(["--agent", "p/a,p/b"]).agents).toEqual(["p/a", "p/b"]);
    expect(options(["--agent", "p/a", "--agent", "p/b"]).agents).toEqual(["p/a", "p/b"]);
  });

  it("collects repeated --task and comma lists", () => {
    const parsed = options(["--task", "retail-01-nvda-beat-and-drop,retail-02-nike-moat-erosion", "--task", "retail-03-nuclear-thematic-purity"]);
    expect(parsed.taskIds).toHaveLength(3);
  });

  it("reads the remaining options", () => {
    const parsed = options([
      "--repeat",
      "3",
      "--fixtures",
      "record",
      "--config",
      "/tmp/config.json",
      "--out",
      "/tmp/out",
      "--baseline",
      "2026-09-20-a-b",
      "--observe",
      "--keep",
    ]);
    expect(parsed).toMatchObject({
      repeat: 3,
      fixtures: "record",
      configPath: "/tmp/config.json",
      outDir: "/tmp/out",
      baseline: "2026-09-20-a-b",
      observe: true,
      keep: true,
    });
  });

  it("names the offline dataset mode offline", () => {
    expect(options(["--fixtures", "offline"]).fixtures).toBe("offline");
    for (const removed of ["sandbox", "replay", "extend"]) expect(parseArgs(["--fixtures", removed])).toMatchObject({ ok: false });
  });

  it("rejects a bad fixture mode, a bad repeat and an unknown flag", () => {
    expect(parseArgs(["--fixtures", "sometimes"])).toMatchObject({ ok: false });
    expect(parseArgs(["--repeat", "0"])).toMatchObject({ ok: false });
    expect(parseArgs(["--repeat", "two"])).toMatchObject({ ok: false });
    expect(parseArgs(["--nope"])).toMatchObject({ ok: false });
  });

  it("rejects a flag whose value is missing or is another flag", () => {
    expect(parseArgs(["--agent"])).toMatchObject({ ok: false });
    expect(parseArgs(["--agent", "--judge", "p/m"])).toMatchObject({ ok: false });
  });

  it("takes every pi-ai thinking level for the agent and, separately, the judge", () => {
    for (const level of thinkingLevels) {
      expect(options(["--thinking", level]).thinking).toBe(level);
      expect(options(["--judge-thinking", level]).judgeThinking).toBe(level === "off" ? undefined : level);
    }
    const parsed = options(["--thinking", "max", "--judge-thinking", "xhigh"]);
    expect(parsed).toMatchObject({ thinking: "max", judgeThinking: "xhigh" });
    expect(options([]).judgeThinking).toBeUndefined();
    expect(parseArgs(["--thinking", "extreme"])).toMatchObject({ ok: false, error: expect.stringContaining("off, minimal, low") });
    expect(parseArgs(["--judge-thinking", "extreme"])).toMatchObject({ ok: false, error: expect.stringContaining("--judge-thinking") });
    expect(parseArgs(["--judge-thinking"])).toMatchObject({ ok: false });
  });

  it("reads --judge-thinking off as no flag, since both send the judge nothing", () => {
    expect(options(["--judge-thinking", "off"])).not.toHaveProperty("judgeThinking");
  });

  it("leaves the judge thinking of a --judge-only run to the run itself", () => {
    expect(parseArgs(["--judge-only", "run.json", "--judge-thinking", "high"])).toMatchObject({ ok: false });
  });

  it("accepts local rescoring without models and refuses incompatible scoring flags", () => {
    expect(options(["--rescore", "old-run.json", "--out", "/tmp/rescored"])).toMatchObject({
      rescore: "old-run.json", outDir: "/tmp/rescored",
    });
    expect(parseArgs(["--rescore"])).toMatchObject({ ok: false });
    for (const flags of [["--agent", "p/a"], ["--judge", "p/j"], ["--judge-only", "run.json"], ["--baseline", "b"]]) {
      expect(parseArgs(["--rescore", "old-run.json", ...flags])).toMatchObject({ ok: false });
    }
  });

  it("recognises --list, --list-models and --help without any model", () => {
    expect(options(["--list"]).list).toBe(true);
    expect(options(["--list-models"]).listModels).toBe(true);
    expect(options(["--help"]).help).toBe(true);
    expect(options(["-h"]).help).toBe(true);
  });
});

describe("selectTasks", () => {
  it("runs the whole suite when nothing is filtered", () => {
    const selected = selectTasks(options([]));
    expect(selected.ok && selected.tasks).toHaveLength(RETAIL_EVAL_TASKS.length);
  });

  it("filters by id, in suite order", () => {
    const selected = selectTasks(options(["--task", "retail-05-intel-value-trap,retail-01-nvda-beat-and-drop"]));
    expect(selected.ok && selected.tasks.map((task) => task.id)).toEqual(["retail-01-nvda-beat-and-drop", "retail-05-intel-value-trap"]);
  });

  it("names an unknown id", () => {
    expect(selectTasks(options(["--task", "retail-99"]))).toMatchObject({ ok: false });
    expect(parseArgs(["--category", "value_trap"])).toMatchObject({ ok: false });
  });
});

describe("model specs", () => {
  it("splits at the first slash, so a model id may contain slashes", () => {
    expect(parseModelSpec("local/Qwen/Qwen3-32B")).toEqual({ provider: "local", model: "Qwen/Qwen3-32B" });
    expect(parseModelSpec("openrouter/openai/gpt-5")).toEqual({ provider: "openrouter", model: "openai/gpt-5" });
    expect(parseModelSpec(" local/my-model ")).toEqual({ provider: "local", model: "my-model" });
  });

  it("rejects a spec with no provider or no model", () => {
    expect(parseModelSpec("gpt-5")).toBeNull();
    expect(parseModelSpec("/gpt-5")).toBeNull();
    expect(parseModelSpec("openrouter/")).toBeNull();
  });

  it("round-trips through the catalog's model key", () => {
    const ref = parseModelSpec("local/Qwen/Qwen3-32B");
    expect(ref && modelRefKey(ref)).toBe("local/Qwen/Qwen3-32B");
  });

  it("checks the provider against the config", () => {
    const config = configWith("local");
    expect(resolveModelSpec(config, "local/Qwen/Qwen3-32B")).toMatchObject({
      ok: true,
      ref: { provider: "local" },
    });
    const missing = resolveModelSpec(config, "nowhere/model");
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain("local");
  });
});

describe("--baseline preflight", () => {
  const agent = { provider: "p", model: "agent" };
  const judge = { provider: "q", model: "judge" };

  it("lets a repeated, independently judged run through", () => {
    expect(baselinePreflight(options(["--baseline", "b", "--repeat", "3"]), [agent], judge)).toBeUndefined();
    expect(baselinePreflight(options(["--repeat", "1"]), [agent], agent)).toBeUndefined();
  });

  it("refuses a run that is not against the offline dataset before it starts", () => {
    expect(baselinePreflight(options(["--baseline", "b", "--repeat", "3", "--fixtures", "live"]), [agent], judge)).toContain("fixture mode live");
  });

  it("refuses a single-repeat run before it starts", () => {
    expect(baselinePreflight(options(["--baseline", "b"]), [agent], judge)).toContain("needs --repeat 2 or more");
  });

  it("refuses a self-judged run, including when only one of several agents is the judge", () => {
    expect(baselinePreflight(options(["--baseline", "b", "--repeat", "3"]), [judge], judge)).toContain("self-judged");
    expect(baselinePreflight(options(["--baseline", "b", "--repeat", "3"]), [agent, judge], judge)).toContain("self-judged");
  });
});

describe("thinkingTransmitted", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ofa-eval-thinking-"));
    process.env.OFA_HOME = home;
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.OFA_HOME;
  });

  const config = (): AppConfig => {
    const base = defaultConfig();
    base.llm.providers = [
      {
        id: "local",
        type: "openai-compatible",
        name: "Local",
        apiKey: "",
        baseUrl: "http://127.0.0.1:9999/v1",
        models: [
          { id: "Qwen/Qwen3-32B", reasoning: true, thinking: { levels: { high: "xhigh" }, off: "chat-template" } },
          { id: "plain", reasoning: true },
          { id: "no-thinking" },
          { id: "deep", reasoning: true, thinking: { levels: { xhigh: "very-high" } } },
        ],
      },
      { id: "anthropic", type: "anthropic", name: "Anthropic", apiKey: "sk-ant", auth: "api_key" },
    ];
    return base;
  };
  const agents = [
    { provider: "local", model: "Qwen/Qwen3-32B" },
    { provider: "local", model: "plain" },
    { provider: "local", model: "no-thinking" },
    { provider: "anthropic", model: "claude-opus-4-7" },
  ];

  it("records the value sent for the level after the declared level names", async () => {
    expect(await thinkingTransmitted(config(), agents, "high")).toEqual({
      "local/Qwen/Qwen3-32B": 'high → "xhigh"',
      "local/plain": 'high → "high"',
      "local/no-thinking": "high → not sent (model not marked for reasoning)",
      "anthropic/claude-opus-4-7": "high",
    });
    expect((await thinkingTransmitted(config(), agents, "medium"))["local/Qwen/Qwen3-32B"]).toBe('medium → "medium"');
  });

  it("records the level pi-ai clamps an unoffered level to, and a hosted model's catalog value", async () => {
    const sent = await thinkingTransmitted(config(), [...agents, { provider: "local", model: "deep" }], "max");
    expect(sent["local/plain"]).toBe('max → high → "high"');
    expect(sent["local/deep"]).toBe('max → xhigh → "very-high"');
    expect(sent["anthropic/claude-opus-4-7"]).toBe('max → "max"');
    expect((await thinkingTransmitted(config(), agents, "minimal"))["local/plain"]).toBe('minimal → "minimal"');
  });

  it("says why a model it cannot resolve was not described", async () => {
    const sent = await thinkingTransmitted(config(), [{ provider: "local", model: "gone" }], "high");
    expect(sent["local/gone"]).toBe("high → not resolved: model_missing");
  });

  it("records how Off was sent", async () => {
    const sent = await thinkingTransmitted(config(), agents, "off");
    expect(sent["local/Qwen/Qwen3-32B"]).toBe("off → chat-template");
    expect(sent["local/plain"]).toBe("off → omit");
  });
});
