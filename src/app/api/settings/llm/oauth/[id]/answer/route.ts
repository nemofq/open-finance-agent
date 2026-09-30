import { z } from "zod";
import { loginSessions } from "@/lib/llm/oauth/sessions";
import { errorResponse, jsonError, readJson } from "@/app/api/http";

const bodySchema = z.object({
  value: z.string(),
  /** The prompt being answered; leaving it out answers whichever prompt is open. */
  promptId: z.string().optional(),
});

type Context = { params: Promise<{ id: string }> };

/** Hand the pasted code, the typed URL or the chosen option back to the waiting flow. */
export async function POST(request: Request, { params }: Context): Promise<Response> {
  try {
    const { value, promptId } = await readJson(request, bodySchema);

    switch (loginSessions().answer((await params).id, value, promptId)) {
      case "unknown_session":
        return jsonError("Sign-in not found", 404);
      case "no_prompt":
        return jsonError("This sign-in is not waiting for an answer", 409);
      default:
        return Response.json({ ok: true });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
