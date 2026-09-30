import { z } from "zod";
import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { type CompactChatRefusal, compactChat } from "@/lib/agent/compact";

const compactBodySchema = z.object({
  /** The `<focus>` of `/compact <focus>`: what the checkpoint should keep in view. */
  focus: z.string().optional(),
});

function refusal(refused: CompactChatRefusal): Response {
  switch (refused.reason) {
    case "session_not_found":
      return jsonError(refused.message, 404);
    case "run_in_progress":
      return jsonError(refused.message, 409, "run_in_progress");
    case "nothing_to_compact":
      return jsonError(refused.message, 400, "nothing_to_compact");
    case "model_unavailable":
      return jsonError(refused.message, 400, refused.code);
  }
}

/** Compact a chat on demand (`/compact [focus]`) and return the checkpoint it wrote. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    // A cross-site page could otherwise spend a model call with a `text/plain` body.
    const focus = (await readJson(request, compactBodySchema)).focus?.trim() || undefined;
    const result = await compactChat(id, { focus });
    // The bare checkpoint: the chat appends it to its transcript as a "Context compacted" divider.
    return result.ok ? Response.json(result.compaction) : refusal(result);
  } catch (err) {
    return errorResponse(err);
  }
}
