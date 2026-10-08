import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeJsonFile } from "@/lib/atomic-write";
import { currentModelRef } from "@/lib/config/legacy-providers";
import type { ModelRef } from "@/lib/config/schema";
import { ensureDataDirs, sessionDir, sessionsDir } from "@/lib/paths";
import { processSingleton } from "@/lib/process-state";
import { sessionTickers } from "@/lib/sessions/cashtags";
import { reportSummariesOf } from "@/lib/sessions/reports";
import { DEFAULT_TITLE } from "@/lib/sessions/title";
import type { SessionFile, SessionHeader } from "@/lib/sessions/types";
import { UUID } from "@/lib/utils";


function sessionPath(id: string): string {
  if (!UUID.test(id)) throw new Error(`Invalid session id: ${id}`);
  return path.join(sessionsDir(), `${id}.json`);
}

export async function createSession({
  model,
  skill,
  title,
  visibility = "recent",
  scheduledOrigin,
}: {
  model: ModelRef;
  skill?: string;
  title?: string;
  visibility?: "recent" | "scheduled";
  scheduledOrigin?: { taskId: string; runId: string };
}): Promise<SessionFile> {
  const now = new Date().toISOString();
  const session: SessionFile = {
    id: randomUUID(),
    title: title?.trim() || DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    model,
    tickers: [],
    ...(skill ? { skill } : {}),
    ...(visibility === "scheduled" ? { visibility } : {}),
    ...(scheduledOrigin ? { scheduledOrigin } : {}),
    messages: [],
  };
  await saveSession(session);
  return session;
}

export async function getSession(id: string): Promise<SessionFile | null> {
  try {
    const session = JSON.parse(await readFile(sessionPath(id), "utf8")) as SessionFile;
    // A chat saved before a pi provider rename resolves to the provider's current id.
    return session.model ? { ...session, model: currentModelRef(session.model) } : session;
  } catch {
    return null;
  }
}

/** Write the whole session atomically so a crash mid-write cannot truncate a transcript. */
async function saveSession(session: SessionFile): Promise<void> {
  ensureDataDirs();
  await writeJsonFile(sessionPath(session.id), session);
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<SessionFile, "id" | "createdAt">>,
): Promise<SessionFile | null> {
  const session = await getSession(id);
  if (!session) return null;
  const updated: SessionFile = { ...session, ...patch, updatedAt: new Date().toISOString() };
  // Derived here, once per save of the transcript, so no reader has to walk the messages for them.
  if (patch.messages) updated.tickers = sessionTickers(patch.messages);
  await saveSession(updated);
  return updated;
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await rm(sessionPath(id));
    // The chat's evidence payloads and attachments live beside it; deleting the chat deletes them.
    await rm(sessionDir(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

type StoredHeader = Omit<SessionHeader, "running">;

/**
 * The sidebar, the dashboard and the Scheduled page each list the chats every few seconds, and a
 * header means reading and parsing the whole transcript. So each chat's header is kept with its
 * file's modification time and size and read again only when either changes. Every save replaces
 * the file by a rename (`writeFileAtomic`), which gives it a new time, and the time is read before
 * the file, so a save racing the list only costs a re-read. Some file systems stamp times at a
 * coarse tick, so a file touched within the last `SETTLE_MS` is read afresh and its header not kept:
 * a write later in the same tick would leave the time as it was.
 */
interface CachedHeader {
  modified: bigint;
  size: bigint;
  header: StoredHeader;
}

const SETTLE_MS = 2_000;

/** Keyed by the file's path, so a different data folder (a test's) never reuses a header. */
function headerCache(): Map<string, CachedHeader> {
  return processSingleton("sessions.header-cache", () => new Map<string, CachedHeader>());
}

async function storedHeader(file: string): Promise<StoredHeader | null> {
  const { mtimeNs: modified, size } = await stat(file, { bigint: true });
  const cache = headerCache();
  const cached = cache.get(file);
  const settled = Date.now() - Number(modified / BigInt(1_000_000)) > SETTLE_MS;
  if (settled && cached?.modified === modified && cached.size === size) return cached.header;
  const session = await getSession(path.basename(file, ".json"));
  if (!session) return null;
  const { messages, ...rest } = session;
  const header = { ...rest, messageCount: messages.length, reports: reportSummariesOf(messages) };
  if (settled) cache.set(file, { modified, size, header });
  else cache.delete(file);
  return header;
}

/**
 * Newest first. Unreadable files are skipped rather than breaking the list. A run in flight lives
 * in the in-process registry rather than on disk, so it arrives as a predicate and this stays
 * filesystem-only; callers with no registry to consult get `running: false` throughout.
 */
export async function listSessions(isRunning: (id: string) => boolean = () => false, includeScheduled = false): Promise<SessionHeader[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir());
  } catch {
    return [];
  }
  const files = entries.filter((name) => name.endsWith(".json")).map((name) => path.join(sessionsDir(), name));
  const headers = await Promise.all(files.map((file) => storedHeader(file).catch(() => null)));
  // A deleted chat's header goes with it.
  const listed = new Set(files);
  const cache = headerCache();
  for (const file of cache.keys()) if (!listed.has(file)) cache.delete(file);
  return headers
    .filter((header): header is StoredHeader => header !== null && (includeScheduled || header.visibility !== "scheduled"))
    .map((header) => ({ ...header, running: isRunning(header.id) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
