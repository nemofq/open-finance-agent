import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistant, failed } from "@/lib/context/testing";
import { promptWithTransientRetries } from "./transient-retries";

afterEach(() => { vi.useRealTimers(); });

describe("promptWithTransientRetries", () => {
  it("retries the failed continuation and preserves completed tool results", async () => {
    vi.useFakeTimers();
    const user: AgentMessage = { role: "user", content: [{ type: "text", text: "look up NVDA" }], timestamp: 1 };
    const toolResult: AgentMessage = {
      role: "toolResult",
      toolCallId: "edgar-1",
      toolName: "edgar_financials",
      content: [{ type: "text", text: "Revenue: 30B" }],
      isError: false,
      timestamp: 2,
    };
    let calls = 0;
    const agent = {
      state: { messages: [] as AgentMessage[] },
      async prompt() {
        this.state.messages = [user, toolResult, failed("503 upstream connect error")];
      },
      async continue() {
        calls += 1;
        expect(this.state.messages.at(-1)?.role).toBe("toolResult");
        this.state.messages = [...this.state.messages, assistant({ text: "Answer" })];
      },
      async waitForIdle() {},
    };

    const pending = promptWithTransientRetries(agent, "look up NVDA", { maxRetries: 2, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(9);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(calls).toBe(1);
    expect(result).toEqual({ retries: 1, infrastructureError: false, errors: ["503 upstream connect error"] });
    expect(agent.state.messages).toHaveLength(3);
    expect(agent.state.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
  });

  it("marks exhausted retryable failures as infrastructure errors", async () => {
    vi.useFakeTimers();
    const user: AgentMessage = { role: "user", content: [{ type: "text", text: "question" }], timestamp: 1 };
    const agent = {
      state: { messages: [] as AgentMessage[] },
      async prompt() {
        this.state.messages = [user, failed("503 upstream connect error")];
      },
      async continue() {
        this.state.messages = [...this.state.messages, failed("503 still unavailable")];
      },
      async waitForIdle() {},
    };

    const pending = promptWithTransientRetries(agent, "question", { maxRetries: 1, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.retries).toBe(1);
    expect(result.infrastructureError).toBe(true);
    expect(result.errors).toEqual(["503 upstream connect error"]);
  });

  it("retries nothing when the run ended on a tool result", async () => {
    const toolResult: AgentMessage = { role: "toolResult", toolCallId: "cut", toolName: "edgar_financials",
      content: [{ type: "text", text: "Arguments were cut off" }], isError: true, timestamp: 2 };
    let calls = 0;
    const agent = {
      state: { messages: [] as AgentMessage[] },
      async prompt() {
        this.state.messages = [failed("503 upstream connect error"), toolResult];
      },
      async continue() {
        calls += 1;
      },
      async waitForIdle() {},
    };

    expect(await promptWithTransientRetries(agent, "question", { maxRetries: 2, baseDelayMs: 10 })).toEqual({ retries: 0, infrastructureError: false, errors: [] });
    expect(calls).toBe(0);
    expect(agent.state.messages).toHaveLength(2);
  });

  it("stops waiting when the caller's deadline aborts the backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const agent = {
      state: { messages: [] as AgentMessage[] },
      async prompt() {
        this.state.messages = [failed("503 upstream connect error")];
      },
      async continue() {
        calls += 1;
      },
      async waitForIdle() {},
    };

    const pending = promptWithTransientRetries(agent, "question", { maxRetries: 2, baseDelayMs: 1_000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const result = await pending;

    expect(calls).toBe(0);
    expect(result).toEqual({ retries: 0, infrastructureError: false, errors: [] });
  });
});
