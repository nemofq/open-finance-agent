import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { matchFigures } from "@/lib/evidence/figures";
import { applyCompaction } from "./apply";
import { contextUsage, resolveContextBudget } from "./budget";
import { compactSession, findCut, type Summarize, summarizer } from "./compact";
import { assistant, entry, fakeModel, toolResult, user } from "./testing";
import type { CompactionMessage, ContextBudget } from "./types";
import { ledgerWith } from "@/lib/evidence/testing";

const budget = resolveContextBudget(fakeModel(32_768));

const revenue = entry("E7", {
  summary: "EDGAR income statement, quarterly, $NVDA",
  source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
  asOf: "2026-08-27",
  toolCallId: "call-0",
  facts: [{ metric: "revenue", period: "FY26 Q2", value: 30_040_000_000, unit: "USD" }],
});

const ledger = () => ledgerWith([revenue]);

/** A chat of `turns` question-tool-answer rounds, each result `chars` long. */
function chat(turns: number, chars = 400): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push(user(`question ${i}`));
    messages.push(assistant({ calls: [{ id: `call-${i}`, name: "edgar_income", arguments: { cik: "1045810" } }] }));
    messages.push(toolResult(`call-${i}`, "edgar_income", `revenue rows ${"x".repeat(chars)}`, i === 0 ? revenue : undefined));
    messages.push(assistant({ text: `answer ${i}` }));
  }
  return messages;
}

const scripted = (...summaries: string[]): Summarize => {
  let call = 0;
  return vi.fn(async () => summaries[Math.min(call++, summaries.length - 1)]);
};

const SOURCED = "### Facts\n- Revenue was $30,040M [E7] in FY26 Q2.";
const UNSOURCED = "### Facts\n- Revenue was $30,040M [E7], gross margin 74.9%.";

describe("applyCompaction", () => {
  it("leaves a chat that has never been compacted alone", () => {
    const messages = chat(1);
    expect(applyCompaction(messages)).toBe(messages);
  });

  it("sends the checkpoint in place of everything before it", () => {
    const checkpoint: CompactionMessage = {
      role: "compaction",
      summary: "the story so far",
      tokensBefore: 100,
      tokensAfter: 10,
      evidenceIds: ["E7"],
      timestamp: 1,
    };
    const messages = [...chat(1), checkpoint, user("and now?")];
    const visible = applyCompaction(messages);

    expect(visible).toHaveLength(2);
    expect(visible[0]).toMatchObject({ role: "user" });
    expect(visible[0].role === "user" && visible[0].content).toContain("the story so far");
    expect(visible[1]).toMatchObject({ role: "user" });
  });

  it("uses the last checkpoint and preserves its entire explicit tail", () => {
    const first: CompactionMessage = {
      role: "compaction",
      summary: "first",
      tokensBefore: 1,
      tokensAfter: 1,
      evidenceIds: [],
      timestamp: 1,
    };
    const messages = [
      user("a"),
      first,
      user("b"),
      { ...first, summary: "second" },
      toolResult("orphan", "edgar_income", "rows"),
      user("c"),
    ];
    const visible = applyCompaction(messages);

    expect(visible).toHaveLength(3);
    expect(visible[0].role === "user" && visible[0].content).toContain("second");
    expect(visible.slice(1)).toEqual(messages.slice(4));
  });
});

describe("findCut", () => {
  it("never places a checkpoint before a tool result in any transcript fixture", () => {
    const fixtures = [chat(1), chat(3, 4_000), chat(3, 40), [user("one long turn"), ...chat(1, 4_000).slice(1)],
      [{ role: "skill" as const, skill: "review", request: "review", prompt: "review", timestamp: 1 }, ...chat(1).slice(1)],
      [{ role: "scheduled" as const, taskId: "t", runId: "r", request: "review", prompt: "review", timestamp: 1 }, ...chat(1).slice(1)],
      [user("first question")]];
    for (const messages of fixtures) for (const budget of [0, 10, 1_000, 100_000]) {
      const cut = findCut(messages, 0, budget);
      expect(messages[cut].role).not.toBe("toolResult");
      expect(["user", "skill", "scheduled", "assistant"]).toContain(messages[cut].role);
    }
  });
  it("keeps the latest turn in full, whatever it costs", () => {
    const messages = chat(3, 4_000);
    expect(findCut(messages, 0, 10)).toBe(8);
  });

  it("takes in earlier turns while they fit the recent budget", () => {
    const messages = chat(3, 40);
    expect(findCut(messages, 0, 1_000)).toBe(4);
  });

  it("cuts inside a turn that is bigger than the budget on its own, never before a tool result", () => {
    const messages = [user("one long turn"), ...chat(1, 4_000).slice(1)];
    const cut = findCut(messages, 0, 10);
    expect(messages[cut].role).toBe("assistant");
  });
});

