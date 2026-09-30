import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CheckpointIdentity, resumeCheckpoint, writeCheckpoint } from "./checkpoint";
import type { TaskEvalResult } from "../types";

const identity: CheckpointIdentity = {
  version: "1",
  datasetVersion: "mock-mcp-v5",
  fixtureMode: "offline",
  agents: ["p/agent"],
  judge: "p/judge",
  thinking: "medium",
  judgeThinking: "high",
  taskIds: ["retail-01-nvda-beat-and-drop"],
  repeat: 2,
  taskDatasetHashes: { "retail-01-nvda-beat-and-drop": "abc" },
};
const results = [{ agent: "p/agent", repeat: 1, status: "completed" }] as unknown as TaskEvalResult[];

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "ofa-checkpoint-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("checkpoints", () => {
  it("round-trip the results of the same run, atomically into a new folder", () => {
    const file = path.join(dir, "nested", "checkpoint.json");
    writeCheckpoint(file, { ...identity, results });
    expect(readdirSync(path.dirname(file))).toEqual(["checkpoint.json"]);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual([...Object.keys(identity), "results"]);
    expect(resumeCheckpoint(file, identity)).toEqual(results);
  });

  it("start empty when there is nothing to resume", () => {
    const file = path.join(dir, "missing.json");
    expect(resumeCheckpoint(file, identity)).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("refuse a checkpoint from a different run and say what differs", () => {
    const file = path.join(dir, "checkpoint.json");
    writeCheckpoint(file, { ...identity, results });
    expect(() => resumeCheckpoint(file, { ...identity, judge: "p/other" })).toThrow("Checkpoint judge does not match");
    expect(() => resumeCheckpoint(file, { ...identity, repeat: 3 })).toThrow("repeat count does not match");
    expect(() => resumeCheckpoint(file, { ...identity, judgeThinking: undefined })).toThrow("judge thinking setting does not match");
    expect(() => resumeCheckpoint(file, { ...identity, judgeThinking: "max" })).toThrow("judge thinking setting does not match");
    expect(() => resumeCheckpoint(file, { ...identity, fixtureMode: "live" })).toThrow("fixture mode offline does not match live");
    expect(() => resumeCheckpoint(file, { ...identity, taskDatasetHashes: { "retail-01-nvda-beat-and-drop": "changed" } }))
      .toThrow("task dataset hashes do not match");
  });
});
