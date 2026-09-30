import type { DestinationInput, ScheduleInput } from "./schema";

/**
 * The stored shapes, derived from the contract in ./schema. `sessionId?: never` on a standalone
 * destination lets a reader test `destination.sessionId` without narrowing first.
 */
export type ScheduledDestination =
  | Extract<DestinationInput, { type: "chat" }>
  | (Extract<DestinationInput, { type: "standalone" }> & { sessionId?: never });

export type ScheduledSchedule = ScheduleInput;

export type ScheduledTaskStatus = "active" | "paused" | "completed";
export type ScheduledRunStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type ScheduledRunTrigger = "scheduled" | "catch_up" | "manual";

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  skill?: string;
  destination: ScheduledDestination;
  schedule: ScheduledSchedule;
  status: ScheduledTaskStatus;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: ScheduledRunStatus;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  trigger: ScheduledRunTrigger;
  scheduledFor: string;
  status: ScheduledRunStatus;
  sessionId?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  usage?: { input: number; output: number; cost: number; calls: number };
  unread: boolean;
}

export interface ScheduledTaskWithRuns extends ScheduledTask {
  runs: ScheduledRun[];
  unreadCount: number;
}

export interface SchedulerHealth {
  status: "starting" | "ready" | "error";
  message?: string;
  nextWakeAt?: string;
}
