import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onTasksChanged } from "@/lib/scheduled/events";
import { createScheduledRun, getScheduledTask, updateScheduledRun } from "@/lib/scheduled/store";
import type { ScheduledTask } from "@/lib/scheduled/types";
import { createSession } from "@/lib/sessions/store";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-scheduled-api-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const schedule = { kind: "recurring", dtStartLocal: "2026-04-02T09:00", timeZone: "UTC", rrule: "FREQ=DAILY" };
const MISSING = "00000000-0000-4000-8000-000000000000";

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/scheduled-tasks", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(json("POST", body));
}

describe("/api/scheduled-tasks", () => {
  it("creates a task on an existing chat, edits it and deletes it", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const created = await create({ title: "Morning check", prompt: "Check AAPL", destination: { type: "chat", sessionId: chat.id }, schedule });
    expect(created.status).toBe(201);
    const task = (await created.json()) as ScheduledTask;

    const { PATCH, DELETE } = await import("./[id]/route");
    const paused = await PATCH(json("PATCH", { status: "paused" }), params(task.id));
    expect(await paused.json()).toMatchObject({ id: task.id, status: "paused" });
    expect((await DELETE(new Request("http://localhost"), params(task.id))).status).toBe(200);
    expect((await DELETE(new Request("http://localhost"), params(task.id))).status).toBe(404);
  });

  it("answers each refusal with its status, a readable error and a code", async () => {
    const bad = await create({ title: "T" });
    expect(bad.status).toBe(400);
    const refusal = (await bad.json()) as { error: string; code: string };
    expect(refusal.code).toBe("invalid_task");
    // A sentence naming each field, not a JSON dump of the validator's issues.
    expect(refusal.error).toBe("prompt: Required; destination: Required; schedule: Required");
    expect(() => JSON.parse(refusal.error)).toThrow();

    const { PATCH } = await import("./[id]/route");
    const patched = await PATCH(json("PATCH", { status: "sleeping" }), params(MISSING));
    expect(patched.status).toBe(400);
    expect(await patched.json()).toMatchObject({ code: "invalid_task", error: 'status: must be one of "active", "paused"' });

    const gone = await create({ title: "T", prompt: "P", destination: { type: "chat", sessionId: MISSING }, schedule });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "session_not_found", error: "The selected chat no longer exists" });

    const model = await create({ title: "T", prompt: "P", destination: { type: "standalone", model: { provider: "gone", model: "m" } }, schedule });
    expect(model.status).toBe(400);
    expect(await model.json()).toMatchObject({ code: "model_unavailable", error: expect.stringContaining("gone") });

    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const rrule = await create({ title: "T", prompt: "P", destination: { type: "chat", sessionId: chat.id }, schedule: { ...schedule, rrule: "FREQ=SECONDLY" } });
    expect(rrule.status).toBe(400);
    expect(await rrule.json()).toMatchObject({ code: "invalid_task" });

    const task = (await (await create({ title: "T", prompt: "P", destination: { type: "chat", sessionId: chat.id }, schedule })).json()) as ScheduledTask;
    await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: new Date().toISOString(), status: "queued" });
    const { DELETE } = await import("./[id]/route");
    const busy = await DELETE(new Request("http://localhost"), params(task.id));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "run_in_progress" });

    const invalid = await DELETE(new Request("http://localhost"), params("not-a-uuid"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid scheduled task id", code: "invalid_task_id" });
  });

  it("pauses a chat's tasks when the chat is deleted, and tells the runner", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const task = (await (await create({ title: "T", prompt: "P", destination: { type: "chat", sessionId: chat.id }, schedule })).json()) as ScheduledTask;
    let changes = 0;
    const stop = onTasksChanged(() => changes++);
    try {
      const { DELETE } = await import("@/app/api/sessions/[id]/route");
      expect((await DELETE(new Request("http://localhost"), params(chat.id))).status).toBe(200);
      expect((await getScheduledTask(task.id))?.status).toBe("paused");
      expect(changes).toBe(1);
    } finally {
      stop();
    }
  });
});

describe("/api/scheduled-tasks/unread", () => {
  it("answers the unread count the full listing adds up to", async () => {
    const chat = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const task = (await (await create({ title: "Badge", prompt: "Check AAPL", destination: { type: "chat", sessionId: chat.id }, schedule })).json()) as ScheduledTask;
    const run = await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: new Date().toISOString(), status: "queued" });
    await updateScheduledRun(task.id, run.id, { status: "succeeded" });
    const { GET: list } = await import("./route");
    const { GET: unread } = await import("./unread/route");
    const listed = (await (await list()).json()) as {
      tasks: { unreadCount: number }[];
    };
    const expected = listed.tasks.reduce((total, listedTask) => total + listedTask.unreadCount, 0);
    expect(expected).toBeGreaterThan(0);
    expect(await (await unread()).json()).toEqual({ unread: expected });
  });
});
