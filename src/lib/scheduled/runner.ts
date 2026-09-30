import { acceptRun } from "@/lib/agent/accept";
import { bindRun, getRun, endRun, releaseRun, type RunReservation, RunInProgressError } from "@/lib/agent/runs";
import { runTurn } from "@/lib/agent/turn";
import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { resolveModel } from "@/lib/llm";
import { processSingleton } from "@/lib/process-state";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { resolveTimeContext } from "@/lib/time";
import { errorMessage } from "@/lib/utils";
import { onTasksChanged } from "./events";
import { ScheduledTaskError } from "./tasks";
import {
  advanceSchedule,
  latestOccurrence,
} from "./schedule";
import {
  createScheduledRun,
  getScheduledTask,
  listScheduledTasks,
  recoverScheduledRuns,
  updateScheduledRun,
  updateScheduledTask,
} from "./store";
import type { ScheduledRun, ScheduledTask, SchedulerHealth } from "./types";

const SUMMARY_MAX = 1_000;

function summary(text: string): string {
  const value = text.trim();
  return value.length > SUMMARY_MAX ? `${value.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : value;
}

/** The one in-process worker that drives all background runs. */
class Scheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: { task: ScheduledTask; run: ScheduledRun }[] = [];
  private queuedTasks = new Set<string>();
  private runningTasks = new Set<string>();
  private running = false;
  private health: SchedulerHealth = { status: "starting" };
  private listening = false;

  getHealth(): SchedulerHealth {
    return { ...this.health };
  }

  async start(): Promise<void> {
    if (this.health.status === "ready") return;
    // An edit may move the next due time; `wake` ignores it until recovery has finished.
    if (!this.listening) {
      onTasksChanged(() => this.wake());
      this.listening = true;
    }
    try {
      await recoverScheduledRuns();
      this.health = { status: "ready" };
      await this.scan(true);
    } catch (error) {
      this.health = { status: "error", message: errorMessage(error) };
      console.error("[scheduled] runner failed to initialize:", error);
    }
  }

  wake(): void {
    if (this.health.status !== "ready") return;
    if (this.timer) clearTimeout(this.timer);
    void this.scan(false);
  }

  async enqueueManual(task: ScheduledTask): Promise<ScheduledRun> {
    const existing = this.queue.find((item) => item.task.id === task.id);
    if (existing) return existing.run;
    const run = await createScheduledRun({ taskId: task.id, trigger: "manual", scheduledFor: new Date().toISOString(), status: "queued" });
    this.queue.push({ task, run });
    this.queuedTasks.add(task.id);
    this.queue.sort((a, b) => a.run.scheduledFor.localeCompare(b.run.scheduledFor));
    void this.pump();
    return run;
  }

  private scheduleWake(nextRunAt: string | undefined): void {
    if (this.timer) clearTimeout(this.timer);
    if (!nextRunAt) {
      this.health = { ...this.health, nextWakeAt: undefined };
      return;
    }
    const delay = Math.min(Math.max(new Date(nextRunAt).getTime() - Date.now(), 0), 2_147_000_000);
    this.health = { ...this.health, nextWakeAt: nextRunAt };
    this.timer = setTimeout(() => void this.scan(false), delay);
  }

  private async scan(catchUp: boolean): Promise<void> {
    if (this.health.status !== "ready") return;
    try {
      const now = new Date();
      const { tasks } = await listScheduledTasks();
      let earliest: string | undefined;
      for (const task of tasks) {
        if (task.status !== "active" || !task.nextRunAt) continue;
        if (new Date(task.nextRunAt).getTime() <= now.getTime()) {
          if (this.queuedTasks.has(task.id) || this.runningTasks.has(task.id)) continue;
          const scheduledFor = catchUp && task.schedule.kind === "recurring"
            ? latestOccurrence(task.schedule, now)?.toISOString() ?? task.nextRunAt
            : task.nextRunAt;
          const run = await createScheduledRun({
            taskId: task.id,
            trigger: catchUp ? "catch_up" : "scheduled",
            scheduledFor,
            status: "queued",
          });
          // With no next run the store completes the task.
          const nextRunAt = advanceSchedule(task.schedule, now);
          await updateScheduledTask(task.id, { nextRunAt });
          this.queue.push({ task: { ...task, nextRunAt }, run });
          this.queuedTasks.add(task.id);
          continue;
        }
        if (!earliest || task.nextRunAt < earliest) earliest = task.nextRunAt;
      }
      this.queue.sort((a, b) => a.run.scheduledFor.localeCompare(b.run.scheduledFor));
      this.scheduleWake(earliest);
      void this.pump();
    } catch (error) {
      this.health = { status: "error", message: errorMessage(error) };
      console.error("[scheduled] scan failed:", error);
    }
  }

  private async pump(): Promise<void> {
    if (this.running || this.queue.length === 0 || this.health.status !== "ready") return;
    const next = this.queue[0];
    if (next.task.destination.type === "chat" && getRun(next.task.destination.sessionId)) {
      if (this.pumpTimer) clearTimeout(this.pumpTimer);
      this.pumpTimer = setTimeout(() => void this.pump(), 1_000);
      return;
    }
    this.queue.shift();
    this.queuedTasks.delete(next.task.id);
    this.runningTasks.add(next.task.id);
    this.running = true;
    try {
      // An edit can arrive while a run waits behind a human turn; use the durable definition that
      // is current at execution time rather than the snapshot that was queued by the scan.
      const current = await getScheduledTask(next.task.id);
      if (current) await this.execute(current, next.run);
      else await updateScheduledRun(next.task.id, next.run.id, { status: "failed", finishedAt: new Date().toISOString(), error: "The task was deleted before this run started" });
    } finally {
      this.running = false;
      this.runningTasks.delete(next.task.id);
      void this.scan(false);
    }
  }

  private async execute(task: ScheduledTask, run: ScheduledRun): Promise<void> {
    await updateScheduledRun(task.id, run.id, { status: "running", startedAt: new Date().toISOString() });
    let sessionId: string | undefined;
    let owned = false;
    let reservation: RunReservation | undefined;
    try {
      const config = readConfig();
      if (task.destination.type === "standalone") await checkModel(task, config, task.destination.model);
      const session = task.destination.type === "chat"
        ? await getSession(task.destination.sessionId)
        : await createSession({
            model: task.destination.model,
            skill: task.skill,
            title: `${task.title} · ${new Date(run.scheduledFor).toLocaleDateString()}`,
            visibility: "scheduled",
            scheduledOrigin: { taskId: task.id, runId: run.id },
          });
      if (!session) {
        await pause(task);
        throw new Error(`The linked chat for task ${task.id} no longer exists`);
      }
      sessionId = session.id;
      const accepted = (await acceptRun(session.id)).reservation;
      reservation = accepted;
      const time = resolveTimeContext({ timeZone: task.schedule.timeZone });
      await updateScheduledRun(task.id, run.id, { sessionId });
      const result = await runTurn({
        config,
        session,
        text: task.prompt,
        skill: task.skill,
        scheduled: { taskId: task.id, runId: run.id },
        time,
        store: { update: updateSession },
        sink: (event) => getRun(session.id)?.publish(event),
        onAgent: (agent) => {
          bindRun(accepted, agent);
          owned = true;
        },
      });
      if (result.aborted) {
        await finishRun(task, run, "interrupted", { error: "The run was stopped" });
        return;
      }
      if (result.error) throw new Error(result.error);
      await finishRun(task, run, "succeeded", {
        summary: summary(result.finalText),
        usage: { input: result.usage.input, output: result.usage.output, cost: result.usage.cost, calls: result.usage.calls },
      });
    } catch (error) {
      const message = errorMessage(error);
      if (!(error instanceof RunInProgressError)) {
        await finishRun(task, run, "failed", { error: message });
        console.error(`[scheduled] task ${task.id} run ${run.id} failed:`, error);
      } else {
        // A race with an interactive turn: keep one pending run for this task.
        this.queue.unshift({ task, run: { ...run, status: "queued" } });
        this.queuedTasks.add(task.id);
        await updateScheduledRun(task.id, run.id, { status: "queued", error: "Waiting for the linked chat to finish" });
      }
    } finally {
      if (owned && sessionId) endRun(sessionId);
      else if (reservation) releaseRun(reservation);
    }
  }
}

/**
 * Refuse a standalone run whose model cannot be used before its chat exists, or every run would
 * leave an empty chat behind. A model or provider that is gone will not come back, so the task is
 * paused, as one whose linked chat is gone is; a sign-in or a model list that failed may recover.
 */
async function checkModel(task: ScheduledTask, config: AppConfig, model: ModelRef): Promise<void> {
  const resolved = await resolveModel(config, model, { heldBy: "task" });
  if (resolved.ok) return;
  if (resolved.reason === "model_missing" || resolved.reason === "provider_missing") await pause(task);
  throw new Error(resolved.message);
}

/**
 * Stop a task from firing again. Only an active task can be: a one-off the scan has just run is
 * already completed by the store, and pausing it would offer a Resume with nothing left to run.
 */
async function pause(task: ScheduledTask): Promise<void> {
  if (task.status === "active") await updateScheduledTask(task.id, { status: "paused" });
}

/**
 * Record how a run ended, on the run and on its task. A task left with no next run is completed by
 * the store's own rule for an active task.
 */
async function finishRun(task: ScheduledTask, run: ScheduledRun, status: "succeeded" | "failed" | "interrupted", details: Partial<ScheduledRun>): Promise<void> {
  const finishedAt = new Date().toISOString();
  await updateScheduledRun(task.id, run.id, { status, finishedAt, ...details });
  await updateScheduledTask(task.id, { lastRunAt: finishedAt, lastRunStatus: status });
}

function scheduler(): Scheduler {
  return processSingleton("scheduled.scheduler", () => new Scheduler());
}

export async function startScheduler(): Promise<void> {
  await scheduler().start();
}

export function schedulerHealth(): SchedulerHealth {
  return scheduler().getHealth();
}

/** Used by the manual Run now endpoint; it never advances recurrence. */
export async function queueManualRun(taskId: string): Promise<ScheduledRun | null> {
  const task = await getScheduledTask(taskId);
  if (!task) return null;
  if (scheduler().getHealth().status !== "ready") throw new ScheduledTaskError("Scheduled runner is not ready", "runner_unavailable");
  return scheduler().enqueueManual(task);
}
