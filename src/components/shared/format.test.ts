import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatTokens, gainClass, parseNumber } from "./format";

describe("formatTokens", () => {
  it("prints counts below a thousand in full", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(940)).toBe("940");
  });

  it("keeps one decimal up to a hundred thousand, then drops it", () => {
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(32_768)).toBe("32.8k");
    expect(formatTokens(8_000)).toBe("8k");
    expect(formatTokens(128_000)).toBe("128k");
  });

  it("switches to millions for the largest windows", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_048_576)).toBe("1M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("never shows a negative or fractional count", () => {
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(12.6)).toBe("13");
  });
});

describe("formatCalendarDate", () => {
  it("reads the day as written, whatever the time after it", () => {
    expect(formatCalendarDate("2026-03-05")).toBe(formatCalendarDate("2026-03-05T23:30:00-05:00"));
    expect(formatCalendarDate("2026-03-05")).toContain("2026");
  });

  it("shows a value that is not a date as it was stored", () => {
    expect(formatCalendarDate("unknown")).toBe("unknown");
  });
});

describe("gainClass", () => {
  it("colours gains and losses, and leaves zero and missing values muted", () => {
    expect(gainClass(1.5)).toContain("emerald");
    expect(gainClass(-0.1)).toContain("red");
    expect(gainClass(0)).toBe("text-muted-foreground");
    expect(gainClass(null)).toBe("text-muted-foreground");
  });
});

describe("parseNumber", () => {
  it("reads plain and comma-grouped numbers, and nothing else", () => {
    expect(parseNumber(" 1,250.5 ")).toBe(1250.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("12 shares")).toBeUndefined();
  });
});
