/** Shared interpretation of numeric units for evidence matching and report display. */
export type UnitKind = "currency" | "percent" | "bps" | "multiple" | "plain";

/** What a cell's `unit` says about the number beside it. */
export interface UnitParts {
  kind: UnitKind;
  /** ISO code when the unit names a currency, e.g. `USD`. */
  currency?: string;
  /** Multiplier the value is quoted in: 1, 1e3, 1e6, 1e9 or 1e12. */
  scale: number;
  /** The value is an amount per share. */
  perShare: boolean;
  /** Words printed after the number for an otherwise unknown unit, e.g. `shares`. */
  suffix?: string;
}

export const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  billions: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
  trillions: 1e12,
};

const PERCENT = new Set(["%", "percent", "percentage", "pct"]);
const BPS = new Set(["bps", "bp", "basis points", "basis point"]);
const MULTIPLE = new Set(["x", "ratio", "times", "multiple"]);
const PER_SHARE = /\s*(?:\/\s*share|per\s*share|\/\s*sh)\s*$/i;

export const CURRENCY_CODES = ["USD", "EUR", "GBP", "JPY", "CNY", "RMB", "CHF", "CAD", "AUD", "HKD", "INR"];
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Currency symbols the model may use instead of a code. */
const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

/** Split a cell's `unit` into the parts that decide how the number is printed and compared. */
export function parseUnit(unit?: string): UnitParts {
  const raw = (unit ?? "").trim();
  if (raw === "") return { kind: "plain", scale: 1, perShare: false };

  const perShare = PER_SHARE.test(raw);
  const base = perShare ? raw.replace(PER_SHARE, "").trim() : raw;
  const lower = base.toLowerCase();

  if (PERCENT.has(lower)) return { kind: "percent", scale: 1, perShare: false };
  if (BPS.has(lower)) return { kind: "bps", scale: 1, perShare: false };
  if (MULTIPLE.has(lower)) return { kind: "multiple", scale: 1, perShare: false };

  const tokens = base.split(/[\s,]+/).filter(Boolean);
  let currency: string | undefined;
  let scale = 1;
  const rest: string[] = [];
  for (const token of tokens) {
    const symbol = SYMBOLS[token];
    if (symbol !== undefined && currency === undefined) {
      currency = symbol;
      continue;
    }
    if (currency === undefined && (CURRENCY_CODE.test(token) || CURRENCY_CODES.includes(token.toUpperCase()))) {
      currency = token.toUpperCase();
      continue;
    }
    const factor = SCALES[token.toLowerCase()];
    if (factor !== undefined && scale === 1) {
      scale = factor;
      continue;
    }
    rest.push(token);
  }

  if (currency !== undefined) {
    return { kind: "currency", currency, scale, perShare, suffix: rest.join(" ") || undefined };
  }
  return { kind: "plain", scale, perShare, suffix: rest.join(" ") || undefined };
}
