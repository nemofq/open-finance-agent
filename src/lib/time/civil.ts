/**
 * Calendar arithmetic on civil dates (`YYYY-MM-DD`) with no time zone attached. Days are
 * counted as UTC instants so that adding a day never lands on a daylight-saving seam; the
 * market calendar is a list of civil dates in New York, not a list of instants.
 */

export interface CivilDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLIS_PER_DAY = 86_400_000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatCivilDate({ year, month, day }: CivilDate): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function utcMillis({ year, month, day }: CivilDate): number {
  return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(millis: number): CivilDate {
  const date = new Date(millis);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Parses and validates a civil date. Throws on anything that is not a real `YYYY-MM-DD` day. */
export function parseCivilDate(value: string): CivilDate {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${JSON.stringify(value)}`);
  const parsed = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  // Rejects 2024-02-31 and friends: an out-of-range day rolls over and no longer round-trips.
  if (formatCivilDate(fromUtcMillis(utcMillis(parsed))) !== value) {
    throw new RangeError(`Not a real calendar date: ${value}`);
  }
  return parsed;
}

/** 0 for Sunday through 6 for Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(utcMillis(parseCivilDate(date))).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const weekday = dayOfWeek(date);
  return weekday === 0 || weekday === 6;
}

export function addDays(date: string, days: number): string {
  return formatCivilDate(fromUtcMillis(utcMillis(parseCivilDate(date)) + days * MILLIS_PER_DAY));
}

/** The `nth` occurrence (1-based) of `weekday` in a month, e.g. the third Monday of January. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const first = formatCivilDate({ year, month, day: 1 });
  const shift = (weekday - dayOfWeek(first) + 7) % 7;
  return addDays(first, shift + (nth - 1) * 7);
}

/** The last occurrence of `weekday` in a month, e.g. the last Monday of May. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const nextMonthFirst = month === 12
    ? formatCivilDate({ year: year + 1, month: 1, day: 1 })
    : formatCivilDate({ year, month: month + 1, day: 1 });
  const last = addDays(nextMonthFirst, -1);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

export const SUNDAY = 0;
export const MONDAY = 1;
export const THURSDAY = 4;
export const SATURDAY = 6;
