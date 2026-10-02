import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { CheckRecord } from "@/lib/policy/types";
import {
  buildJudgePrompt,
  extractJudgeJson,
  JUDGE_PROMPT_VERSION,
  parseJudgeJson,
  renderChecks,
  renderDataBoundary,
  renderEvidenceIndex,
  truncateToolOutput,
} from "./judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION, type DeterministicCheckResult, type OfflineAudit, type OfflineAuditEvent } from "../types";

const VALID = {
  intentScore: 14,
  intentFeedback: "Saw the guidance question behind the beat.",
  financialScore: 17,
  financialFeedback: "Margin bridge is right.",
  groundingScore: 12,
  groundingFeedback: "Every figure traced to EDGAR.",
  retailClarityScore: 9,
  retailClarityFeedback: "Plain language, no advice.",
  overallVerdict: "Strong answer.",
};

describe("parsing the judge's reply", () => {
  it("reads plain JSON", () => {
    const result = parseJudgeJson(JSON.stringify(VALID), "prov/judge");
    expect(result.totalJudgeScore).toBe(52);
    expect(result.promptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(result.error).toBeUndefined();
    expect(result.rawResponse).toBe(JSON.stringify(VALID));
  });

  it("reads a fenced block", () => {
    const raw = `Here is my assessment.\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\nDone.`;
    expect(parseJudgeJson(raw, "prov/judge").intentScore).toBe(14);
  });

  it("ignores a <think> block, including braces inside it", () => {
    const raw = `<think>The agent said {"foo": 1}; I should score grounding low.</think>\n${JSON.stringify(VALID)}`;
    expect(parseJudgeJson(raw, "prov/judge").groundingScore).toBe(12);
  });

  it("handles a <think> block followed by a fenced block", () => {
    const raw = `<think>weighing it up</think>\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(parseJudgeJson(raw, "prov/judge").totalJudgeScore).toBe(52);
  });

  it("handles a closing </think> with no opening tag", () => {
    expect(parseJudgeJson(`reasoning text</think>${JSON.stringify(VALID)}`, "prov/judge").financialScore).toBe(17);
  });

  it("treats an unterminated <think> as reasoning with no answer", () => {
    const result = parseJudgeJson("<think>still thinking about the margins", "prov/judge");
    expect(result.error).toBe("Invalid JSON response from judge");
    expect(result.totalJudgeScore).toBe(0);
  });

  it("skips a prose object that is not the verdict", () => {
    const raw = `The tool returned {not json at all} first.\n${JSON.stringify(VALID)}`;
    expect(parseJudgeJson(raw, "prov/judge").intentScore).toBe(14);
  });

  it.each([
    { intentScore: 99 },
    { financialScore: -4 },
    { groundingScore: "12" },
    { retailClarityScore: 9.5 },
    { intentScore: undefined },
    { financialFeedback: undefined },
    { groundingFeedback: "   " },
    { overallVerdict: null },
  ])("rejects incomplete or invalid rubric fields: %j", (fields) => {
    const raw = JSON.stringify({ ...VALID, ...fields });
    const result = parseJudgeJson(raw, "prov/judge");
    expect(result.error).toContain("Invalid judge rubric");
    expect(result.totalJudgeScore).toBe(0);
    expect(result.rawResponse).toBe(raw);
  });

  it("does not turn an empty object into a valid zero grade", () => {
    expect(parseJudgeJson("{}", "prov/judge").error).toContain("Invalid judge rubric");
  });

  it("accepts a complete, genuinely zero-scored rubric", () => {
    const raw = JSON.stringify({ ...VALID, intentScore: 0, financialScore: 0, groundingScore: 0, retailClarityScore: 0 });
    const result = parseJudgeJson(raw, "prov/judge");
    expect(result.totalJudgeScore).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("reports unparseable output without throwing", () => {
    const result = parseJudgeJson("I refuse to answer in JSON.", "prov/judge");
    expect(result.error).toBeDefined();
    expect(result.judgeModel).toBe("prov/judge");
    expect(result.overallVerdict).toContain("I refuse");
    expect(result.rawResponse).toBe("I refuse to answer in JSON.");
  });

  it("takes the last fenced block when the model emits a draft first", () => {
    const draft = JSON.stringify({ ...VALID, intentScore: 2 });
    const raw = `\`\`\`json\n${draft}\n\`\`\`\nOn reflection:\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(extractJudgeJson(raw)).toBe(JSON.stringify(VALID));
  });
});

describe("what the judge sees", () => {
  it("keeps the head of a long output and rescues evidence tags from the tail", () => {
    const body = "x".repeat(120);
    const text = `${body}\n${"filler line\n".repeat(50)}Revenue: $30,040M [E7]`;
    const truncated = truncateToolOutput(text, 100);

    expect(truncated.startsWith("x".repeat(100))).toBe(true);
    expect(truncated).toContain("more characters omitted");
    expect(truncated).toContain("[E7]");
    expect(truncated.length).toBeLessThan(text.length);
  });

  it("leaves a short output alone", () => {
    expect(truncateToolOutput("short", 100)).toBe("short");
  });

  it("renders one line per evidence entry", () => {
    const entries: EvidenceEntry[] = [
      {
        id: "E1",
        kind: "E",
        summary: "EDGAR income statement, quarterly, $NVDA",
        fetchedAt: "2026-01-01T00:00:00Z",
        asOf: "2024-07-28",
        source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      },
      { id: "E2", kind: "E", summary: "Web article", fetchedAt: "2026-01-01T00:00:00Z", lookAhead: true },
    ];

    const rendered = renderEvidenceIndex(entries);
    expect(rendered).toContain("- E1 · SEC EDGAR (tier 1) · as-of 2024-07-28 · EDGAR income statement");
    expect(rendered).toContain("LOOK-AHEAD");
  });

  it("marks observe-mode checks as observed only", () => {
    const checks: CheckRecord[] = [
      {
        id: "c1",
        rule: "P8",
        kind: "follow_up",
        reason: "Two figures had no entry.",
        timestamp: 0,
        stage: "before_stop",
        mode: "observe",
        enforced: false,
      },
    ];
    expect(renderChecks(checks)).toContain("P8 follow_up (observed only)");
    const resolved = { ...checks[0], enforced: true, resolved: true };
    const unresolved = { ...checks[0], enforced: true, resolved: false };
    expect(renderChecks([resolved])).toContain("P8 follow_up (resolved): Two figures had no entry.");
    expect(renderChecks([unresolved])).toContain("P8 follow_up (unresolved)");
    expect(renderChecks(checks)).not.toContain("resolved");
  });

  it("puts the tool outputs, the as-of date and the evidence index in the prompt", () => {
    const deterministicCheck: DeterministicCheckResult = {
      version: BENCHMARK_VERSION,
      identifiedAllEntities: true,
      matchedEntities: ["NVIDIA"],
      missingEntities: [],
      derivedFigures: 2,
      mathExpectationSatisfied: true,
      citationCount: 3,
      figuresChecked: 5,
      figuresBacked: 5,
      evidenceAvailable: true,
      evidenceScore: 12,
      figureSupportScore: 12,
      contractScore: 16,
      contractResults: [],
      score: 40,
      maxScore: 40,
      details: ["[Entities: diagnostic] found [NVIDIA]"],
    };

    const prompt = buildJudgePrompt({
      task: RETAIL_EVAL_TASKS[0],
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "edgar_financials",
          args: { ticker: "NVDA" },
          output: "Revenue: $30,040M",
          durationMs: 10,
          isError: false,
        },
      ],
      evidence: [{ id: "E1", kind: "E", summary: "EDGAR income", fetchedAt: "2026-01-01T00:00:00Z" }],
      checks: [],
      finalAssistantText: "NVIDIA beat but guided margins lower.",
      deterministicCheck,
    });

    expect(prompt).toContain("Revenue: $30,040M");
    expect(prompt).toContain("As-Of Date");
    expect(prompt).toContain("2024-08-29");
    expect(prompt).toContain("- E1 ·");
    expect(prompt).toContain("Checks are historical events");
    expect(prompt).toContain("Missing resolution status means unknown");
  });

  it("shows every user prompt for a multi-turn task and marks the last one as graded", () => {
    const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === "retail-13-semis-figure-survival");
    if (!task) throw new Error("missing multi-turn fixture");
    const prompt = buildJudgePrompt({
      task,
      toolCalls: [],
      evidence: [],
      checks: [],
      finalAssistantText: "Two exact figures.",
      deterministicCheck: {
        version: BENCHMARK_VERSION,
        identifiedAllEntities: false,
        matchedEntities: [],
        missingEntities: task.expectedEntities.map((entity) => entity.label),
        derivedFigures: 0,
        mathExpectationSatisfied: false,
        citationCount: 0,
        figuresChecked: 0,
        figuresBacked: 0,
        evidenceAvailable: true,
        evidenceScore: 0,
        figureSupportScore: 0,
        contractScore: 0,
        contractResults: [],
        score: 0,
        maxScore: 40,
        details: [],
      },
    });

    expect(prompt).toContain("Conversation Prompts (the final response answers the last prompt)");
    expect(prompt).toContain(task.prompt);
    expect(prompt).toContain(task.followUpPrompts?.[0] ?? "missing follow-up");
  });
});

describe("the offline data boundary", () => {
  const event = (kind: OfflineAuditEvent["kind"], tool: string, request: Record<string, unknown>, urls?: string[]): OfflineAuditEvent =>
    ({ tool, kind, normalizedRequest: request, ...(urls ? { urls } : {}), reason: "test" });
  const audit = (events: OfflineAuditEvent[]): OfflineAudit =>
    ({ emptyProviderResults: 0, corpusNotCaptured: 0, notAvailableAsOf: 0, outOfScopeQueries: 0, integrityErrors: 0, events });
  const future = "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm";

  it("lists refused requests once each, and leaves ordinary empty results out", () => {
    const text = renderDataBoundary(audit([
      event("not_available_as_of", "edgar_read_filing", { url: future }, [future]),
      event("not_available_as_of", "edgar_read_filing", { url: future }, [future]),
      event("out_of_scope_query", "web_search", { query: "bitcoin miners" }),
      event("not_captured", "web_fetch", { urls: ["https://example.com/a"] }, ["https://example.com/a"]),
      event("empty_result", "edgar_search", { query: "nothing" }),
      event("integrity_error", "market_quotes", { symbols: ["AAPL"] }),
    ]));
    expect(text?.split("\n")).toEqual([
      `- future-blocked · edgar_read_filing · ${future}`,
      '- out of scope · web_search · {"query":"bitcoin miners"}',
      "- not captured · web_fetch · https://example.com/a",
    ]);
  });

  it("caps the list and counts the rest", () => {
    const many = Array.from({ length: 20 }, (_, index) => event("out_of_scope", "web_fetch", {}, [`https://example.com/${index}`]));
    const lines = renderDataBoundary(audit(many))?.split("\n") ?? [];
    expect(lines).toHaveLength(16);
    expect(lines[15]).toBe("- … 5 more unavailable request(s) not listed");
  });

  it("puts the boundary and its grading rule in the prompt only when the offline dataset refused something", () => {
    const task = RETAIL_EVAL_TASKS[0];
    const base = {
      task,
      toolCalls: [],
      evidence: [],
      checks: [],
      finalAssistantText: "Answer.",
      deterministicCheck: {
        version: BENCHMARK_VERSION, identifiedAllEntities: true, matchedEntities: [], missingEntities: [],
        derivedFigures: 0, mathExpectationSatisfied: true, citationCount: 0, figuresChecked: 0, figuresBacked: 0, evidenceAvailable: true,
        evidenceScore: 0, figureSupportScore: 0, contractScore: 0, contractResults: [],
        score: 0, maxScore: 40, details: [],
      },
    };
    const withBoundary = buildJudgePrompt({ ...base, offlineAudit: audit([event("not_available_as_of", "edgar_read_filing", { url: future }, [future])]) });
    expect(withBoundary).toContain("### Offline Data Boundary");
    expect(withBoundary).toContain(`- future-blocked · edgar_read_filing · ${future}`);
    expect(withBoundary).toContain("Do not penalise the absence of a comparison or figure that this boundary made unavailable");
    expect(withBoundary).toContain("Do penalise any claim that ignores the boundary");
    expect(buildJudgePrompt(base)).not.toContain("Offline Data Boundary");
    expect(buildJudgePrompt({ ...base, offlineAudit: audit([event("empty_result", "edgar_search", {})]) })).not.toContain("Offline Data Boundary");
    expect(JUDGE_PROMPT_VERSION).toBe("7");
  });
});