describe("compactSession", () => {
  it("writes a checkpoint, keeps the history and hides it from the model", async () => {
    const messages = chat(4);
    const summarize = scripted(SOURCED);
    const result = await compactSession({ messages, ledger: ledger(), budget, summarize, time: { mode: "live", timeZone: "Asia/Shanghai", localDate: "2026-09-13", market: { session: "closed", lastCompletedSession: "2026-09-11", nextOpen: "2026-09-14T09:30:00-04:00" } } });

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(result.compaction.summary).toBe(SOURCED);
    expect(result.compaction.evidenceIds).toEqual(["E7"]);
    expect(result.compaction.stripped).toBeUndefined();
    expect(result.messages).toHaveLength(messages.length + 1);
    expect(result.messages.filter((message) => message.role === "compaction")).toHaveLength(1);
    expect(applyCompaction(result.messages).length).toBeLessThan(result.messages.length);
  });

  it("carries the turn's date and the focus into the prompt", async () => {
    const summarize = scripted(SOURCED);
    await compactSession({
      messages: chat(2),
      ledger: ledger(),
      budget,
      summarize,
      focus: "the margin story",
      time: { mode: "live", timeZone: "UTC", localDate: "2026-09-13", market: { session: "closed", lastCompletedSession: "2026-09-11", nextOpen: "2026-09-14T09:30:00-04:00" } },
    });

    const call = vi.mocked(summarize).mock.calls[0][0];
    const text = call.messages[0].content;
    expect(call.systemPrompt).toContain("research checkpoint");
    expect(typeof text === "string" ? text : JSON.stringify(text)).toContain("Today's date: 2026-09-13");
    expect(typeof text === "string" ? text : JSON.stringify(text)).toContain("the margin story");
  });

  it("asks once more when the first checkpoint invents a figure", async () => {
    const summarize = scripted(UNSOURCED, SOURCED);
    const result = await compactSession({ messages: chat(3), ledger: ledger(), budget, summarize });

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(result.compaction.summary).toBe(SOURCED);
    expect(result.compaction.stripped).toBeUndefined();
  });

  it("strips what the retry still cannot source, and says what it stripped", async () => {
    const summarize = scripted(UNSOURCED, UNSOURCED);
    const result = await compactSession({ messages: chat(3), ledger: ledger(), budget, summarize });

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(result.compaction.summary).toContain("[figure removed: unsourced]");
    expect(result.compaction.summary).toContain("$30,040M [E7]");
    expect(result.compaction.stripped).toEqual(["74.9%"]);
  });

  it("updates the previous checkpoint instead of starting over", async () => {
    const first = await compactSession({ messages: chat(3), ledger: ledger(), budget, summarize: scripted(SOURCED) });
    const summarize = scripted(SOURCED);
    await compactSession({ messages: [...first.messages, ...chat(2)], ledger: ledger(), budget, summarize });

    const prompt = vi.mocked(summarize).mock.calls[0][0].messages[0].content;
    expect(JSON.stringify(prompt)).toContain("Previous checkpoint");
  });

  it("compacts a long chat on a 32k window and leaves its figures answerable", async () => {
    const long = chat(10, 12_000);
    const before = contextUsage(long, budget);
    expect(before.used).toBeGreaterThan(budget.compactAt);

    const result = await compactSession({ messages: long, ledger: ledger(), budget, summarize: scripted(SOURCED) });
    const after = contextUsage(result.messages, budget);

    expect(after.used).toBeLessThan(before.used);
    expect(after.compactions).toBe(1);
    expect(result.compaction.tokensAfter).toBeLessThan(result.compaction.tokensBefore);

    // The figure survived with its id, and the ledger still holds the value it names.
    const visible = applyCompaction(result.messages);
    const checkpoint = visible[0];
    const text = checkpoint.role === "user" && typeof checkpoint.content === "string" ? checkpoint.content : "";
    expect(text).toContain("$30,040M [E7]");
    expect(matchFigures(text, ledger())[0].matches).toEqual(["E7"]);
  });
});

describe("contextUsage after compaction", () => {
  it("falls under the compaction threshold once the history is hidden", async () => {
    const tight: ContextBudget = { ...budget, keepRecent: 1_000 };
    const long = chat(8, 12_000);
    const result = await compactSession({ messages: long, ledger: ledger(), budget: tight, summarize: scripted(SOURCED) });
    expect(contextUsage(result.messages, tight).used).toBeLessThan(tight.compactAt);
  });
});

describe("summarizer", () => {
  const context = { systemPrompt: "Summarise.", messages: [] };

  it("returns the text of the model's reply", async () => {
    const summarize = summarizer(() => ({
      result: async () => ({ ...assistant({ text: "" }), content: [{ type: "text", text: "Revenue " }, { type: "text", text: "grew." }] }),
    }));
    expect(await summarize(context)).toBe("Revenue grew.");
  });

  it("throws on a failed call rather than writing an empty checkpoint", async () => {
    const summarize = summarizer(() => ({
      result: async () => ({ ...assistant({ text: "" }), content: [], stopReason: "error" as const, errorMessage: "overloaded" }),
    }));
    await expect(summarize(context)).rejects.toThrow("overloaded");
  });
});
