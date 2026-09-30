import { errorResponse } from "@/app/api/http";
import { unreadRunCount } from "@/lib/scheduled/unread";

/** The sidebar badge's poll: one number, without the tasks, their runs or the scheduler's health. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ unread: await unreadRunCount() });
  } catch (err) {
    return errorResponse(err);
  }
}
