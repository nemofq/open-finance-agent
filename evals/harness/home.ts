import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setCredentialsFile } from "@/lib/paths";

/**
 * Every run works in a throwaway data folder, and every task cell in a folder of its own inside it.
 * Only the chosen `config.json` is copied in; sessions, evidence payloads and caches the run
 * creates never touch the developer's chats.
 *
 * Sign-ins are the exception: the run reads and refreshes the `auth.json` beside the chosen config
 * in place, through the app's credential store and its cross-process lock. A copy would lose a
 * refreshed token with the folder, and a provider that rotates refresh tokens would then have
 * spent the one the real file holds, signing the developer's app out.
 */

export interface TempHome {
  /** The value `OFA_HOME` was set to. */
  dir: string;
  /** Delete the folder and restore the previous `OFA_HOME` and credentials file. */
  remove(): void;
  /** Leave the folder on disk; still restores the previous `OFA_HOME` and credentials file. */
  keep(): void;
}

/**
 * Create the folder, copy `sourceConfig` into it, point `OFA_HOME` at it and the credential store at
 * the `auth.json` beside `sourceConfig`. `dataDir()` reads the variable on every call, so this must
 * happen before the first store call of a run.
 */
export function createTempHome(sourceConfig: string): TempHome {
  if (!existsSync(sourceConfig)) {
    throw new Error(`No config at ${sourceConfig}. Configure a provider in Settings, or pass --config <path>.`);
  }

  // mkdtemp creates the folder owner-only (0700).
  const dir = mkdtempSync(path.join(tmpdir(), "ofa-eval-"));
  copyFileSync(sourceConfig, path.join(dir, "config.json"));

  const previous = process.env.OFA_HOME;
  process.env.OFA_HOME = dir;
  const previousCredentials = setCredentialsFile(path.join(path.dirname(sourceConfig), "auth.json"));

  const restore = () => {
    setCredentialsFile(previousCredentials);
    if (previous === undefined) delete process.env.OFA_HOME;
    else process.env.OFA_HOME = previous;
  };

  return {
    dir,
    remove: () => {
      restore();
      rmSync(dir, { recursive: true, force: true });
    },
    keep: restore,
  };
}

/**
 * A fresh folder for one task cell, under the run's home so removing or keeping the run covers it.
 * Only the run's `config.json` is copied in, so a task starts with no profile, holdings, memory or
 * chats from the task before it. The runner points `dataDir()` at it with `withDataDir`, which the
 * credential store ignores.
 */
export function createTaskHome(runDir: string, name: string): string {
  const tasks = path.join(runDir, "tasks");
  mkdirSync(tasks, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(path.join(tasks, `${name}-`));
  const config = path.join(runDir, "config.json");
  if (existsSync(config)) copyFileSync(config, path.join(dir, "config.json"));
  return dir;
}
