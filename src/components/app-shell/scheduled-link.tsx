"use client";

import { AlarmClockIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { useScheduledChanged, useSessionsChanged } from "@/components/shared/session-events";
import { useJson } from "@/components/shared/use-json";

/**
 * Unread scheduled runs across every task, for the sidebar's badge: re-read on navigation, when a
 * task or a session changes, and every five seconds from the count-only route.
 */
export function useScheduledUnread(): number {
  const pathname = usePathname();
  const { data, reload } = useJson<{ unread: number }>("/api/scheduled-tasks/unread", {
    intervalMs: 5_000,
    refreshKey: pathname,
  });
  const refresh = useCallback(() => void reload(), [reload]);
  useScheduledChanged(refresh);
  useSessionsChanged(refresh);
  return data?.unread ?? 0;
}

/** The expanded sidebar's unread count beside its Scheduled link. */
export function BadgeCount({ count }: { count: number }) {
  return <span className="ml-auto rounded-full bg-destructive/15 px-1.5 text-[10px] font-medium text-destructive">{count > 99 ? "99+" : count}</span>;
}

/** The rail's Scheduled icon: a dot says something is unread. */
export function ScheduledRailIcon({ unread }: { unread: number }) {
  return (
    <span className="relative"><AlarmClockIcon />{unread > 0 && <span className="absolute -top-1 -right-1 size-1.5 rounded-full bg-destructive" />}</span>
  );
}
