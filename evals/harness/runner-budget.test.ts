import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonObject, Usage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "@/lib/agent/turn";
import type { TurnInput, TurnResult } from "@/lib/agent/turn-types";
import { defaultConfig } from "@/lib/config/schema";
import { countDiagnostics } from "../reporting/diagnostics";
import { evaluateWithJudge } from "../scoring/judge";
import { runBenchmark, runTask } from "./runner";
import { budgetExhausted, EVAL_HUNG_TURN_MS } from "./turn-bounds";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { type EvalTask, type JudgeEvaluationResult, type ToolCallTrace } from "../types";

/**
 * The loop is mocked. It enforces the model-call limit itself, so these tests check the runner
 * hands it the eval deadline and classifies the loop's typed stop reasons. Model calls are driven
 * with the wire events a real turn emits: `message_start` before every message and `usage` after
 * every model call.
 */
vi.mock("@/lib/agent/turn", () => ({ runTurn: vi.fn() }));
vi.mock("../scoring/judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scoring/judge")>()),
  evaluateWithJudge: vi.fn(),
}));

const verdict: JudgeEvaluationResult = {
  rubricItems: [],
  dimensionScores: { intent: 10, financial: 10, grounding: 10, clarity: 5 },
  intentScore: 10,
  intentFeedback: "",
  financialScore: 10,
  financialFeedback: "",
  groundingScore: 10,
  groundingFeedback: "",
  retailClarityScore: 5,
  retailClarityFeedback: "",
  totalJudgeScore: 35,
  maxJudgeScore: 80,
  criticalMisses: [],
  criticalContradictions: [],
  overallVerdict: "ok",
  judgeModel: "offline/test",
  promptVersion: "test",
};

let home: string;
const TASK = RETAIL_EVAL_TASKS[0];

const empty = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  status: "failed",
  finalText: "",
  messages: [],
  checks: [],
  evidence: [],
  compactions: [],
  followUps: 0,
  durationMs: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 },
  ...overrides,
});

