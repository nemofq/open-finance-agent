import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { CheckRecord } from "@/lib/policy/types";
import {
  aggregateJudgeEvaluations,
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
import type { EvalTask, OfflineAudit, OfflineAuditEvent, RubricVerdict } from "../types";

const TASK = RETAIL_EVAL_TASKS[0];

function reply(task: EvalTask, verdict: RubricVerdict | ((id: string) => RubricVerdict) = "met"): string {
  return JSON.stringify({
    items: task.rubricItems.map((item) => ({
      id: item.id,
      verdict: typeof verdict === "function" ? verdict(item.id) : verdict,
      rationale: `Reason for ${item.id}`,
      answerEvidence: `Answer passage for ${item.id}`,
      evidenceIds: [],
    })),
    overallVerdict: "A concise verdict.",
  });
}

describe("the v2 item judge", () => {
  it("computes all numbers from item verdicts", () => {
    const result = parseJudgeJson(reply(TASK, (id) => id === "financial" ? "partial" : "met"), "prov/judge", TASK);
    expect(result.intentScore).toBe(20);
    expect(result.financialScore).toBe(15);
    expect(result.groundingScore).toBe(20);
    expect(result.retailClarityScore).toBe(10);
    expect(result.totalJudgeScore).toBe(65);
    expect(result.promptVersion).toBe(JUDGE_PROMPT_VERSION);
  });

  it("caps a missed critical item at 69 and a contradiction at 49", () => {
    const critical = TASK.rubricItems.find((item) => item.critical)?.id;
    expect(critical).toBeDefined();
    const missed = parseJudgeJson(reply(TASK, (id) => id === critical ? "missed" : "met"), "prov/judge", TASK);
    const contradicted = parseJudgeJson(reply(TASK, (id) => id === critical ? "contradicted" : "met"), "prov/judge", TASK);
    expect(missed.totalJudgeScore).toBe(80);
    expect(missed.scoreCap).toBe(69);
    expect(missed.criticalMisses).toEqual([critical]);
    expect(contradicted.scoreCap).toBe(49);
    expect(contradicted.criticalContradictions).toEqual([critical]);
  });

  it("rejects missing, duplicate and invented item ids", () => {
    const parsed = JSON.parse(reply(TASK)) as { items: Array<Record<string, unknown>>; overallVerdict: string };
    parsed.items.pop();
    expect(parseJudgeJson(JSON.stringify(parsed), "prov/judge", TASK).error).toContain("Invalid judge rubric ids");
    parsed.items.push(parsed.items[0]);
    expect(parseJudgeJson(JSON.stringify(parsed), "prov/judge", TASK).error).toContain("Invalid judge rubric ids");
  });

  it("accepts fenced output and ignores reasoning blocks", () => {
    const raw = `<think>{"draft":true}</think>\n\`\`\`json\n${reply(TASK)}\n\`\`\``;
    expect(parseJudgeJson(raw, "prov/judge", TASK).totalJudgeScore).toBe(80);
  });

  it("reports malformed output without manufacturing a valid grade", () => {
    const result = parseJudgeJson("I refuse.", "prov/judge", TASK);
    expect(result.error).toBe("Invalid JSON response from judge");
    expect(result.totalJudgeScore).toBe(0);
  });

  it("takes the last valid fenced object", () => {
    const raw = `\`\`\`json\n{"draft":true}\n\`\`\`\n\`\`\`json\n${reply(TASK)}\n\`\`\``;
    expect(extractJudgeJson(raw)).toBe(reply(TASK));
  });

  it("uses the median item verdict across repeated judges", () => {
    const grades = (["met", "partial", "partial"] as RubricVerdict[]).map((verdict) => parseJudgeJson(reply(TASK, verdict), "prov/judge", TASK));
    const result = aggregateJudgeEvaluations(grades, TASK, "prov/judge");
    expect(result.rubricItems.every((item) => item.verdict === "partial")).toBe(true);
    expect(result.totalJudgeScore).toBe(40);
  });

  it("resolves an even repeated-judge tie conservatively", () => {
    const grades = (["met", "partial"] as RubricVerdict[]).map((verdict) => parseJudgeJson(reply(TASK, verdict), "prov/judge", TASK));
    expect(aggregateJudgeEvaluations(grades, TASK, "prov/judge").totalJudgeScore).toBe(40);
  });

  it("keeps the known Apple and YieldMax core errors below 50 even with perfect integrity", () => {
    for (const [taskId, criticalId] of [
      ["retail-14-apple-pre-open-timing", "pre-open-boundary"],
      ["retail-04-dividend-yield-trap", "roc-not-inferred"],
    ]) {
      const task = RETAIL_EVAL_TASKS.find((item) => item.id === taskId);
      if (!task) throw new Error(`missing ${taskId}`);
      const judged = parseJudgeJson(reply(task, (id) => id === criticalId ? "contradicted" : "met"), "prov/judge", task);
      expect(Math.min(20 + judged.totalJudgeScore, judged.scoreCap ?? 100), taskId).toBe(49);
    }
  });

  it("gives SMCI partial grounding credit when the risk interpretation is right but a requested quote is absent", () => {
    const task = RETAIL_EVAL_TASKS.find((item) => item.id === "retail-10-smci-accounting-red-flag");
    if (!task) throw new Error("missing SMCI task");
    const judged = parseJudgeJson(reply(task, (id) => id === "grounding" ? "partial" : "met"), "prov/judge", task);
    expect(judged.groundingScore).toBe(10);
    expect(judged.criticalMisses).toEqual([]);
    expect(judged.totalJudgeScore).toBe(70);
  });
});

describe("what the judge sees", () => {
  it("keeps evidence tags from the tail of a long tool output", () => {
    const text = `${"x".repeat(120)}\n${"filler\n".repeat(50)}Revenue: $30,040M [E7]`;
    const truncated = truncateToolOutput(text, 100);
    expect(truncated).toContain("more characters omitted");
    expect(truncated).toContain("[E7]");
  });

  it("renders evidence and check state", () => {
    const entries: EvidenceEntry[] = [{
      id: "E1", kind: "E", summary: "EDGAR income", fetchedAt: "2026-01-01T00:00:00Z", asOf: "2024-07-28",
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 }, lookAhead: true,
    }];
    expect(renderEvidenceIndex(entries)).toContain("LOOK-AHEAD");
    const checks: CheckRecord[] = [{ id: "c1", rule: "P8", kind: "follow_up", reason: "missing", timestamp: 0, stage: "before_stop", mode: "observe", enforced: false }];
    expect(renderChecks(checks)).toContain("observed only");
  });

  it("includes answer context and never exposes an integrity score", () => {
    const prompt = buildJudgePrompt({
      task: TASK,
      toolCalls: [{ toolCallId: "c1", toolName: "edgar_financials", args: { ticker: "NVDA" }, output: "Revenue $30,040M [E1]", durationMs: 1, isError: false, offlineOutcome: "served" }],
      evidence: [{ id: "E1", kind: "E", summary: "EDGAR income", fetchedAt: "2026-01-01T00:00:00Z" }],
      checks: [],
      finalAssistantText: "NVIDIA beat but forward margins disappointed.",
    });
    expect(prompt).toContain("Revenue $30,040M");
    expect(prompt).toContain("NVIDIA beat but forward margins disappointed.");
    expect(prompt).toContain("### Rubric Items");
    expect(prompt).not.toMatch(/Deterministic|Integrity:|\/20/);
  });
});

describe("the offline data boundary", () => {
  const event = (kind: OfflineAuditEvent["kind"], tool: string, request: Record<string, unknown>, urls?: string[]): OfflineAuditEvent =>
    ({ tool, kind, normalizedRequest: request, ...(urls ? { urls } : {}), reason: "test" });
  const audit = (events: OfflineAuditEvent[]): OfflineAudit =>
    ({ emptyProviderResults: 0, corpusNotCaptured: 0, notAvailableAsOf: 0, outOfScopeQueries: 0, integrityErrors: 0, events });

  it("deduplicates refused requests and excludes ordinary empty results", () => {
    const url = "https://example.com/future";
    expect(renderDataBoundary(audit([
      event("not_available_as_of", "web_fetch", { url }, [url]),
      event("not_available_as_of", "web_fetch", { url }, [url]),
      event("empty_result", "web_search", { query: "nothing" }),
    ]))?.split("\n")).toEqual([`- future-blocked · web_fetch · ${url}`]);
  });
});
