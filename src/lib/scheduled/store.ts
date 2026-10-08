import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingFile, writeJsonFile } from "@/lib/atomic-write";
import { currentModelRef } from "@/lib/config/legacy-providers";
import { ensureDataDirs, scheduledTaskRunsDir, scheduledTasksDir } from "@/lib/paths";
import { errorMessage, UUID } from "@/lib/utils";
import { advanceSchedule, initialNextRun, normalizeSchedule } from "./schedule";
import type { TaskInput } from "./schema";
import type { ScheduledRun, ScheduledTask } from "./types";

function taskPath(id: string): string {
  if (!UUID.test(id)) throw new Error(`Invalid scheduled task id: ${id}`);
  return path.join(scheduledTasksDir(), `${id}.json`);
}

function runPath(taskId: string, runId: string): string {
  if (!UUID.test(taskId) || !UUID.test(runId)) throw new Error("Invalid scheduled run id");
  return path.join(scheduledTaskRunsDir(taskId), `${runId}.json`);
}

export async function createScheduledTask(input: TaskInput & { now?: Date }): Promise<ScheduledTask> {
  ensureDataDirs();
  const now = input.now ?? new Date();
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title) throw new RangeError("title is required");
  if (!prompt) throw new RangeError("prompt is required");
  const schedule = normalizeSchedule(input.schedule, now);
  const stamp = now.toISOString();
  const task: ScheduledTask = {
    id: randomUUID(), title, prompt, ...(input.skill ? { skill: input.skill } : {}),
    destination: input.destination, schedule, status: "active", nextRunAt: initialNextRun(schedule, now), createdAt: stamp, updatedAt: stamp,
  };
  await writeJsonFile(taskPath(task.id), task);
  return task;
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  try {
    const task = JSON.parse(await readFile(taskPath(id), "utf8")) as ScheduledTask;
    // A standalone task saved before a pi provider rename resolves to the provider's current id.
    return task.destination?.type === "standalone"
      ? { ...task, destination: { ...task.destination, model: currentModelRef(task.destination.model) } }
      : task;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * Every task, newest edit first, with a warning for each file that could not be read. The warnings
 * are the caller's: two listings at once (the scheduler's scan and the page) must not share them.
 */
export async function listScheduledTasks(): Promise<{ tasks: ScheduledTask[]; warnings: string[] }> {
  ensureDataDirs();
  const warnings: string[] = [];
  const names = await readdir(scheduledTasksDir());
  const tasks: ScheduledTask[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const id = name.slice(0, -5);
    try {
      const task = await getScheduledTask(id);
      if (task) tasks.push(task);
    } catch (error) {
      const warning = `Could not read scheduled task file ${path.join(scheduledTasksDir(), name)}: ${errorMessage(error)}`;
      warnings.push(warning);
      console.error(`[scheduled] ${warning}`, error);
    }
  }
  return { tasks: tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
}

export async function updateScheduledTask(id: string, patch: Partial<Pick<ScheduledTask, "title" | "prompt" | "skill" | "destination" | "schedule" | "status" | "nextRunAt" | "lastRunAt" | "lastRunStatus">>, now = new Date()): Promise<ScheduledTask | null> {
  const current = await getScheduledTask(id);
  if (!current) return null;
  const next = { ...current, ...patch } as ScheduledTask;
  if (patch.title !== undefined && !patch.title.trim()) throw new RangeError("title is required");
  if (patch.prompt !== undefined && !patch.prompt.trim()) throw new RangeError("prompt is required");
  if (patch.schedule) {
    next.schedule = normalizeSchedule(patch.schedule, now);
    next.nextRunAt = initialNextRun(next.schedule, now);
  }
  if (patch.status === "active" && current.status !== "active") next.nextRunAt = advanceSchedule(next.schedule, now);
  if (next.status === "active" && next.nextRunAt === null) next.status = "completed";
  next.updatedAt = now.toISOString();
  await writeJsonFile(taskPath(id), next);
  return next;
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  try {
    await rm(taskPath(id));
    await rm(scheduledTaskRunsDir(id), { recursive: true, force: true });
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function createScheduledRun(input: Omit<ScheduledRun, "id" | "queuedAt" | "unread"> & { now?: Date }): Promise<ScheduledRun> {
  const now = input.now ?? new Date();
  const run: ScheduledRun = { ...input, id: randomUUID(), queuedAt: now.toISOString(), unread: false };
  await writeJsonFile(runPath(run.taskId, run.id), run);
  return run;
}

export async function updateScheduledRun(taskId: string, runId: string, patch: Partial<ScheduledRun>): Promise<ScheduledRun | null> {
  try {
    const current = JSON.parse(await readFile(runPath(taskId, runId), "utf8")) as ScheduledRun;
    const next = { ...current, ...patch };
    if (patch.status === "succeeded" || patch.status === "failed" || patch.status === "interrupted") next.unread = true;
    await writeJsonFile(runPath(taskId, runId), next);
    return next;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/** A task's newest runs, with a warning for each run file that could not be read, as for tasks. */
export async function listScheduledRuns(taskId: string, limit = 50): Promise<{ runs: ScheduledRun[]; warnings: string[] }> {
  if (!UUID.test(taskId)) throw new Error(`Invalid scheduled task id: ${taskId}`);
  const dir = scheduledTaskRunsDir(taskId);
  const warnings: string[] = [];
  try {
    const names = await readdir(dir);
    const runs: ScheduledRun[] = [];
    for (const name of names.filter((entry) => entry.endsWith(".json"))) {
      try { runs.push(JSON.parse(await readFile(path.join(dir, name), "utf8")) as ScheduledRun); }
      catch (error) {
        const warning = `Could not read scheduled run file ${path.join(dir, name)}: ${errorMessage(error)}`;
        warnings.push(warning);
        console.error(`[scheduled] ${warning}`, error);
      }
    }
    return { runs: runs.sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)).slice(0, limit), warnings };
  } catch (error) {
    if (isMissingFile(error)) return { runs: [], warnings };
    throw error;
  }
}

export async function markScheduledTaskRead(taskId: string): Promise<void> {
  for (const run of (await listScheduledRuns(taskId, 500)).runs) if (run.unread) await updateScheduledRun(taskId, run.id, { unread: false });
}

export async function markAllScheduledRead(): Promise<void> {
  for (const task of (await listScheduledTasks()).tasks) await markScheduledTaskRead(task.id);
}

export async function recoverScheduledRuns(): Promise<void> {
  for (const task of (await listScheduledTasks()).tasks) {
    for (const run of (await listScheduledRuns(task.id, 500)).runs) {
      if (run.status === "queued" || run.status === "running") {
        await updateScheduledRun(task.id, run.id, { status: "interrupted", finishedAt: new Date().toISOString(), error: "The server stopped before this run finished" });
      }
    }
  }
}
