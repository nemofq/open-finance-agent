/**
 * State that must exist once per server process. Next loads a module more than once (the
 * instrumentation bundle, each route bundle, a dev reload), so a module-level `let` can hold a
 * different value in each copy: a write queue in one copy does not order writes made through
 * another, and a runtime started by one copy is invisible to the rest. Everything here lives on
 * `globalThis` instead, under one registry that every copy of this module finds.
 */

/** `Symbol.for` resolves to the same symbol in every module copy, so they all share one registry. */
const REGISTRY = Symbol.for("open-finance-agent.process-state");

type Host = typeof globalThis & { [REGISTRY]?: Map<string, unknown> };

function registry(): Map<string, unknown> {
  const host = globalThis as Host;
  return (host[REGISTRY] ??= new Map());
}

/**
 * The process's one value under `key`, created by `create` on first use. Call it where the value
 * is used rather than capturing it at module load, so `resetProcessSingletons` can take effect.
 *
 * A key names one shape: a change to the stored value's shape takes a new key, or a dev reload
 * would hand the new code the old value.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const values = registry();
  if (values.has(key)) return values.get(key) as T;
  const value = create();
  values.set(key, value);
  return value;
}

/** For tests: forget one value, or every value, so the next `processSingleton` call creates it afresh. */
export function resetProcessSingletons(key?: string): void {
  if (key === undefined) registry().clear();
  else registry().delete(key);
}

/**
 * Run `task` once every task queued before it under the same `key` has settled, whichever module
 * copy queued it. A failed task does not stop the queue. Only this process is ordered: another
 * process writing the same files is not locked out.
 *
 * Key by what the tasks write, such as a file's absolute path, so writes to unrelated files (the
 * benchmark gives each task its own data folder) never wait for each other.
 */
export function runSerially<T>(key: string, task: () => Promise<T>): Promise<T> {
  const queues = processSingleton("serial-queues", () => new Map<string, Promise<unknown>>());
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  // Drop the entry once the queue drains, so a process touching many keys does not keep them all.
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}
