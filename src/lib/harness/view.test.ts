import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { resolveContextBudget } from "@/lib/context/budget";
import { assistant, entry, fakeModel, toolResult, user } from "@/lib/context/testing";
import type { ContextBudget, ContextUsage } from "@/lib/context/types";
import { ledgerWith } from "@/lib/evidence/testing";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { testTurn } from "./testing";
import { view } from "./view";

const base = resolveContextBudget(fakeModel(32_768));

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

const hooksWith = (budget: ContextBudget, onUsage?: (usage: ContextUsage) => void, ledger = ledgerWith([prices])) => {
  const turn = testTurn({ ledger });
  const transform = view(budget, onUsage).transformContext;
  if (!transform) throw new Error("the view concern lost its transformContext");
  return { transformContext: async (messages: AgentMessage[]) => await transform(messages, turn) };
};

describe("the view concern's transformContext", () => {
  it("adds no note of its own", async () => {
    const messages = transcript();
    expect(await hooksWith(base).transformContext(messages)).toBe(messages);
  });

  it("stubs older results once the context passes the threshold", async () => {
    const hooks = hooksWith({ ...base, stubAt: 100 });
    const out = await hooks.transformContext(transcript());
    const stubbed = out[2];

    expect(stubbed.role === "toolResult" && stubbed.content[0].type === "text" && stubbed.content[0].text).toContain(
      "(stubbed; evidence_get E12 for values)",
    );
  });

  it("reports how full the context is on every call", async () => {
    const seen: ContextUsage[] = [];
    await hooksWith(base, (usage) => seen.push(usage)).transformContext(transcript());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ window: 32_768, unknownWindow: false, compactions: 0 });
  });

  it("falls back to the untouched context rather than throwing at pi", async () => {
    const broken = { ...ledgerWith(), list: () => { throw new Error("ledger gone"); } } as EvidenceLedger;
    const messages = transcript();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await hooksWith({ ...base, stubAt: 1 }, undefined, broken).transformContext(messages);

    expect(out).toBe(messages);
    spy.mockRestore();
  });
});
