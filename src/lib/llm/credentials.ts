import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { writeFileAtomic } from "@/lib/atomic-write";
import { authPath } from "@/lib/paths";
import { processSingleton } from "@/lib/process-state";
import { isRecord } from "@/lib/utils";

/**
 * pi-ai's `CredentialStore` over `auth.json` (`authPath()`). `modify` is the only write
 * path, and pi refreshes an OAuth token inside it: two refreshes of a rotating token would burn it,
 * so every write is serialised per provider in this process *and* across processes — the scheduler
 * runs in-process, but `pnpm eval` and the scripts do not.
 */

interface AuthFile {
  version: 1;
  credentials: Record<string, Credential>;
}

/** Long enough that no honest write is interrupted, short enough that a crash is not a deadlock. */
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;

export class FileCredentialStore implements CredentialStore {
  /** One promise chain per provider id: `CredentialStore.modify` promises mutual exclusion per provider. */
  private readonly chains = new Map<string, Promise<unknown>>();

  /** The path is resolved per operation so a test (or a second profile) can move `OFA_HOME` at will. */
  constructor(private readonly filePath: () => string = authPath) {}

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return (await this.load()).credentials[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const { credentials } = await this.load();
    return Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.serialize(providerId, async () => {
      const release = await this.lock(options?.signal);
      try {
        const file = await this.load();
        const current = file.credentials[providerId];
        const next = await fn(current);
        if (next === undefined) return current;
        await this.save({ ...file, credentials: { ...file.credentials, [providerId]: next } });
        return next;
      } finally {
        await release();
      }
    });
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await this.serialize(providerId, async () => {
      const release = await this.lock(options?.signal);
      try {
        const file = await this.load();
        if (!(providerId in file.credentials)) return;
        const credentials = { ...file.credentials };
        delete credentials[providerId];
        await this.save({ ...file, credentials });
      } finally {
        await release();
      }
    });
  }

  /** FIFO per provider, so a queued write always sees what the write before it stored. */
  private serialize<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    // A rejected chain must not reject everything queued behind it.
    this.chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * `auth.json.lock` guards the whole-file read-modify-write. The per-provider chain above orders
   * this process; the lockfile is what a second process has to respect. A lock nobody has touched
   * for 30 s belonged to a process that died holding it, so it is broken rather than waited on.
   */
  private async lock(signal?: AbortSignal): Promise<() => Promise<void>> {
    const lockFile = `${this.filePath()}.lock`;
    await mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      signal?.throwIfAborted();
      try {
        await (await open(lockFile, "wx", 0o600)).close();
        return () => rm(lockFile, { force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (await this.stale(lockFile)) {
          await rm(lockFile, { force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`${lockFile} is held by another process`);
        await delay(LOCK_RETRY_MS);
      }
    }
  }

  private async stale(lockFile: string): Promise<boolean> {
    try {
      return Date.now() - (await stat(lockFile)).mtimeMs > LOCK_STALE_MS;
    } catch {
      // Released while we were looking; the next `open` decides.
      return false;
    }
  }

  /** A missing, unreadable or foreign file reads as empty: a broken auth.json must not block a login. */
  private async load(): Promise<AuthFile> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath(), "utf8"));
      const credentials = isRecord(parsed) && isRecord(parsed.credentials) ? parsed.credentials : {};
      return { version: 1, credentials: credentials as Record<string, Credential> };
    } catch {
      return { version: 1, credentials: {} };
    }
  }

  /** Atomic, so a crash cannot truncate the tokens. */
  private async save(file: AuthFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFileAtomic(target, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  }
}

/**
 * One store per process, so a dev hot reload does not hand out a second set of locks. Every
 * `Models` collection shares it.
 */
export function credentialStore(): CredentialStore {
  return processSingleton<CredentialStore>("llm.credential-store", () => new FileCredentialStore());
}
