import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { compose, type SessionCtx } from "@/lib/harness/concern";
import { capabilities } from "@/lib/harness/capabilities";
import { conduct } from "@/lib/harness/conduct";
import { delivery } from "@/lib/harness/delivery";
import { evidence } from "@/lib/harness/evidence";
import { user } from "@/lib/harness/user";
import { time } from "@/lib/harness/time";
import { testContext, generalTool } from "@/lib/policy/testing";
import type { FinanceTool, ToolMeta } from "@/lib/tools/contracts";
import { testTurn } from "@/lib/harness/testing";

function buildSystemPrompt(input: Partial<SessionCtx> & { dateLine?: string; skills?: SessionCtx["skillsIndex"]; sessionTickers?: string[]; calculator?: { available: boolean; reason?: string } }) {
  return compose([time, capabilities(input.calculator?.available ?? true), user(testContext()), conduct, evidence, delivery],
    { tools: [], skillsIndex: input.skills ?? [], ...input }, testTurn()).systemPrompt;
}

const dateLine = "Today's date is 2026-09-11.";

function tool(name: string, label: string, meta: ToolMeta): FinanceTool {
  return { ...generalTool(name), name, label, description: `${label} description`, meta };
}

const edgarFinancials = tool("edgar_financials", "As-reported financials", {
  class: "data",
  effect: "read",
  supportsAsOf: true,
  source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["fundamentals", "earnings"] },
});

const edgarFilings = tool("edgar_filings", "Recent SEC filings", {
  class: "data",
  effect: "read",
  supportsAsOf: true,
  source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["filings"] },
});

const vendorQuote = tool("alphavantage__GLOBAL_QUOTE", "GLOBAL_QUOTE", {
  class: "data",
  effect: "read",
  supportsAsOf: true,
  source: { id: "alphavantage", name: "Alpha Vantage", tier: 2, coverage: ["prices"] },
});

const calculator = tool("financial_calculator", "Financial calculator", {
  class: "finance",
  effect: "compute",
});

const webSearch = tool("web_search", "Web search", { class: "general", effect: "external" });
const memoryUpdate = tool("memory_update", "Update memory", { class: "general", effect: "write-local" });

describe("operating rules", () => {
  it("tells the model an attached image is a transcription, not evidence", () => {
    const prompt = buildSystemPrompt({ dateLine });
    expect(prompt).toContain("An attached image");
    expect(prompt).toContain("is not evidence");
    expect(prompt).toContain("assume()");
    expect(prompt).toContain("came from the user's image");
  });
});

