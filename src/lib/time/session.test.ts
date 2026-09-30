import { describe, expect, it } from "vitest";
import { lastCompletedSession, marketClock, nextMarketOpen } from "./session";

/** 2026-09-14 is a Monday in daylight time; the Friday before it is 2026-09-11. */
const monday = (time: string): Date => new Date(`2026-09-14T${time}:00-04:00`);

describe("marketClock sessions", () => {
  it("walks a normal trading day", () => {
    expect(marketClock(monday("03:00")).session).toBe("closed");
    expect(marketClock(monday("04:00")).session).toBe("pre_market");
    expect(marketClock(monday("09:29")).session).toBe("pre_market");
    expect(marketClock(monday("09:30")).session).toBe("open");
    expect(marketClock(monday("15:59")).session).toBe("open");
    expect(marketClock(monday("16:00")).session).toBe("after_hours");
    expect(marketClock(monday("19:59")).session).toBe("after_hours");
    expect(marketClock(monday("20:00")).session).toBe("closed");
  });

  it("reports New York's own date and time alongside the session", () => {
    // 23:30 UTC on the Monday is already Tuesday morning in Shanghai.
    expect(marketClock(new Date("2026-09-14T23:30:00Z"))).toMatchObject({
      session: "after_hours",
      newYorkDate: "2026-09-14",
      newYorkTime: "19:30",
      lastCompletedSession: "2026-09-14",
      nextOpen: "2026-09-15T09:30:00-04:00",
    });
  });

  it("gives a reason on a weekend", () => {
    expect(marketClock(new Date("2026-09-12T12:00:00-04:00"))).toMatchObject({
      session: "closed",
      reason: "weekend",
      lastCompletedSession: "2026-09-11",
      nextOpen: "2026-09-14T09:30:00-04:00",
    });
  });

  it("names the holiday on an observed closure", () => {
    // 2026-07-04 is a Saturday, so the market closes on Friday 2026-07-03.
    expect(marketClock(new Date("2026-07-03T12:00:00-04:00"))).toMatchObject({
      session: "closed",
      reason: "holiday",
      holiday: "Independence Day",
      lastCompletedSession: "2026-07-02",
      nextOpen: "2026-07-06T09:30:00-04:00",
    });
  });
});

describe("early closes", () => {
  const blackFriday = (time: string): Date => new Date(`2024-11-29T${time}:00-05:00`);

  it("flags the short day while the market is still open", () => {
    const clock = marketClock(blackFriday("12:00"));
    expect(clock).toMatchObject({ session: "open", earlyClose: true, lastCompletedSession: "2024-11-27" });
    expect(clock.reason).toBeUndefined();
  });

  it("ends the session at 13:00 and says why", () => {
    expect(marketClock(blackFriday("13:00"))).toMatchObject({
      session: "after_hours",
      reason: "early_close",
      holiday: "the day after Thanksgiving",
      earlyClose: true,
      lastCompletedSession: "2024-11-29",
      nextOpen: "2024-12-02T09:30:00-05:00",
    });
  });

  it("counts the short session as completed once 13:00 has passed", () => {
    expect(lastCompletedSession(blackFriday("12:59"))).toBe("2024-11-27");
    expect(lastCompletedSession(blackFriday("13:01"))).toBe("2024-11-29");
  });
});

describe("lastCompletedSession", () => {
  it("refers to the previous session when asked before today's close", () => {
    // "What did the market do today?" at 08:00 on a Monday can only mean Friday.
    expect(lastCompletedSession(monday("08:00"))).toBe("2026-09-11");
    expect(lastCompletedSession(monday("15:59"))).toBe("2026-09-11");
    expect(lastCompletedSession(monday("16:00"))).toBe("2026-09-14");
  });

  it("skips holidays as well as weekends", () => {
    expect(lastCompletedSession(new Date("2026-07-06T08:00:00-04:00"))).toBe("2026-07-02");
  });
});

describe("nextMarketOpen", () => {
  it("names today's open before 09:30 and the next day's after it", () => {
    expect(nextMarketOpen(monday("08:00"))).toBe("2026-09-14T09:30:00-04:00");
    expect(nextMarketOpen(monday("09:30"))).toBe("2026-09-15T09:30:00-04:00");
    expect(nextMarketOpen(monday("21:00"))).toBe("2026-09-15T09:30:00-04:00");
  });

  it("carries the offset across both daylight-saving changes", () => {
    // Clocks go forward on 2026-03-08 and back on 2026-11-01, both over a weekend.
    expect(nextMarketOpen(new Date("2026-03-06T17:00:00-05:00"))).toBe("2026-03-09T09:30:00-04:00");
    expect(nextMarketOpen(new Date("2026-10-30T17:00:00-04:00"))).toBe("2026-11-02T09:30:00-05:00");
  });

  it("skips a holiday weekend", () => {
    expect(nextMarketOpen(new Date("2026-09-04T17:00:00-04:00"))).toBe("2026-09-08T09:30:00-04:00");
  });
});
