import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { asRecord, reportVerification } from "../scoring/report-content";
import type { RunDiagnostics, ToolCallTrace } from "../types";

/** The two phrasings tool argument validation uses when it rejects a call. */
const ARGUMENT_ERROR = /Input validation error|Invalid arguments/;

export function emptyDiagnostics(): RunDiagnostics {
  return { toolArgumentErrors: 0, fallbackReports: 0, unverifiedFigures: 0, repairedFigures: 0 };
}

export function addDiagnostics(total: RunDiagnostics, item: RunDiagnostics): RunDiagnostics {
  return {
    toolArgumentErrors: total.toolArgumentErrors + item.toolArgumentErrors,
    fallbackReports: total.fallbackReports + item.fallbackReports,
    unverifiedFigures: total.unverifiedFigures + item.unverifiedFigures,
    repairedFigures: total.repairedFigures + item.repairedFigures,
  };
}

/**
 * Argument errors come from the tool trace, which records every call the model made. Reports come
 * from the transcript because a report the harness renders from the answer never passes through
 * the tool events, only into the persisted tool results.
 */
export function countDiagnostics(toolCalls: ToolCallTrace[], transcript: AgentMessage[]): RunDiagnostics {
  const diagnostics = emptyDiagnostics();
  for (const call of toolCalls) {
    if (call.isError && ARGUMENT_ERROR.test(call.output)) diagnostics.toolArgumentErrors += 1;
  }
  for (const message of transcript) {
    if (message.role !== "toolResult" || message.toolName !== "create_report" || message.isError) continue;
    if (asRecord(message.details)?.rendered === "answer") diagnostics.fallbackReports += 1;
    const verification = reportVerification(message.details);
    diagnostics.unverifiedFigures += verification?.unverified ?? 0;
    diagnostics.repairedFigures += verification?.repaired ?? 0;
  }
  return diagnostics;
}
