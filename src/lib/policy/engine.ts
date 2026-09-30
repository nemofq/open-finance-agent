import type { BeforeStopEvent, BeforeToolEvent, AfterToolEvent, RuleContext } from "./events";
import { AFTER_TOOL_RULES, BEFORE_STOP_RULES, BEFORE_TOOL_RULES } from "./rules";
import type { Block, CheckRecord, CheckStage, Verdict } from "./types";

/**
 * Files a verdict on the turn and returns the record as filed. The harness binds it to the turn's
 * one check list, so the record the engine acts on is the one the transcript keeps.
 */
export type RecordCheck = (verdict: Verdict, stage: CheckStage, call: { name: string; id: string }) => CheckRecord;

export interface PolicyEngineOptions {
  context: RuleContext;
  record: RecordCheck;
}
export function createEngine({ context, record: file }: PolicyEngineOptions) {
  const record = (verdict: Verdict, stage: CheckStage, event: { toolName: string; toolCallId: string }) =>
    file(verdict, stage, { name: event.toolName, id: event.toolCallId });
  return {
    beforeTool(event: BeforeToolEvent): Block | undefined {
      for (const rule of BEFORE_TOOL_RULES) {
        const found = rule(event, context);
        if (!found) continue;
        // A block that asks for another tool first is satisfied once that tool was attempted.
        const verdict = found.kind === "block" && found.requires?.some((name) => context.state.attempted.has(name)) ? { ...found, kind: "annotate" as const } : found;
        const check = record(verdict, "before_tool", event);
        if (verdict.kind === "block" || verdict.kind === "serve") {
          return check.enforced ? { block: true, reason: verdict.text ?? verdict.reason } : undefined;
        }
      }
    },
    afterTool(event: AfterToolEvent): string[] {
      const notes: string[] = [];
      for (const rule of AFTER_TOOL_RULES) {
        const verdict = rule(event, context);
        if (!verdict) continue;
        const check = record(verdict, verdict.rule === "P6" ? "calculator" : "after_tool", event);
        if (check.enforced && verdict.kind === "annotate" && verdict.text) notes.push(verdict.text);
      }
      return notes;
    },
    beforeStop(event: BeforeStopEvent): Verdict | undefined {
      for (const rule of BEFORE_STOP_RULES) {
        const verdict = rule(event, context);
        if (verdict) return verdict;
      }
    },
  };
}
