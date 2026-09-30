import { describe, expect, it } from "vitest";
import { isTradingDay } from "./calendar";
import { fixedTimeContext, resolveTimeContext } from "./index";

describe("resolveTimeContext", () => {
  it("uses the reader's date on the far side of UTC midnight", () => {
    // 23:30 UTC on Monday: Shanghai is already into Tuesday, New York is still on Monday evening.
    const time = resolveTimeContext({ timeZone: "Asia/Shanghai", now: new Date("2026-09-14T23:30:00Z") });
    expect(time).toMatchObject({
      mode: "live",
      timeZone: "Asia/Shanghai",
      localDate: "2026-09-15",
      localTime: "07:30",
    });
    expect(time.market).toMatchObject({
      session: "after_hours",
      newYorkDate: "2026-09-14",
      lastCompletedSession: "2026-09-14",
    });
    expect(time.asOf).toBeUndefined();
  });

  it("keeps the reader's date when UTC has already rolled over", () => {
    const time = resolveTimeContext({
      timeZone: "America/Los_Angeles",
      now: new Date("2026-09-15T00:30:00Z"),
    });
    expect(time.localDate).toBe("2026-09-14");
    expect(time.localTime).toBe("17:30");
    expect(time.market.newYorkDate).toBe("2026-09-14");
  });

  it("falls back to a usable zone when the browser sends a broken one", () => {
    const time = resolveTimeContext({ timeZone: "Nowhere/Special", now: new Date("2026-09-14T23:30:00Z") });
    expect(time.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(time.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves afresh, so a chat continued the next day knows it", () => {
    const options = { timeZone: "Asia/Shanghai" } as const;
    const monday = resolveTimeContext({ ...options, now: new Date("2026-09-14T23:30:00Z") });
    const tuesday = resolveTimeContext({ ...options, now: new Date("2026-09-15T23:30:00Z") });
    expect(monday.localDate).toBe("2026-09-15");
    expect(tuesday.localDate).toBe("2026-09-16");
  });
});

describe("fixedTimeContext", () => {
  it("pins the as-of date and the session that had closed by then", () => {
    expect(fixedTimeContext({ asOf: "2024-08-29" })).toEqual({
      mode: "fixed",
      timeZone: "America/New_York",
      localDate: "2024-08-29",
      market: {
        session: "closed",
        lastCompletedSession: "2024-08-29",
        nextOpen: "2024-08-30T09:30:00-04:00",
      },
      asOf: "2024-08-29",
    });
  });

  it("reports no time of day, because a date-only as-of only stands after the close", () => {
    expect(fixedTimeContext({ asOf: "2024-08-29" }).localTime).toBeUndefined();
    expect(fixedTimeContext({ asOf: "2024-08-29" }).market.newYorkTime).toBeUndefined();
  });

  it("steps back to the last trading day when the as-of date is closed", () => {
    expect(fixedTimeContext({ asOf: "2024-06-08" }).market.lastCompletedSession).toBe("2024-06-07");
    expect(fixedTimeContext({ asOf: "2024-07-04" }).market.lastCompletedSession).toBe("2024-07-03");
  });

  it("never reports a date later than the as-of date", () => {
    for (const asOf of ["2024-06-08", "2024-07-05", "2024-08-29", "2024-11-25", "2025-01-09"]) {
      const time = fixedTimeContext({ asOf });
      expect(time.localDate).toBe(asOf);
      expect(time.asOf).toBe(asOf);
      expect(time.market.lastCompletedSession <= asOf).toBe(true);
      expect(isTradingDay(time.market.lastCompletedSession)).toBe(true);
    }
  });

  it("rejects an as-of that is not a plain calendar date", () => {
    expect(() => fixedTimeContext({ asOf: "2024-08-29T16:00:00Z" })).toThrow(/Not a YYYY-MM-DD date/);
    expect(() => fixedTimeContext({ asOf: "2024-02-30" })).toThrow(/Not a real calendar date/);
  });
});
