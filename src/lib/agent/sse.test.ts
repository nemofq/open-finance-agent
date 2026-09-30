import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, SystemMessage, Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { encodeSse, toSseEvents } from "./sse";

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistantMessage: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "hi" }],
  api: "openai-completions",
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  usage,
  stopReason: "stop",
  timestamp: 0,
};

const update = (inner: AssistantMessageEvent): AgentEvent => ({
  type: "message_update",
  message: assistantMessage,
  assistantMessageEvent: inner,
});

describe("toSseEvents", () => {
  it("maps text and thinking deltas", () => {
    expect(toSseEvents(update({ type: "text_delta", contentIndex: 0, delta: "he", partial: assistantMessage }))).toEqual([
      { type: "text_delta", delta: "he" },
    ]);
    expect(
      toSseEvents(update({ type: "thinking_delta", contentIndex: 0, delta: "hm", partial: assistantMessage })),
    ).toEqual([{ type: "thinking_delta", delta: "hm" }]);
  });

  it("announces a tool call whose arguments are still streaming", () => {
    const partial: AssistantMessage = {
      ...assistantMessage,
      content: [{ type: "toolCall", id: "t1", name: "create_report", arguments: {} }],
    };
    expect(toSseEvents(update({ type: "toolcall_start", contentIndex: 0, partial }))).toEqual([
      { type: "tool_call_pending", name: "create_report" },
    ]);
  });

  it("reports an empty name while the tool call block is still empty", () => {
    expect(
      toSseEvents(update({ type: "toolcall_start", contentIndex: 1, partial: assistantMessage })),
    ).toEqual([{ type: "tool_call_pending", name: "" }]);
  });

  it("ignores deltas the UI does not render", () => {
    expect(toSseEvents(update({ type: "text_start", contentIndex: 0, partial: assistantMessage }))).toEqual([]);
    expect(toSseEvents({ type: "turn_start" })).toEqual([]);
    expect(toSseEvents({ type: "agent_start" })).toEqual([]);
  });

  it("maps tool execution boundaries", () => {
    expect(
      toSseEvents({ type: "tool_execution_start", toolCallId: "t1", toolName: "web_search", args: { q: "nvda" } }),
    ).toEqual([{ type: "tool_call_start", id: "t1", name: "web_search", args: { q: "nvda" } }]);

    expect(
      toSseEvents({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "web_search",
        result: { content: [{ type: "text", text: "one" }, { type: "text", text: "two" }], details: null },
        isError: false,
      }),
    ).toEqual([{ type: "tool_call_end", id: "t1", result: "one\ntwo", isError: false }]);
  });

  it("reports tool errors", () => {
    expect(
      toSseEvents({
        type: "tool_execution_end",
        toolCallId: "t2",
        toolName: "web_search",
        result: { content: [{ type: "text", text: "rate limited" }], details: null },
        isError: true,
      }),
    ).toEqual([{ type: "tool_call_end", id: "t2", result: "rate limited", isError: true }]);
  });

  it("emits usage before an assistant message ends", () => {
    expect(toSseEvents({ type: "message_end", message: assistantMessage })).toEqual([
      { type: "usage", usage },
      { type: "message_end", message: assistantMessage },
    ]);
  });

  it("emits no usage for non-assistant messages", () => {
    const message = { role: "user", content: "hi", timestamp: 0 } as const;
    expect(toSseEvents({ type: "message_end", message })).toEqual([{ type: "message_end", message }]);
  });

  it("forwards a skill turn to the client as-is", () => {
    const message = { role: "skill", skill: "earnings-review", request: "$AAPL", prompt: "…", timestamp: 0 } as const;
    expect(toSseEvents({ type: "message_end", message })).toEqual([{ type: "message_end", message }]);
  });

  it("sends nothing of pi's system messages, which carry the prompt and the tools", () => {
    const message: SystemMessage = { role: "system", content: "You are…", toolsAdded: [{ name: "web_search", description: "Search", parameters: {} }], timestamp: 0 };
    expect(toSseEvents({ type: "message_start", message })).toEqual([]);
    expect(toSseEvents({ type: "message_end", message })).toEqual([]);
  });
});

describe("encodeSse", () => {
  it("writes one SSE data frame", () => {
    expect(encodeSse({ type: "done" })).toBe('data: {"type":"done"}\n\n');
  });

  it("passes a revised answer through unchanged", () => {
    const frame = encodeSse({ type: "answer_updated", text: "Revenue rose 8% [1].\n" });
    expect(JSON.parse(frame.slice("data: ".length))).toEqual({ type: "answer_updated", text: "Revenue rose 8% [1].\n" });
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});
