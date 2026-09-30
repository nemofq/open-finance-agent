import { errorResponse } from "@/app/api/http";
import { markAllScheduledRead } from "@/lib/scheduled/store";

export async function POST() {
  try {
    await markAllScheduledRead();
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
