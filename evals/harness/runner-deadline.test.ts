import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runTurn } from "@/lib/agent/turn";
import type { TurnResult } from "@/lib/agent/turn-types";
import { defaultConfig } from "@/lib/config/schema";
import { runTask } from "./runner";
import { EVAL_HUNG_TURN_MS } from "./turn-bounds";
import { RETAIL_EVAL_TASKS } from "../tasks";

vi.mock("@/lib/agent/turn", () => ({ runTurn: vi.fn() }));
let home: string;
const empty = (): TurnResult => ({ status: "failed", finalText: "", messages: [], checks: [], evidence: [],
  compactions: [], followUps: 0, durationMs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 } });

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-eval-deadline-"));
  vi.stubEnv("OFA_HOME", home);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const options = () => ({ config: defaultConfig(), task: RETAIL_EVAL_TASKS[0], agent: { provider: "offline", model: "test" },
  judge: { provider: "offline", model: "test" }, repeat: 1, fixtureMode: "offline" as const, policyMode: "enforce" as const });

it("leaves every conversation turn to the loop's own deadline, as in a chat", async () => {
  let turns = 0;
  vi.mocked(runTurn).mockImplementation(async (input) => {
    expect(input.execution?.deadlineAt).toBeUndefined();
    turns += 1;
    return empty();
  });
  await runTask({ ...options(), task: { ...RETAIL_EVAL_TASKS[0], followUpPrompts: ["Only the requested figures."] } });
  expect(turns).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("retains the outer abort when a turn ignores its deadline", async () => {
  const abort = vi.fn();
  vi.mocked(runTurn).mockImplementation(async (input) => {
    input.onAgent!({ abort } as unknown as Agent);
    await vi.advanceTimersByTimeAsync(EVAL_HUNG_TURN_MS + 1000);
    return empty();
  });
  const result = await runTask(options());
  expect(abort).toHaveBeenCalledTimes(2);
  expect(result.error).toBe("Agent turn was still running after 20 minutes, past its own deadline, and was aborted");
  expect(result.status).toBe("agent_timeout");
  expect(vi.getTimerCount()).toBe(0);
});
