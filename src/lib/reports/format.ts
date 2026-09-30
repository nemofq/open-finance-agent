/**
 * How a figure is written in a report: money with its currency and scale (`USD 4.32B`,
 * `USD 1.87 per share`), percentages (`11.2%`), counts with thousands separators. A negative
 * figure takes a leading minus, never parentheses, so it reads the same in a table and in prose.
 */
import type { Figure } from "@/lib/evidence/types";
import { parseUnit } from "@/lib/evidence/units";

/** Fixed locale so the same spec renders identically on every machine and in tests. */
const LOCALE = "en-US";

function grouped(value: number, maxFractionDigits: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: maxFractionDigits });
}

/** Formats currency amounts, omitting decimal places for whole numbers. */
function money(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const ABBREVIATIONS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];

/** Formats numbers with scale abbreviations (M, B, T) or comma separators. */
function abbreviate(value: number, currency: boolean): string {
  for (const [threshold, suffix] of ABBREVIATIONS) {
    if (Math.abs(value) >= threshold) return `${grouped(value / threshold, 2)}${suffix}`;
  }
  return currency ? money(value) : grouped(value, 2);
}

/**
 * A bare magnitude, scaled the way a figure with a unit is: `331.84B`, `1,500`. Used where a
 * number reaches the reader outside a cell, such as inside a calculator formula.
 */
export function formatMagnitude(value: number): string {
  return abbreviate(value, false);
}

/**
 * The value in its unit's base terms: `4.32` quoted as `USD B` is 4,320,000,000. Percentages,
 * basis points and multiples are already in their own terms, so they pass through.
 */
export function cellMagnitude(value: number, unit?: string): number {
  return value * parseUnit(unit).scale;
}

/** The unit a figure carries into evidence matching: a currency code, `%`, `bps`, or nothing. */
export function cellUnit(unit?: string): string | undefined {
  const parts = parseUnit(unit);
  if (parts.kind === "percent") return "%";
  if (parts.kind === "bps") return "bps";
  if (parts.kind === "multiple") return "x";
  if (parts.currency !== undefined) return parts.perShare ? `${parts.currency}/share` : parts.currency;
  return parts.suffix;
}

/**
 * A cell as the report prints it. String values are shown verbatim, so `not available` or a
 * guided range stays exactly as the model wrote it.
 */
export function formatCell(value: number | string, unit?: string): string {
  if (typeof value === "string") return value.trim();

  const parts = parseUnit(unit);
  switch (parts.kind) {
    case "percent":
      return `${grouped(value, 2)}%`;
    case "bps":
      return `${grouped(value, 0)} bps`;
    case "multiple":
      return `${grouped(value, 2)}x`;
    case "currency": {
      const amount = value * parts.scale;
      if (parts.perShare) return `${parts.currency} ${money(amount)} per share`;
      const tail = parts.suffix === undefined ? "" : ` ${parts.suffix}`;
      return `${parts.currency} ${abbreviate(amount, true)}${tail}`;
    }
    case "plain": {
      const amount = value * parts.scale;
      const shown = parts.suffix === undefined ? grouped(amount, 2) : abbreviate(amount, false);
      const perShare = parts.perShare ? " per share" : "";
      const tail = parts.suffix === undefined ? "" : ` ${parts.suffix}`;
      return `${shown}${tail}${perShare}`;
    }
  }
}

/**
 * A cell as the evidence matcher sees it: the printed text for the precision shown, and the
 * value in base terms so `USD 4.32B` can be compared with an entry holding 4,318,000,000.
 */
export function cellFigure(value: number, unit?: string): Figure {
  return {
    raw: formatCell(value, unit),
    value: cellMagnitude(value, unit),
    unit: cellUnit(unit),
    index: 0,
  };
}
