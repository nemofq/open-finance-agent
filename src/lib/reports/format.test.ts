import { describe, expect, it } from "vitest";
import { parseUnit } from "@/lib/evidence/units";
import { cellFigure, cellMagnitude, cellUnit, formatCell } from "./format";

describe("parseUnit", () => {
  it("splits a currency from the scale it is quoted in", () => {
    expect(parseUnit("USD B")).toMatchObject({ kind: "currency", currency: "USD", scale: 1e9 });
    expect(parseUnit("USD millions")).toMatchObject({ currency: "USD", scale: 1e6 });
    expect(parseUnit("$")).toMatchObject({ currency: "USD", scale: 1 });
  });

  it("recognises per-share, percent, basis points and multiples", () => {
    expect(parseUnit("USD/share")).toMatchObject({ currency: "USD", perShare: true });
    expect(parseUnit("USD per share")).toMatchObject({ currency: "USD", perShare: true });
    expect(parseUnit("%")).toMatchObject({ kind: "percent" });
    expect(parseUnit("bps")).toMatchObject({ kind: "bps" });
    expect(parseUnit("x")).toMatchObject({ kind: "multiple" });
  });

  it("keeps an unknown unit as a suffix", () => {
    expect(parseUnit("shares")).toMatchObject({ kind: "plain", suffix: "shares" });
  });
});

describe("formatCell", () => {
  it("abbreviates money from millions up and keeps the currency", () => {
    expect(formatCell(4_318_000_000, "USD")).toBe("USD 4.32B");
    expect(formatCell(4.318, "USD B")).toBe("USD 4.32B");
    expect(formatCell(12_400_000, "USD")).toBe("USD 12.4M");
    expect(formatCell(12.6, "USD mn")).toBe("USD 12.6M");
    expect(formatCell(1.5, "usd bn")).toBe("USD 1.5B");
    expect(formatCell(1_230_000_000_000, "USD")).toBe("USD 1.23T");
  });

  it("writes smaller amounts in full, with cents only when there are any", () => {
    expect(formatCell(214.6, "USD")).toBe("USD 214.60");
    expect(formatCell(4318, "USD")).toBe("USD 4,318");
  });

  it("writes per-share amounts the way a release does", () => {
    expect(formatCell(1.87, "USD/share")).toBe("USD 1.87 per share");
  });

  it("writes percentages, basis points and multiples", () => {
    expect(formatCell(11.2, "%")).toBe("11.2%");
    expect(formatCell(330, "bps")).toBe("330 bps");
    expect(formatCell(18.4, "x")).toBe("18.4x");
  });

  it("puts a leading minus on a negative, never parentheses", () => {
    expect(formatCell(-3.4, "%")).toBe("-3.4%");
    expect(formatCell(-1_200_000, "USD")).toBe("USD -1.2M");
  });

  it("groups plain counts and appends an unknown unit", () => {
    expect(formatCell(1234)).toBe("1,234");
    expect(formatCell(4_320_000_000, "shares")).toBe("4.32B shares");
  });

  it("prints a string value exactly as the model wrote it", () => {
    expect(formatCell("not guided")).toBe("not guided");
  });
});

describe("cellFigure", () => {
  it("carries the printed precision and the value in base terms", () => {
    const figure = cellFigure(4.318, "USD B");
    expect(figure.raw).toBe("USD 4.32B");
    expect(figure.value).toBeCloseTo(4_318_000_000, 0);
    expect(figure.unit).toBe("USD");
  });

  it("keeps percentages in their own terms", () => {
    expect(cellMagnitude(11.2, "%")).toBe(11.2);
    expect(cellUnit("%")).toBe("%");
    expect(cellUnit("USD/share")).toBe("USD/share");
  });
});
