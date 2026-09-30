import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { sniff } from "@/lib/attachments/parse/sniff";
import { writeFileAtomic } from "@/lib/atomic-write";
import { sessionAttachmentsDir, stagingDir } from "@/lib/paths";
import { UUID } from "@/lib/utils";
import { ATTACHMENT_NAME, isDocumentName, parsedName } from "./formats";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_MESSAGE, STAGING_MAX_AGE_MS } from "./limits";
import { describeParse, parseAttachment } from "./parse";
import { attachmentPath } from "./store";
import type { ParsedAttachment, StoredAttachment, StoredParse } from "./types";
import { megabytes } from "./wording";

/**
 * Documents the user attached. They are uploaded before the chat exists, so they land in
 * `stagingDir()` with their parse beside them as `<sha1>.json`, and the message POST *claims* them
 * into the chat's attachments folder (`./store`). The transcript keeps a `StoredAttachment`
 * descriptor; the text is read back from the sidecar when the model needs it.
 */

/** Bad input from the composer, surfaced by the route as a 400 rather than a 500. */
export class InvalidDocuments extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocuments";
  }
}

/** Long enough for any real file name, short enough that nothing downstream has to truncate it. */
const MAX_NAME_CHARS = 200;

/**
 * The file name as we are willing to repeat it: the base name only, with separators, control
 * characters and leading dots gone. It reaches the model, the transcript and a `Content-Disposition`
 * header, and it never reaches the filesystem — the stored name is the content hash.
 */
function sanitiseName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return clean.slice(0, MAX_NAME_CHARS) || "attachment";
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function readSidecar(file: string): Promise<StoredParse | null> {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as StoredParse;
    return record?.parsed?.version === 1 && record.stored?.attachment ? record : null;
  } catch {
    return null;
  }
}

/**
 * Parse one uploaded document and hold it in staging until a chat claims it.
 *
 * The stored name is `<sha1>.<ext>` with the extension the *sniff* settled on, not the one the user
 * typed, so what the serve route later hands back is what the bytes actually are. Content
 * addressing makes a re-upload free: the parse beside the file is reused and only the descriptor's
 * `name` is refreshed, which is the one thing the hash cannot tell us.
 */
export async function stageDocument(bytes: Uint8Array, name: string): Promise<StoredParse> {
  if (bytes.length === 0) throw new InvalidDocuments("That file is empty.");
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new InvalidDocuments(`Each attached file must be under ${megabytes(MAX_DOCUMENT_BYTES)} MB.`);
  }
  const clean = sanitiseName(name);
  const sniffed = sniff(bytes, clean);
  const attachment = `${createHash("sha1").update(bytes).digest("hex")}.${sniffed.extension}`;

  const dir = stagingDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(/* turbopackIgnore: true */ dir, attachment);
  const sidecar = path.join(dir, parsedName(attachment));

  const cached = (await exists(file)) ? await readSidecar(sidecar) : null;
  const parsed = cached?.parsed ?? (await parseAttachment(bytes, clean, sniffed));
  const stored: StoredAttachment = { attachment, name: clean, bytes: bytes.length, ...describeParse(parsed) };

  const record: StoredParse = { version: 1, stored, parsed };
  if (!cached) await writeFileAtomic(file, bytes, { mode: 0o600 });
  await writeFileAtomic(sidecar, JSON.stringify(record), { mode: 0o600 });
  return record;
}

/**
 * Move staged documents into the chat that is about to send them, and describe them the way the
 * transcript stores them. Everything is checked before anything moves, so a refused message leaves
 * staging as it found it; a turn refused after the move puts them back with `unclaimDocuments`.
 * `claimed`, when given, collects the name of each document this call actually moves as it moves
 * it, so a caller can undo exactly those after a failure partway through or a later refusal.
 *
 * A name the chat already holds is accepted: names are content hashes, so the second send of the
 * same file is the same file. That is also what makes a retry work after a refused turn put the
 * documents back (`unclaimDocuments`) — and after one that did not, because the chat still has them.
 */
