import { describe, expect, it } from "vitest";
import { contextUsage, FALLBACK_WINDOW, resolveContextBudget } from "./budget";
import { assistant, fakeModel, toolResult, usageOf, user } from "./testing";
import type { CompactionMessage } from "./types";

/** pi's estimate of plain text, at its 3.5 characters to a token. */
const piTokens = (chars: number) => Math.ceil(chars / 3.5);

const checkpoint = (summary: string): CompactionMessage => ({
  role: "compaction",
  summary,
  tokensBefore: 100,
  tokensAfter: 10,
  evidenceIds: [],
  timestamp: 1,
});

describe("resolveContextBudget", () => {
  it("derives every threshold from a known window", () => {
    expect(resolveContextBudget(fakeModel(200_000, 32_000))).toEqual({
      window: 200_000,
      unknownWindow: false,
      toolResultMax: 10_000,
      stubAt: 100_000,
      compactAt: 150_000,
      keepRecent: 50_000,
    });
  });

  it("assumes 32k and says so when the provider reports no window", () => {
    const budget = resolveContextBudget(fakeModel(0));
    expect(budget.window).toBe(FALLBACK_WINDOW);
    expect(budget.unknownWindow).toBe(true);
    expect(budget.compactAt).toBe(24_576);
  });

  it("keeps a tool result usable on a small window", () => {
    expect(resolveContextBudget(fakeModel(8_000)).toolResultMax).toBe(2_000);
  });
});

describe("contextUsage", () => {
  const budget = resolveContextBudget(fakeModel(32_768));

  it("estimates from characters when the transcript has no provider usage", () => {
    const usage = contextUsage([user("a".repeat(400))], budget);
    expect(usage.used).toBe(piTokens(400));
    expect(usage.window).toBe(32_768);
    expect(usage.compactions).toBe(0);
  });

  it("trusts provider usage and estimates only what follows it", () => {
    const messages = [user("hi"), assistant({ text: "ok", usage: usageOf(5_000) }), user("b".repeat(400))];
    expect(contextUsage(messages, budget).used).toBe(5_000 + piTokens(400));
  });

  it("estimates around the app's own message kinds, which pi's estimator does not know", () => {
    const skill = { role: "skill", skill: "earnings-review", request: "", prompt: "p".repeat(400), timestamp: 2 } as const;
    const messages = [user("hi"), assistant({ text: "ok", usage: usageOf(5_000) }), skill, user("b".repeat(400))];
    // The skill turn is charged by the app at its prompt's length; pi counts only the user turn.
    expect(contextUsage(messages, budget).used).toBe(5_000 + piTokens(400) + piTokens(400));
  });

  it("counts only what the model still sees after a checkpoint, and how many there were", () => {
    const messages = [
      user("x".repeat(4_000)),
      toolResult("t1", "edgar", "y".repeat(4_000)),
      checkpoint("z".repeat(400)),
      user("what now?"),
    ];
    const usage = contextUsage(messages, budget);
    expect(usage.compactions).toBe(1);
    expect(usage.used).toBeLessThan(200);
  });
});
