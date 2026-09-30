/**
 * Time and market context for one turn. Resolved on every turn from the
 * browser's time zone in live mode; pinned to a past date only by benchmark runs and, later,
 * deliberate historical chats.
 */

export type MarketSession = "pre_market" | "open" | "after_hours" | "closed";

export type MarketClosedReason = "weekend" | "holiday" | "early_close";

export interface MarketClock {
  /** The US equity session state at the turn's instant. */
  session: MarketSession;
  /** Why the market is closed, when it is closed outside normal hours. */
  reason?: MarketClosedReason;
  /** Name of the holiday when `reason` is `holiday` or `early_close`. */
  holiday?: string;
  /** YYYY-MM-DD of the last regular session that has fully closed. */
  lastCompletedSession: string;
  /** ISO 8601 instant (with offset) of the next regular-session open. */
  nextOpen: string;
  /** Wall-clock time in New York, `HH:mm`, live mode only. */
  newYorkTime?: string;
  /** `YYYY-MM-DD` in New York at the turn's instant, live mode only. */
  newYorkDate?: string;
  /** True on a day whose regular session ends at 13:00 ET, before and after that close. */
  earlyClose?: boolean;
}

/** A day the US equity market closes, or closes early, in the NYSE/Nasdaq calendar. */
export interface MarketHoliday {
  /** YYYY-MM-DD in New York, the observed date rather than the nominal one. */
  date: string;
  name: string;
  /** True when the market opens and closes at 13:00 ET instead of closing for the day. */
  earlyClose?: boolean;
}

export interface TimeContext {
  /** Exact instant for publication-time checks; date-only historical turns omit it. */
  instant?: string;
  /** `fixed` pins a past date (benchmark, historical chats); `live` uses the local clock. */
  mode: "live" | "fixed";
  /** IANA name, e.g. `Asia/Shanghai`. */
  timeZone: string;
  /** YYYY-MM-DD in `timeZone`. */
  localDate: string;
  /** HH:mm in `timeZone`; live mode only. */
  localTime?: string;
  market: MarketClock;
  /** Fixed mode only: the point-in-time cutoff passed to data modules as `ModuleContext.asOf`. */
  asOf?: string;
}

export interface ResolveTimeOptions {
  /** Browser-reported IANA time zone; falls back to the server's zone, then UTC. */
  timeZone?: string;
  /** The instant to resolve; defaults to now. */
  now?: Date;
}

export interface FixedTimeOptions {
  /** YYYY-MM-DD. A date-only as-of means after that day's market close. */
  asOf: string;
  timeZone?: string;
}
