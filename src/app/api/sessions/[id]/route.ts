import { errorResponse, jsonError } from "@/app/api/http";
import { deleteSession, getSession } from "@/lib/sessions/store";
import { pauseTasksForSession } from "@/lib/scheduled/tasks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const session = await getSession((await params).id);
    if (!session) return jsonError("Session not found", 404);
    return Response.json(session);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const id = (await params).id;
  try {
    const deleted = await deleteSession(id);
    if (!deleted) return jsonError("Session not found", 404);
    await pauseTasksForSession(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