describe("buildSystemPrompt", () => {
  it("states the persona without a turn date", () => {
    const prompt = buildSystemPrompt({ dateLine });
    expect(prompt).toContain("Open Finance Agent");
    expect(prompt).not.toContain(dateLine);
  });

  it("frames the work as personalised research and rules out advice", () => {
    const prompt = buildSystemPrompt({ dateLine });
    expect(prompt).toContain("personalised research");
    expect(prompt).toContain("This is research, not investment advice");
    expect(prompt).toContain("or propose a position size");
  });

  it("keeps the ticker, markdown and calculator rules", () => {
    const prompt = buildSystemPrompt({ dateLine });
    expect(prompt).toContain("$TICKER");
    expect(prompt).toContain("GitHub-flavoured markdown");
    expect(prompt).toContain("financial_calculator by evidence reference");
  });

  it("makes a report the default delivery for substantive analysis, with chat as the exception", () => {
    const prompt = buildSystemPrompt({ dateLine });
    expect(prompt).toContain("Substantive analysis");
    expect(prompt).toContain("create_report");
    expect(prompt).toContain("conclusion, decisive evidence and limits");
    expect(prompt).toContain("Quick facts, clarifications and follow-ups stay in chat.");
  });

  it("omits every optional section when there is nothing to say", () => {
    const prompt = buildSystemPrompt({ dateLine, memory: "  ", skills: [], sessionTickers: [], tools: [] });
    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("## Available skills");
    expect(prompt).not.toContain("## Data connections");
    expect(prompt).not.toContain("## Financial tools");
    expect(prompt).not.toContain("## General tools");
    expect(prompt).not.toContain("## Source tiers");
    expect(prompt).not.toContain("## Session context");
  });

  it("groups data connections by source, best tier first, with coverage and tool names", () => {
    const prompt = buildSystemPrompt({
      dateLine,
      tools: [vendorQuote, edgarFinancials, edgarFilings],
    });
    const section = prompt.slice(prompt.indexOf("## Data connections"));
    expect(section).toContain(
      "- **SEC EDGAR** — tier 1 (primary); covers fundamentals, earnings (actuals and calendar), filings",
    );
    expect(section).toContain("  - `edgar_financials` — As-reported financials");
    expect(section).toContain("  - `edgar_filings` — Recent SEC filings");
    expect(section).toContain("- **Alpha Vantage** — tier 2 (licensed vendor); covers prices");
    expect(section.indexOf("SEC EDGAR")).toBeLessThan(section.indexOf("Alpha Vantage"));
  });

  it("says what each financial tool guarantees", () => {
    const prompt = buildSystemPrompt({ dateLine, tools: [calculator] });
    expect(prompt).toContain("## Financial tools");
    expect(prompt).toContain("`financial_calculator` — runs the calculation itself and records the result");
  });

  it("lists general tools without effect parentheticals", () => {
    const prompt = buildSystemPrompt({ dateLine, tools: [webSearch, memoryUpdate] });
    expect(prompt).toContain("- `web_search` — Web search");
    expect(prompt).toContain("- `memory_update` — Update memory");
  });

  it("explains the tiers, the covered domains and the evidence tags", () => {
    const prompt = buildSystemPrompt({ dateLine, tools: [edgarFilings, vendorQuote, webSearch] });
    expect(prompt).toContain("**Tier 1, primary**");
    expect(prompt).toContain("**Tier 4, open web**");
    expect(prompt).toContain("Your data connections cover filings, prices. Use them before web search");
    expect(prompt).toContain("[E7 · SEC EDGAR · tier 1 · as of 2026-08-01]");
    expect(prompt).toContain("`[C3]`");
    expect(prompt).toContain("an unsourced figure is a mistake");
  });

  it("mentions evidence_get only when the tool is available", () => {
    const withoutIt = buildSystemPrompt({ dateLine, tools: [edgarFilings, webSearch] });
    expect(withoutIt).not.toContain("evidence_get");

    const evidenceGet = tool("evidence_get", "Look up evidence", { class: "general", effect: "read" });
    const withIt = buildSystemPrompt({ dateLine, tools: [edgarFilings, evidenceGet] });
    expect(withIt).toContain("`evidence_get` — Look up evidence");
  });

  it("says web search is all there is when no data connection is enabled", () => {
    const prompt = buildSystemPrompt({ dateLine, tools: [webSearch] });
    expect(prompt).not.toContain("## Data connections");
    expect(prompt).toContain("No data connection is enabled, so web search is all you have.");
  });

  it("says once in the prompt that the calculator is unavailable", () => {
    const prompt = buildSystemPrompt({
      dateLine,
      tools: [edgarFilings],
      calculator: { available: false, reason: "Python 3 was not found" },
    });
    expect(prompt).toContain("The financial calculator is unavailable: show every derived figure with its formula and input ids.");
  });

  it("stays quiet about the calculator when it works", () => {
    const prompt = buildSystemPrompt({ dateLine, tools: [calculator], calculator: { available: true } });
    expect(prompt).not.toContain("The financial calculator is unavailable");
  });

  it("includes the profile block as the profile track rendered it", () => {
    const prompt = buildSystemPrompt({ dateLine, profileBlock: "## Investor profile\n\n- Horizon: 3-10 years" });
    expect(prompt).toContain("## Investor profile\n\n- Horizon: 3-10 years");
  });

  it("includes memory and skills, leaving session tickers out", () => {
    const prompt = buildSystemPrompt({
      dateLine,
      memory: "## Watchlist\n- $AAPL",
      skills: [{ name: "earnings-preview", description: "Pre-earnings preview." }],
      sessionTickers: ["AAPL", "MSFT"],
    });
    expect(prompt).toContain("## Memory");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>earnings-preview</name>");
    expect(prompt).toContain("read_skill");
    expect(prompt).not.toContain("$AAPL, $MSFT");
  });

  it("closes memory before the rest of the prompt, so later sections never read as the user's notes", () => {
    const prompt = buildSystemPrompt({ dateLine, memory: "## Notes\n- likes dividends" });
    const closed = prompt.indexOf("</memory>");
    expect(prompt.indexOf("<memory>\n## Notes\n- likes dividends\n</memory>")).toBeGreaterThan(-1);
    expect(prompt.indexOf("You are Open Finance Agent")).toBeGreaterThan(closed);
  });
});

it("keeps the base prompt stable while refreshing request context for each turn", () => {
  const sections = [capabilities(false), user(testContext()), conduct, evidence, delivery];
  const session = { tools: [calculator, edgarFilings], skillsIndex: [] };
  const first = testTurn({ time: { ...testTurn().time, localDate: "2026-09-11" } });
  const second = testTurn({ time: { ...testTurn().time, localDate: "2026-09-18", localTime: "09:30" } });
  const a = compose([time, ...sections], session, first);
  const b = compose([time, ...sections], session, second);
  expect(Buffer.from(a.systemPrompt)).toEqual(Buffer.from(b.systemPrompt));
  const notesA = a.requestContext(normalizeContext({ systemPrompt: a.systemPrompt, messages: [] }));
  const notesB = b.requestContext(normalizeContext({ systemPrompt: b.systemPrompt, messages: [] }));
  expect(notesA).not.toEqual(notesB);
  expect(b.systemPrompt).toContain("The financial calculator is unavailable");
  expect(a.systemPrompt).not.toContain("{C17}");
  expect(a.systemPrompt).not.toContain("Session context");
});
