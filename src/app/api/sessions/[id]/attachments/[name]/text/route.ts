import { errorResponse, jsonError } from "@/app/api/http";
import { markdownOf } from "@/lib/attachments/parse";
import { readParsed } from "@/lib/attachments/documents";
import { getSession } from "@/lib/sessions/store";

type Context = { params: Promise<{ id: string; name: string }> };

/**
 * The normalised Markdown behind a document: what the preview dialog shows, and the same text the
 * model reads. Prose comes back whole; a table comes back as its schema and first rows,
 * because the rows themselves are for the calculator, not for reading.
 *
 * `text/plain`, never `text/markdown`: this is content the user uploaded, and no part of it should
 * be rendered by anything that follows a link to it.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id, name } = await params;
  try {
    const session = await getSession(id);
    const parsed = session ? await readParsed(id, name) : null;
    if (!parsed) return jsonError("Attachment not found", 404);

    return new Response(markdownOf(parsed), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // The name is the hash of the bytes the text was parsed from, so this can never go stale.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
