import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScheduledRun, createScheduledTask, deleteScheduledTask, markScheduledTaskRead, updateScheduledRun } from "./store";
import { unreadRunCount } from "./unread";

describe("unreadRunCount", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ofa-scheduled-unread-"));
    process.env.OFA_HOME = home;
  });
  afterEach(() => {
    delete process.env.OFA_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  const now = new Date("2026-04-01T00:00:00Z");
  const task = () =>
    createScheduledTask({
      title: "Report",
      prompt: "Check AAPL",
      destination: { type: "chat", sessionId: "00000000-0000-0000-0000-000000000001" },
      schedule: { kind: "once", runAt: "2026-04-02T09:00:00Z", timeZone: "UTC" },
      now,
    });
  const finishedRun = async (taskId: string) => {
    const run = await createScheduledRun({ taskId, trigger: "manual", scheduledFor: now.toISOString(), status: "queued", now });
    await updateScheduledRun(taskId, run.id, { status: "succeeded" });
  };

  it("counts finished runs across tasks and follows every change to them", async () => {
    expect(await unreadRunCount()).toBe(0);
    const first = await task();
    const second = await task();
    await finishedRun(first.id);
    await finishedRun(first.id);
    await finishedRun(second.id);
    expect(await unreadRunCount()).toBe(3);
    // Unchanged folders answer from the cache, and still add up.
    expect(await unreadRunCount()).toBe(3);

    await markScheduledTaskRead(first.id);
    expect(await unreadRunCount()).toBe(1);
    await finishedRun(first.id);
    expect(await unreadRunCount()).toBe(2);
    await deleteScheduledTask(second.id);
    expect(await unreadRunCount()).toBe(1);
  });

  it("skips a stray file in the tasks folder", async () => {
    await finishedRun((await task()).id);
    writeFileSync(path.join(home, "scheduled-tasks", "notes.json"), "{}");
    expect(await unreadRunCount()).toBe(1);
  });
});
