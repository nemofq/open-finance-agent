import { z } from "zod";
import { errorResponse, jsonError } from "@/app/api/http";
import { listScheduledRuns } from "@/lib/scheduled/store";
import { ScheduledTaskError, type ScheduledTaskErrorCode } from "@/lib/scheduled/tasks";
import type { ScheduledTask, ScheduledTaskWithRuns } from "@/lib/scheduled/types";

// How the scheduled-task routes refuse, shared so the collection and the item route cannot drift.
// Bodies are checked against the task contract in src/lib/scheduled/schema.ts. Not a route: only a
// `route.ts` is served.

const taskIdSchema = z.string().uuid();

/** The task id from the path, or the 400 a malformed one is refused with. */
export function parseTaskId(value: string): string | Response {
  const parsed = taskIdSchema.safeParse(value);
  return parsed.success ? parsed.data : jsonError("Invalid scheduled task id", 400, "invalid_task_id");
}

/** The task with its recent runs; a run file that could not be read adds a line to `warnings`, when given. */
export async function withRuns(task: ScheduledTask, warnings?: string[]): Promise<ScheduledTaskWithRuns> {
  const { runs, warnings: unread } = await listScheduledRuns(task.id);
  warnings?.push(...unread);
  return { ...task, runs, unreadCount: runs.filter((run) => run.unread).length };
}

const STATUS: Record<ScheduledTaskErrorCode, number> = {
  invalid_task: 400,
  session_not_found: 404,
  model_unavailable: 400,
  run_in_progress: 409,
  runner_unavailable: 503,
};

/** A body the task contract refuses, with the sentence the check wrote. */
export function invalidTask(message: string): Response {
  return jsonError(message, 400, "invalid_task");
}

/** A refusal from the task service with its status; anything else is a 500. */
export function taskFailure(err: unknown): Response {
  if (err instanceof ScheduledTaskError) return jsonError(err.message, STATUS[err.code], err.code);
  return errorResponse(err);
}
