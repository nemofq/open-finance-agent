"use client";

import { useCallback, useState } from "react";
import { deleteJson, patchJson, postJson } from "@/components/shared/http-client";
import { notifyScheduledChanged, useScheduledChanged } from "@/components/shared/session-events";
import { useJson } from "@/components/shared/use-json";
import type { ScheduledTask, ScheduledTaskWithRuns, SchedulerHealth } from "@/lib/scheduled/types";
import type { SessionHeader } from "@/lib/sessions/types";
import { errorMessage } from "@/lib/utils";

interface ScheduledListing {
  tasks: ScheduledTaskWithRuns[];
  sessions?: SessionHeader[];
  health: SchedulerHealth;
  /** Task or run files that could not be read. */
  warnings?: string[];
}

export interface ScheduledTasks {
  tasks: ScheduledTaskWithRuns[];
  /** The chats a task can continue. */
  sessions: SessionHeader[];
  /** The runner's state, reported as an error while any file could not be read. */
  health: SchedulerHealth;
  /** The last failed read or action, in the route's words. */
  error: string | null;
  runNow: (task: ScheduledTask) => Promise<boolean>;
  /** Pause an active task or resume a paused one. */
  togglePaused: (task: ScheduledTask) => Promise<boolean>;
  remove: (task: ScheduledTask) => Promise<boolean>;
  markRead: (task: ScheduledTask) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
}

const taskUrl = (task: ScheduledTask) => `/api/scheduled-tasks/${encodeURIComponent(task.id)}`;

/**
 * The Scheduled page's tasks, their recent runs and the chats they can continue: read on mount,
 * every five seconds while the tab is visible, and whenever a task changes anywhere in the app.
 * Every action announces the change, which is also what reloads the list here.
 */
export function useScheduledTasks(): ScheduledTasks {
  const listing = useJson<ScheduledListing>("/api/scheduled-tasks", { intervalMs: 5_000 });
  const { reload } = listing;
  const [actionError, setActionError] = useState<string | null>(null);
  useScheduledChanged(useCallback(() => void reload(), [reload]));

  const act = async (request: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await request();
      notifyScheduledChanged();
      return true;
    } catch (err) {
      setActionError(errorMessage(err));
      return false;
    }
  };

  const data = listing.data;
  const warnings = data?.warnings ?? [];
  const health: SchedulerHealth = !data
    ? { status: "starting" }
    : warnings.length > 0
      ? { ...data.health, status: "error", message: warnings.join(" · ") }
      : data.health;

  return {
    tasks: data?.tasks ?? [],
    sessions: data?.sessions ?? [],
    health,
    error: actionError ?? listing.error,
    runNow: (task) => act(() => postJson<unknown>(`${taskUrl(task)}/run`)),
    togglePaused: (task) => act(() => patchJson<unknown>(taskUrl(task), { status: task.status === "active" ? "paused" : "active" })),
    remove: (task) => act(() => deleteJson(taskUrl(task))),
    markRead: (task) => act(() => postJson<unknown>(`${taskUrl(task)}/read`)),
    markAllRead: () => act(() => postJson<unknown>("/api/scheduled-tasks/read")),
  };
}
