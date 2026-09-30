"use client";

import { ClockIcon, MessageSquareIcon, SearchIcon, TagIcon, Trash2Icon, XIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { deleteJson } from "@/components/shared/http-client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { filterSessions, groupByDate, groupByTicker } from "@/lib/sessions/grouping";
import type { SessionHeader } from "@/lib/sessions/types";
import { cn } from "cn";
import { errorMessage } from "@/lib/utils";
import { notifySessionsChanged, useSessionsChanged } from "@/components/shared/session-events";
import { createStoredValue, useStoredValue } from "@/components/shared/stored-value";
import { useJson } from "@/components/shared/use-json";

export interface SessionIndex {
  sessions: SessionHeader[];
  dataDir: string;
}

type ViewMode = "date" | "ticker";

/** How the list is grouped, remembered per browser. */
const viewModeStore = createStoredValue<ViewMode>(
  "open-finance.sidebar.view",
  (raw) => (raw === "date" || raw === "ticker" ? raw : undefined),
  "date",
);

/**
 * The saved chats, kept current: re-read on navigation, whenever a session is created, renamed or
 * deleted, and every five seconds for the running dot. `null` until the first read answers.
 */
export function useSessionIndex(): SessionIndex | null {
  const pathname = usePathname();
  const { data, reload } = useJson<SessionIndex>("/api/sessions", { intervalMs: 5_000, refreshKey: pathname });
  useSessionsChanged(useCallback(() => void reload(), [reload]));
  return data;
}

/** `$AAPL $MSFT +2`: the row keeps one line for tickers, so the tail becomes a count. */
function tickerLine(tickers: string[]): string {
  const shown = tickers.slice(0, 3);
  const rest = tickers.length - shown.length;
  return `${shown.map((ticker) => `$${ticker}`).join(" ")}${rest > 0 ? ` +${rest}` : ""}`;
}

interface SessionItemProps {
  session: SessionHeader;
  active: boolean;
  onNavigate?: () => void;
  onRemove: (id: string) => void;
}

function SessionItem({ session, active, onNavigate, onRemove }: SessionItemProps) {
  return (
    <li className="group/item relative">
      <Link
        href={`/chat/${session.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-8 flex-col justify-center rounded-lg py-1 pr-8 pl-2 text-sm transition-colors hover:bg-sidebar-accent",
          active && "bg-sidebar-accent font-medium",
        )}
      >
        <span className="truncate leading-5">{session.title}</span>
        {session.tickers.length > 0 && (
          <span className="truncate font-mono text-[11px] leading-4 text-muted-foreground">
            {tickerLine(session.tickers)}
          </span>
        )}
      </Link>
      {/* One trailing slot for both: the dot gives way to delete on hover, so nothing shifts. */}
      <div className="absolute top-1 right-1 flex h-6 w-8 items-center justify-end">
        {session.running && (
          <span
            role="img"
            aria-label="Working"
            className="mr-1 size-1.5 shrink-0 animate-pulse rounded-full bg-primary group-hover/item:invisible group-focus-within/item:invisible motion-reduce:animate-none"
          />
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${session.title}`}
          onClick={() => onRemove(session.id)}
          className="absolute right-0 opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100"
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

/** One heading's chats: a date, a ticker, or the chats that name none. */
function SessionGroup({ heading, count, sessions, onNavigate, onRemove }: {
  heading: ReactNode;
  count?: number;
  sessions: SessionHeader[];
  onNavigate?: () => void;
  onRemove: (id: string) => void;
}) {
  const pathname = usePathname();
  return (
    <section>
      <div className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
        {heading}
        {count !== undefined && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-normal">{count}</span>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            active={pathname === `/chat/${session.id}`}
            onNavigate={onNavigate}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

function ViewModeButton({ mode, current, icon: Icon, label }: {
  mode: ViewMode;
  current: ViewMode;
  icon: LucideIcon;
  label: string;
}) {
  const selected = mode === current;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={selected}
            onClick={() => viewModeStore.set(mode)}
            className={cn("text-muted-foreground", selected && "bg-sidebar-accent text-foreground")}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The expanded sidebar's chat list: a row that is either the title with its view switches or the
 * search field, and the chats grouped by date or by ticker. The search state belongs to the
 * sidebar, which keeps it while the column is collapsed to its rail.
 */
export function SessionList({
  index,
  searching,
  onSearchingChange,
  query,
  onQueryChange,
  onNavigate,
}: {
  index: SessionIndex | null;
  searching: boolean;
  onSearchingChange: (searching: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onNavigate?: () => void;
}) {
  const filterRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const viewMode = useStoredValue(viewModeStore);

  // The input exists only in search mode, and only in the wide layout: the rail's search control
  // opens the mode and expands the column, and the caret lands here once both have happened.
  useEffect(() => {
    if (!searching) return;
    filterRef.current?.focus();
  }, [searching]);

  function closeSearch() {
    onQueryChange("");
    onSearchingChange(false);
  }

  async function remove(id: string) {
    try {
      await deleteJson(`/api/sessions/${encodeURIComponent(id)}`);
    } catch (err) {
      toast.error(`Could not delete the chat: ${errorMessage(err)}`);
      return;
    }
    notifySessionsChanged();
    if (pathname === `/chat/${id}`) router.push("/");
  }

  // A session only exists once its first message is sent; one left empty by a failed send
  // would otherwise sit in the list as an untitled "New chat".
  const rawSessions = useMemo(
    () => (index?.sessions ?? []).filter((session) => session.messageCount > 0),
    [index?.sessions],
  );

  const filteredSessions = useMemo(
    () => filterSessions(rawSessions, query),
    [rawSessions, query],
  );

  const dateGroups = useMemo(
    () => groupByDate(filteredSessions, new Date()),
    [filteredSessions],
  );

  const tickerGroups = useMemo(
    () => groupByTicker(filteredSessions),
    [filteredSessions],
  );

  return (
    <>
      {/* One row, two modes at the same height: searching takes it over rather than pushing it. */}
      {rawSessions.length > 0 && (
        <div className="flex h-8 shrink-0 items-center justify-between px-3">
          {searching ? (
            <div className="relative w-full">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={filterRef}
                type="text"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                // A query holds the row open while the user clicks through its results; an empty
                // field has nothing to show for the space it takes.
                onBlur={() => {
                  if (!query) closeSearch();
                }}
                placeholder="Filter chats or $ticker…"
                aria-label="Filter chats"
                className="h-8 w-full rounded-lg border border-input bg-transparent pr-7 pl-8 text-xs placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              <button
                type="button"
                aria-label="Close search"
                onClick={closeSearch}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xs font-medium text-muted-foreground">
                {viewMode === "date" ? "Recent" : "By ticker"}
              </h2>
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Search chats"
                        onClick={() => onSearchingChange(true)}
                        className="text-muted-foreground"
                      />
                    }
                  >
                    <SearchIcon />
                  </TooltipTrigger>
                  <TooltipContent side="top">Search chats</TooltipContent>
                </Tooltip>
                <ViewModeButton mode="date" current={viewMode} icon={ClockIcon} label="Recent" />
                <ViewModeButton mode="ticker" current={viewMode} icon={TagIcon} label="By ticker" />
              </div>
            </>
          )}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Sessions" className="flex flex-col gap-4 px-3 pb-4">
          {query && filteredSessions.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              <p>No chats matching &quot;{query}&quot;</p>
              <Button
                variant="link"
                size="xs"
                className="mt-1 h-auto p-0 text-xs"
                onClick={closeSearch}
              >
                Clear filter
              </Button>
            </div>
          ) : viewMode === "date" ? (
            dateGroups.map(({ group, sessions }) => (
              <SessionGroup key={group} heading={group} sessions={sessions} onNavigate={onNavigate} onRemove={remove} />
            ))
          ) : (
            <>
              {tickerGroups.tickers.map(({ ticker, sessions }) => (
                <SessionGroup
                  key={ticker}
                  heading={<span className="font-mono text-foreground/80">${ticker}</span>}
                  count={sessions.length}
                  sessions={sessions}
                  onNavigate={onNavigate}
                  onRemove={remove}
                />
              ))}

              {tickerGroups.general.length > 0 && (
                <SessionGroup
                  heading={
                    <span className="flex items-center gap-1.5">
                      <MessageSquareIcon className="size-3" />
                      General &amp; macro
                    </span>
                  }
                  count={tickerGroups.general.length}
                  sessions={tickerGroups.general}
                  onNavigate={onNavigate}
                  onRemove={remove}
                />
              )}
            </>
          )}

          {index && rawSessions.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No chats yet.</p>
          )}
        </nav>
      </ScrollArea>
    </>
  );
}
