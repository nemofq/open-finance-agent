import type { EvalRunSummary } from "../types";

/** A run header cannot make retained grades from another judge version comparable. */
export function judgeVersionIssues(summary: EvalRunSummary): string[] {
  const mismatches = summary.results.filter((result) => result.judgeResult && !result.judgeResult.error &&
    result.judgeResult.promptVersion !== summary.judgePromptVersion);
  return mismatches.length ? [`${mismatches.length} grade(s) do not match run judge prompt v${summary.judgePromptVersion}`] : [];
}
