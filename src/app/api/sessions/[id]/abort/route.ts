import { abortRun } from "@/lib/agent/runs";

/** Stop the in-flight run for a session, if there is one. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return Response.json({ aborted: abortRun((await params).id) });
}
