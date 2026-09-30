import { randomUUID } from "node:crypto";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Replace a file in one step: write a temporary file beside it, then rename it over the target, so
 * a crash mid-write never leaves a truncated file where a reader would find it. The parent folder
 * must exist; callers create it with the mode they need, or use `writeJsonFile`.
 */

export interface AtomicWriteOptions {
  /**
   * The file's permission bits, such as `0o600` for anything private. The rename carries the
   * temporary file's mode onto the target, so this is the mode the target ends up with.
   */
  mode?: number;
}

/**
 * Unique per write. A name made from the pid alone is shared by two writes of the same file in one
 * process, and the second would write into the first one's temporary file or rename it away.
 */
function temporaryPath(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`;
}

export async function writeFileAtomic(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const temporary = temporaryPath(file);
  try {
    // `wx`: the temporary file is always created here, so `mode` applies to it.
    await writeFile(temporary, data, { flag: "wx", mode: options.mode });
    // The umask may have cleared bits `mode` asked for; set them exactly.
    if (options.mode !== undefined) await chmod(temporary, options.mode);
    await rename(temporary, file);
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * One of the app's JSON documents, written the one way they all are: indented, owner-only, and
 * atomically, into a folder created owner-only when it is missing.
 */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** Whether a file call failed because the file, or a folder on its path, is not there. */
export function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** `writeFileAtomic` for the few callers that must stay synchronous, such as the config store. */
export function writeFileAtomicSync(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): void {
  const temporary = temporaryPath(file);
  try {
    writeFileSync(temporary, data, { flag: "wx", mode: options.mode });
    if (options.mode !== undefined) chmodSync(temporary, options.mode);
    renameSync(temporary, file);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}
