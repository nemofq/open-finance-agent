import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const scopedDataDir = new AsyncLocalStorage<string>();

/** The process's data root: OFA_HOME (useful for tests and multiple profiles), else the default. */
function processDataDir(): string {
  return process.env.OFA_HOME || path.join(homedir(), ".open-finance-agent");
}

/** Root of all user data: the folder `withDataDir` set for this call, else the process's. */
export function dataDir(): string {
  return scopedDataDir.getStore() ?? processDataDir();
}

/**
 * Run `fn`, and everything it awaits, with `dir` as the data root, leaving OFA_HOME alone. The
 * benchmark gives each task its own folder this way, so no task sees another's profile, holdings or
 * memory; the app never sets one.
 */
export function withDataDir<T>(dir: string, fn: () => T): T {
  return scopedDataDir.run(dir, fn);
}

export function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

/** Persistent scheduled-task definitions and their run history. */
export function scheduledTasksDir(): string {
  return path.join(dataDir(), "scheduled-tasks");
}

function scheduledRunsDir(): string {
  return path.join(dataDir(), "scheduled-runs");
}

export function scheduledTaskRunsDir(taskId: string): string {
  return path.join(scheduledRunsDir(), taskId);
}

export function userSkillsDir(): string {
  return path.join(dataDir(), "skills");
}

export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

export function configPath(): string {
  return path.join(dataDir(), "config.json");
}

/** Set by `setCredentialsFile`; the app never sets it. */
let credentialsFile: string | undefined;

/**
 * Provider credentials pi-ai reads and refreshes; never in config.json, never sent to the browser.
 * Under the process's data root, never a `withDataDir` folder: a sign-in is the person's, not one
 * benchmark task's, and with rotating refresh tokens a refresh written to a copy spends the token
 * the real file still holds.
 */
export function authPath(): string {
  return credentialsFile ?? path.join(processDataDir(), "auth.json");
}

/**
 * Read and write credentials at `file` instead of the data root's own, until called with
 * undefined; returns the file it replaces, for the caller to restore. The benchmark runs against a
 * temporary data root but signs in with the developer's real `auth.json`, so a token refreshed
 * during a run lands where the app reads it, behind the same cross-process lock the app takes.
 */
export function setCredentialsFile(file: string | undefined): string | undefined {
  const previous = credentialsFile;
  credentialsFile = file;
  return previous;
}

export function memoryPath(): string {
  return path.join(dataDir(), "memory.md");
}

/** The investor profile, edited only in Settings. */
export function profilePath(): string {
  return path.join(dataDir(), "profile.json");
}

/** Accounts, instruments and the append-only transaction ledger. */
export function portfolioDir(): string {
  return path.join(dataDir(), "portfolio");
}

/**
 * One chat's folder, beside its `<id>.json`: its evidence payloads (`evidence/`, laid out by
 * `src/lib/evidence/store.ts`) and its attachments. Deleted with the chat.
 */
export function sessionDir(sessionId: string): string {
  return path.join(sessionsDir(), sessionId);
}

/** Files the user attached to one chat, named by content hash; deleted with the chat. */
export function sessionAttachmentsDir(sessionId: string): string {
  return path.join(sessionDir(sessionId), "attachments");
}

/**
 * Documents uploaded but not yet sent. A chat is created on the first send, so an
 * upload made while composing has no session to belong to; the message POST claims these files
 * into `sessionAttachmentsDir`. Whatever is never claimed is swept after a day.
 */
export function stagingDir(): string {
  return path.join(dataDir(), "staging");
}

/**
 * Assembled calculator runtimes, one folder per version. Always under the process's data root, never
 * a `withDataDir` folder: the calculator keeps one runtime per process and boots every later job
 * from where it was first assembled, which a scoped folder may no longer be.
 */
export function runtimeDir(): string {
  return path.join(processDataDir(), "runtime");
}

/** Skills shipped with the repo, alongside the user's own in userSkillsDir(). */
export function bundledSkillsDir(): string {
  return path.join(process.cwd(), "skills");
}

/** Idempotently create the data directory tree. */
export function ensureDataDirs(): void {
  for (const dir of [dataDir(), sessionsDir(), scheduledTasksDir(), scheduledRunsDir(), userSkillsDir(), cacheDir(), stagingDir()]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
