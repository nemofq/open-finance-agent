import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledRun, createScheduledTask, getScheduledTask, listScheduledRuns, listScheduledTasks, markScheduledTaskRead, updateScheduledRun, updateScheduledTask } from "./store";

describe("scheduled durable store", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(tmpdir(), "ofa-scheduled-")); process.env.OFA_HOME = home; });
  afterEach(() => { delete process.env.OFA_HOME; rmSync(home, { recursive: true, force: true }); });

  it("atomically creates, updates and reads runs with owner-only files", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const task = await createScheduledTask({ title: " Morning report ", prompt: "Check AAPL", destination: { type: "chat", sessionId: "00000000-0000-0000-0000-000000000001" }, schedule: { kind: "once", runAt: "2026-04-02T09:00:00Z", timeZone: "UTC" }, now });
    expect(task.title).toBe("Morning report");
    expect(statSync(path.join(home, "scheduled-tasks", `${task.id}.json`)).mode & 0o777).toBe(0o600);
    const run = await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: now.toISOString(), status: "queued", now });
    expect((await listScheduledRuns(task.id)).runs[0]?.unread).toBe(false);
    await updateScheduledTask(task.id, { title: "Updated" });
    await updateScheduledRun(task.id, run.id, { status: "failed", error: "boom" });
    expect((await listScheduledRuns(task.id)).runs[0]?.unread).toBe(true);
    await markScheduledTaskRead(task.id);
    expect((await listScheduledRuns(task.id)).runs[0]?.unread).toBe(false);
    expect((await getScheduledTask(task.id))?.title).toBe("Updated");
  });

  it("returns each listing's own warnings for unreadable files, however many listings run at once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = new Date("2026-04-01T00:00:00Z");
    const task = await createScheduledTask({ title: "Report", prompt: "Check AAPL", destination: { type: "chat", sessionId: "00000000-0000-0000-0000-000000000001" }, schedule: { kind: "once", runAt: "2026-04-02T09:00:00Z", timeZone: "UTC" }, now });
    await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: now.toISOString(), status: "queued", now });
    writeFileSync(path.join(home, "scheduled-tasks", "00000000-0000-4000-8000-000000000009.json"), "{ broken");
    writeFileSync(path.join(home, "scheduled-runs", task.id, "00000000-0000-4000-8000-000000000008.json"), "{ broken");

    const [tasks, runs, again] = await Promise.all([listScheduledTasks(), listScheduledRuns(task.id), listScheduledTasks()]);
    expect(tasks.tasks.map((listed) => listed.id)).toEqual([task.id]);
    expect(tasks.warnings).toEqual([expect.stringContaining("Could not read scheduled task file")]);
    expect(again.warnings).toEqual(tasks.warnings);
    expect(runs.runs).toHaveLength(1);
    expect(runs.warnings).toEqual([expect.stringContaining("Could not read scheduled run file")]);
    vi.restoreAllMocks();
  });

  it("rejects path traversal ids", async () => {
    await expect(getScheduledTask("../../outside")).rejects.toThrow("Invalid scheduled task id");
  });
});
