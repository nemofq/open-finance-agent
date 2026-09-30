import { describe, expect, it } from "vitest";
import {
  calendarEntry,
  isTradingDay,
  nextTradingDay,
  previousTradingDay,
} from "./calendar";
import { addDays } from "./civil";
import type { MarketHoliday } from "./types";

/** Every closure and early close in a year, read one day at a time through `calendarEntry`. */
function entriesOf(year: number): MarketHoliday[] {
  const entries: MarketHoliday[] = [];
  for (let date = `${year}-01-01`; date.startsWith(`${year}-`); date = addDays(date, 1)) {
    const entry = calendarEntry(date);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Dates of a named closure in a year, so a rule can be asserted without the rest of the table. */
function dateOf(year: number, name: string): string | undefined {
  return entriesOf(year).find((day) => day.name === name && !day.earlyClose)?.date;
}

function halfDays(year: number): string[] {
  return entriesOf(year).filter((day) => day.earlyClose).map((day) => day.date);
}

describe("fixed-date holidays and their observance", () => {
  it("moves a Sunday holiday to the Monday", () => {
    expect(dateOf(2027, "Independence Day")).toBe("2027-07-05"); // 2027-07-04 is a Sunday
    expect(dateOf(2021, "Independence Day")).toBe("2021-07-05");
    expect(dateOf(2022, "Juneteenth")).toBe("2022-06-20"); // 2022-06-19 is a Sunday
    expect(dateOf(2022, "Christmas Day")).toBe("2022-12-26");
  });

  it("moves a Saturday holiday back to the Friday", () => {
    expect(dateOf(2026, "Independence Day")).toBe("2026-07-03"); // 2026-07-04 is a Saturday
    expect(dateOf(2027, "Juneteenth")).toBe("2027-06-18");
    expect(dateOf(2021, "Christmas Day")).toBe("2021-12-24");
  });

  it("does not observe New Year's Day when it falls on a Saturday", () => {
    // NYSE traded on Friday 2021-12-31 and on Friday 2010-12-31.
    expect(dateOf(2022, "New Year's Day")).toBeUndefined();
    expect(isTradingDay("2021-12-31")).toBe(true);
    expect(dateOf(2011, "New Year's Day")).toBeUndefined();
    expect(dateOf(2023, "New Year's Day")).toBe("2023-01-02"); // 2023-01-01 is a Sunday
    expect(dateOf(2026, "New Year's Day")).toBe("2026-01-01");
  });

  it("starts Juneteenth in 2022 and Martin Luther King Jr. Day in 1998", () => {
    expect(dateOf(2021, "Juneteenth")).toBeUndefined();
    expect(dateOf(2022, "Juneteenth")).toBe("2022-06-20");
    expect(dateOf(1997, "Martin Luther King Jr. Day")).toBeUndefined();
    expect(dateOf(1998, "Martin Luther King Jr. Day")).toBe("1998-01-19");
  });
});

describe("floating holidays", () => {
  it("places the Monday holidays", () => {
    expect(dateOf(2025, "Martin Luther King Jr. Day")).toBe("2025-01-20");
    expect(dateOf(2026, "Martin Luther King Jr. Day")).toBe("2026-01-19");
    expect(dateOf(2025, "Presidents' Day")).toBe("2025-02-17");
    expect(dateOf(2026, "Presidents' Day")).toBe("2026-02-16");
    expect(dateOf(2025, "Memorial Day")).toBe("2025-05-26");
    expect(dateOf(2026, "Memorial Day")).toBe("2026-05-25");
    expect(dateOf(2025, "Labor Day")).toBe("2025-09-01");
    expect(dateOf(2026, "Labor Day")).toBe("2026-09-07");
  });

  it("places Thanksgiving on the fourth Thursday", () => {
    expect(dateOf(2024, "Thanksgiving Day")).toBe("2024-11-28");
    expect(dateOf(2025, "Thanksgiving Day")).toBe("2025-11-27");
    expect(dateOf(2026, "Thanksgiving Day")).toBe("2026-11-26");
  });

  it("computes Good Friday from Easter", () => {
    expect(dateOf(2024, "Good Friday")).toBe("2024-03-29");
    expect(dateOf(2025, "Good Friday")).toBe("2025-04-18");
    expect(dateOf(2026, "Good Friday")).toBe("2026-04-03");
    expect(dateOf(2027, "Good Friday")).toBe("2027-03-26");
  });
});

describe("early closes", () => {
  it("closes at 13:00 the day after Thanksgiving, on Christmas Eve and before Independence Day", () => {
    expect(halfDays(2024)).toEqual(["2024-07-03", "2024-11-29", "2024-12-24"]);
    expect(halfDays(2025)).toEqual(["2025-07-03", "2025-11-28", "2025-12-24"]);
  });

  it("skips the day before Independence Day unless the fourth itself is a weekday", () => {
    expect(halfDays(2022)).toEqual(["2022-11-25"]); // 2022-07-03 is a Sunday, 2022-12-24 a Saturday
    expect(halfDays(2026)).toEqual(["2026-11-27", "2026-12-24"]); // 2026-07-04 is a Saturday
  });

  it("does not make Christmas Eve a half day when it is the observed holiday", () => {
    expect(dateOf(2021, "Christmas Day")).toBe("2021-12-24");
    expect(halfDays(2021)).toEqual(["2021-11-26"]);
  });

  it("leaves an early close a trading day", () => {
    expect(isTradingDay("2024-11-29")).toBe(true);
    expect(calendarEntry("2024-11-29")).toEqual({
      date: "2024-11-29",
      name: "the day after Thanksgiving",
      earlyClose: true,
    });
  });
});

describe("unscheduled closures", () => {
  it("includes the days the exchange closed outside its rules", () => {
    expect(calendarEntry("2025-01-09")?.name).toBe("National Day of Mourning for President Carter");
    expect(isTradingDay("2025-01-09")).toBe(false);
    expect(isTradingDay("2018-12-05")).toBe(false);
    expect(isTradingDay("2012-10-29")).toBe(false);
    expect(isTradingDay("2012-10-30")).toBe(false);
    expect(isTradingDay("2012-10-31")).toBe(true);
  });
});

describe("isTradingDay", () => {
  it("excludes weekends and closures", () => {
    expect(isTradingDay("2026-09-11")).toBe(true);
    expect(isTradingDay("2026-09-12")).toBe(false);
    expect(isTradingDay("2026-09-13")).toBe(false);
    expect(isTradingDay("2026-09-07")).toBe(false); // Labor Day
  });

  it("rejects a malformed date rather than guessing", () => {
    expect(() => isTradingDay("09/11/2026")).toThrow(/Not a YYYY-MM-DD date/);
  });
});

describe("neighbouring trading days", () => {
  it("steps over weekends, holidays and their observed dates", () => {
    expect(previousTradingDay("2026-09-14")).toBe("2026-09-11");
    expect(nextTradingDay("2026-09-11")).toBe("2026-09-14");
    expect(previousTradingDay("2024-07-05")).toBe("2024-07-03");
    expect(nextTradingDay("2024-11-28")).toBe("2024-11-29");
  });

  it("crosses a year boundary", () => {
    expect(nextTradingDay("2025-12-31")).toBe("2026-01-02");
    expect(previousTradingDay("2026-01-02")).toBe("2025-12-31");
  });

  it("steps over the four days of the September 2001 closure", () => {
    expect(nextTradingDay("2001-09-10")).toBe("2001-09-17");
  });
});
