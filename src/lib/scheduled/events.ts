import { processSingleton } from "@/lib/process-state";

/**
 * The seam between editing tasks and running them. The task service announces every change; the
 * runner, which owns the timers, listens once it has started. Neither imports the other, so the
 * agent tool can edit tasks without reaching the turn runtime the runner drives.
 */
type Listener = () => void;

// One set per process for the same reason as the scheduler: Next can load this module more than
// once (the instrumentation bundle, the route bundles, a dev reload), and a change made through any
// copy must reach the one running scheduler.
function listeners(): Set<Listener> {
  return processSingleton("scheduled.task-listeners", () => new Set<Listener>());
}

/** Subscribe to task changes; returns the unsubscribe. */
export function onTasksChanged(listener: Listener): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}

/** A task was created, edited, paused or deleted: the next due time may have moved. */
export function tasksChanged(): void {
  for (const listener of listeners()) listener();
}
