import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "@/lib/sessions/store";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { offlineContext } from "@/lib/tools/testing";
import { createScheduledRun, getScheduledTask } from "./store";
import { scheduledModule } from "./tool";
import type { ScheduledTask } from "./types";

const schedule = { kind: "recurring", dtStartLocal: "2026-04-02T09:00", timeZone: "UTC", rrule: "FREQ=DAILY" };

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-scheduled-tool-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function tools(extra: Partial<ModuleContext> = {}): Promise<Map<string, FinanceTool>> {
  const built = await scheduledModule.createTools({}, offlineContext(extra));
  return new Map(built.map((tool) => [tool.name, tool]));
}

async function call(tool: FinanceTool | undefined, params: Record<string, unknown>) {
  if (!tool) throw new Error("tool not built");
  return tool.execute("call-1", params);
}

describe("scheduled task tool definitions", () => {
  // The model sees these names, descriptions and JSON Schemas; any change to shape, descriptions
  // or required fields must show up here as a reviewed diff.
  it("keep what the model receives", async () => {
    const interactive = await tools({ session: { id: "chat" } });
    const scheduled = await tools({ turn: { kind: "scheduled", taskId: "task" } });
    const definitions = [...interactive.values(), ...scheduled.values()].map(({ name, label, description, parameters }) => ({ name, label, description, parameters }));
    await expect(`${JSON.stringify(definitions, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/tool-definitions.json");
  });
});

describe("scheduled task tools", () => {
  it("continue the current chat by default and edit a task without storing the call's own fields", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const built = await tools({ session: { id: chat.id } });
    const created = (await call(built.get("scheduled_task_create"), { title: "Morning check", prompt: "Check AAPL", schedule })).details as ScheduledTask;
    expect(created.destination).toEqual({ type: "chat", sessionId: chat.id });

    const updated = await call(built.get("scheduled_task_update"), { taskId: created.id, title: "Evening check" });
    expect(updated.content[0]).toMatchObject({ text: expect.stringContaining("Evening check") });
    expect(await getScheduledTask(created.id)).not.toHaveProperty("taskId");
  });

  it("throw the service's refusal as the tool error", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const built = await tools({ session: { id: chat.id } });
    const gone = { type: "chat", sessionId: "00000000-0000-4000-8000-000000000000" };
    await expect(call(built.get("scheduled_task_create"), { title: "T", prompt: "P", schedule, destination: gone })).rejects.toThrow("The selected chat no longer exists");

    const task = (await call(built.get("scheduled_task_create"), { title: "T", prompt: "P", schedule })).details as ScheduledTask;
    await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: new Date().toISOString(), status: "running" });
    await expect(call(built.get("scheduled_task_delete"), { taskId: task.id })).rejects.toThrow("Pause the task");
  });

  it("let a scheduled run pause only its own task", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const task = ((await call((await tools({ session: { id: chat.id } })).get("scheduled_task_create"), { title: "T", prompt: "P", schedule })).details) as ScheduledTask;
    const own = await tools({ turn: { kind: "scheduled", taskId: task.id } });
    expect([...own.keys()]).toEqual(["scheduled_task_pause_self"]);
    const other = await call(own.get("scheduled_task_pause_self"), { taskId: "00000000-0000-4000-8000-000000000000" });
    expect(other.content[0]).toMatchObject({ text: "A scheduled run may pause only its own task." });
    await call(own.get("scheduled_task_pause_self"), { taskId: task.id });
    expect((await getScheduledTask(task.id))?.status).toBe("paused");
  });
});
