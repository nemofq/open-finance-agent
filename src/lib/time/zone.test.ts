import { describe, expect, it } from "vitest";
import { instantAt, isoWithOffset, minuteOfDay, resolveZone, wallClock, zoneOffsetMinutes } from "./zone";

const NEW_YORK = "America/New_York";

describe("resolveZone", () => {
  it("keeps a zone this runtime knows", () => {
    expect(resolveZone("Asia/Shanghai")).toBe("Asia/Shanghai");
  });

  it("falls back to the server's zone when the browser sends something unusable", () => {
    const server = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolveZone("Mars/Olympus_Mons")).toBe(server);
    expect(resolveZone(undefined)).toBe(server);
    expect(resolveZone("")).toBe(server);
  });
});

describe("wallClock", () => {
  it("reads the local date on the far side of UTC midnight", () => {
    // 23:30 UTC is already the next morning in Shanghai and still the previous evening in New York.
    const instant = new Date("2026-09-14T23:30:00Z");
    expect(wallClock(instant, "Asia/Shanghai")).toEqual({ date: "2026-09-15", time: "07:30" });
    expect(wallClock(instant, NEW_YORK)).toEqual({ date: "2026-09-14", time: "19:30" });
  });

  it("reads the local date before UTC has rolled over", () => {
    const instant = new Date("2026-09-15T00:30:00Z");
    expect(wallClock(instant, "America/Los_Angeles")).toEqual({ date: "2026-09-14", time: "17:30" });
  });

  it("uses a 24-hour clock through midnight", () => {
    expect(wallClock(new Date("2026-09-15T04:10:00Z"), NEW_YORK)).toEqual({ date: "2026-09-15", time: "00:10" });
  });
});

describe("zoneOffsetMinutes", () => {
  it("tracks daylight saving in New York", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), NEW_YORK)).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), NEW_YORK)).toBe(-240);
  });

  it("handles zones ahead of UTC and half-hour offsets", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Asia/Shanghai")).toBe(480);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });
});

describe("instantAt", () => {
  it("maps a wall-clock time back to the instant it names", () => {
    expect(instantAt("2026-07-15", "09:30", NEW_YORK).toISOString()).toBe("2026-07-15T13:30:00.000Z");
    expect(instantAt("2026-01-15", "09:30", NEW_YORK).toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });

  it("lands on the right side of both daylight-saving changes", () => {
    // Spring forward is 2026-03-08 and fall back is 2026-11-01, so the Fridays around them differ.
    expect(instantAt("2026-03-06", "09:30", NEW_YORK).toISOString()).toBe("2026-03-06T14:30:00.000Z");
    expect(instantAt("2026-03-09", "09:30", NEW_YORK).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    expect(instantAt("2026-10-30", "09:30", NEW_YORK).toISOString()).toBe("2026-10-30T13:30:00.000Z");
    expect(instantAt("2026-11-02", "09:30", NEW_YORK).toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });
});

describe("isoWithOffset", () => {
  it("writes the offset in force on the day", () => {
    expect(isoWithOffset("2026-03-06", "09:30", NEW_YORK)).toBe("2026-03-06T09:30:00-05:00");
    expect(isoWithOffset("2026-03-09", "09:30", NEW_YORK)).toBe("2026-03-09T09:30:00-04:00");
    expect(isoWithOffset("2026-11-02", "09:30", NEW_YORK)).toBe("2026-11-02T09:30:00-05:00");
  });

  it("round-trips through Date.parse", () => {
    const iso = isoWithOffset("2026-09-15", "09:30", NEW_YORK);
    expect(new Date(iso).toISOString()).toBe("2026-09-15T13:30:00.000Z");
  });
});

describe("minuteOfDay", () => {
  it("counts minutes from midnight", () => {
    expect(minuteOfDay("00:00")).toBe(0);
    expect(minuteOfDay("09:30")).toBe(570);
    expect(minuteOfDay("23:59")).toBe(1439);
    expect(() => minuteOfDay("9:30")).toThrow(/Not an HH:mm time/);
  });
});
