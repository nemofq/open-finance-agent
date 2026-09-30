import { fixedTimeContext, resolveTimeContext } from "@/lib/time";
import { NEW_YORK } from "@/lib/time/session";
import type { TimeContext } from "@/lib/time/types";
import { cutoffInstant } from "../offline/mock-mcp-view";
import type { EvalTask } from "../types";

/**
 * The turn's clock against live providers. Most tasks are pinned to the end of their as-of day, so
 * every data tool runs with a point-in-time cutoff. A task that sets `asOfTime` is asked at a real
 * moment instead — the market is genuinely pre-open, open or closed — at the cost of the cutoff:
 * live time mode sets no `asOf` (see `EvalTask.asOfTime`).
 */
export function taskTimeContext(task: EvalTask): TimeContext {
  if (!task.asOfTime) return fixedTimeContext({ asOf: task.asOfDate });
  return resolveTimeContext({
    timeZone: NEW_YORK,
    now: new Date(cutoffInstant(task.asOfDate, task.asOfTime)),
  });
}

/**
 * Offline turns stay fixed even for an intraday task.  We still resolve the
 * market clock at the requested New York instant so retail-14 sees a genuine
 * pre-open state, while its data modules receive the deterministic task date
 * and cannot fall through to the host clock.
 */
export function offlineTimeContext(task: EvalTask): TimeContext {
  if (!task.asOfTime) return fixedTimeContext({ asOf: task.asOfDate });
  const atInstant = resolveTimeContext({
    timeZone: NEW_YORK,
    now: new Date(cutoffInstant(task.asOfDate, task.asOfTime)),
  });
  return { ...atInstant, mode: "fixed", asOf: task.asOfDate };
}
