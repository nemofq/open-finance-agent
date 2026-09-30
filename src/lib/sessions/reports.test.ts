import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { reportSummariesOf } from "./reports";

const at = Date.UTC(2026, 8, 14, 12, 0, 0);

function call(id: string, args: Record<string, unknown>, name = "create_report"): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
    api: "openai-completions",
    provider: "openrouter",
    model: "m",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: at,
  } as AgentMessage;
}

function result(id: string, details: unknown, isError = false, timestamp = at + 1000): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "create_report",
    content: [{ type: "text", text: "ok" }],
    details,
    isError,
    timestamp,
  } as AgentMessage;
}

describe("reportSummariesOf", () => {
  it("lists rendered reports oldest first, without their HTML", () => {
    const messages = [
      call("c1", { spec: { title: "Spec title", template: "stock-brief" } }),
      result("c1", { html: "<h1>1</h1>", title: "Rendered title", format: "slides", template: "stock-brief" }),
      call("c2", { spec: { title: "Second" } }),
      result("c2", { html: "<p>2</p>", title: "Second", format: "doc" }, false, at + 5000),
    ];
    expect(reportSummariesOf(messages)).toEqual([
      { id: "c1", title: "Rendered title", format: "slides", template: "stock-brief", createdAt: new Date(at + 1000).toISOString() },
      { id: "c2", title: "Second", format: "doc", createdAt: new Date(at + 5000).toISOString() },
    ]);
  });

  it("skips failed calls, other tools and calls still running", () => {
    const messages = [
      call("c1", { spec: { title: "Failed" } }),
      result("c1", undefined, true),
      call("c2", { ticker: "AAPL" }, "financial_calculator"),
      result("c2", { html: "<p>not a report</p>" }),
      call("c3", { spec: { title: "Running" } }),
    ];
    expect(reportSummariesOf(messages)).toEqual([]);
  });

  it("survives a result without a usable timestamp", () => {
    const broken = { ...result("c1", { html: "<p>1</p>", title: "T" }), timestamp: undefined } as unknown as AgentMessage;
    expect(reportSummariesOf([call("c1", { spec: { title: "T" } }), broken])).toEqual([
      { id: "c1", title: "T", format: "doc", createdAt: new Date(0).toISOString() },
    ]);
  });
});
