import type { SessionHeader } from "./types";

const DATE_GROUPS = ["Today", "Yesterday", "Earlier"] as const;
export type DateGroup = (typeof DATE_GROUPS)[number];

/** Bucket a session by how many local calendar days ago it was last updated. */
export function dateGroupOf(updatedAt: string, now = new Date()): DateGroup {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const updated = new Date(updatedAt).getTime();
  if (updated >= startOfToday) return "Today";
  if (updated >= startOfToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

export interface DateGroupedSessions {
  group: DateGroup;
  sessions: SessionHeader[];
}

export function groupByDate(sessions: SessionHeader[], now = new Date()): DateGroupedSessions[] {
  return DATE_GROUPS.map((group) => ({
    group,
    sessions: sessions.filter((session) => dateGroupOf(session.updatedAt, now) === group),
  })).filter((entry) => entry.sessions.length > 0);
}

export interface TickerGroup {
  ticker: string;
  sessions: SessionHeader[];
  lastUpdatedAt: string;
}

export interface TickerGroupedSessions {
  tickers: TickerGroup[];
  general: SessionHeader[];
}

export function groupByTicker(sessions: SessionHeader[]): TickerGroupedSessions {
  const tickerMap = new Map<string, SessionHeader[]>();
  const general: SessionHeader[] = [];

  for (const session of sessions) {
    if (!session.tickers || session.tickers.length === 0) {
      general.push(session);
    } else {
      for (const ticker of session.tickers) {
        const list = tickerMap.get(ticker) ?? [];
        list.push(session);
        tickerMap.set(ticker, list);
      }
    }
  }

  // Sort sessions within each ticker group by updatedAt desc
  const tickers: TickerGroup[] = Array.from(tickerMap.entries()).map(([ticker, groupSessions]) => {
    const sorted = [...groupSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      ticker,
      sessions: sorted,
      lastUpdatedAt: sorted[0]?.updatedAt ?? "",
    };
  });

  // Sort ticker groups by their most recent active session
  tickers.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));

  // Sort general group by updatedAt desc
  general.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    tickers,
    general,
  };
}

export function filterSessions(sessions: SessionHeader[], query: string): SessionHeader[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return sessions;

  const cleanQuery = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;

  return sessions.filter((session) => {
    const titleMatch = session.title.toLowerCase().includes(trimmed);
    const tickerMatch = session.tickers.some((t) => {
      const lower = t.toLowerCase();
      return lower === cleanQuery || lower.includes(cleanQuery);
    });
    return titleMatch || tickerMatch;
  });
}
