import { describe, expect, it } from "vitest";
import { formatTimeNote } from "./format";
import { fixedTimeContext, resolveTimeContext } from "./index";

/** Monday 2026-09-14, 19:30 in New York; already Tuesday morning in Shanghai. */
const evening = new Date("2026-09-14T23:30:00Z");

function words(note: string): number {
  return note.split(/\s+/).length;
}

describe("formatTimeNote in live mode", () => {
  it("gives the local time, New York's, and the market state", () => {
    const time = resolveTimeContext({ timeZone: "Asia/Shanghai", now: evening });
    expect(formatTimeNote(time)).toBe(
      "Current time: 2026-09-15 07:30 Asia/Shanghai (2026-09-14 19:30 New York). US market: after-hours; last completed session 2026-09-14; next open 2026-09-15 09:30 ET.",
    );
    expect(words(formatTimeNote(time))).toBeLessThanOrEqual(40);
  });

  it("drops the New York parenthetical for a reader already on New York time", () => {
    const note = formatTimeNote(resolveTimeContext({ timeZone: "America/New_York", now: evening }));
    expect(note).toBe(
      "Current time: 2026-09-14 19:30 America/New_York. US market: after-hours; last completed session 2026-09-14; next open 2026-09-15 09:30 ET.",
    );
  });

  it("names the reason the market is closed", () => {
    const weekend = resolveTimeContext({
      timeZone: "America/New_York",
      now: new Date("2026-09-12T12:00:00-04:00"),
    });
    expect(formatTimeNote(weekend)).toContain("US market: closed (weekend);");

    const holiday = resolveTimeContext({
      timeZone: "America/New_York",
      now: new Date("2026-07-03T12:00:00-04:00"),
    });
    expect(formatTimeNote(holiday)).toContain("US market: closed (Independence Day);");
  });

  it("warns about a short day before the close and explains it after", () => {
    const before = resolveTimeContext({
      timeZone: "America/New_York",
      now: new Date("2024-11-29T12:00:00-05:00"),
    });
    expect(formatTimeNote(before)).toContain("US market: open, closes early at 13:00 ET;");

    const after = resolveTimeContext({
      timeZone: "America/New_York",
      now: new Date("2024-11-29T14:00:00-05:00"),
    });
    expect(formatTimeNote(after)).toContain("US market: after-hours (closed early, the day after Thanksgiving);");
    expect(words(formatTimeNote(after))).toBeLessThanOrEqual(40);
  });
});

describe("formatTimeNote in fixed mode", () => {
  it("stands after the close of the as-of date", () => {
    expect(formatTimeNote(fixedTimeContext({ asOf: "2024-08-29" }))).toBe(
      "As-of date 2024-08-29 (after the close). Last completed session 2024-08-29.",
    );
  });

  it("falls back to the previous session when the as-of date is not a trading day", () => {
    expect(formatTimeNote(fixedTimeContext({ asOf: "2024-06-08" }))).toBe(
      "As-of date 2024-06-08 (market closed). Last completed session 2024-06-07.",
    );
  });

  it("mentions no date later than the as-of date", () => {
    for (const asOf of ["2024-08-29", "2024-06-08", "2024-07-05", "2024-11-29"]) {
      const time = fixedTimeContext({ asOf });
      const shown = formatTimeNote(time);
      for (const date of shown.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
        expect(date <= asOf).toBe(true);
      }
    }
  });
});
