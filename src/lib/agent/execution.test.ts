import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { fakeModel } from "@/lib/context/testing";
import { type StreamOptions, streamModel } from "@/lib/llm/stream";
import { execution, executionDeadline } from "./execution";
import { answer, testTurn } from "@/lib/harness/testing";

vi.mock("@/lib/llm/stream", () => ({ streamModel: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const model = { ...fakeModel(65_536), maxTokens: 65_536, reasoning: true };

describe("execution budget", () => {
  it("uses the caller's absolute deadline and reserves a completion inside a short budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const deadlineAt = executionDeadline({ turnMs: 300, deadlineAt: 1200 });
    vi.setSystemTime(1030); // setup already consumed part of the caller's budget
    vi.mocked(streamModel).mockReturnValue(createAssistantMessageEventStream());
    const run = execution(defaultConfig(), testTurn(), { deadlineAt, recoveryMs: 60 });
    const interrupted = run.stream(model, { messages: [] }).result();
    await vi.advanceTimersByTimeAsync(114);
    const last = await interrupted;
    expect(last.stopReason).toBe("error");
    expect(Date.now()).toBeLessThan(deadlineAt);
    expect(run.recovery(last)).toBeDefined();
    const completion = run.stream(model, { messages: [] }).result();
    await vi.advanceTimersByTimeAsync(57);
    expect(await completion).toMatchObject({ stopReason: "error" });
    expect(run.requests.at(-1)!.endedAt).toBe(deadlineAt);
    expect(run.recovery(last)).toBeUndefined();
  });

  it("counts tool rounds without new usable evidence, not argument variants or repeated results", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Continue");
      stream.push({ type: "done", reason: "stop", message }); stream.end(message);
      return stream;
    });
    const turn = testTurn();
    const run = execution(defaultConfig(), turn, { stalledCalls: 2 });
    const failed = { content: [], details: {}, isError: true };
    const call = { name: "lookup", id: "call", args: {} };
    run.toolResult(call, failed);
    run.toolResult({ ...call, args: { variant: true } }, failed); // same model round
    await run.stream(model, { messages: [] }).result();
    const entry = turn.ledger.add({ kind: "E", summary: "Retrieved revenue", value: 123, hash: "source" });
    run.toolResult(call, { ...failed, isError: false, details: { evidence: entry } });
    await run.stream(model, { messages: [] }).result(); // new evidence resets the budget
    const duplicate = turn.ledger.add({ kind: "E", summary: "Same source", value: 123, hash: "source" });
    run.toolResult(call, { ...failed, isError: false, details: { evidence: duplicate } });
    await run.stream(model, { messages: [] }).result();
    const future = turn.ledger.add({ kind: "E", summary: "Future source", value: 999, lookAhead: true });
    run.toolResult(call, { ...failed, isError: false, details: { evidence: future } });
    expect(() => run.stream(model, { messages: [] })).toThrow("no new usable evidence");
    expect(run.stopFor(run.exhausted)).toBe("stalled");
    expect(run.recovery(answer(""))).toBeDefined();
    await run.stream(model, { messages: [] }).result();
    expect(run.requests.map((r) => r.phase)).toEqual(["analysis", "analysis", "analysis", "recovery"]);
  });

  it("budgets failing tool rounds apart from stalled ones, and gives recovery room to explain", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Continue");
      stream.push({ type: "done", reason: "stop", message }); stream.end(message);
      return stream;
    });
    const turn = testTurn();
    // A generous stalled budget the failing rounds must not touch: the two are counted apart.
    const run = execution(defaultConfig(), turn, { stalledCalls: 5, failedCalls: 2 });
    const failed = { content: [], details: {}, isError: true };
    const call = { name: "lookup", id: "call", args: {} };
    run.toolResult(call, failed);
    await run.stream(model, { messages: [] }).result();
    run.toolResult(call, failed);
    expect(() => run.stream(model, { messages: [] })).toThrow("failed (lookup); the data sources are unavailable");
    expect(run.stopFor(run.exhausted)).toBe("tool_failures");

    const recovery = run.recovery(answer(""));
    expect(recovery?.reason).toBe("Complete the answer after research stopped early");
    const text = recovery?.followUp ?? "";
    expect(text).toContain("under 800 words");
    expect(text).toContain("name what could not be retrieved");
  });

  it("stops calling a tool after three consecutive errors, and names rejected input rather than the sources", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Continue");
      stream.push({ type: "done", reason: "stop", message }); stream.end(message);
      return stream;
    });
    const invalid = { content: [{ type: "text" as const, text: "Invalid JSON: Unexpected token at position 12." }], details: {}, isError: true };
    const found = { content: [{ type: "text" as const, text: "Found" }], details: {}, isError: false };
    const compose = { name: "compose", id: "compose", args: {} }, lookup = { name: "lookup", id: "lookup", args: {} };
    const run = execution(defaultConfig(), testTurn());
    // A success restarts the count for that tool only.
    for (const result of [invalid, invalid, found, invalid, invalid]) run.toolResult(lookup, result);
    expect(run.beforeTool(lookup)).toBeUndefined();
    for (let i = 0; i < 3; i++) run.toolResult(compose, invalid);
    const reason = "compose failed 3 times in a row with the same kind of error; finish from what you have";
    expect(run.beforeTool(compose)).toEqual({ block: true, reason });
    expect(run.beforeTool(lookup)).toBeUndefined();
    // Arguments are prepared before beforeTool runs; a capped tool is refused there as well.
    const tool = { name: "compose", label: "Compose", description: "", parameters: Type.Object({}), execute: vi.fn() };
    expect(() => run.guard(tool).prepareArguments!({})).toThrow(reason);
    expect(run.guard({ ...tool, name: "lookup" }).prepareArguments!({ q: 1 })).toEqual({ q: 1 });

    const stalled = execution(defaultConfig(), testTurn(), { failedCalls: 2 });
    stalled.toolResult(compose, invalid);
    await stalled.stream(model, { messages: [] }).result();
    stalled.toolResult(compose, invalid);
    expect(() => stalled.stream(model, { messages: [] })).toThrow("Research stopped after repeated tool rounds failed: compose rejected the input it was given");
  });

  it("counts a new slice of existing evidence as progress, but not identical rereads", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Continue");
      stream.push({ type: "done", reason: "stop", message }); stream.end(message);
      return stream;
    });
    const turn = testTurn();
    const entry = turn.ledger.add({ kind: "E", summary: "Retained filing", hasPayload: true });
    const run = execution(defaultConfig(), turn, { stalledCalls: 1 });
    const call = { name: "evidence_get", id: "read", args: { id: entry.id } };
    const result = { content: [{ type: "text" as const, text: "A retrieved passage" }], details: { id: entry.id, from: "text" }, isError: false };
    run.toolResult(call, result);
    await run.stream(model, { messages: [] }).result();
    run.toolResult(call, { ...result, content: [{ type: "text", text: "Another relevant passage" }] });
    await run.stream(model, { messages: [] }).result();
    run.toolResult({ ...call, args: { ...call.args, query: "a different argument" } }, result);
    expect(() => run.stream(model, { messages: [] })).toThrow("no new usable evidence");
  });

  it("ends a stalled stream even if the provider ignores cancellation", async () => {
    vi.useFakeTimers();
    vi.mocked(streamModel).mockReturnValue(createAssistantMessageEventStream());
    const run = execution(defaultConfig(), testTurn(), { requestMs: 50, turnMs: 1000, recoveryMs: 100 });
    const result = run.stream({ ...model, reasoning: false }, { messages: [] }).result();
    await vi.advanceTimersByTimeAsync(51);
    expect(await result).toMatchObject({ stopReason: "error", errorMessage: "Model request deadline exceeded" });
    expect(run.requests[0].endedAt).toBeDefined();
  });

  it("gives a model that declares reasoning half again the request deadline, within the turn's remaining time", async () => {
    vi.useFakeTimers();
    vi.mocked(streamModel).mockReturnValue(createAssistantMessageEventStream());
    const timeouts = (turnMs: number) => {
      const run = execution(defaultConfig(), testTurn(), { requestMs: 100, turnMs, recoveryMs: 0 });
      for (const reasoning of [false, true]) void run.stream({ ...model, reasoning }, { messages: [] });
      return vi.mocked(streamModel).mock.calls.splice(0).map((call) => call[3]?.timeoutMs);
    };
    expect(timeouts(1000)).toEqual([100, 150]);
    expect(timeouts(120)).toEqual([100, 120]);
  });

  it("gives a reasoning model half again the final and repair output caps, within its own maximum", async () => {
    vi.mocked(streamModel).mockReturnValue(createAssistantMessageEventStream());
    const caps = (reasoning: boolean, maxTokens: number) => {
      const turn = testTurn({ delivery: { mode: "auto", stage: "pending", why: "analysis" } });
      const run = execution(defaultConfig(), turn);
      const selected = { ...model, reasoning, maxTokens };
      void run.stream(selected, { messages: [] });
      turn.delivery!.stage = "created";
      void run.stream(selected, { messages: [] });
      void run.stream(selected, { messages: [{ role: "user", content: "Fix the citation.", timestamp: 0 }] });
      return vi.mocked(streamModel).mock.calls.splice(0).map((call) => call[3]?.maxTokens);
    };
    expect(caps(false, 65_536)).toEqual([24_576, 4_096, 12_288]);
    expect(caps(true, 65_536)).toEqual([24_576, 6_144, 18_432]);
    expect(caps(true, 8_000)).toEqual([8_000, 6_144, 8_000]);
  });

  it("caps the recovery request's thinking at low, keeping a lower level and Off", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Done");
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });
    const recovered = async (level: StreamOptions["reasoning"]) => {
      const run = execution(defaultConfig(), testTurn(), { calls: 1 });
      await run.stream(model, { messages: [] }, { reasoning: level }).result();
      expect(run.recovery({ ...answer(""), stopReason: "length" })).toBeDefined();
      await run.stream(model, { messages: [] }, { reasoning: level }).result();
      expect(run.requests.at(-1)?.phase).toBe("recovery");
      return vi.mocked(streamModel).mock.calls.splice(0).at(-1)?.[3]?.reasoning;
    };
    // Off reaches the run as no level.
    expect(await recovered(undefined)).toBeUndefined();
    expect(await recovered("minimal")).toBe("minimal");
    expect(await recovered("low")).toBe("low");
    for (const level of ["medium", "high", "xhigh"] as const) expect(await recovered(level)).toBe("low");
  });

  it("keeps user cancellation distinct from recoverable execution failure", async () => {
    vi.mocked(streamModel).mockReturnValue(createAssistantMessageEventStream());
    const controller = new AbortController();
    const run = execution(defaultConfig(), testTurn());
    const result = run.stream(model, { messages: [] }, { signal: controller.signal }).result();
    controller.abort();
    const stopped = await result;
    expect(stopped.stopReason).toBe("aborted");
    expect(run.recovery(stopped)).toBeUndefined();
  });

  it("reserves one tool-free completion after exhausting the call budget", async () => {
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const message = answer("Done");
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });
    const run = execution(defaultConfig(), testTurn(), { calls: 1 });
    await run.stream(model, { messages: [] }, { reasoning: "medium" }).result();
    expect(() => run.stream(model, { messages: [] })).toThrow("model-call limit");
    expect(run.stopFor("The turn reached its model-call limit")).toBe("calls");
    expect(run.recovery({ ...answer(""), stopReason: "error" })).toBeDefined();
    await run.stream(model, { messages: [], tools: [{ name: "write", description: "effect", parameters: {} }] }, { reasoning: "medium" }).result();
    expect(vi.mocked(streamModel).mock.calls[1][2].tools).toEqual([]);
    expect(vi.mocked(streamModel).mock.calls[1][3]).toMatchObject({ maxTokens: 8192, reasoning: "low" });
    expect(() => run.stream(model, { messages: [] })).toThrow("reserved completion request");
    // The reserved completion running out is not a budget of its own, and no other message is a stop.
    expect(run.stopFor(run.exhausted)).toBeUndefined();
    expect(run.stopFor("Upstream gateway timeout")).toBeUndefined();
    expect(run.recovery({ ...answer(""), stopReason: "error", errorMessage: "terminated" })).toBeUndefined();
  });

  it("asks again after a transient provider error or a request deadline, never after a spent quota", () => {
    const recovers = (errorMessage: string) =>
      execution(defaultConfig(), testTurn()).recovery({ ...answer(""), stopReason: "error", errorMessage }) !== undefined;
    expect(recovers("503 upstream connect error")).toBe(true);
    expect(recovers("Model request deadline exceeded")).toBe(true);
    expect(recovers("429 insufficient_quota: you exceeded your current quota")).toBe(false);
    expect(recovers("400 invalid request body")).toBe(false);
  });

  it.each([false, true])("preserves configured reasoning through research, repair and completion (off supported: %s)", async (supportsOff) => {
    const selected = model;
    const config = defaultConfig();
    config.llm.providers = [{ id: selected.provider, type: "openai-compatible", name: "Lab", apiKey: "",
      baseUrl: "https://llm.example.com/v1", models: [{ id: selected.id, reasoning: true, ...(supportsOff && { thinking: { off: "none" as const } }) }] }];
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: answer("Done") });
      stream.end();
      return stream;
    });
    const turn = testTurn({ delivery: { mode: "auto", stage: "pending", why: "analysis" } });
    const run = execution(config, turn);
    await run.stream(selected, { messages: [] }, { reasoning: "medium" }).result();
    turn.delivery!.stage = "created";
    await run.stream(selected, { messages: [] }, { reasoning: "medium" }).result();
    await run.stream(selected, { messages: [] }, { reasoning: "minimal" }).result();
    await run.stream(selected, { messages: [] }).result();
    expect(vi.mocked(streamModel).mock.calls.map((call) => call[3]?.maxTokens)).toEqual([24576, 6144, 6144, 6144]);
    expect(run.requests.map((request) => request.phase)).toEqual(["analysis", "final", "final", "final"]);
    expect(vi.mocked(streamModel).mock.calls.map((call) => call[3]?.reasoning)).toEqual(["medium", "medium", "minimal", undefined]);
    expect(vi.mocked(streamModel).mock.calls.every((call) => call[1] === selected)).toBe(true);
  });

  it.each([false, true])("keeps corrections and recovery distinct from a report summary (off supported: %s)", async (supportsOff) => {
    const config = defaultConfig();
    config.llm.providers = [{ id: model.provider, type: "openai-compatible", name: "Lab", apiKey: "",
      baseUrl: "https://llm.example.com/v1", models: [{ id: model.id, reasoning: true, ...(supportsOff && { thinking: { off: "none" as const } }) }] }];
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: answer("Done") });
      stream.end();
      return stream;
    });
    const turn = testTurn({ delivery: { mode: "auto", stage: "created", why: "report ready" } });
    const run = execution(config, turn);
    await run.stream(model, { messages: [{ role: "toolResult", toolCallId: "report", toolName: "create_report",
      content: [{ type: "text", text: "The report is open beside the chat." }], isError: false, timestamp: 0 }], tools: [] }, { reasoning: "medium" }).result();
    const correction = { messages: [{ role: "user" as const, content: "Correct the citation to the existing figure and give the answer again.", timestamp: 1 }], tools: [] };
    await run.stream(model, correction, { reasoning: "medium" }).result();
    expect(run.requests.map((request) => request.phase)).toEqual(["final", "repair"]);
    expect(vi.mocked(streamModel).mock.calls[1][1]).toBe(model);
    expect(vi.mocked(streamModel).mock.calls[1][2].tools).toEqual([]);
    expect(vi.mocked(streamModel).mock.calls[1][3]).toMatchObject({ maxTokens: 18432, reasoning: "medium" });
    expect(run.recovery({ ...answer(""), stopReason: "length" })).toBeDefined();
    await run.stream(model, correction, { reasoning: "medium" }).result();
    expect(run.requests[2].phase).toBe("recovery");
    expect(vi.mocked(streamModel).mock.calls[2][1]).toBe(model);
    expect(vi.mocked(streamModel).mock.calls[2][3]).toMatchObject({ maxTokens: 8192, reasoning: "low" });
  });

  it("blocks a hallucinated recovery tool call without repeating a completed side effect", async () => {
    const write = (id: string): AssistantMessage => ({ ...answer(""), stopReason: "toolUse",
      content: [{ type: "toolCall", id, name: "write", arguments: {} }] });
    const replies = [write("original"), { ...answer(""), stopReason: "error" as const, errorMessage: "terminated" }, write("recovery")];
    vi.mocked(streamModel).mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      const reply = replies.shift()!;
      if (reply.stopReason === "error") stream.push({ type: "error", reason: "error", error: reply });
      else stream.push({ type: "done", reason: "toolUse", message: reply });
      stream.end(reply);
      return stream;
    });
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "Saved" }], details: {} }));
    const run = execution(defaultConfig(), testTurn());
    const agent = new Agent({ initialState: { model, tools: [{ name: "write", label: "Write", description: "Save once", parameters: Type.Object({}), execute }] },
      streamFn: run.stream, beforeToolCall: async ({ toolCall }) => run.beforeTool({ name: toolCall.name, id: toolCall.id, args: toolCall.arguments }) });
    await agent.prompt("Save the result.");
    const recovery = run.recovery(agent.state.messages.findLast((m) => m.role === "assistant"));
    expect(recovery).toBeDefined();
    await agent.prompt(recovery?.followUp ?? "");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(streamModel).toHaveBeenCalledTimes(3);
    expect(agent.state.messages).toContainEqual(expect.objectContaining({ role: "toolResult", toolCallId: "recovery", isError: true }));
    expect(run.exhausted).toBe("The reserved completion request has been used");
  });
});
