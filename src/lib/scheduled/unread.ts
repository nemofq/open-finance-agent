import { readdir, stat } from "node:fs/promises";
import { scheduledTaskRunsDir, scheduledTasksDir } from "@/lib/paths";
import { isMissingFile } from "@/lib/atomic-write";
import { processSingleton } from "@/lib/process-state";
import { UUID } from "@/lib/utils";
import { listScheduledRuns } from "./store";

/**
 * The sidebar's unread badge, which every open tab polls every few seconds. Counting means reading
 * a task's run files, so each task's count is kept with the modification time of its runs folder
 * and read again only when that changes. Every run write replaces the file by a rename into the
 * folder (`writeFileAtomic`), which moves the folder's time, so a new or updated run is never
 * missed. The time is read before the files, so a write racing the count only costs a re-read.
 * Some file systems stamp times at a coarse tick, so two writes a moment apart can share one; a
 * folder touched within the last `SETTLE_MS` is therefore always counted afresh.
 */
interface Counted {
  modified: bigint;
  unread: number;
}

const SETTLE_MS = 2_000;

/** Keyed by the runs folder, so a different data folder (a test's) never reuses a count. */
function counts(): Map<string, Counted> {
  return processSingleton("scheduled.unread-counts", () => new Map<string, Counted>());
}

async function modifiedAt(dir: string): Promise<bigint | null> {
  try {
    return (await stat(dir, { bigint: true })).mtimeNs;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function taskIds(): Promise<string[]> {
  try {
    return (await readdir(scheduledTasksDir())).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

/**
 * Unread runs across every task, counted as the Scheduled page counts them: among each task's
 * newest runs (`listScheduledRuns`' default window).
 */
export async function unreadRunCount(): Promise<number> {
  const cache = counts();
  const seen = new Set<string>();
  let total = 0;
  for (const id of await taskIds()) {
    // A stray file whose name is not a task id has no runs to count.
    if (!UUID.test(id)) continue;
    const dir = scheduledTaskRunsDir(id);
    const modified = await modifiedAt(dir);
    if (modified === null) continue;
    seen.add(dir);
    const cached = cache.get(dir);
    const settled = Date.now() - Number(modified / BigInt(1_000_000)) > SETTLE_MS;
    if (settled && cached?.modified === modified) {
      total += cached.unread;
      continue;
    }
    const { runs } = await listScheduledRuns(id);
    const unread = runs.filter((run) => run.unread).length;
    cache.set(dir, { modified, unread });
    total += unread;
  }
  // A deleted task takes its runs folder with it; its count goes too.
  for (const dir of cache.keys()) if (!seen.has(dir)) cache.delete(dir);
  return total;
}
