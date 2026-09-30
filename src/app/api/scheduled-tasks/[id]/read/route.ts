import { errorResponse } from "@/app/api/http";
import { parseTaskId } from "@/app/api/scheduled-tasks/request";
import { markScheduledTaskRead } from "@/lib/scheduled/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseTaskId((await params).id);
  if (id instanceof Response) return id;
  try {
    await markScheduledTaskRead(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
