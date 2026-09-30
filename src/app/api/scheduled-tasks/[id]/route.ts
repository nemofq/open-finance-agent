import { z } from "zod";
import { jsonError, readJson } from "@/app/api/http";
import { invalidTask, parseTaskId, taskFailure } from "@/app/api/scheduled-tasks/request";
import { deleteTask, updateTask } from "@/lib/scheduled/tasks";
import { checkTaskPatch } from "@/lib/scheduled/validate";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseTaskId((await params).id);
  if (id instanceof Response) return id;
  try {
    const checked = checkTaskPatch(await readJson(request, z.unknown()));
    if (!checked.ok) return invalidTask(checked.message);
    const task = await updateTask(id, checked.value);
    return task ? Response.json(task) : jsonError("Task not found", 404);
  } catch (error) {
    return taskFailure(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseTaskId((await params).id);
  if (id instanceof Response) return id;
  try {
    return (await deleteTask(id)) ? Response.json({ ok: true }) : jsonError("Task not found", 404);
  } catch (error) {
    return taskFailure(error);
  }
}
