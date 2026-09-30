import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-write";
import { isEvidenceId } from "./ids";
import type { EvidenceId } from "./types";

/**
 * `<dataDir>/sessions/<id>/evidence/<entry>.json`: the one place the payload layout is written
 * down. The folder is passed in rather than read from `dataDir()` so a benchmark run and a test
 * can point somewhere else.
 */
function evidenceDir(dataDir: string, sessionId: string): string {
  return path.join(dataDir, "sessions", sessionId, "evidence");
}

export function payloadPath(dataDir: string, sessionId: string, id: EvidenceId): string {
  if (!isEvidenceId(id)) throw new Error(`"${id}" is not an evidence id.`);
  return path.join(evidenceDir(dataDir, sessionId), `${id}.json`);
}

/**
 * Write through a temporary file so a crash mid-write cannot leave a half-payload behind,
 * and keep payloads readable only by the user: they hold whole filings and quotes.
 */
async function writePayload(file: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, JSON.stringify(payload), { mode: 0o600 });
}

/** Whether a payload is already on disk, without reading it back: some of them are megabytes. */
async function payloadExists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** The stored payload, or undefined when the entry never had one or the chat was deleted. */
async function readPayload<T = unknown>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Where a ledger keeps its payloads, by entry id. */
export interface PayloadStore {
  exists(id: EvidenceId): Promise<boolean>;
  write(id: EvidenceId, payload: unknown): Promise<void>;
  read<T>(id: EvidenceId): Promise<T | undefined>;
}

/** One chat's evidence folder. */
export function diskPayloads(dataDir: string, sessionId: string): PayloadStore {
  return {
    exists: (id) => payloadExists(payloadPath(dataDir, sessionId, id)),
    write: (id, payload) => writePayload(payloadPath(dataDir, sessionId, id), payload),
    read: (id) => readPayload(payloadPath(dataDir, sessionId, id)),
  };
}

/** Payloads held for the ledger's lifetime, stored as JSON so a reader gets a copy, as from disk. */
export function memoryPayloads(): PayloadStore {
  const stored = new Map<EvidenceId, string>();
  return {
    exists: async (id) => stored.has(id),
    write: async (id, payload) => { stored.set(id, JSON.stringify(payload)); },
    read: async <T>(id: EvidenceId) => {
      const text = stored.get(id);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
  };
}
