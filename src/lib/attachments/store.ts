import { readFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { sessionAttachmentsDir } from "@/lib/paths";
import { UUID } from "@/lib/utils";
import { ATTACHMENT_NAME, isDocumentName, parsedName } from "./formats";

/**
 * What a user attached lives in `sessions/<id>/attachments/`, named `<sha1>.<ext>` by its bytes, and
 * never in the session file: `listSessions` reads every transcript to build the sidebar, and
 * persistence rewrites the whole file after each message, so megabytes of base64 or document text
 * in a message would be paid for again and again. The transcript keeps a descriptor, and
 * `hydrateAttachments` (in `./hydrate`) puts the content back just before each model call — the
 * same rule the evidence layer follows for payloads.
 *
 * This file is what images and documents share: the chat's folder, serving a file from it, and
 * undoing a refused turn. How each kind gets there is `./images` (written with the message) and
 * `./documents` (staged on upload, parsed once, claimed by the message).
 *
 * Node-only: the composer's half of the contract is in `./formats` (names, URL) and `./limits`.
 */

/** A path only for a well-formed session id and a content-addressed name; otherwise nothing. */
export function attachmentPath(sessionId: string, name: string): string | undefined {
  if (!UUID.test(sessionId) || !ATTACHMENT_NAME.test(name)) return undefined;
  return path.join(sessionAttachmentsDir(sessionId), name);
}

/** The bytes of one attachment, or null when the name, the session or the file is not there. */
export async function readAttachment(sessionId: string, name: string): Promise<Buffer | null> {
  const file = attachmentPath(sessionId, name);
  if (!file) return null;
  return readFile(/* turbopackIgnore: true */ file).catch(() => null);
}

/**
 * Delete attachments a refused turn wrote. Best effort: an orphaned file costs disk, a failed
 * cleanup that threw would cost the user the error message they were waiting for. A document takes
 * its parse sidecar with it; nothing else ever points at one.
 */
export async function removeAttachments(sessionId: string, names: string[]): Promise<void> {
  if (names.length === 0 || !UUID.test(sessionId)) return;
  await Promise.all(
    names.map(async (name) => {
      const file = attachmentPath(sessionId, name);
      if (!file) return;
      await rm(file, { force: true }).catch(() => undefined);
      if (isDocumentName(name)) await rm(path.join(path.dirname(file), parsedName(name)), { force: true }).catch(() => undefined);
    }),
  );
  // A chat whose only attachment was refused should not keep an empty folder; `rmdir` refuses a
  // folder with anything left in it, which is exactly the check wanted here.
  await rmdir(sessionAttachmentsDir(sessionId)).catch(() => undefined);
}

/** The attachment name of a stored image block, or undefined for anything else. */
export function attachmentOf(block: unknown): string | undefined {
  if (!block || typeof block !== "object") return undefined;
  const candidate = block as { type?: unknown; attachment?: unknown };
  if (candidate.type !== "image" || typeof candidate.attachment !== "string") return undefined;
  return candidate.attachment;
}
