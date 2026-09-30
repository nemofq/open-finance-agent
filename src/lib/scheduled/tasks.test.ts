import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/store";
import { createSession, getSession } from "@/lib/sessions/store";
import { onTasksChanged } from "./events";
import { createScheduledRun, getScheduledTask, updateScheduledRun } from "./store";
import type { TaskInput, TaskPatch } from "./schema";
import { createTask, deleteTask, pauseTasksForSession, ScheduledTaskError, updateTask } from "./tasks";

const MISSING_CHAT = "00000000-0000-4000-8000-000000000000";
const schedule = { kind: "recurring", dtStartLocal: "2026-04-02T09:00", timeZone: "UTC", rrule: "FREQ=DAILY" } as const;

function input(destination: TaskInput["destination"]): TaskInput {
  return { title: "Morning check", prompt: "Check AAPL", destination, schedule };
}

async function refusal(promise: Promise<unknown>): Promise<ScheduledTaskError> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(ScheduledTaskError);
  return error as ScheduledTaskError;
}

describe("scheduled task service", () => {
  let home: string;
  let changes: number;
  let stopListening: () => void;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ofa-scheduled-tasks-"));
    process.env.OFA_HOME = home;
    const config = defaultConfig();
    // A hand-listed endpoint resolves from its list, so nothing here reaches the network.
    config.llm.providers = [{ id: "lab", type: "openai-compatible", name: "Lab", apiKey: "", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "qwen3" }] }];
    writeConfig(config);
    changes = 0;
    stopListening = onTasksChanged(() => changes++);
  });

  afterEach(() => {
    stopListening();
    delete process.env.OFA_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("creates a task on an existing chat and announces the change", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const task = await createTask(input({ type: "chat", sessionId: chat.id }));
    expect(task).toMatchObject({ title: "Morning check", status: "active", destination: { type: "chat", sessionId: chat.id } });
    expect(await getScheduledTask(task.id)).toEqual(task);
    expect(changes).toBe(1);
  });

  it("stores only the contract's fields, whatever else a caller sends", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const extra = { id: "not-an-id", nextRunAt: null, destination: { type: "chat", sessionId: chat.id, pinned: true } };
    const task = await createTask({ ...input({ type: "chat", sessionId: chat.id }), ...extra } as TaskInput);
    expect(task.id).not.toBe("not-an-id");
    expect(task.nextRunAt).not.toBeNull();
    expect(task.destination).toEqual({ type: "chat", sessionId: chat.id });

    const edited = await updateTask(task.id, { title: "Evening check", nextRunAt: null, lastRunStatus: "succeeded", createdAt: "1999-01-01" } as TaskPatch);
    expect(edited).toMatchObject({ title: "Evening check", nextRunAt: task.nextRunAt, createdAt: task.createdAt });
    expect(edited).not.toHaveProperty("lastRunStatus");
    expect(await getScheduledTask(task.id)).toEqual(edited);
  });

  it("refuses a chat that no longer exists", async () => {
    const error = await refusal(createTask(input({ type: "chat", sessionId: MISSING_CHAT })));
    expect(error.code).toBe("session_not_found");
    expect(changes).toBe(0);
  });

  it("stores a standalone model under the ids it resolved to, and refuses one that does not resolve", async () => {
    const task = await createTask(input({ type: "standalone", model: { provider: "lab", model: "qwen3" } }));
    expect(task.destination).toEqual({ type: "standalone", model: { provider: "lab", model: "qwen3" } });
    const error = await refusal(createTask(input({ type: "standalone", model: { provider: "gone", model: "qwen3" } })));
    expect(error.code).toBe("model_unavailable");
    expect(error.message).toContain("gone");
  });

  it("turns the store's validation into invalid_task", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const blank = await refusal(createTask({ ...input({ type: "chat", sessionId: chat.id }), title: "  " }));
    expect(blank).toMatchObject({ code: "invalid_task", message: "title is required" });
    const rrule = await refusal(createTask({ ...input({ type: "chat", sessionId: chat.id }), schedule: { ...schedule, rrule: "FREQ=SECONDLY" } }));
    expect(rrule.code).toBe("invalid_task");
  });

  it("updates and pauses a task, checking a new destination the same way", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const task = await createTask(input({ type: "chat", sessionId: chat.id }));
    expect(await updateTask(task.id, { title: "Evening check", status: "paused" })).toMatchObject({ title: "Evening check", status: "paused" });
    expect(changes).toBe(2);
    const error = await refusal(updateTask(task.id, { destination: { type: "chat", sessionId: MISSING_CHAT } }));
    expect(error.code).toBe("session_not_found");
    expect((await getScheduledTask(task.id))?.destination).toEqual({ type: "chat", sessionId: chat.id });
    expect(await updateTask(MISSING_CHAT, { status: "paused" })).toBeNull();
    expect(changes).toBe(2);
  });

  it("pauses the active tasks bound to a chat and tells the runner", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const other = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const bound = await createTask(input({ type: "chat", sessionId: chat.id }));
    const elsewhere = await createTask(input({ type: "chat", sessionId: other.id }));
    changes = 0;

    expect(await pauseTasksForSession(chat.id)).toBe(1);
    expect((await getScheduledTask(bound.id))?.status).toBe("paused");
    expect((await getScheduledTask(elsewhere.id))?.status).toBe("active");
    // The runner re-plans its timers on this; without it the paused task would still fire.
    expect(changes).toBe(1);

    expect(await pauseTasksForSession(chat.id)).toBe(0);
    expect(changes).toBe(1);
  });

  it("refuses to delete while a run is queued or running, then keeps the chats it made", async () => {
    const task = await createTask(input({ type: "standalone", model: { provider: "lab", model: "qwen3" } }));
    const made = await createSession({ model: { provider: "lab", model: "qwen3" }, visibility: "scheduled", scheduledOrigin: { taskId: task.id, runId: "r" } });
    const run = await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: new Date().toISOString(), status: "queued", sessionId: made.id });

    expect((await refusal(deleteTask(task.id))).code).toBe("run_in_progress");
    await updateScheduledRun(task.id, run.id, { status: "running" });
    expect((await refusal(deleteTask(task.id))).code).toBe("run_in_progress");
    expect(await getScheduledTask(task.id)).not.toBeNull();

    await updateScheduledRun(task.id, run.id, { status: "succeeded" });
    const before = changes;
    expect(await deleteTask(task.id)).toBe(true);
    expect(changes).toBe(before + 1);
    expect(await getScheduledTask(task.id)).toBeNull();
    expect(await getSession(made.id)).toMatchObject({ visibility: "recent" });
    expect(await deleteTask(task.id)).toBe(false);
  });
});
