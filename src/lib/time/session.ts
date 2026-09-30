/**
 * The US equity session clock: where the current instant sits in the trading day, which session
 * has fully closed, and when the next one opens.
 */
import { isWeekend } from "./civil";
import { calendarEntry, isTradingDay, nextTradingDay, previousTradingDay } from "./calendar";
import type { MarketClock, MarketSession } from "./types";
import { isoWithOffset, minuteOfDay, wallClock } from "./zone";

/** Every session boundary is a wall-clock time in this zone, daylight saving included. */
export const NEW_YORK = "America/New_York";

const PRE_MARKET_OPEN = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const EARLY_CLOSE = 13 * 60;
const AFTER_HOURS_END = 20 * 60;

/** The wall-clock minute at which a trading day's regular session ends. */
function closeMinute(date: string): number {
  return calendarEntry(date)?.earlyClose ? EARLY_CLOSE : REGULAR_CLOSE;
}

function sessionAt(minute: number, close: number): MarketSession {
  if (minute < PRE_MARKET_OPEN || minute >= AFTER_HOURS_END) return "closed";
  if (minute < REGULAR_OPEN) return "pre_market";
  return minute < close ? "open" : "after_hours";
}

/** The most recent trading day whose regular session has closed, `YYYY-MM-DD` in New York. */
export function lastCompletedSession(instant: Date): string {
  const { date, time } = wallClock(instant, NEW_YORK);
  if (isTradingDay(date) && minuteOfDay(time) >= closeMinute(date)) return date;
  return previousTradingDay(date);
}

/** The next regular open, 09:30 New York, as ISO 8601 with that day's Eastern offset. */
export function nextMarketOpen(instant: Date): string {
  const { date, time } = wallClock(instant, NEW_YORK);
  const open = isTradingDay(date) && minuteOfDay(time) < REGULAR_OPEN ? date : nextTradingDay(date);
  return isoWithOffset(open, "09:30", NEW_YORK);
}

export function marketClock(instant: Date): MarketClock {
  const { date, time } = wallClock(instant, NEW_YORK);
  const common = {
    lastCompletedSession: lastCompletedSession(instant),
    nextOpen: nextMarketOpen(instant),
    newYorkDate: date,
    newYorkTime: time,
  };

  if (isWeekend(date)) return { session: "closed", reason: "weekend", ...common };

  const entry = calendarEntry(date);
  if (entry && !entry.earlyClose) {
    return { session: "closed", reason: "holiday", holiday: entry.name, ...common };
  }

  const minute = minuteOfDay(time);
  const session = sessionAt(minute, entry?.earlyClose ? EARLY_CLOSE : REGULAR_CLOSE);
  if (!entry?.earlyClose) return { session, ...common };
  // Before 13:00 the early close is a warning about the day; after it, the reason trading stopped.
  return minute < EARLY_CLOSE
    ? { session, earlyClose: true, ...common }
    : { session, reason: "early_close", holiday: entry.name, earlyClose: true, ...common };
}
