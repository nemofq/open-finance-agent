import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createLedger } from "./ledger";
import { registerUserFigures, registerUserMessages } from "./user";

const ledgerFor = (messages?: AgentMessage[]) =>
  createLedger({ sessionId: "chat-1", messages });

const userMessage = (text: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 1,
});

describe("registerUserFigures", () => {
  it("records one entry per distinct figure, with what the user said around it", () => {
    const ledger = ledgerFor();
    const created = registerUserFigures(ledger, "I hold 400 shares at a cost basis of $118.20 each.", "message");

    expect(created.map((entry) => entry.id)).toEqual(["U1", "U2"]);
    expect(created[0]).toMatchObject({ kind: "U", value: 400, origin: "message" });
    expect(created[1]).toMatchObject({ value: 118.2, unit: "USD", name: "$118.20" });
    expect(created[1].summary).toContain("cost basis of $118.20");
  });

  it("skips years, dates, tickers and repeats", () => {
    const ledger = ledgerFor();
    const created = registerUserFigures(ledger, "I bought $NVDA on 2024-08-28, back in 2024, twice at $118.20 and $118.20.", "holdings");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ value: 118.2, origin: "holdings" });
  });

  it("gives the figures to the enforcement engine as sourced values", () => {
    const ledger = ledgerFor();
    registerUserFigures(ledger, "My target price is $180.", "profile");
    expect(ledger.matchValue({ raw: "$180", value: 180, unit: "USD", index: 0 })).toEqual(["U1"]);
  });
});

describe("registerUserMessages", () => {
  it("replays the original skill request, never the skill's expanded instructions", () => {
    const transcript: AgentMessage[] = [
      { role: "skill", skill: "valuation", request: "My cost basis is $118.20", prompt: "Use a 9.5% discount rate", timestamp: 1 },
      userMessage("My target is $180"),
    ];
    const first = ledgerFor();
    registerUserFigures(first, "My cost basis is $118.20", "message");
    registerUserFigures(first, "My target is $180", "message");
    const replayed = ledgerFor(transcript);
    registerUserMessages(replayed, transcript);
    const values = (ledger: ReturnType<typeof ledgerFor>) => ledger.list("U").map((entry) => [entry.id, entry.value]);
    expect(values(replayed)).toEqual(values(first));
    expect(values(replayed)).toEqual([["U1", 118.2], ["U2", 180]]);
  });
  it("replays the transcript so a reopened chat keeps the same U ids", () => {
    const transcript = [userMessage("I hold 400 shares"), userMessage("at $118.20")];
    const first = registerUserMessages(ledgerFor(), transcript);
    const second = registerUserMessages(ledgerFor(transcript), transcript);
    expect(first.map((entry) => entry.id)).toEqual(["U1", "U2"]);
    expect(second.map((entry) => [entry.id, entry.value])).toEqual(first.map((entry) => [entry.id, entry.value]));
  });

  it("ignores assistant and tool messages", () => {
    const ledger = ledgerFor();
    const assistant: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Revenue was $30,040M." }],
      timestamp: 1,
      api: "anthropic",
      provider: "openrouter",
      model: "claude",
      stopReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const toolResult: AgentMessage = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "edgar_financials",
      content: [{ type: "text", text: "Net income 16,599.0" }],
      isError: false,
      timestamp: 2,
    };
    expect(registerUserMessages(ledger, [assistant, toolResult, userMessage("I paid 118.20")])).toHaveLength(1);
  });
});