export async function claimDocuments(sessionId: string, names: string[], claimed?: string[]): Promise<StoredAttachment[]> {
  if (names.length === 0) return [];
  if (!UUID.test(sessionId)) throw new InvalidDocuments("That chat cannot take attachments.");
  const unique = [...new Set(names)];
  if (unique.length > MAX_DOCUMENTS_PER_MESSAGE) {
    throw new InvalidDocuments(`You can attach at most ${MAX_DOCUMENTS_PER_MESSAGE} files to one message.`);
  }

  const dir = sessionAttachmentsDir(sessionId);
  const staging = stagingDir();
  const planned = await Promise.all(
    unique.map(async (attachment) => {
      if (!ATTACHMENT_NAME.test(attachment) || !isDocumentName(attachment)) {
        throw new InvalidDocuments("One of the attached files is not something this chat can take.");
      }
      const sidecar = parsedName(attachment);
      // The chat's own copy first: a file sent twice was claimed by the earlier message and is no
      // longer in staging, and its descriptor is the one that message already agreed on.
      const record = (await readSidecar(path.join(dir, sidecar))) ?? (await readSidecar(path.join(staging, sidecar)));
      if (!record) throw new InvalidDocuments("One of the attached files is no longer available; attach it again.");
      return { attachment, sidecar, record };
    }),
  );

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stored: StoredAttachment[] = [];
  for (const { attachment, sidecar, record } of planned) {
    if (await moveAttachment(path.join(staging, attachment), path.join(dir, attachment))) claimed?.push(attachment);
    await moveAttachment(path.join(staging, sidecar), path.join(dir, sidecar));
    stored.push(record.stored);
  }
  return stored;
}

/**
 * Put claimed documents back in staging, for a turn the chat refused before it ever happened.
 * Deleting them, which is what a refused image gets, would cost the user the upload as well as the
 * turn: the composer still holds their names, and sending again is the obvious next thing to do.
 * Staging is where a document with no owner belongs, and the sweep ends its life if no retry comes.
 */
export async function unclaimDocuments(sessionId: string, names: string[]): Promise<void> {
  if (names.length === 0 || !UUID.test(sessionId)) return;
  const staging = stagingDir();
  await mkdir(staging, { recursive: true, mode: 0o700 });
  for (const name of names) {
    const file = attachmentPath(sessionId, name);
    if (!file || !isDocumentName(name)) continue;
    const sidecar = parsedName(name);
    await moveAttachment(file, path.join(staging, name)).catch(() => undefined);
    await moveAttachment(path.join(path.dirname(file), sidecar), path.join(staging, sidecar)).catch(() => undefined);
  }
  // As in `removeAttachments`: a chat whose only attachment went back should keep no empty folder.
  await rmdir(sessionAttachmentsDir(sessionId)).catch(() => undefined);
}

/**
 * Move one attachment between staging and a chat, in either direction. A target that is already
 * there holds the same bytes — the name is their hash — so the source is simply dropped, which is
 * also what makes this safe on Windows, where renaming onto an existing file fails. True when this
 * call put the file at `to`, false when it was already there or there was nothing to move.
 */
async function moveAttachment(from: string, to: string): Promise<boolean> {
  if (await exists(to)) {
    await rm(from, { force: true }).catch(() => undefined);
    return false;
  }
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false; // claimed by a concurrent send, or never staged
    if (code !== "EXDEV") throw err;
    // Only when OFA_HOME straddles two filesystems; the two directories are normally siblings.
    await copyFile(from, to);
    await rm(from, { force: true }).catch(() => undefined);
  }
  return true;
}

/** The parse behind a document in one chat, or null when the name or the file is not there. */
export async function readParsed(sessionId: string, name: string): Promise<ParsedAttachment | null> {
  return (await readStoredParse(sessionId, name))?.parsed ?? null;
}

/** The parse and the descriptor as they were written, for a caller that needs the original name. */
export async function readStoredParse(sessionId: string, name: string): Promise<StoredParse | null> {
  const file = attachmentPath(sessionId, name);
  if (!file || !isDocumentName(name)) return null;
  return readSidecar(path.join(path.dirname(file), parsedName(name)));
}

/**
 * Drop staged uploads nothing ever claimed. A file the user picked and then thought better of has
 * no owner and no other end of life, so it gets one by age: run at server start and on every upload.
 * Best effort, like every other cleanup here.
 */
export async function sweepStaging(maxAgeMs: number = STAGING_MAX_AGE_MS): Promise<number> {
  const dir = stagingDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const cutoff = Date.now() - maxAgeMs;
  let swept = 0;
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry);
      const stats = await stat(file).catch(() => null);
      if (!stats?.isFile() || stats.mtimeMs >= cutoff) return;
      await rm(file, { force: true }).catch(() => undefined);
      swept += 1;
    }),
  );
  return swept;
}
