import { errorResponse, jsonError } from "@/app/api/http";
import { isDocumentName, servedTypeOfAttachment } from "@/lib/attachments/formats";
import { readStoredParse } from "@/lib/attachments/documents";
import { readAttachment } from "@/lib/attachments/store";
import { getSession } from "@/lib/sessions/store";

type Context = { params: Promise<{ id: string; name: string }> };

/**
 * Serve one file the user attached: an image for the transcript and the composer's previews, or a
 * document as a download. A name is the sha1 of the bytes behind it, so the content at a URL can
 * never change and the browser is told to keep it for good. `readAttachment` is what checks the
 * name; the chat is looked up first so a deleted chat stops answering for its files.
 *
 * Two rules keep uploaded content from becoming content of ours. A document is always
 * `Content-Disposition: attachment`, never rendered in place. And html is handed back as
 * `text/plain`, because `nosniff` only stops a browser guessing — it does not stop one believing a
 * `text/html` we sent ourselves. The parse sidecar is not servable at all: it is `<sha1>.json`, and
 * `ATTACHMENT_NAME` has no `json` among its extensions, so `readAttachment` refuses the name.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id, name } = await params;
  try {
    const session = await getSession(id);
    const bytes = session ? await readAttachment(id, name) : null;
    const mimeType = servedTypeOfAttachment(name);
    if (!bytes || !mimeType) return jsonError("Attachment not found", 404);

    const document = isDocumentName(name);
    // The stored name is a hash, so the download is named from the descriptor the upload recorded.
    const filename = document ? ((await readStoredParse(id, name))?.stored.name ?? name) : name;

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        // The type comes from the name we assigned, but a browser must not go looking for another.
        "X-Content-Type-Options": "nosniff",
        ...(document ? { "Content-Disposition": disposition(filename) } : {}),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * `attachment`, with the file name in both forms: the plain parameter for old clients, and RFC 5987
 * percent-encoding for anything not ASCII. The name has already lost quotes and control characters
 * in `sanitiseName`, which is what keeps the plain parameter from breaking the header.
 */
function disposition(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
