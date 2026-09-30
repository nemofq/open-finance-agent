import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { extractCashtags, sessionTickers } from "./cashtags";

const assistant = (text: string): AgentMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: "openrouter",
  model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 0,
});

describe("extractCashtags", () => {
  it("finds uppercase cashtags, de-duplicated and in order", () => {
    expect(extractCashtags("Compare $MSFT and $AAPL, then $MSFT again")).toEqual(["MSFT", "AAPL"]);
  });

  it("supports a share-class suffix", () => {
    expect(extractCashtags("$BRK.B vs $BRK")).toEqual(["BRK.B", "BRK"]);
  });

  it("ignores lowercase, prices and over-long symbols", () => {
    expect(extractCashtags("$aapl costs $250 and $TOOLONG")).toEqual([]);
  });

  it("ignores display math, inline math variables, and escaped dollars", () => {
    expect(extractCashtags("$$FV = 1{,}000{,}000 \\times (1.12)^{10} = 3{,}105{,}848$$")).toEqual([]);
    expect(extractCashtags("Where $FV$ is future value and $PV$ is present value")).toEqual([]);
    expect(extractCashtags("\\$FV and $$PV$$")).toEqual([]);
    expect(extractCashtags("foo$AAPL")).toEqual([]);
    expect(extractCashtags("For $AAPL, $$FV = 100$$ and $MSFT")).toEqual(["AAPL", "MSFT"]);
  });

  it("returns an empty list for text without cashtags", () => {
    expect(extractCashtags("no tickers here")).toEqual([]);
  });
});

describe("sessionTickers", () => {
  it("unions tickers across user and assistant messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "How did $NVDA do?", timestamp: 0 },
      assistant("$NVDA beat; compare with $AMD."),
      { role: "user", content: [{ type: "text", text: "And $AMD guidance?" }], timestamp: 0 },
    ];
    expect(sessionTickers(messages)).toEqual(["NVDA", "AMD"]);
  });

  it("reads a skill turn's tickers from the request, not the expanded prompt", () => {
    const messages: AgentMessage[] = [
      { role: "skill", skill: "earnings-review", request: "$AAPL", prompt: "Compare $MSFT and $GOOGL", timestamp: 0 },
    ];
    expect(sessionTickers(messages)).toEqual(["AAPL"]);
  });

  it("ignores tool results and non-text content", () => {
    const messages: AgentMessage[] = [
      { role: "toolResult", toolCallId: "1", toolName: "quote", content: [{ type: "text", text: "$TSLA" }], isError: false, timestamp: 0 },
    ];
    expect(sessionTickers(messages)).toEqual([]);
  });
});
