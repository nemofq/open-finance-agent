"use client";

import Link from "next/link";
import { CheckCircle2Icon, ChevronDownIcon, CircleAlertIcon, Clock3Icon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { humanSchedule } from "@/lib/scheduled/schedule";
import type { ScheduledRun, ScheduledTaskWithRuns } from "@/lib/scheduled/types";
import type { SessionHeader } from "@/lib/sessions/types";
import { cn } from "cn";

function RunItem({ run }: { run: ScheduledRun }) {
  const Icon =
    run.status === "succeeded"
      ? CheckCircle2Icon
      : run.status === "failed" || run.status === "interrupted"
        ? CircleAlertIcon
        : Clock3Icon;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">
          {run.status} · {run.trigger}
        </p>
        <p className="text-xs text-muted-foreground">{new Date(run.scheduledFor).toLocaleString()}</p>
        {run.sessionId ? (
          <Link className="text-xs text-primary underline-offset-2 hover:underline" href={`/chat/${run.sessionId}`}>
            Open chat
          </Link>
        ) : null}
        {run.error ? <p className="break-words text-xs text-destructive">{run.error}</p> : null}
        {run.summary ? <p className="line-clamp-3 text-xs text-muted-foreground">{run.summary}</p> : null}
      </div>
    </li>
  );
}

const statusVariant = { active: "default", paused: "secondary", completed: "outline" } as const;

export interface TaskCardProps {
  task: ScheduledTaskWithRuns;
  /** For naming the chat a task continues. */
  sessions: SessionHeader[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onRun: () => void;
  onTogglePaused: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One task: its schedule and instructions, its actions, and when expanded its destination and runs. */
export function TaskCard({ task, sessions, expanded, onToggleExpanded, onRun, onTogglePaused, onEdit, onDelete }: TaskCardProps) {
  const latest = task.runs.at(0);
  const detailsId = `task-${task.id}-runs`;
  const destination =
    task.destination.type === "chat"
      ? `Linked chat: ${sessions.find((session) => session.id === task.destination.sessionId)?.title ?? task.destination.sessionId}`
      : `Standalone · ${task.destination.model.provider}/${task.destination.model.model}`;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="truncate">{task.title}</span>
            <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
            {task.unreadCount > 0 ? <Badge variant="destructive">{task.unreadCount} unread</Badge> : null}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{humanSchedule(task.schedule)}</p>
          <p className="text-xs text-muted-foreground">
            Next: {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "none"}
            {latest ? ` · Last: ${latest.status}` : null}
          </p>
          {task.status === "paused" && latest?.status === "failed" && latest.error ? (
            <p className="break-words text-xs text-destructive">{latest.error}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? "Hide" : "Show"} runs of ${task.title}`}
          onClick={onToggleExpanded}
        >
          <ChevronDownIcon className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="line-clamp-3 whitespace-pre-wrap text-sm">{task.prompt}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRun}>
            <PlayIcon />
            Run now
          </Button>
          {task.status !== "completed" ? (
            <Button variant="outline" size="sm" onClick={onTogglePaused}>
              {task.status === "active" ? <PauseIcon /> : <PlayIcon />}
              {task.status === "active" ? "Pause" : "Resume"}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </Button>
        </div>
        {expanded ? (
          <div id={detailsId} className="grid gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">{destination}</p>
            {task.skill ? <p className="text-xs text-muted-foreground">Skill: {task.skill}</p> : null}
            {task.runs.length > 0 ? (
              <ul className="grid gap-3">
                {task.runs.map((run) => (
                  <RunItem key={run.id} run={run} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
