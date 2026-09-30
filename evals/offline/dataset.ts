import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceContract } from "./coverage";
import { type CanonicalDatabase, loadCanonicalDatabase } from "./mock-mcp-data";
import type { EvalTask } from "../types";

/**
 * The benchmark's offline dataset: the compiled database under `evals/dataset/` that the mock MCP
 * serves when the benchmark runs `--offline`. Loaded once per process.
 */

let database: ReturnType<typeof loadCanonicalDatabase> | undefined;

function datasetDir(): string {
  return fileURLToPath(new URL("../dataset/", import.meta.url));
}

export function datasetPath(dir = datasetDir()): string {
  return path.join(dir, "db.json.gz");
}

export function loadDataset() {
  if (!database) {
    const file = datasetPath();
    if (!existsSync(file)) throw new Error(`Canonical mock MCP database is missing at ${file}. Run "npx tsx scripts/compile-offline-dataset.ts --source <capture backup>" first.`);
    database = loadCanonicalDatabase(file);
  }
  return database;
}

export function datasetTaskHash(taskId: string): string | undefined {
  return loadDataset().scopes[taskId]?.hash;
}

export function validateDatasetScopes(taskIds: string[], db: CanonicalDatabase = loadDataset()): string[] {
  return taskIds.flatMap((id) => {
    const scope = db.scopes[id];
    if (!scope) return [`${id}: missing canonical mock MCP task scope`];
    if (!scope.cutoff || !scope.hash || scope.tickers.length === 0) return [`${id}: incomplete canonical mock MCP task scope`];
    return [];
  });
}

/**
 * Offline preflight: every selected task has a compiled scope that meets its evidence contract. The
 * compiler passes the database it just wrote.
 */
export function validateDatasetTasks(tasks: EvalTask[], db: CanonicalDatabase = loadDataset()): string[] {
  return [...validateDatasetScopes(tasks.map((task) => task.id), db), ...validateEvidenceContract(db, tasks)];
}
