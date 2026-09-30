import { errorResponse, jsonError } from "@/app/api/http";
import { rejected, supported } from "@/lib/attachments/formats";
import { MAX_DOCUMENT_BYTES } from "@/lib/attachments/limits";
import { ParseFailed } from "@/lib/attachments/parse";
import { UnsupportedAttachment } from "@/lib/attachments/parse/sniff";
import { InvalidDocuments, stageDocument, sweepStaging } from "@/lib/attachments/documents";

const MEGABYTE = 1024 * 1024;

/**
 * Upload one document, before there is a chat to attach it to. The file is sniffed,
 * parsed in a worker and left in staging with its parse beside it; the message POST claims both
 * into the chat it creates. The descriptor that comes back is what the composer shows and what it
 * sends back as `documents: [name]`.
 *
 * Multipart rather than JSON, following `POST /api/portfolio/parse`: a 20 MB file base64-encoded in
 * a JSON body would be a third larger and would have to be buffered as a string first.
 */
export async function POST(request: Request): Promise<Response> {
  // Every upload pays for the sweep, which is a `readdir` of a folder that is normally empty.
  void sweepStaging().catch(() => undefined);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("The upload was not a file.", 400, "invalid_document");
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Attach one file as `file`.", 400, "invalid_document");

  const explained = rejected(file.name);
  if (explained) return jsonError(`${file.name} cannot be read — ${explained}.`, 400, "unsupported_document");
  if (!supported(file.name)) return jsonError(`${file.name} is not a kind of file that can be attached.`, 400, "unsupported_document");
  // Checked before it is parsed as well as after, so an oversized upload is refused before any
  // parsing; `file.size` is the browser's claim, `bytes.length` is the fact.
  if (file.size > MAX_DOCUMENT_BYTES) return jsonError(tooLarge(), 413, "document_too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_DOCUMENT_BYTES) return jsonError(tooLarge(), 413, "document_too_large");

  try {
    const { stored, parsed } = await stageDocument(bytes, file.name);
    return Response.json({ document: stored, warnings: parsed.warnings });
  } catch (err) {
    // Everything the user can act on: a format we do not take, a file we could not read, a cap.
    if (err instanceof UnsupportedAttachment) return jsonError(err.message, 400, "unsupported_document");
    if (err instanceof InvalidDocuments) return jsonError(err.message, 400, "invalid_document");
    if (err instanceof ParseFailed) return jsonError(err.message, 422, "parse_failed");
    return errorResponse(err);
  }
}

function tooLarge(): string {
  return `Each attached file must be under ${MAX_DOCUMENT_BYTES / MEGABYTE} MB.`;
}
