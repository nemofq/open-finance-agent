import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { assistant, toolResult } from "@/lib/context/testing";
import { dataTool, financeTool, testLedger, toolCall } from "./testing";
import { createState, isInBandError, rebuildState, recordConnectionAttempt, recordToolIssued, recordToolResult } from "./state";

const etfProfile = dataTool("alphavantage__ETF_PROFILE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["funds"],
});
const tools = [etfProfile, financeTool("create_report")];

function transcript(text: string, isError = false): AgentMessage[] {
  const call = toolCall("call_0", "alphavantage__ETF_PROFILE", { symbol: "TSLY" });
  return [assistant({ calls: [call], stopReason: "stop" }), { ...toolResult("call_0", "alphavantage__ETF_PROFILE", text), isError }];
}

describe("the run's state", () => {
  it("reads the connections a chat already tried off the transcript", () => {
    const state = rebuildState(transcript("TSLY — YieldMax"), tools);

    expect(state.connectionsTried.get("TSLY")).toEqual(new Set(["alphavantage"]));
    expect(state.connectionsFailed.size).toBe(0);
    expect(state.attempted.size).toBe(0); // earlier turns are not this turn's attempts
  });

  it("counts an empty result as a connection that came back with nothing", () => {
    const state = rebuildState(transcript("   "), tools);

    expect(state.connectionsFailed.get("TSLY")).toEqual(new Set(["alphavantage"]));
  });

  it("ignores tools it no longer knows", () => {
    const state = rebuildState(transcript("TSLY — YieldMax"), []);

    expect(state.connectionsTried.size).toBe(0);
  });

  it("counts a connection as tried the moment its call goes ahead", () => {
    const state = createState();
    recordConnectionAttempt(state, etfProfile, { symbol: "TSLY" });

    expect(state.connectionsTried.get("TSLY")).toEqual(new Set(["alphavantage"]));
    expect(state.connectionsFailed.size).toBe(0);
    expect(state.attempted.size).toBe(0); // issued calls are recorded on their own, allowed or not
  });

  it("counts every issued call as attempted, whatever became of it", () => {
    const state = createState();
    recordToolIssued(state, etfProfile.name); // e.g. blocked by another concern, before any result
    recordToolResult(state, { tool: etfProfile, toolName: etfProfile.name, args: { symbol: "TSLY" }, isError: true, text: "rate limited" });

    expect(state.attempted).toEqual(new Set([etfProfile.name]));
    expect(state.connectionsFailed.get("TSLY")).toEqual(new Set(["alphavantage"]));
  });

  it("ignores a preflight of a tool that is not a connection", () => {
    const state = createState();
    recordConnectionAttempt(state, financeTool("create_report"), { spec: {} });

    expect(state.connectionsTried.size).toBe(0);
  });

  it("reads a rate limit reported in the body as a failed attempt", () => {
    const body = '{"error":{"type":"rate_limit","message":"25 requests per day"}}';
    const state = rebuildState(transcript(body), tools);

    expect(state.connectionsFailed.get("TSLY")).toEqual(new Set(["alphavantage"]));
  });

  it("knows an in-band error from ordinary content", () => {
    expect(isInBandError('{"error":{"type":"rate_limit"}}')).toBe(true);
    expect(isInBandError('{"Note":"Thank you for using Alpha Vantage! Our standard API call frequency is 25 per day"}')).toBe(true);
    expect(isInBandError('{"Error Message":"Invalid API call"}')).toBe(true);
    expect(isInBandError("TSLY — YieldMax TSLA Option Income Strategy ETF, NAV 15.82")).toBe(false);
  });

  it("keeps each disagreement once", () => {
    const state = createState();
    const entry = testLedger().add({
      kind: "E",
      summary: "income statement",
      conflicts: [
        { with: "E1", metric: "revenue", period: "FY26 Q2", value: 30_040, otherValue: 29_800, agree: false },
        { with: "E1", metric: "eps", period: "FY26 Q2", value: 1.05, otherValue: 1.05, agree: true },
      ],
    });
    const outcome = { toolName: "alphavantage__INCOME_STATEMENT", args: {}, isError: false, text: "ok", entry };

    recordToolResult(state, outcome);
    recordToolResult(state, outcome);

    expect(state.conflicts).toEqual([
      { entry: entry.id, with: "E1", metric: "revenue", period: "FY26 Q2", value: 30_040, otherValue: 29_800 },
    ]);
  });
});
