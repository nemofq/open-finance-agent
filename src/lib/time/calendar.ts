/**
 * The NYSE/Nasdaq calendar, computed from rules rather than fetched. Full closures
 * and 13:00 ET early closes live in the same table, keyed by observed date; `earlyClose` tells
 * the two apart, because an early close is still a trading day.
 */
import {
  addDays,
  dayOfWeek,
  isWeekend,
  lastWeekdayOfMonth,
  MONDAY,
  nthWeekdayOfMonth,
  parseCivilDate,
  SATURDAY,
  SUNDAY,
  THURSDAY,
} from "./civil";
import type { MarketHoliday } from "./types";

/**
 * Unscheduled closures, newest first. Add a row when the exchange closes for a day the rules
 * below cannot predict; set `earlyClose` for a one-off half day.
 */
const UNSCHEDULED: readonly MarketHoliday[] = [
  { date: "2025-01-09", name: "National Day of Mourning for President Carter" },
  { date: "2018-12-05", name: "National Day of Mourning for President Bush" },
  { date: "2012-10-30", name: "Hurricane Sandy" },
  { date: "2012-10-29", name: "Hurricane Sandy" },
  { date: "2007-01-02", name: "National Day of Mourning for President Ford" },
  { date: "2004-06-11", name: "National Day of Mourning for President Reagan" },
  { date: "2001-09-14", name: "September 11 attacks" },
  { date: "2001-09-13", name: "September 11 attacks" },
  { date: "2001-09-12", name: "September 11 attacks" },
  { date: "2001-09-11", name: "September 11 attacks" },
];

/** The first year NYSE observed Martin Luther King Jr. Day. */
const MLK_FROM = 1998;
/** The first year NYSE observed Juneteenth. */
const JUNETEENTH_FROM = 2022;

/** No run of consecutive closed days in the calendar comes anywhere near this long. */
const MAX_CLOSED_RUN = 30;

/** The unscheduled rows for a year, split by whether they closed the day or shortened it. */
function unscheduledIn(year: number, earlyClose: boolean): MarketHoliday[] {
  return UNSCHEDULED.filter(
    (day) => parseCivilDate(day.date).year === year && (day.earlyClose === true) === earlyClose,
  ).map((day) => ({ ...day }));
}

/** Easter Sunday by the anonymous Gregorian algorithm; Good Friday is two days earlier. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const day = h + l - 7 * m + 114;
  return addDays(`${year}-${String(Math.floor(day / 31)).padStart(2, "0")}-01`, (day % 31));
}

/**
 * NYSE moves a Saturday holiday to the preceding Friday and a Sunday holiday to the following
 * Monday. New Year's Day is the exception and is handled by its caller.
 */
function observed(date: string): string {
  const weekday = dayOfWeek(date);
  if (weekday === SATURDAY) return addDays(date, -1);
  if (weekday === SUNDAY) return addDays(date, 1);
  return date;
}

function fullClosures(year: number): MarketHoliday[] {
  const days: MarketHoliday[] = [];
  const add = (date: string, name: string): void => {
    days.push({ date, name });
  };

  const newYear = `${year}-01-01`;
  // A Saturday New Year's Day is not moved to the Friday before, because that Friday belongs to
  // the previous trading year; every other Saturday holiday is observed on the Friday.
  if (dayOfWeek(newYear) !== SATURDAY) add(observed(newYear), "New Year's Day");
  if (year >= MLK_FROM) add(nthWeekdayOfMonth(year, 1, MONDAY, 3), "Martin Luther King Jr. Day");
  add(nthWeekdayOfMonth(year, 2, MONDAY, 3), "Presidents' Day");
  add(addDays(easterSunday(year), -2), "Good Friday");
  add(lastWeekdayOfMonth(year, 5, MONDAY), "Memorial Day");
  if (year >= JUNETEENTH_FROM) add(observed(`${year}-06-19`), "Juneteenth");
  add(observed(`${year}-07-04`), "Independence Day");
  add(nthWeekdayOfMonth(year, 9, MONDAY, 1), "Labor Day");
  add(nthWeekdayOfMonth(year, 11, THURSDAY, 4), "Thanksgiving Day");
  add(observed(`${year}-12-25`), "Christmas Day");

  days.push(...unscheduledIn(year, false));
  return days;
}

/** Half days: the market opens as usual and closes at 13:00 ET. */
function earlyCloses(year: number, closed: ReadonlySet<string>): MarketHoliday[] {
  const days: MarketHoliday[] = [];
  const add = (date: string, name: string): void => {
    if (!isWeekend(date) && !closed.has(date)) days.push({ date, name, earlyClose: true });
  };

  // Only when Independence Day itself is the trading holiday: an observed Friday or Monday
  // holiday leaves the third a weekend day or the holiday itself.
  const july4 = `${year}-07-04`;
  if (!isWeekend(july4)) add(`${year}-07-03`, "the day before Independence Day");
  add(addDays(nthWeekdayOfMonth(year, 11, THURSDAY, 4), 1), "the day after Thanksgiving");
  add(`${year}-12-24`, "Christmas Eve");

  days.push(...unscheduledIn(year, true));
  return days;
}

const byYear = new Map<number, Map<string, MarketHoliday>>();

function calendarFor(year: number): Map<string, MarketHoliday> {
  const cached = byYear.get(year);
  if (cached) return cached;
  const closures = fullClosures(year);
  const closed = new Set(closures.map((day) => day.date));
  const all = [...closures, ...earlyCloses(year, closed)].sort((a, b) => a.date.localeCompare(b.date));
  const calendar = new Map(all.map((day) => [day.date, day]));
  byYear.set(year, calendar);
  return calendar;
}

/** The calendar entry for a date, when it is a closure or an early close. */
export function calendarEntry(date: string): MarketHoliday | undefined {
  const entry = calendarFor(parseCivilDate(date).year).get(date);
  return entry ? { ...entry } : undefined;
}

/** True on a weekday the market trades, including days it closes early at 13:00 ET. */
export function isTradingDay(date: string): boolean {
  if (isWeekend(date)) return false;
  const entry = calendarFor(parseCivilDate(date).year).get(date);
  return entry === undefined || entry.earlyClose === true;
}

function scanForTradingDay(date: string, step: number): string {
  for (let offset = step; Math.abs(offset) <= MAX_CLOSED_RUN; offset += step) {
    const candidate = addDays(date, offset);
    if (isTradingDay(candidate)) return candidate;
  }
  throw new Error(`No trading day within ${MAX_CLOSED_RUN} days of ${date}; the calendar is wrong.`);
}

export function previousTradingDay(date: string): string {
  return scanForTradingDay(date, -1);
}

export function nextTradingDay(date: string): string {
  return scanForTradingDay(date, 1);
}
