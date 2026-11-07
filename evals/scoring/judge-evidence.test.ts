import { describe, expect, it } from "vitest";
import type { ToolCallTrace } from "../types";
import { auditJudgeEvidence, excerptFigures, figureWindows, judgeEvidenceOutputs, truncateToolOutput, uniqueClaims, WINDOW_BUDGET } from "./judge-evidence";

function call(output: string, id = "source", extra: Partial<ToolCallTrace> = {}): ToolCallTrace {
  return { toolCallId: id, toolName: "edgar_read_filing", args: {}, output, durationMs: 1, isError: false, ...extra };
}
const padding = "unrelated text ".repeat(500);

describe("bounded judge evidence windows", () => {
  it("restores word-form basis points and scaled table amounts from original source text", () => {
    const output = `${padding}\nGross margin increased seven basis points. Membership income (in millions): 1,712.\n[E7]`;
    const claims = "Gross margin rose 7 basis points; membership income was $1.712 billion [E7].";
    const packet = judgeEvidenceOutputs([call(output)], claims)[0].output;
    expect(packet.startsWith(output.slice(0, 6000))).toBe(true);
    expect(packet).toContain("increased seven basis points");
    expect(packet).toContain("millions): 1,712");
    expect(packet).toContain("[E7]");
    const audit = auditJudgeEvidence([call(output)], claims);
    expect(audit).toHaveLength(2);
    expect(audit.every((item) => item.cause === "head_cut" && item.recovered)).toBe(true);
  });

  it("handles reverse word-form claims and preserves source offsets", () => {
    const text = "Revenue grew twenty-seven percent, up one hundred and seven basis points.";
    const figures = excerptFigures(text);
    expect(figures.map((figure) => figure.value)).toEqual([27, 107]);
    expect(text.slice(figures[0].index, figures[0].index + figures[0].raw.length)).toContain("percent");
    const output = `${padding}Margin changed 7 basis points.`;
    expect(auditJudgeEvidence([call(output)], "seven basis points")[0]?.recovered).toBe(true);
  });

  it("leaves short and unrelated outputs unchanged", () => {
    for (const output of ["Revenue $1.712 billion.", padding]) {
      expect(judgeEvidenceOutputs([call(output)], "Revenue $1.712 billion.")[0].output).toBe(truncateToolOutput(output));
    }
  });

  it("does not duplicate values already visible in the head or preserved tag lines", () => {
    const output = `Membership income $1.712 billion. ${padding}Other context 1,712 [E7]`;
    expect(judgeEvidenceOutputs([call(output)], "$1.712 billion")[0].output).toBe(truncateToolOutput(output));
    expect(auditJudgeEvidence([call(output)], "$1.712 billion")).toEqual([]);
  });

  it("merges nearby windows and respects the per-output budget including markers", () => {
    const output = `${padding}Revenue $1.712 billion; margin rose 27.3%. ${padding}`;
    const windows = figureWindows(output, uniqueClaims("$1.712 billion and 27.3%"));
    expect(windows.match(/source characters/g)).toHaveLength(1);
    const many = Array.from({ length: 30 }, (_, i) => `$${100.25 + i} million`).join(` ${padding} `);
    const claims = Array.from({ length: 30 }, (_, i) => `$${100.25 + i} million`).join("; ");
    expect(figureWindows(`${padding}${many}`, uniqueClaims(claims)).length).toBeLessThanOrEqual(WINDOW_BUDGET);
    expect(auditJudgeEvidence([call(`${padding}${many}`)], claims).some((item) => !item.recovered)).toBe(true);
  });

  it("restores a figure split by the head boundary", () => {
    const output = `${"x ".repeat(2999)}$123.45 million profits`;
    expect(auditJudgeEvidence([call(output)], "$123.45 million")[0]?.recovered).toBe(true);
  });

  it("recovers relevant middle calls without adding every omitted head", () => {
    const calls = Array.from({ length: 20 }, (_, i) => call(i === 9 ? "HOKA wholesale sales $1.126 billion." : "No relevant financial data.", `c${i}`));
    const outputs = judgeEvidenceOutputs(calls, "HOKA wholesale sales $1.126 billion.");
    expect(outputs).toHaveLength(17);
    expect(outputs.find((item) => item.call.toolCallId === "c9")?.supplementary).toBe(true);
    expect(auditJudgeEvidence(calls, "$1.126 billion")[0]).toMatchObject({ cause: "call_filtered", recovered: true });
  });

  it("bounds windows from omitted middle calls globally", () => {
    const calls = Array.from({ length: 50 }, (_, i) => call(`${padding}$${100.25 + i} million ${padding}`, `c${i}`));
    const answer = calls.map((_, i) => `$${100.25 + i} million`).join("; ");
    const supplemental = judgeEvidenceOutputs(calls, answer).filter((item) => item.supplementary);
    expect(supplemental.reduce((sum, item) => sum + item.output.length, 0)).toBeLessThanOrEqual(6000);
    expect(supplemental.every((item) => item.output.length <= WINDOW_BUDGET)).toBe(true);
  });

  it("never recovers planted errors, incompatible currency, failed calls or rejected reports", () => {
    const calls = [call(`${padding}Income $1.712 billion.`), call("Income $8.456 billion.", "failed", { isError: true }),
      call("Income $8.456 billion.", "future", { offlineOutcome: "not_available_as_of" }),
      call("Income $8.456 billion.", "report", { toolName: "create_report" })];
    expect(auditJudgeEvidence(calls, "Income $8.456 billion and EUR 1.712 billion.")).toEqual([]);
    const output = judgeEvidenceOutputs(calls, "Income $8.456 billion.").map((item) => item.output).join("\n");
    expect(output).not.toContain("Income $1.712 billion");
    expect(output).not.toContain("$8.456 billion");
  });

  it("never treats omission counts or window coordinates as source figures", () => {
    expect(excerptFigures("… [2345 more characters omitted]\n… [source characters 6789-7890]")).toEqual([]);
    expect(auditJudgeEvidence([call(`${padding}Revenue $6789.`)], "Revenue $2345.")).toEqual([]);
  });
});
