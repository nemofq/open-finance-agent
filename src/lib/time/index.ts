/**
 * Time and market context for a turn. Live mode reads the local clock in the
 * browser's time zone; fixed mode pins a past date for benchmark runs and historical chats and
 * never reports anything later than that date.
 */
import { isTradingDay, nextTradingDay, previousTradingDay } from "./calendar";
import { formatCivilDate, parseCivilDate } from "./civil";
import { marketClock, NEW_YORK } from "./session";
import type { FixedTimeOptions, ResolveTimeOptions, TimeContext } from "./types";
import { isoWithOffset, resolveZone, wallClock } from "./zone";

/** The turn's real date, time and market state, resolved fresh so a chat continued tomorrow knows. */
export function resolveTimeContext(options: ResolveTimeOptions = {}): TimeContext {
  const now = options.now ?? new Date();
  const timeZone = resolveZone(options.timeZone);
  const { date, time } = wallClock(now, timeZone);
  return { mode: "live", instant: now.toISOString(), timeZone, localDate: date, localTime: time, market: marketClock(now) };
}

/** A turn pinned to a past date. A date-only as-of stands after that day's close. */
export function fixedTimeContext(options: FixedTimeOptions): TimeContext {
  const asOf = formatCivilDate(parseCivilDate(options.asOf));
  return {
    mode: "fixed",
    timeZone: resolveZone(options.timeZone ?? NEW_YORK),
    localDate: asOf,
    market: {
      session: "closed",
      lastCompletedSession: isTradingDay(asOf) ? asOf : previousTradingDay(asOf),
      nextOpen: isoWithOffset(nextTradingDay(asOf), "09:30", NEW_YORK),
    },
    asOf,
  };
}
