import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A request at a provider boundary, below the agent-tool layer. Arguments must be JSON-safe: eval
 * snapshots persist them and deliberately never include credentials or request headers.
 */
export interface SourceRequest {
  source: string;
  operation: string;
  args: Record<string, unknown>;
}

export interface SourceSnapshot {
  resolve<T>(request: SourceRequest, load: () => Promise<T>, toolCallId?: string): Promise<T>;
}

interface SnapshotContext {
  snapshot: SourceSnapshot;
  toolCallId?: string;
}

const storage = new AsyncLocalStorage<SnapshotContext>();

/** Run a benchmark operation against one task's source-data snapshot. */
export function withSourceSnapshot<T>(snapshot: SourceSnapshot, run: () => Promise<T>): Promise<T> {
  return storage.run({ snapshot }, run);
}

/** Attribute every provider request made by one tool execution to its model-facing call id. */
export function withSourceToolCall<T>(toolCallId: string, run: () => Promise<T>): Promise<T> {
  const active = storage.getStore();
  if (!active) return run();
  return storage.run({ ...active, toolCallId }, run);
}

/**
 * Read or record one provider resource. Outside the benchmark this is exactly `load()` and adds
 * no cache, persistence or behavioural change to the product. Nothing asks whether a snapshot is
 * active, so a provider makes the same request, and shapes the same result, in both.
 */
export function sourceRequest<T>(request: SourceRequest, load: () => Promise<T>): Promise<T> {
  const active = storage.getStore();
  return active ? active.snapshot.resolve(request, load, active.toolCallId) : load();
}
