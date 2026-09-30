import { describe, expect, it } from "vitest";
import { advanceSchedule, latestOccurrence, nextOccurrence, normalizeSchedule, presetFromSchedule, type SchedulePreset, scheduleFromPreset } from "./schedule";

describe("scheduled recurrence", () => {
  it("keeps a daily task at the same local time across DST", () => {
    const schedule = normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-03-07T08:00", timeZone: "America/Los_Angeles", rrule: "FREQ=DAILY" }, new Date("2026-03-01T00:00:00Z"));
    expect(nextOccurrence(schedule, new Date("2026-03-07T16:00:00Z"))?.toISOString()).toBe("2026-03-08T15:00:00.000Z");
  });

  it("keeps the selected local time after the autumn clock change", () => {
    const schedule = normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-10-31T08:00", timeZone: "America/Los_Angeles", rrule: "FREQ=DAILY" }, new Date("2026-10-01T00:00:00Z"));
    expect(nextOccurrence(schedule, new Date("2026-11-01T17:00:00Z"))?.toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("advances a one-time task to no future occurrence", () => {
    const schedule = normalizeSchedule({ kind: "once", runAt: "2026-04-01T12:00:00Z", timeZone: "UTC" }, new Date("2026-03-01T00:00:00Z"));
    expect(advanceSchedule(schedule, new Date("2026-04-02T00:00:00Z"))).toBeNull();
  });

  it("supports preset rules and restart catch-up", () => {
    const schedule = scheduleFromPreset({ kind: "weekly", dtStartLocal: "2026-04-06T09:00", timeZone: "UTC", weekdays: [1, 3] });
    const normalized = normalizeSchedule(schedule, new Date("2026-04-01T00:00:00Z"));
    expect(latestOccurrence(normalized as Extract<typeof normalized, { kind: "recurring" }>, new Date("2026-04-08T10:00:00Z"))?.toISOString()).toBe("2026-04-08T09:00:00.000Z");
  });

  it("rejects invalid time zones and unsupported seconds", () => {
    expect(() => normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-04-01T09:00", timeZone: "No/Such_Zone", rrule: "FREQ=DAILY" })).toThrow("time zone");
    expect(() => normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-04-01T09:00", timeZone: "UTC", rrule: "FREQ=SECONDLY" })).toThrow("FREQ");
    expect(() => normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-04-01T09:00", timeZone: "UTC", rrule: "FREQ=MINUTELY;BYSECOND=30" })).toThrow("second");
  });

  it("refuses a TZID or DTSTART inside the rule, which rrule would read as the start", () => {
    const at = { kind: "recurring" as const, dtStartLocal: "2026-04-01T09:00", timeZone: "UTC" };
    expect(() => normalizeSchedule({ ...at, rrule: "FREQ=DAILY;TZID=America/New_York" })).toThrow("RRULE TZID is not supported");
    expect(() => normalizeSchedule({ ...at, rrule: "FREQ=DAILY;dtstart=20260101T090000Z" })).toThrow("RRULE DTSTART is not supported");
  });

  it("honors COUNT and UNTIL when advancing", () => {
    const counted = normalizeSchedule({ kind: "recurring", dtStartLocal: "2026-04-01T09:00", timeZone: "UTC", rrule: "FREQ=DAILY;COUNT=2" }, new Date("2026-03-01T00:00:00Z"));
    expect(advanceSchedule(counted, new Date("2026-04-01T10:00:00Z"))).toBe("2026-04-02T09:00:00.000Z");
    expect(advanceSchedule(counted, new Date("2026-04-02T10:00:00Z"))).toBeNull();
  });
});

describe("presetFromSchedule", () => {
  const at = { dtStartLocal: "2026-04-06T09:00", timeZone: "Europe/London" };
  const presets: SchedulePreset[] = [
    { kind: "minutes", interval: 15, ...at },
    { kind: "daily", interval: 1, ...at },
    { kind: "daily", interval: 3, ...at },
    { kind: "weekly", interval: 1, ...at },
    { kind: "weekly", interval: 2, weekdays: [1, 3, 5], ...at },
    { kind: "weekly", interval: 1, weekdays: [0, 6], ...at },
    { kind: "monthly", interval: 1, ...at },
    { kind: "monthly", interval: 6, dayOfMonth: 31, ...at },
  ];

  it("reads back every preset scheduleFromPreset builds", () => {
    for (const preset of presets) expect(presetFromSchedule(scheduleFromPreset(preset))).toEqual(preset);
  });

  it("rebuilds the same rule from what it reads", () => {
    for (const preset of presets) {
      const schedule = scheduleFromPreset(preset);
      const read = presetFromSchedule(schedule);
      expect(read && scheduleFromPreset(read)).toEqual(schedule);
    }
  });

  it("reads a hand-written rule in any case and order, defaulting the interval", () => {
    const schedule = { kind: "recurring" as const, ...at, rrule: "byday=we,mo;FREQ=weekly" };
    expect(presetFromSchedule(schedule)).toEqual({ kind: "weekly", interval: 1, weekdays: [1, 3], ...at });
  });

  it("leaves anything a preset cannot say to the raw RRULE", () => {
    for (const rrule of [
      "FREQ=DAILY;COUNT=5",
      "FREQ=DAILY;UNTIL=20261231T000000Z",
      "FREQ=HOURLY",
      "FREQ=YEARLY",
      "FREQ=WEEKLY;BYDAY=1MO",
      "FREQ=MONTHLY;BYMONTHDAY=1,15",
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "FREQ=DAILY;BYDAY=MO",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;FREQ=WEEKLY",
    ]) {
      expect(presetFromSchedule({ kind: "recurring", ...at, rrule }), rrule).toBeNull();
    }
    expect(presetFromSchedule({ kind: "once", runAt: "2026-04-06T09:00:00Z", timeZone: "UTC" })).toBeNull();
  });
});
