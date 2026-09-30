import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomicSync } from "@/lib/atomic-write";
import type { SourceRequest } from "@/lib/data/source-snapshot";
import { stableStringify } from "@/lib/text/stable-json";
import { isRecord } from "@/lib/utils";

/**
 * Maintainer-only: the capture files `--fixtures record` writes and
 * `scripts/compile-offline-dataset.ts --source` reads, one per task. A capture sits below the
 * agent tools — EDGAR HTTP resources, MCP RPC results, Tavily pages and quote-provider responses —
 * so the compiled dataset does not depend on which tool or call order a model chose.
 */
export const CAPTURE_VERSION = 3;

export interface CapturedResource {
  request: SourceRequest;
  value: unknown;
  recordedAt: string;
  asOf: string;
}

export interface TaskCapture {
  version: number;
  taskId: string;
  asOf?: string;
  /**
   * Tool-level recordings older captures carry. The dataset compiler still reads them, so a
   * capture keeps them untouched; recording never adds any.
   */
  entries: Record<string, unknown>;
  /** Provider resources, keyed by their canonical request. */
  resources: Record<string, CapturedResource>;
}

/** Where `record` writes; gitignored, and the compiler's default `--source`. */
export function defaultCaptureDir(): string {
  return fileURLToPath(new URL("../fixtures/", import.meta.url));
}

export function capturePath(taskId: string, dir: string = defaultCaptureDir()): string {
  return path.join(dir, `${taskId}.json`);
}

function recordObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

/** Read a task's capture, or an empty one when the task has none yet. */
export function loadCapture(taskId: string, dir: string = defaultCaptureDir()): TaskCapture {
  const file = capturePath(taskId, dir);
  if (!existsSync(file)) return { version: CAPTURE_VERSION, taskId, entries: {}, resources: {} };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Capture file ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const root = recordObject(raw, `Capture file ${file}`);
  const entries = recordObject(root.entries ?? {}, `Capture file ${file} entries`);
  const rawResources = recordObject(root.resources ?? {}, `Capture file ${file} resources`);
  const resources: Record<string, CapturedResource> = {};
  for (const [key, value] of Object.entries(rawResources)) {
    resources[key] = recordObject(value, `Captured resource ${key} in ${file}`) as unknown as CapturedResource;
  }
  const asOf = typeof root.asOf === "string" ? root.asOf : undefined;
  const version = typeof root.version === "number" ? root.version : CAPTURE_VERSION;
  return { version, taskId, ...(asOf ? { asOf } : {}), entries, resources };
}

export function saveCapture(capture: TaskCapture, dir: string = defaultCaptureDir()): void {
  mkdirSync(dir, { recursive: true });
  const out: TaskCapture = {
    version: CAPTURE_VERSION,
    taskId: capture.taskId,
    ...(capture.asOf ? { asOf: capture.asOf } : {}),
    entries: capture.entries,
    resources: capture.resources,
  };
  writeFileAtomicSync(capturePath(capture.taskId, dir), `${JSON.stringify(out, null, 2)}\n`);
}

function canonicalValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalValue(item));
    return key && ["forms", "includeDomains", "include_domains", "symbols", "urls"].includes(key)
      ? [...items].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
      : items;
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      if (child === undefined) continue;
      result[childKey] = canonicalValue(child, childKey);
    }
    return result;
  }
  if (typeof value !== "string") return value;
  const compact = value.trim().replace(/\s+/g, " ");
  if (key && ["symbol", "ticker"].includes(key)) return compact.toUpperCase();
  if (key === "query") return compact.toLowerCase();
  return compact;
}

export function canonicalSourceRequest(request: SourceRequest): SourceRequest {
  const args = canonicalValue(request.args) as Record<string, unknown>;
  if (request.source === "mcp:alphavantage") {
    if (args.outputsize === "compact") delete args.outputsize;
    if (args.datatype === "json") delete args.datatype;
    if (args.return_full_data === true) delete args.return_full_data;
  }
  return { source: request.source, operation: request.operation, args };
}

export function captureKey(request: SourceRequest): string {
  const normalized = canonicalSourceRequest(request);
  return `${normalized.source}:${normalized.operation}:${stableStringify(normalized.args)}`;
}

/** Enforce the task cutoff locally even if a search provider returns an out-of-range result. */
export function valueWithinAsOf(request: SourceRequest, value: unknown, asOf: string): unknown {
  if (request.source !== "tavily" || request.operation !== "search" || !isRecord(value)) return value;
  const results = Array.isArray(value.results)
    ? value.results.filter((result) => {
        if (!isRecord(result) || typeof result.publishedDate !== "string") return true;
        return result.publishedDate.slice(0, 10) <= asOf;
      })
    : value.results;
  return { ...value, results };
}
