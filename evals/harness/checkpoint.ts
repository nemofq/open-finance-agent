import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/atomic-write";
import type { RunCheckpoint, TaskEvalResult } from "../types";

/**
 * `--checkpoint` writes the run so far after every task cell; `--resume` continues only a run with
 * the same identity: benchmark and dataset versions, agents, judge, the agent's and the judge's
 * thinking, tasks, repeats and task dataset hashes.
 */

export type CheckpointIdentity = Omit<RunCheckpoint, "results">;

/** The results a matching checkpoint holds; none when the file does not exist yet. */
export function resumeCheckpoint(file: string, expectedCheckpoint: CheckpointIdentity): TaskEvalResult[] {
  if (!existsSync(file)) return [];
  const fixtureMode = expectedCheckpoint.fixtureMode;
  const checkpoint = JSON.parse(readFileSync(file, "utf8")) as RunCheckpoint;
  if (checkpoint.fixtureMode !== fixtureMode) {
    throw new Error(`Checkpoint fixture mode ${checkpoint.fixtureMode} does not match ${fixtureMode}.`);
  }
  if (checkpoint.version !== expectedCheckpoint.version) throw new Error(`Checkpoint benchmark version ${checkpoint.version} does not match ${expectedCheckpoint.version}.`);
  if (fixtureMode === "offline" && checkpoint.datasetVersion !== expectedCheckpoint.datasetVersion) throw new Error(`Checkpoint dataset version ${checkpoint.datasetVersion ?? "missing"} does not match ${expectedCheckpoint.datasetVersion}.`);
  if (JSON.stringify(checkpoint.agents) !== JSON.stringify(expectedCheckpoint.agents)) throw new Error("Checkpoint agent set does not match the requested run.");
  if (checkpoint.judge !== expectedCheckpoint.judge) throw new Error("Checkpoint judge does not match the requested run.");
  if (checkpoint.thinking !== expectedCheckpoint.thinking) throw new Error("Checkpoint thinking setting does not match the requested run.");
  if (checkpoint.judgeThinking !== expectedCheckpoint.judgeThinking) throw new Error("Checkpoint judge thinking setting does not match the requested run.");
  if (checkpoint.judgeRepeat !== expectedCheckpoint.judgeRepeat) throw new Error("Checkpoint judge repeat count does not match the requested run.");
  if (JSON.stringify(checkpoint.taskIds) !== JSON.stringify(expectedCheckpoint.taskIds)) throw new Error("Checkpoint task set does not match the requested run.");
  if (checkpoint.repeat !== expectedCheckpoint.repeat) throw new Error("Checkpoint repeat count does not match the requested run.");
  if (JSON.stringify(checkpoint.taskDatasetHashes) !== JSON.stringify(expectedCheckpoint.taskDatasetHashes)) throw new Error("Checkpoint task dataset hashes do not match the current dataset.");
  return checkpoint.results;
}

/** Atomic, so a run killed mid-write leaves the previous checkpoint to resume from. */
export function writeCheckpoint(file: string, checkpoint: RunCheckpoint): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomicSync(file, JSON.stringify(checkpoint, null, 2));
}
