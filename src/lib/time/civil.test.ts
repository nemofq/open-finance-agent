import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, isWeekend, lastWeekdayOfMonth, nthWeekdayOfMonth, parseCivilDate } from "./civil";

describe("parseCivilDate", () => {
  it("accepts a real date", () => {
    expect(parseCivilDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it("rejects a day that does not exist", () => {
    expect(() => parseCivilDate("2023-02-29")).toThrow(/Not a real calendar date/);
    expect(() => parseCivilDate("2024-13-01")).toThrow(/Not a real calendar date/);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(() => parseCivilDate("2024-8-29")).toThrow(/Not a YYYY-MM-DD date/);
    expect(() => parseCivilDate("2024-08-29T12:00:00Z")).toThrow(/Not a YYYY-MM-DD date/);
    expect(() => parseCivilDate("")).toThrow(/Not a YYYY-MM-DD date/);
  });
});

describe("addDays", () => {
  it("crosses months, years and leap days", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });

  it("is unaffected by daylight saving in the host zone", () => {
    // The US spring-forward Sunday still has exactly one day before and after it.
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("weekdays", () => {
  it("numbers Sunday as zero", () => {
    expect(dayOfWeek("2026-09-13")).toBe(0);
    expect(dayOfWeek("2026-09-11")).toBe(5);
    expect(isWeekend("2026-09-12")).toBe(true);
    expect(isWeekend("2026-09-14")).toBe(false);
  });

  it("finds the nth and last weekday of a month", () => {
    expect(nthWeekdayOfMonth(2024, 1, 1, 3)).toBe("2024-01-15");
    expect(nthWeekdayOfMonth(2024, 11, 4, 4)).toBe("2024-11-28");
    expect(lastWeekdayOfMonth(2024, 5, 1)).toBe("2024-05-27");
    expect(lastWeekdayOfMonth(2024, 12, 2)).toBe("2024-12-31");
  });
});
