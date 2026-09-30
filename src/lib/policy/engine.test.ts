import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import type { AfterToolEvent, BeforeToolEvent, RuleContext } from "./events";
import { recordCheck } from "@/lib/harness/concern";
import { testTurn } from "@/lib/harness/testing";
import { dataTool, generalTool, testContext, testLedger } from "./testing";
import type { PolicyMode } from "./types";

const alphaVantage = dataTool("alphavantage__ETF_PROFILE", {
  id: "alphavantage",
  name: "Alpha Vantage",
  tier: 2,
  coverage: ["funds"],
});
const search = generalTool("web_search");

function setup(mode: PolicyMode = "enforce", overrides: Partial<RuleContext> = {}, turn = testTurn({ mode })) {
  const context = testContext({ tools: [alphaVantage, search], ...overrides });
  const engine = createEngine({ context, record: (verdict, stage, call) => recordCheck(turn, verdict, stage, call) });
  return { checks: turn.checks, context, engine, turn };
}

const fundSearch: BeforeToolEvent = {
  stage: "before_tool",
  toolName: "web_search",
  toolCallId: "call_1",
  args: { query: "$TSLY ETF distribution yield" },
  tool: search,
};


describe("the enforcement engine", () => {
  it("blocks and records the verdict in enforce mode", () => {
    const { engine, checks } = setup();
    const blocked = engine.beforeTool(fundSearch);

    expect(blocked).toEqual({ block: true, reason: expect.stringContaining("alphavantage__ETF_PROFILE") });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      id: "chk_1",
      rule: "P1",
      kind: "block",
      stage: "before_tool",
      tool: "web_search",
      toolCallId: "call_1",
      mode: "enforce",
      enforced: true,
    });
  });

  it("records what it would have done in observe mode, without blocking", () => {
    const { engine, checks } = setup("observe");

    expect(engine.beforeTool(fundSearch)).toBeUndefined();
    expect(checks[0]).toMatchObject({ rule: "P1", kind: "block", mode: "observe", enforced: false });
  });

  it("stops at the first block, since the later rules judge a call that is not happening", () => {
    const privacy = { accountNames: ["Nemo Brokerage"], quantities: [], costs: [], symbols: [] };
    const { engine, checks } = setup("enforce", { privacy });
    const event = { ...fundSearch, args: { query: "Nemo Brokerage $TSLY ETF distribution" } };

    engine.beforeTool(event);

    expect(checks.map((check) => check.rule)).toEqual(["P3"]);
  });

  it("annotates instead of blocking once the tool a block asks for was attempted this turn", () => {
    const { engine, checks, context } = setup();
    expect(engine.beforeTool(fundSearch)).toMatchObject({ block: true });
    // The attempt counts whatever it returned, and for whichever company it was made.
    context.state.attempted.add(alphaVantage.name);

    expect(engine.beforeTool({ ...fundSearch, toolCallId: "call_2" })).toBeUndefined();
    expect(checks.map((check) => [check.rule, check.kind])).toEqual([["P1", "block"], ["P1", "annotate"]]);
  });

  it("keeps blocking when only other tools were attempted", () => {
    const { engine, checks, context } = setup();
    context.state.attempted.add(search.name);

    expect(engine.beforeTool(fundSearch)).toMatchObject({ block: true });
    expect(checks.map((check) => check.kind)).toEqual(["block"]);
  });

  it("numbers checks in the order they happen", () => {
    const { engine, checks } = setup();
    engine.beforeTool(fundSearch);
    engine.beforeTool({ ...fundSearch, toolCallId: "call_2" });

    expect(checks.map((check) => check.id)).toEqual(["chk_1", "chk_2"]);
  });

  it("files its checks on the turn after those other concerns recorded, and acts on the record as filed", () => {
    const turn = testTurn({ mode: "observe" });
    recordCheck(turn, { rule: "P12", kind: "annotate", reason: "profile" }, "before_model");
    const { engine, checks } = setup("observe", {}, turn);

    expect(engine.beforeTool(fundSearch)).toBeUndefined();
    expect(checks.map((check) => [check.id, check.rule, check.enforced])).toEqual([["chk_1", "P12", false], ["chk_2", "P1", false]]);
  });

  it("files the calculator rule under their own stage", () => {
    const { engine, checks } = setup();
    const calculator: AfterToolEvent = {
      stage: "after_tool",
      toolName: "financial_calculator",
      toolCallId: "call_3",
      args: {},
      isError: false,
      text: "fv = 107",
      details: { undeclaredConstants: [{ value: 1.07, line: 1, snippet: "1.07" }] },
    };
    engine.afterTool(calculator);

    expect(checks.map((check) => check.stage)).toEqual(["calculator"]);
  });

  it("annotates a result in enforce mode and only records in observe mode", () => {
    const quote = dataTool("alphavantage__GLOBAL_QUOTE", {
      id: "alphavantage",
      name: "Alpha Vantage",
      tier: 2,
      coverage: ["prices"],
    });
    const ledger = testLedger();
    const entry = ledger.add({ kind: "E", summary: "quote", asOf: "2026-09-08" });
    const event: AfterToolEvent = {
      stage: "after_tool",
      toolName: quote.name,
      toolCallId: "call_5",
      args: { symbol: "NVDA" },
      tool: quote,
      entry,
      isError: false,
      text: "NVDA 178.20",
      details: undefined,
    };

    expect(setup("enforce", { ledger }).engine.afterTool(event)).toEqual([
      "Note: quote is as of 2026-09-08, older than the last completed session 2026-09-10.",
    ]);
    expect(setup("observe", { ledger }).engine.afterTool(event)).toEqual([]);
  });

});
