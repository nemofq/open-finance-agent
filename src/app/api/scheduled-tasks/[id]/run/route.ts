import { jsonError } from "@/app/api/http";
import { parseTaskId, taskFailure } from "@/app/api/scheduled-tasks/request";
import { queueManualRun } from "@/lib/scheduled/runner";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseTaskId((await params).id);
    if (id instanceof Response) return id;
    const run = await queueManualRun(id);
    return run ? Response.json(run, { status: 202 }) : jsonError("Task not found", 404);
  } catch (error) {
    return taskFailure(error);
  }
}
