"use client";

import { useMemo, useState } from "react";
import { AlarmClockIcon, PlusIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, Notice, PageHeader, PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ScheduledTask, ScheduledTaskStatus } from "@/lib/scheduled/types";
import { TaskCard } from "./task-card";
import { TaskEditor } from "./task-editor";
import { useScheduledTasks } from "./use-scheduled-tasks";

const FILTERS: { value: ScheduledTaskStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

/**
 * Which task the editor is open on, `null` for a new one. The editor is mounted only while open, so
 * each opening seeds a fresh draft.
 */
type EditorState = { task: ScheduledTask | null } | null;

/** The Scheduled inbox: the tasks by status, the runner's health, and the task editor. */
export function ScheduledPage() {
  const scheduled = useScheduledTasks();
  const { tasks, health } = scheduled;
  const [filter, setFilter] = useState<ScheduledTaskStatus>("active");
  const [editor, setEditor] = useState<EditorState>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);
  const [deleting, setDeleting] = useState(false);

  const visible = useMemo(() => tasks.filter((task) => task.status === filter), [tasks, filter]);
  const unread = tasks.reduce((total, task) => total + task.unreadCount, 0);

  const toggleExpanded = (task: ScheduledTask) => {
    const opening = !expanded.has(task.id);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
    // Opening a task is reading its runs.
    if (opening && (tasks.find((candidate) => candidate.id === task.id)?.unreadCount ?? 0) > 0) void scheduled.markRead(task);
  };

  async function confirmDelete(task: ScheduledTask) {
    setDeleting(true);
    await scheduled.remove(task);
    setDeleting(false);
    setPendingDelete(null);
  }

  return (
    <PageShell>
      <PageHeader
        icon={AlarmClockIcon}
        title="Scheduled"
        description="Background tasks that continue a chat or start a fresh chat on each run."
        actions={
          <>
            <Button variant="outline" disabled={unread === 0} onClick={() => void scheduled.markAllRead()}>
              Mark all as read{unread ? ` · ${unread}` : ""}
            </Button>
            <Button onClick={() => setEditor({ task: null })}>
              <PlusIcon />
              New task
            </Button>
          </>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Show tasks by status">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                variant={filter === item.value ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
                <span className="ml-1 text-xs text-muted-foreground">
                  {tasks.filter((task) => task.status === item.value).length}
                </span>
              </Button>
            ))}
          </div>
          <span className={`text-xs ${health.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            Runner: {health.status}
            {health.nextWakeAt ? ` · next ${new Date(health.nextWakeAt).toLocaleString()}` : null}
            {health.message ? ` · ${health.message}` : null}
          </span>
        </div>

        {scheduled.error ? <Notice tone="error">{scheduled.error}</Notice> : null}

        {visible.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            sessions={scheduled.sessions}
            expanded={expanded.has(task.id)}
            onToggleExpanded={() => toggleExpanded(task)}
            onRun={() => void scheduled.runNow(task)}
            onTogglePaused={() => void scheduled.togglePaused(task)}
            onEdit={() => setEditor({ task })}
            onDelete={() => setPendingDelete(task)}
          />
        ))}
        {visible.length === 0 ? <EmptyState>No {filter} scheduled tasks.</EmptyState> : null}
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        {editor ? (
          <TaskEditor task={editor.task} sessions={scheduled.sessions} onClose={() => setEditor(null)} />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.title ?? "task"}”?`}
        description="The task and its run history are removed. Chats and reports its runs made are kept."
        confirmLabel="Delete task"
        pending={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void confirmDelete(pendingDelete)}
      />
    </PageShell>
  );
}
