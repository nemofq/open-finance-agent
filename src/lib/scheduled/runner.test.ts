import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnInput } from "@/lib/agent/turn-types";
import { defaultConfig, type LlmProviderConfig, type ModelRef } from "@/lib/config/schema";
import { readConfig, writeConfig } from "@/lib/config/store";
import { rewriteRenamedModels } from "@/lib/llm/model-rewrite";
import { authPath } from "@/lib/paths";
import { resetProcessSingletons } from "@/lib/process-state";
import { listSessions } from "@/lib/sessions/store";
import { queueManualRun, startScheduler } from "./runner";
import { createScheduledTask, getScheduledTask, listScheduledRuns } from "./store";

const runTurn = vi.hoisted(() =>
  vi.fn<(input: TurnInput) => Promise<object>>(async () => ({ finalText: "Done", usage: { input: 1, output: 1, cost: 0, calls: 1 } })),
);
vi.mock("@/lib/agent/turn", () => ({ runTurn }));

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-runner-"));
  process.env.OFA_HOME = home;
  resetProcessSingletons("scheduled.scheduler");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  runTurn.mockClear();
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const providers: LlmProviderConfig[] = [
  { id: "openai-codex", type: "openai-codex", name: "ChatGPT", apiKey: "", auth: "oauth" },
  { id: "deepseek", type: "deepseek", name: "DeepSeek", apiKey: "sk-ds" },
];

function setUp(): void {
  const config = defaultConfig();
  config.llm.providers = providers;
  config.modules = { python: { enabled: false } };
  writeConfig(config);
  const credential = { type: "oauth", access: "at", refresh: "rt", expires: Date.now() + 3_600_000 };
  writeFileSync(authPath(), JSON.stringify({ version: 1, credentials: { "openai-codex": credential } }));
}

async function standalone(model: ModelRef, runAt = "2099-01-01T09:00:00Z", now?: Date) {
  return createScheduledTask({
    title: "Brief",
    prompt: "Check AAPL",
    destination: { type: "standalone", model },
    schedule: { kind: "once", runAt, timeZone: "UTC" },
    now,
  });
}

/** Run the task now and wait for the run to end. */
async function runNow(taskId: string) {
  await startScheduler();
  const queued = await queueManualRun(taskId);
  return vi.waitFor(async () => {
    const run = (await listScheduledRuns(taskId)).runs.find((candidate) => candidate.id === queued?.id);
    if (!run || run.status === "queued" || run.status === "running") throw new Error("still running");
    return run;
  });
}

describe("a standalone task's model", () => {
  it("pauses a task on a retired model with the reason, before creating a chat", async () => {
    setUp();
    const task = await standalone({ provider: "openai-codex", model: "gpt-5.4" });

    const run = await runNow(task.id);

    expect(run).toMatchObject({ status: "failed", error: "ChatGPT does not offer gpt-5.4 any more. Edit the task to pick another model." });
    expect(run.sessionId).toBeUndefined();
    expect(await getScheduledTask(task.id)).toMatchObject({ status: "paused", lastRunStatus: "failed" });
    expect(await listSessions(undefined, true)).toEqual([]);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("leaves a one-off task that fired on a retired model completed, not paused", async () => {
    setUp();
    // Due since 2020, so the scan runs it and the store completes it with no next run.
    const task = await standalone({ provider: "openai-codex", model: "gpt-5.4" }, "2020-01-02T09:00:00Z", new Date("2020-01-01T00:00:00Z"));

    await startScheduler();
    const run = await vi.waitFor(async () => {
      const [latest] = (await listScheduledRuns(task.id)).runs;
      if (!latest || latest.status === "queued" || latest.status === "running") throw new Error("still running");
      return latest;
    });

    expect(run).toMatchObject({ trigger: "catch_up", status: "failed", error: expect.stringContaining("Edit the task") });
    expect(await getScheduledTask(task.id)).toMatchObject({ status: "completed", lastRunStatus: "failed" });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("runs a task on a renamed model on its successor once startup has moved it", async () => {
    setUp();
    const task = await standalone({ provider: "deepseek", model: "deepseek-v4-flash" });
    await rewriteRenamedModels(readConfig());

    const run = await runNow(task.id);

    expect(run.status).toBe("succeeded");
    expect(runTurn.mock.calls[0]?.[0].session.model).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect((await getScheduledTask(task.id))?.status).toBe("active");
  });
});