const usage = (output: number): Usage => ({
  input: 10,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 10 + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** One model call as the sink sees it. */
function call(input: TurnInput, output = 50): void {
  input.sink?.({ type: "message_start" });
  input.sink?.({ type: "usage", usage: usage(output) });
}

const options = (task: EvalTask = TASK) => ({
  config: defaultConfig(),
  task,
  agent: { provider: "offline", model: "test" },
  judge: { provider: "offline", model: "test" },
  repeat: 1,
  fixtureMode: "offline" as const,
  policyMode: "enforce" as const,
});

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-eval-budget-"));
  vi.stubEnv("OFA_HOME", home);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("budget enforcement", () => {
  it("leaves the loop its own execution budget, deadline and call limit, as in a chat", async () => {
    vi.mocked(runTurn).mockResolvedValue(empty());

    await runTask(options());

    const input = vi.mocked(runTurn).mock.calls[0][0];
    expect(input.execution).toBeUndefined();
  });

  it("judges and scores a call-limited turn that still produced an answer, keeping agent_budget", async () => {
    vi.mocked(evaluateWithJudge).mockResolvedValue(verdict);
    vi.mocked(runTurn).mockResolvedValue(
      empty({ status: "partial", finalText: "A bounded answer.", error: "The turn reached its model-call limit", stop: "calls" }),
    );

    const result = await runTask(options());

    expect(evaluateWithJudge).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("agent_budget");
    expect(result.valid).toBe(true);
    expect(result.judgeResult?.totalJudgeScore).toBe(35);
    expect(result.totalScore).toBe(result.deterministicCheck.score + 35);
    expect(result.error).toBe("The turn reached its model-call limit");
    expect(result.stop).toBe("calls");
  });

  it("scores a call-limited turn without an answer as zero and skips the judge", async () => {
    vi.mocked(runTurn).mockResolvedValue(empty({ error: "The turn reached its model-call limit", stop: "calls" }));

    const result = await runTask(options());

    expect(evaluateWithJudge).not.toHaveBeenCalled();
    expect(result.status).toBe("agent_budget");
    expect(result.valid).toBe(true);
    expect(result.totalScore).toBe(0);
    expect(result.judgeResult).toBeUndefined();
  });

  it("leaves an infrastructure error that still answered unjudged and unscored", async () => {
    vi.mocked(runTurn).mockResolvedValue(empty({ status: "partial", finalText: "A draft.", infrastructureError: true }));

    const result = await runTask(options());

    expect(evaluateWithJudge).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "infra_error", valid: false });
    expect(result.totalScore).toBeUndefined();
  });

  it("classifies the loop's stalled-research stop as agent_budget", async () => {
    vi.mocked(runTurn).mockResolvedValue(
      empty({ error: "Research stopped after repeated tool rounds produced no new usable evidence", stop: "stalled" }),
    );
    const result = await runTask(options());
    expect(result.status).toBe("agent_budget");
    expect(budgetExhausted("tool_failures")).toBe(true);
  });

  it("keeps the loop's execution deadline and the safety bound as timeouts, not budgets", async () => {
    expect(budgetExhausted("calls")).toBe(true);
    expect(budgetExhausted("deadline")).toBe(false);
    expect(budgetExhausted(undefined)).toBe(false);

    vi.mocked(runTurn).mockResolvedValue(empty({ finalText: "An incomplete answer before timeout.", error: "The turn reached its execution deadline", stop: "deadline" }));
    const result = await runTask(options());
    expect(result.status).toBe("agent_timeout");
    expect(result.totalScore).toBe(0);
    expect(evaluateWithJudge).not.toHaveBeenCalled();
  });

  it("classifies by the stop reason, never by the wording of the error", async () => {
    // A reworded budget message still ends on the budget, and is judged when it answered.
    vi.mocked(evaluateWithJudge).mockResolvedValue(verdict);
    vi.mocked(runTurn).mockResolvedValue(empty({ status: "partial", finalText: "A bounded answer.", error: "Out of calls", stop: "calls" }));
    expect(await runTask(options())).toMatchObject({ status: "agent_budget", totalScore: expect.any(Number) });

    // A provider error that happens to say "timeout" is an agent error, not a timeout.
    vi.mocked(runTurn).mockResolvedValue(empty({ error: "Upstream gateway timeout while parsing the reply" }));
    const result = await runTask(options());
    expect(result).toMatchObject({ status: "agent_error", totalScore: 0 });
    expect(result.stop).toBeUndefined();
  });

  it("forwards every wire event to the runner's trace", async () => {
    vi.mocked(runTurn).mockImplementation(async (input) => {
      call(input);
      input.sink?.({ type: "tool_call_start", id: "t1", name: "edgar_financials", args: { ticker: "NVDA" } });
      input.sink?.({ type: "tool_call_end", id: "t1", result: "ok", isError: false });
      return empty();
    });

    const result = await runTask(options());

    expect(result.toolCalls.map((item) => item.toolName)).toEqual(["edgar_financials"]);
  });
});

