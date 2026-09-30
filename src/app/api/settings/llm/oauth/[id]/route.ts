import { loginSessions } from "@/lib/llm/oauth/sessions";
import { jsonError } from "@/app/api/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Give up on a sign-in: the dialog was closed, or the user changed their mind. The flow inside pi
 * is aborted, its streams are told, and the session is gone.
 *
 * There is no body to guard with `requireJson`: a DELETE is never a simple cross-site request, so
 * it cannot reach here without a CORS preflight these routes never grant.
 */
export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  return loginSessions().abort((await params).id) ? Response.json({ ok: true }) : jsonError("Sign-in not found", 404);
}
