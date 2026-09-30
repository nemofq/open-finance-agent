"use client";

import { CheckIcon, Clock3Icon, Loader2Icon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { Disclosure } from "@/components/shared/disclosure";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { entriesOf } from "./evidence";
import { toolBadges } from "./tool-badges";
import type { MessagePart } from "./transcript";
import { humanSchedule } from "@/lib/scheduled/schedule";
import { SCHEDULED_TOOL_NAMES } from "@/lib/scheduled/tool-names";
import type { ScheduledTask } from "@/lib/scheduled/types";

type ToolPart = Extract<MessagePart, { kind: "tool" }>;

/** `ticker: AAPL, limit: 4` — enough to recognise the call without expanding it. */
function argsSummary(args: unknown): string {
  if (args === null || typeof args !== "object") return "";
  const summary = Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
  return summary.length > 90 ? `${summary.slice(0, 89)}…` : summary;
}

function StatusIcon({ part }: { part: ToolPart }) {
  if (part.result === undefined) return <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />;
  if (part.isError) return <TriangleAlertIcon className="size-3.5 text-destructive" />;
  return <CheckIcon className="size-3.5 text-muted-foreground" />;
}

/** The header is one line: a long run of ids is cut short rather than pushing the card wider. */
const MAX_IDS = 3;

export function ToolCallCard({ part }: { part: ToolPart }) {
  const badges = toolBadges(part);
  const entries = entriesOf(part);

  if (part.name === SCHEDULED_TOOL_NAMES.create && part.result !== undefined && !part.isError) {
    const task = part.details as Partial<Pick<ScheduledTask, "id" | "title" | "schedule" | "nextRunAt">> | undefined;
    if (task?.id && task.schedule) {
      return (
        <div className="my-2 flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
          <Clock3Icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Scheduled: {task.title ?? "New task"}</p>
            <p className="text-xs text-muted-foreground">
              {humanSchedule(task.schedule)} · next {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "none"}
            </p>
          </div>
          <Link href="/scheduled" className="shrink-0 text-xs text-primary underline-offset-2 hover:underline">
            Manage
          </Link>
        </div>
      );
    }
  }

  return (
    <Disclosure
      className="my-2 rounded-lg border border-border bg-card text-sm"
      triggerClassName="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      summary={
        <>
          <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-mono text-xs">{part.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{argsSummary(part.args)}</span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{badges.label}</span>
          {badges.ids.slice(0, MAX_IDS).map((id) => (
            <Badge key={id} variant="outline" className="font-mono">
              {id}
            </Badge>
          ))}
          {badges.ids.length > MAX_IDS && <Badge variant="outline">+{badges.ids.length - MAX_IDS}</Badge>}
          {badges.lookAhead && <Badge variant="secondary">look-ahead</Badge>}
          {badges.conflict && <Badge variant="destructive">conflict</Badge>}
          <StatusIcon part={part} />
        </>
      }
    >
      <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2">
        {entries.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Evidence</p>
            <ul className="flex flex-col gap-1 text-xs">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-1.5">
                  <Badge variant="outline" className="font-mono">
                    {entry.id}
                  </Badge>
                  <span className="min-w-0 break-words">{entry.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Section label="Arguments" body={JSON.stringify(part.args, null, 2)} />
        {part.result !== undefined && (
          <Section label={part.isError ? "Error" : "Result"} body={part.result} error={part.isError} />
        )}
      </div>
    </Disclosure>
  );
}

function Section({ label, body, error }: { label: string; body: string; error?: boolean }) {
  return (
    <div>
      <p className={cn("mb-1 text-xs font-medium", error ? "text-destructive" : "text-muted-foreground")}>{label}</p>
      <pre className="max-h-64 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}
