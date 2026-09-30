import { z } from "zod";
import { errorResponse, readJson } from "@/app/api/http";
import { invalidTask, taskFailure, withRuns } from "@/app/api/scheduled-tasks/request";
import { listSessions } from "@/lib/sessions/store";
import { schedulerHealth } from "@/lib/scheduled/runner";
import { listScheduledTasks } from "@/lib/scheduled/store";
import { createTask } from "@/lib/scheduled/tasks";
import { checkTaskInput } from "@/lib/scheduled/validate";

/** Every task with its recent runs, and the chats a task can post into, for the Scheduled page. */
export async function GET() {
  try {
    const listed = await listScheduledTasks();
    const warnings = [...listed.warnings];
    const tasks = await Promise.all(listed.tasks.map((task) => withRuns(task, warnings)));
    return Response.json({
      tasks,
      health: schedulerHealth(),
      warnings,
      sessions: (await listSessions(() => false, true)).filter((session) => session.visibility !== "scheduled"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const checked = checkTaskInput(await readJson(request, z.unknown()));
    if (!checked.ok) return invalidTask(checked.message);
    return Response.json(await createTask(checked.value), { status: 201 });
  } catch (error) {
    return taskFailure(error);
  }
}