describe("hung-turn backstop", () => {
  it("aborts a turn that runs past its own deadline, as agent_timeout", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    vi.mocked(runTurn).mockImplementation(async (input) => {
      input.onAgent!({ abort } as unknown as Agent);
      await vi.advanceTimersByTimeAsync(EVAL_HUNG_TURN_MS + 1_000);
      return empty();
    });

    const result = await runTask(options());

    // Once at the backstop, then once more from the loop that refuses a queued follow-up request.
    expect(abort).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("agent_timeout");
    expect(result.stop).toBe("deadline");
    expect(result.error).toBe("Agent turn was still running after 20 minutes, past its own deadline, and was aborted");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("diagnostics", () => {
  const trace = (id: string, output: string, isError: boolean): ToolCallTrace => ({
    toolCallId: id,
    toolName: "edgar_financials",
    args: {},
    output,
    durationMs: 1,
    isError,
  });

  const verification = (unverified: number, repaired: number) => ({ checked: 20, supported: 20 - unverified - repaired, repaired, unverified });

  const report = (id: string, details: JsonObject, isError = false): AgentMessage => ({
    role: "toolResult",
    toolCallId: id,
    toolName: "create_report",
    content: [{ type: "text", text: "The report is open beside the chat." }],
    details,
    isError,
    timestamp: 0,
  });

  it("counts argument errors, fallback reports, and the validator's unverified and repaired report figures", () => {
    const diagnostics = countDiagnostics(
      [
        trace("a", "Input validation error: ticker is required", true),
        trace("b", "Invalid arguments for tool edgar_financials", true),
        // Mentions the phrase but succeeded, so it is data, not a rejected call.
        trace("c", "Invalid arguments were discussed in this filing", false),
        trace("d", "Upstream returned 503", true),
      ],
      [
        report("r1", { rendered: "answer", verification: verification(2, 0) }),
        report("r2", { verification: verification(3, 1) }),
        report("r5", { verification: verification(6, 2) }),
        report("r3", { rendered: "answer", verification: verification(5, 0) }, true),
        { ...report("r4", { rendered: "answer", verification: verification(7, 0) }), toolName: "edgar_financials" } as AgentMessage,
      ],
    );

    expect(diagnostics).toEqual({ toolArgumentErrors: 2, fallbackReports: 1, unverifiedFigures: 11, repairedFigures: 3 });
  });

  it("records the counts on each result and sums them per agent and per run", async () => {
    vi.mocked(runTurn).mockImplementation(async (input) => {
      call(input);
      input.sink?.({ type: "tool_call_start", id: "t1", name: "edgar_financials", args: {} });
      input.sink?.({ type: "tool_call_end", id: "t1", result: "Input validation error: ticker", isError: true });
      await input.store.update(input.session.id, {
        messages: [report("r1", { rendered: "answer", verification: verification(4, 0) })],
      });
      return empty();
    });

    const summary = await runBenchmark({ ...options(), agents: [options().agent], tasks: [TASK], repeat: 2 });

    const expected = { toolArgumentErrors: 1, fallbackReports: 1, unverifiedFigures: 4, repairedFigures: 0 };
    expect(summary.results.map((result) => result.diagnostics)).toEqual([expected, expected]);
    const doubled = { toolArgumentErrors: 2, fallbackReports: 2, unverifiedFigures: 8, repairedFigures: 0 };
    expect(summary.agentSummaries[0].diagnostics).toEqual(doubled);
    expect(summary.diagnostics).toEqual(doubled);
  });
});

describe("judge thinking", () => {
  it("grades at --judge-thinking, and records it in the summary and the checkpoint identity", async () => {
    vi.mocked(evaluateWithJudge).mockResolvedValue(verdict);
    vi.mocked(runTurn).mockResolvedValue(empty({ status: "complete", finalText: "An answer." }));
    const checkpointPath = path.join(home, "checkpoint.json");

    const summary = await runBenchmark({ ...options(), agents: [options().agent], tasks: [TASK], judgeThinking: "high", checkpointPath });

    expect(vi.mocked(evaluateWithJudge).mock.calls[0][3]).toBe("high");
    expect(summary.judgeThinking).toBe("high");
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({ judgeThinking: "high" });
  });

  it("sends the judge no level and records none without the flag", async () => {
    vi.mocked(evaluateWithJudge).mockResolvedValue(verdict);
    vi.mocked(runTurn).mockResolvedValue(empty({ status: "complete", finalText: "An answer." }));

    const summary = await runBenchmark({ ...options(), agents: [options().agent], tasks: [TASK] });

    expect(vi.mocked(evaluateWithJudge).mock.calls[0][3]).toBeUndefined();
    expect(summary).not.toHaveProperty("judgeThinking");
  });
});
