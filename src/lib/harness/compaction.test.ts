import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SystemMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { contextUsage, resolveContextBudget } from "@/lib/context/budget";
import { findCut, type Summarize } from "@/lib/context/compact";
import { assistant, entry, fakeModel, failed, toolResult, user } from "@/lib/context/testing";
import type { ContextBudget } from "@/lib/context/types";
import { ledgerWith } from "@/lib/evidence/testing";
import { compaction, type CompactionOptions } from "./compaction";
import { testTurn } from "./testing";

const model = fakeModel(32_768);
const base = resolveContextBudget(model);
const summarize: Summarize = async () => "### Facts\n- Revenue was $30,040M [E7].";

const prices = entry("E12", {
  summary: "Alpha Vantage daily prices, $NVDA",
  source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
  toolCallId: "call-1",
});

function transcript(chars = 4_000): AgentMessage[] {
  return [
    user("How did $NVDA do?"),
    assistant({ calls: [{ id: "call-1", name: "av_prices", arguments: { symbol: "NVDA" } }] }),
    toolResult("call-1", "av_prices", "x".repeat(chars), prices),
    assistant({ text: "It rose." }),
    user("And the quarter?"),
  ];
}

const hooksWith = (budget: ContextBudget, extra: Partial<CompactionOptions> = {}, ledger = ledgerWith([prices])) => {
  const turn = testTurn({ ledger });
  const concern = compaction({ budget, summarize, onCompaction: () => {}, ...extra });
  void concern.beforeTurn!(turn, []);
  return {
    prepareNextTurnWithContext: concern.prepareNextTurn!,
    beforeTurn: async (messages: AgentMessage[]) => await concern.beforeTurn!(turn, messages) as AgentMessage[],
    recoverFromOverflow: async (messages: AgentMessage[]) => (await concern.afterRun!(messages, turn))?.messages,
  };
};

describe("prepareNextTurnWithContext", () => {
  /** The system message pi keeps at the head of the run's transcript. */
  const leading: SystemMessage = { role: "system", content: "system", timestamp: 0 };
  const turnFor = (messages: AgentMessage[]) => ({
    message: assistant({ text: "done" }),
    toolResults: [],
    context: { messages: [leading, ...messages], tools: [] },
    newMessages: [],
  });

  it("leaves a turn alone while there is room", async () => {
    expect(await hooksWith(base).prepareNextTurnWithContext(turnFor(transcript()))).toBeUndefined();
  });

  it("compacts mid-run and hands back the transcript to mirror onto the agent", async () => {
    const written: AgentMessage[][] = [];
    const hooks = hooksWith({ ...base, compactAt: 100, keepRecent: 50 }, {
      onCompaction: (_message, messages) => written.push(messages),
    });
    const update = await hooks.prepareNextTurnWithContext(turnFor(transcript()));

    expect(update?.context?.messages[0]).toBe(leading);
    expect(update?.context?.messages.some((message) => message.role === "compaction")).toBe(true);
    expect(written[0]).toEqual(update?.context?.messages);
  });
});

describe("beforeTurn", () => {
  it("starts the turn on the transcript it was given when there is room", async () => {
    const messages = transcript();
    expect(await hooksWith(base).beforeTurn(messages)).toBe(messages);
  });

  it("compacts before a turn that would not fit", async () => {
    const out = await hooksWith({ ...base, compactAt: 100, keepRecent: 50 }).beforeTurn(transcript());
    expect(out.some((message) => message.role === "compaction")).toBe(true);
  });
});

describe("recoverFromOverflow", () => {
  it("does nothing for a failure that is not an overflow", async () => {
    const messages = transcript();
    const failure = failed("429 rate limit exceeded");
    expect(await hooksWith(base).recoverFromOverflow([...messages, failure])).toBeUndefined();
  });

  it("drops the failed turn and compacts once", async () => {
    const messages = transcript();
    const failure = failed("prompt is too long: 40000 tokens > 32768 maximum");
    const out = await hooksWith(base).recoverFromOverflow([...messages, failure]);

    expect(out?.includes(failure)).toBe(false);
    expect(out?.some((message) => message.role === "compaction")).toBe(true);
    expect(out?.[out.length - 1]).toBe(messages[messages.length - 1]);
  });
});

/**
 * pi keeps its system message at the head of a run's transcript, and a chat's first turn follows
 * it. The first compaction of a chat must still cut inside that turn, as it did before pi kept one.
 */
describe("a chat's first turn behind pi's system message", () => {
  const leading: SystemMessage = { role: "system", content: "system", timestamp: 0 };
  const calls = [1, 2, 3, 4, 5];
  const found = calls.map((n) => entry(`E${n}`, { summary: "prices", source: prices.source, toolCallId: `c${n}` }));
  /** One question and five lookups of ~6k tokens each: past 75% of a 32k window on its own. */
  const firstTurn = (): AgentMessage[] => [
    user("How did $NVDA do?"),
    ...calls.flatMap((n) => [
      assistant({ calls: [{ id: `c${n}`, name: "av_prices", arguments: { symbol: "NVDA" } }] }),
      toolResult(`c${n}`, "av_prices", "x".repeat(24_000), found[n - 1]),
    ]),
  ];
  const hooks = () => hooksWith(base, {}, ledgerWith(found));

  /** The cut falls inside the turn, on an assistant message, and the context comes back under the line. */
  function expectCompactedInsideTurn(chat: AgentMessage[], out: AgentMessage[] | undefined) {
    expect(contextUsage(chat, base).used).toBeGreaterThan(base.compactAt);
    expect(out?.[0]).toBe(leading);
    const at = out?.findIndex((message) => message.role === "compaction") ?? -1;
    const cut = findCut(chat, 0, base.keepRecent);
    expect(cut).toBeGreaterThan(1);
    expect(chat[cut].role).toBe("assistant");
    expect(at).toBe(cut + 1);
    expect(contextUsage(out ?? [], base).used).toBeLessThan(base.keepRecent);
  }

  it("compacts mid-run once the first turn passes the line", async () => {
    const chat = firstTurn();
    const update = await hooks().prepareNextTurnWithContext({
      message: assistant({ text: "done" }), toolResults: [], context: { messages: [leading, ...chat], tools: [] }, newMessages: [],
    });
    expectCompactedInsideTurn(chat, update?.context?.messages);
  });

  it("recovers from an overflow on the first turn", async () => {
    const chat = firstTurn();
    const out = await hooks().recoverFromOverflow([leading, ...chat, failed("prompt is too long: 40000 tokens > 32768 maximum")]);
    expectCompactedInsideTurn(chat, out);
    expect(out?.at(-1)).toBe(chat.at(-1));
  });

  it("compacts before the second turn when the first was large", async () => {
    const chat = [...firstTurn(), assistant({ text: "It rose." })];
    expectCompactedInsideTurn(chat, await hooks().beforeTurn([leading, ...chat]));
  });
});
