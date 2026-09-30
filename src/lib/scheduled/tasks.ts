import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { readConfig } from "@/lib/config/store";
import { resolveModel } from "@/lib/llm";
import { getSession, updateSession } from "@/lib/sessions/store";
import { tasksChanged } from "./events";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledRuns,
  listScheduledTasks,
  updateScheduledTask,
} from "./store";
import { type TaskInput, taskInputSchema, type TaskPatch, taskPatchSchema } from "./schema";
import type { ScheduledDestination, ScheduledTask } from "./types";

/**
 * Creating, editing and deleting scheduled tasks, for the Scheduled page's routes and the agent's
 * tools alike. It never imports the runner: the tools are built inside a turn, and the runner is
 * what starts turns. The runner hears about changes through `./events`.
 */

export type ScheduledTaskErrorCode = "invalid_task" | "session_not_found" | "model_unavailable" | "run_in_progress" | "runner_unavailable";

/** A refusal the caller can show as it stands: the routes map `code` to a status, the tools throw it. */
export class ScheduledTaskError extends Error {
  constructor(
    message: string,
    readonly code: ScheduledTaskErrorCode,
  ) {
    super(message);
    this.name = "ScheduledTaskError";
  }
}

/**
 * The contract's fields alone. A request body or a model's tool call can carry others, such as
 * `nextRunAt` or `id`, and the store would save them over the task.
 */
function contractFields<T>(schema: TSchema, value: T): T {
  return Value.Clean(schema, structuredClone(value)) as T;
}

/**
 * A destination the runner will be able to use: the chat still exists, or the standalone model
 * resolves now and is stored under the provider and model ids it resolved to.
 */
async function checkedDestination(destination: ScheduledDestination): Promise<ScheduledDestination> {
  if (destination.type === "chat") {
    if (!(await getSession(destination.sessionId))) throw new ScheduledTaskError("The selected chat no longer exists", "session_not_found");
    return destination;
  }
  const resolved = await resolveModel(readConfig(), destination.model);
  if (!resolved.ok) throw new ScheduledTaskError(resolved.message, "model_unavailable");
  return { type: "standalone", model: { provider: resolved.provider.id, model: resolved.info.id } };
}

/** The store and the schedule parser refuse bad input with a `RangeError`; it is the caller's to fix. */
async function validated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof RangeError) throw new ScheduledTaskError(error.message, "invalid_task");
    throw error;
  }
}

export async function createTask(raw: TaskInput): Promise<ScheduledTask> {
  const input = contractFields(taskInputSchema, raw);
  const destination = await checkedDestination(input.destination);
  const task = await validated(() => createScheduledTask({ ...input, destination }));
  tasksChanged();
  return task;
}

/** Edit or pause a task; `null` when there is no task with that id. */
export async function updateTask(taskId: string, raw: TaskPatch): Promise<ScheduledTask | null> {
  const patch = contractFields(taskPatchSchema, raw);
  const destination = patch.destination ? await checkedDestination(patch.destination) : undefined;
  const task = await validated(() => updateScheduledTask(taskId, { ...patch, ...(destination ? { destination } : {}) }));
  if (task) tasksChanged();
  return task;
}

/**
 * Delete the task and its run history, never its output: the chats it wrote to remain, and the
 * hidden standalone chats it created move to Recent. `false` when there is no task with that id.
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  if (!(await getScheduledTask(taskId))) return false;
  const { runs } = await listScheduledRuns(taskId, 500);
  // A queued or running run would write to a task and run folder that no longer exist.
  if (runs.some((run) => run.status === "queued" || run.status === "running")) {
    throw new ScheduledTaskError("Pause the task and wait for its current run before deleting it", "run_in_progress");
  }
  for (const run of runs) {
    if (!run.sessionId) continue;
    const session = await getSession(run.sessionId);
    if (session?.visibility === "scheduled") await updateSession(run.sessionId, { visibility: "recent", scheduledOrigin: undefined });
  }
  const deleted = await deleteScheduledTask(taskId);
  tasksChanged();
  return deleted;
}

/**
 * Pause every active task that writes into a chat, because the chat is being deleted: a task
 * pointing at a missing session must not keep firing. Returns how many were paused.
 */
export async function pauseTasksForSession(sessionId: string): Promise<number> {
  const bound = (await listScheduledTasks()).tasks.filter(
    (task) => task.status === "active" && task.destination.type === "chat" && task.destination.sessionId === sessionId,
  );
  for (const task of bound) await updateScheduledTask(task.id, { status: "paused" });
  if (bound.length > 0) tasksChanged();
  return bound.length;
}
