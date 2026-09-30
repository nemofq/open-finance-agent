/**
 * Time-zone resolution and wall-clock conversions, built on `Intl` alone: the app never asks
 * the network what time it is, and pulling in a time-zone library to answer a
 * question the platform already answers would only add a second source of truth.
 */
import { formatCivilDate, parseCivilDate } from "./civil";

export interface WallClock {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** `HH:mm` in the zone, 24-hour. */
  time: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const TIME = /^(\d{2}):(\d{2})$/;

/** Formatters are expensive to build and every turn asks for the same two or three zones. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, made);
  return made;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const found = new Map<string, string>();
  for (const part of formatterFor(timeZone).formatToParts(instant)) found.set(part.type, part.value);
  const value = (type: string): number => Number(found.get(type));
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's IANA zone when it is one this runtime knows, else the server's, else UTC. */
export function resolveZone(timeZone?: string): string {
  const server = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const candidate of [timeZone, server]) {
    if (candidate && isKnownZone(candidate)) return candidate;
  }
  return "UTC";
}

export function wallClock(instant: Date, timeZone: string): WallClock {
  const { year, month, day, hour, minute } = zonedParts(instant, timeZone);
  return {
    date: formatCivilDate({ year, month, day }),
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** Minutes the zone is ahead of UTC at an instant; -240 for New York in daylight time. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // The formatted parts carry no milliseconds, so compare whole seconds on both sides.
  return Math.round((asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function minuteOfDay(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new RangeError(`Not an HH:mm time: ${JSON.stringify(time)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The instant at which a zone's clocks read `date` `time`. */
export function instantAt(date: string, time: string, timeZone: string): Date {
  const { year, month, day } = parseCivilDate(date);
  const minutes = minuteOfDay(time);
  const asIfUtc = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // The offset to subtract depends on the instant being solved for, so apply the offset at a
  // first guess and then at that result: a guess landing on the wrong side of a daylight-saving
  // change corrects itself on the second pass.
  const guess = asIfUtc - zoneOffsetMinutes(new Date(asIfUtc), timeZone) * 60_000;
  return new Date(asIfUtc - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000);
}

/** A zone's `date` `time` as an ISO 8601 instant carrying that zone's offset for the day. */
export function isoWithOffset(date: string, time: string, timeZone: string): string {
  const offset = zoneOffsetMinutes(instantAt(date, time, timeZone), timeZone);
  const magnitude = Math.abs(offset);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, "0");
  const minutes = String(magnitude % 60).padStart(2, "0");
  return `${date}T${time}:00${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}
