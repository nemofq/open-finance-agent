import * as rruleModule from "rrule";
import type { RRule as RRuleType } from "rrule";
import { instantAt, isKnownZone, wallClock } from "@/lib/time/zone";
import type { ScheduledSchedule } from "./types";

function resolveRRule(): typeof RRuleType {
  if (typeof rruleModule.RRule === "function") return rruleModule.RRule;
  const commonJs = Reflect.get(rruleModule, "default") as Partial<typeof import("rrule")> | undefined;
  if (typeof commonJs?.RRule === "function") return commonJs.RRule;
  throw new Error("rrule did not expose RRule through either its ESM or CommonJS entry point");
}

const RRule = resolveRRule();

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ALLOWED_FREQUENCIES = new Set(["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
/**
 * The RFC 5545 rule parts a task may use. rrule reads a `DTSTART` or `TZID` inside the rule as the
 * rule's start, which would replace the start `ruleFor` sets, so anything else is refused.
 */
const ALLOWED_KEYS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "WKST"]);

function validZone(value: string): string {
  if (!isKnownZone(value)) throw new RangeError(`Unknown IANA time zone: ${value}`);
  return value;
}

function localParts(value: string): { date: string; time: string } {
  const match = LOCAL.exec(value);
  if (!match) throw new RangeError(`Expected local date-time YYYY-MM-DDTHH:mm: ${value}`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${match[4]}:${match[5]}`;
  // instantAt performs strict civil-date and clock validation.
  instantAt(date, time, "UTC");
  return { date, time };
}

function floatingDate(local: string): Date {
  const { date, time } = localParts(local);
  return new Date(`${date}T${time}:00.000Z`);
}

function basicDate(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}${(date.getUTCMonth() + 1).toString().padStart(2, "0")}${date.getUTCDate().toString().padStart(2, "0")}T${date.getUTCHours().toString().padStart(2, "0")}${date.getUTCMinutes().toString().padStart(2, "0")}00Z`;
}

function normalizedRrule(value: string): string {
  const text = value.trim().replace(/^RRULE:/i, "");
  if (!text || text.includes("\n") || text.includes("\r")) throw new RangeError("RRULE must contain one rule only");
  const fields = new Map(text.split(";").map((part) => part.split("=", 2) as [string, string]).map(([key, field]) => [key.toUpperCase(), field]));
  if (fields.has("BYSECOND")) throw new RangeError("RRULE second-level schedules are not supported");
  for (const key of fields.keys()) if (!ALLOWED_KEYS.has(key)) throw new RangeError(`RRULE ${key} is not supported`);
  const freq = fields.get("FREQ")?.toUpperCase();
  if (!freq || !ALLOWED_FREQUENCIES.has(freq)) throw new RangeError("RRULE FREQ must be MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY");
  const interval = Number(fields.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1) throw new RangeError("RRULE INTERVAL must be a positive integer");
  // RRule validates BYxxx, COUNT and UNTIL syntax. Keeping keys uppercase makes storage stable.
  const canonical = [...fields.entries()].map(([key, field]) => `${key}=${field}`).join(";");
  const rule = RRule.fromString(`RRULE:${canonical}`);
  if (!rule.options.freq && rule.options.freq !== 0) throw new RangeError("Invalid RRULE");
  return canonical;
}

function ruleFor(schedule: Extract<ScheduledSchedule, { kind: "recurring" }>): RRuleType {
  const local = floatingDate(schedule.dtStartLocal);
  return RRule.fromString(`DTSTART:${basicDate(local)}\nRRULE:${schedule.rrule}`);
}

function floatingFromInstant(instant: Date, timeZone: string): Date {
  const clock = wallClock(instant, timeZone);
  return floatingDate(`${clock.date}T${clock.time}`);
}

function candidateToInstant(candidate: Date, timeZone: string): Date {
  const date = `${candidate.getUTCFullYear().toString().padStart(4, "0")}-${(candidate.getUTCMonth() + 1).toString().padStart(2, "0")}-${candidate.getUTCDate().toString().padStart(2, "0")}`;
  const time = `${candidate.getUTCHours().toString().padStart(2, "0")}:${candidate.getUTCMinutes().toString().padStart(2, "0")}`;
  return instantAt(date, time, timeZone);
}

export function normalizeSchedule(schedule: ScheduledSchedule, now = new Date()): ScheduledSchedule {
  if (schedule.kind === "once") {
    const timeZone = validZone(schedule.timeZone);
    const runAt = new Date(schedule.runAt);
    if (Number.isNaN(runAt.getTime())) throw new RangeError("runAt must be an ISO timestamp");
    if (runAt.getTime() <= now.getTime()) throw new RangeError("One-time tasks must be scheduled in the future");
    return { kind: "once", runAt: runAt.toISOString(), timeZone };
  }
  const timeZone = validZone(schedule.timeZone);
  localParts(schedule.dtStartLocal);
  const rrule = normalizedRrule(schedule.rrule);
  return { kind: "recurring", dtStartLocal: schedule.dtStartLocal, timeZone, rrule };
}

/** Return the next real instant strictly after `now`, preserving the local wall-clock time. */
export function nextOccurrence(schedule: ScheduledSchedule, now = new Date()): Date | null {
  if (schedule.kind === "once") {
    const value = new Date(schedule.runAt);
    return value.getTime() > now.getTime() ? value : null;
  }
  const rule = ruleFor(schedule);
  const candidate = rule.after(floatingFromInstant(now, schedule.timeZone), false);
  if (!candidate) return null;
  const instant = candidateToInstant(candidate, schedule.timeZone);
  return instant.getTime() > now.getTime() ? instant : nextOccurrence(schedule, new Date(instant.getTime() + 1));
}

/** Return the latest occurrence at or before `now`; used for one restart catch-up. */
export function latestOccurrence(schedule: Extract<ScheduledSchedule, { kind: "recurring" }>, now = new Date()): Date | null {
  const candidate = ruleFor(schedule).before(floatingFromInstant(now, schedule.timeZone), true);
  if (!candidate) return null;
  const instant = candidateToInstant(candidate, schedule.timeZone);
  return instant.getTime() <= now.getTime() ? instant : null;
}

export function initialNextRun(schedule: ScheduledSchedule, now = new Date()): string | null {
  return nextOccurrence(schedule, new Date(now.getTime() - 1))?.toISOString() ?? null;
}

export function advanceSchedule(schedule: ScheduledSchedule, now = new Date()): string | null {
  return nextOccurrence(schedule, now)?.toISOString() ?? null;
}

export function humanSchedule(schedule: ScheduledSchedule): string {
  if (schedule.kind === "once") return `Once · ${new Date(schedule.runAt).toLocaleString([], { timeZone: schedule.timeZone })} (${schedule.timeZone})`;
  return `${schedule.rrule.replace(/;/g, " · ")} · ${schedule.timeZone}`;
}

/** RFC 5545 weekday codes, Sunday first so an index is what `Date.getDay()` returns. */
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

const PRESET_FREQUENCIES = { minutes: "MINUTELY", daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" } as const;

export type PresetKind = keyof typeof PRESET_FREQUENCIES;

/** The recurring schedules the task editor builds from a few fields instead of a raw RRULE. */
export interface SchedulePreset {
  kind: PresetKind;
  /** Every how many minutes, days, weeks or months; 1 when omitted. */
  interval?: number;
  dtStartLocal: string;
  timeZone: string;
  /** Weekly only: the days it runs, as `Date.getDay()` numbers. */
  weekdays?: number[];
  /** Monthly only: the day of the month it runs. */
  dayOfMonth?: number;
}

export function scheduleFromPreset(input: SchedulePreset): ScheduledSchedule {
  const interval = input.interval ?? 1;
  const by = input.kind === "weekly" && input.weekdays?.length ? `;BYDAY=${input.weekdays.map((day) => WEEKDAY_CODES[day]).join(",")}` : input.kind === "monthly" && input.dayOfMonth ? `;BYMONTHDAY=${input.dayOfMonth}` : "";
  return { kind: "recurring", dtStartLocal: input.dtStartLocal, timeZone: input.timeZone, rrule: `FREQ=${PRESET_FREQUENCIES[input.kind]};INTERVAL=${interval}${by}` };
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * The preset a recurring schedule was built from, so the editor can show its fields again, or
 * `null` when its rule says anything a preset cannot (COUNT, UNTIL, BYHOUR, an ordinal weekday such
 * as `1MO`, several month days) and the editor must keep the raw RRULE rather than drop part of it.
 * The inverse of `scheduleFromPreset`.
 */
export function presetFromSchedule(schedule: ScheduledSchedule): SchedulePreset | null {
  if (schedule.kind !== "recurring") return null;
  const fields = new Map<string, string>();
  for (const part of schedule.rrule.trim().replace(/^RRULE:/i, "").split(";")) {
    const [key, value, ...rest] = part.split("=");
    if (!key || value === undefined || rest.length > 0 || fields.has(key.toUpperCase())) return null;
    fields.set(key.toUpperCase(), value.toUpperCase());
  }
  const freq = fields.get("FREQ");
  const kind = (Object.keys(PRESET_FREQUENCIES) as PresetKind[]).find((candidate) => PRESET_FREQUENCIES[candidate] === freq);
  if (!kind) return null;

  const allowed = new Set(["FREQ", "INTERVAL", ...(kind === "weekly" ? ["BYDAY"] : kind === "monthly" ? ["BYMONTHDAY"] : [])]);
  if ([...fields.keys()].some((key) => !allowed.has(key))) return null;

  const intervalText = fields.get("INTERVAL") ?? "1";
  if (!POSITIVE_INTEGER.test(intervalText)) return null;
  const preset: SchedulePreset = { kind, interval: Number(intervalText), dtStartLocal: schedule.dtStartLocal, timeZone: schedule.timeZone };

  const byDay = fields.get("BYDAY");
  if (byDay !== undefined) {
    const days = byDay.split(",").map((code) => WEEKDAY_CODES.indexOf(code as (typeof WEEKDAY_CODES)[number]));
    if (days.some((day) => day < 0)) return null;
    preset.weekdays = [...new Set(days)].sort((a, b) => a - b);
  }
  const byMonthDay = fields.get("BYMONTHDAY");
  if (byMonthDay !== undefined) {
    const day = Number(byMonthDay);
    if (!POSITIVE_INTEGER.test(byMonthDay) || day > 31) return null;
    preset.dayOfMonth = day;
  }
  return preset;
}
