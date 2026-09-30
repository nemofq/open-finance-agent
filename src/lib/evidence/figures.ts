/**
 * Finding numbers in text and deciding whether the ledger already holds them.
 *
 * Three tracks call these exact names: the enforcement engine (P8, unsourced figures),
 * report validation (cell values) and the compaction checkpoint validator.
 *
 * Two ideas run through the file:
 * - **Compare at the precision shown.** `11.2%` is a claim about one decimal, so it matches
 *   anything that rounds to it. `4.32B` matches 4,318,000,000.
 * - **Exempt what is not a figure.** Years, dates, fiscal labels, tickers, ordinals, ids and
 *   small counts are returned with an `exempt` reason instead of being matched.
 */
import { CITABLE_CLASS, KIND_CLASS } from "./ids";
import type { EvidenceEntry, EvidenceLedger, Figure, FigureMatch } from "./types";
import { CURRENCY_CODES, parseUnit, SCALES } from "./units";

type ExemptReason = NonNullable<Figure["exempt"]>;

/** `¥` is read as JPY; a CNY amount has to say `CNY` or `RMB`. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "us$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
};

const CODE_ALIASES: Record<string, string> = { RMB: "CNY" };

/** Nouns that turn a small integer into a count of things rather than a figure. */
const COUNT_NOUNS =
  "quarters?|qtrs?|periods?|years?|months?|weeks?|days?|business days?|trading days?|sessions?|" +
  "analysts?|compan(?:y|ies)|filings?|sources?|segments?|entr(?:y|ies)|rows?|columns?|items?|" +
  "holdings?|positions?|decades?|bullet points?";

const COUNT_AFTER = new RegExp(`^[\\s-]{0,2}(?:${COUNT_NOUNS})\\b`, "i");

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const WORD_COUNT_RE = new RegExp(
  `\\b(${Object.keys(WORD_NUMBERS).join("|")})[\\s-](?:${COUNT_NOUNS})\\b`,
  "gi",
);

const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const CLOCK_24 = String.raw`(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?`;
const SCALE_WORDS = Object.keys(SCALES).sort((a, b) => b.length - a.length).join("|");
const FIGURE_SUFFIX = String.raw`(?:%|percentage points?|percent|pct|pp|bps|bp|basis points|times|x|×|${SCALE_WORDS})(?![A-Za-z])`;
// A subsequent SEC item is a decimal code, not an amount, yield or valuation multiple.
const DECIMAL_ITEM = String.raw`\d{1,2}\.\d{2}\b(?!\.\d)(?![ \t]*(?:${FIGURE_SUFFIX}|(?:${CURRENCY_CODES.join("|")})\b|per (?:diluted |basic )?share|/\s?(?:share|sh\b)))`;

/**
 * Spans that are never figures. Accession numbers and zero-padded CIKs are ids; a bare run of
 * ten digits is deliberately NOT an id, because a market cap written without separators looks
 * exactly like one and a wrong exemption hides an unsourced number.
 */
const EXEMPT_PATTERNS: { kind: ExemptReason; re: RegExp }[] = [
  { kind: "ticker", re: /\$[A-Za-z][A-Za-z0-9]{0,5}(?:\.[A-Za-z]{1,2})?\b/g },
  { kind: "id", re: /\b\d{7,10}-\d{2}-\d{6}\b/g },
  { kind: "id", re: /\bCIK[\s#:]*\d{4,10}\b/gi },
  { kind: "id", re: /\b(?:SIC[\s#:]*\d{4}|NAICS[\s#:]*\d{6})\b/gi },
  { kind: "id", re: /\b0\d{6,}\b/g },
  { kind: "id", re: /\+?\d{1,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  // Our own citations: `[E7]`, `C3`. Case-sensitive, so scientific notation (`1E7`) is untouched.
  { kind: "id", re: new RegExp(String.raw`\b${KIND_CLASS}\d{1,4}\b`, "g") },
  // SEC form names, whose digits are part of the name: `10-Q`, `8-K`, `13F`, `424B5`.
  {
    kind: "id",
    re: /\b(?:10-[KQD]|8-K|6-K|11-K|20-F|40-F|S-[1348]|F-[134]|13[DFG]|424B\d|DEF\s?14A|SC\s?13[DG])(?:\/A)?(?:['’]?s)?\b/gi,
  },
  { kind: "id", re: new RegExp(String.raw`\bItems?\s+\d{1,2}(?:\.\d{2})?[A-Z]?\b(?:[ \t]*(?:[,/&][ \t]*(?:(?:and|or)[ \t]+)?|(?:and|or)[ \t]+)${DECIMAL_ITEM})*`, "gi") },
  { kind: "id", re: /\b(?:Exhibits?\s+|EX[-\s])\d{1,3}(?:\.\d{1,2})?\b/gi },
  { kind: "date", re: /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g },
  { kind: "date", re: /\b\d{8}T\d{6}\b/g },
  { kind: "date", re: /\b\d{4}\/\d{1,2}\/\d{1,2}\b/g },
  { kind: "date", re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Require clock context. Without a zone or meridiem, "at" alone needs a zero-padded hour.
  { kind: "date", re: new RegExp(String.raw`\b${CLOCK_24}\s+(?:UTC|GMT|[ECMP][SD]?T)\b`, "gi") },
  { kind: "date", re: /\b(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s*[ap]\.?m\.?(?!\w)/gi },
  { kind: "date", re: new RegExp(String.raw`\b(?:before|after|opens?|closes?)\s+${CLOCK_24}\b(?!\.\d|[:\d%])`, "gi") },
  { kind: "date", re: /\b(?:at|by|from|until)\s+0\d:[0-5]\d(?::[0-5]\d)?\b(?!\.\d|[:\d%])/gi },
  { kind: "date", re: new RegExp(String.raw`\b(?:${MONTHS})\.?\s+(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b(?!\.\d)`, "gi") },
  { kind: "date", re: new RegExp(String.raw`(?<![.\d])\b(?:[12]\d|3[01]|0?[1-9])\s+(?:${MONTHS})\.?(?:\s+\d{4})?\b(?!\.\d)`, "gi") },
  { kind: "date", re: new RegExp(String.raw`\b(?:${MONTHS})\.?(?:[ \t-]+\d{4}|[ \t]*(?:-[ \t]*['’]?|['’])\d{2})\b(?!\.\d)`, "gi") },
  // `mid-2025`, `2024–2026`: a hyphen or dash between a word and a year, or between two years.
  { kind: "year", re: /\b(?:early|mid|late)[-\s]\d{4}\b/gi },
  { kind: "year", re: /\b(?:19|20)\d{2}\s?[-−–—]\s?(?:\d{4}|\d{2})\b/g },
  { kind: "fiscal", re: /\b(?:FY|CY)\s?['’]?\d{2,4}(?:\s?[-−–—]\s?(?:FY|CY)?\d{2,4})?(?:\s?Q[1-4])?\b/gi },
  { kind: "fiscal", re: /\bF?Q[1-4](?:[-\s]?(?:FY|CY)?\s?['’]?\d{2,4})?\b/gi },
  { kind: "fiscal", re: /\b(?:19|20)\d{2}[-\s]?Q[1-4]\b/gi },
  { kind: "fiscal", re: /\b[1-4]Q\s?['’]?\d{2,4}\b/gi },
  { kind: "fiscal", re: /\bH[12](?:\s?['’]?\d{2,4})?\b/g },
  { kind: "fiscal", re: /\b[12]H\s?['’]?\d{2,4}\b/g },
  { kind: "id", re: /\b(?:form|version|model|series)\s+[A-Za-z]*[- ]?\d+[A-Za-z0-9.-]*\b/gi },
  { kind: "id", re: /\b(?:1099|1098|1040|5498|W-?2)(?:-[A-Z]+)\b/gi },
  { kind: "id", re: /(?:§{1,2}\s*|\bIRC\s+(?:sections?\s+)?)(?:\d+)(?:\([a-z0-9]+\))*/gi },
  { kind: "id", re: /\b\d{3}\([a-z]\)(?!\w)/gi },
  { kind: "id", re: /\b(?:529|457)(?=[ -]+(?:plans?|accounts?|savings)\b)|\b(?:plans?|accounts?)\s+(?:529|457)\b/gi },
  { kind: "id", re: /\b\d{3,5}[-A-Z]*[ \t]+(?:tax )?forms?\b/gi },
  { kind: "id", re: new RegExp(String.raw`\b(?:[a-z][A-Z][A-Za-z]*\s+|(?!(?:${CURRENCY_CODES.join("|")})-)[A-Z]{2,}-)\d+\b`, "g") },
  { kind: "count", re: /\b\d+-(?:day|week|month|year)\b/gi },
  // Letter-number product codes and document labels identify things; scales and yields remain figures.
  { kind: "id", re: /(?<![$\w])(?:[A-Za-z]{1,2}\d+[A-Za-z]?|\d+[ACDEFGHIJLNOPQRSUVWYZ])\b/g },
  { kind: "ordinal", re: /^(?:#{1,6}\s*)?(?:claim|section|step|part|point)\s+\d+(?=[:.)]\s)/gim },
  { kind: "ordinal", re: /\b(?:claims?|sections?|steps?|parts?|points?|premises?|buckets?|tiers?|years?|quarters?|months?|periods?|lines?|rows?|columns?)[\s-]+\d+(?:\s*-\s*\d+)?\b(?!\.\d)/gi },
  { kind: "ordinal", re: /^\s*(?:>\s*)?(?:#{1,6}[ \t]+)?(?:\*\*|__)?\d+[.)](?:\*\*|__)?\s/gm },
  { kind: "ordinal", re: /\b\d{1,3}(?:st|nd|rd|th)\b/gi },
];

/** `-$5M` and `$-5M` both mean minus five million: the sign may sit on either side of the symbol. */
const TOKEN_RE = new RegExp(
  String.raw`(?:(?<lead>[-−–+])(?=US\$|\$|€|£|¥|₹))?(?<cur>US\$|\$|€|£|¥|₹)?\s?(?<sign>[-−–+])?\s?` +
    String.raw`(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)` +
    String.raw`(?<suffix>\s?${FIGURE_SUFFIX})?`,
  "gdiu",
);

const PER_SHARE_RE = /^\s?(?:per (?:diluted |basic )?share|a share|\/\s?share|\/sh\b)/i;
const TRAILING_CODE_RE = new RegExp(`^\\s?(${CURRENCY_CODES.join("|")})\\b`, "i");
const LEADING_CODE_RE = new RegExp(`(${CURRENCY_CODES.join("|")})\\s?$`, "i");

interface Span {
  start: number;
  end: number;
  kind: ExemptReason;
}

function exemptSpans(text: string): Span[] {
  const spans: Span[] = inlineListSpans(text);
  for (const { kind, re } of EXEMPT_PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (match.index === undefined) continue;
      spans.push({ start: match.index, end: match.index + match[0].length, kind });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Inline lists need a sequence and clause separators; isolated accounting negatives stay figures. */
function inlineListSpans(text: string): Span[] {
  const spans: Span[] = [];
  const decoration = String.raw`(?:(?:\*\*|__)|["“‘'])*`;
  const markers = new RegExp(String.raw`(?:^|[.:;!?,-])["”’']?\s*(?:(?:and|or)\s+)?\((\d{1,2})\)\s+${decoration}(?!(?:${SCALE_WORDS}|${CURRENCY_CODES.join("|")})\b)(?=\p{L})`, "giu");
  for (const line of text.matchAll(/[^\n]+/g)) {
    const items = [...line[0].matchAll(markers)];
    if (items.length < 2 || items.some((item, index) => Number(item[1]) !== index + 1)) continue;
    for (const item of items) spans.push({ start: line.index + item.index, end: line.index + item.index + item[0].length, kind: "ordinal" });
  }
  return spans;
}

function spanAt(spans: Span[], start: number, end: number): ExemptReason | undefined {
  for (const span of spans) {
    if (span.start >= end) break;
    if (span.end > start) return span.kind;
  }
  return undefined;
}

/** Digits that carry information: leading zeros do not, so `0.67` has two. */
function significantDigits(digits: string): number {
  const bare = digits.replace(/[,.]/g, "").replace(/^0+/, "");
  return bare.length;
}

function decimalsOf(digits: string): number {
  const dot = digits.indexOf(".");
  return dot === -1 ? 0 : digits.length - dot - 1;
}

function normalizeCode(code: string): string {
  const upper = code.toUpperCase();
  return CODE_ALIASES[upper] ?? upper;
}

function scaleOf(suffix: string | undefined): number {
  if (!suffix) return 1;
  const key = suffix.trim().toLowerCase();
  return SCALES[key] ?? 1;
}

function unitOfSuffix(suffix: string | undefined): string | undefined {
  if (!suffix) return undefined;
  const key = suffix.trim().toLowerCase();
  if (key === "%" || key === "percent" || key === "pct") return "%";
  if (key === "pp" || key === "percentage point" || key === "percentage points") return "pp";
  if (key === "bps" || key === "bp" || key === "basis points") return "bps";
  if (key === "x" || key === "×" || key === "times") return "x";
  return undefined;
}

/**
 * A sign glued to the token before it is punctuation, not arithmetic: `Sep-2024` is a month,
 * `12–18%` a band, `2024–2026` a window. Only a sign with a break before it negates.
 */
function signsNumber(text: string, signStart: number): boolean {
  return signStart === 0 || !/[A-Za-z0-9]/.test(text[signStart - 1]);
}

/** Accounting notation needs a numeric cell, units or a financial label; prose ages stay positive. */
function inParentheses(text: string, start: number, end: number, formatted = false): boolean {
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(end, end + 3);
  if (!/\($/.test(before.replace(/\s$/, "")) || !/^\s?\)/.test(after)) return false;
  const opening = text.lastIndexOf("(", start);
  const prefix = text.slice(Math.max(0, opening - 70), opening);
  const suffix = text.slice(text.indexOf(")", end) + 1).replace(/^[\s*_'"“”]+/, "");
  return formatted || /(?:^|[\n|\t])\s*$/.test(prefix) ||
    /\b(?:loss|income|expense|costs?|profit|margin|balances?|cash flow|revenue|ebitda?)(?:\s+(?:was|were|is|are|of|at|totaled|totals))*\s*[:=]?\s*$/i.test(prefix) ||
    new RegExp(`^(?:${SCALE_WORDS}|${CURRENCY_CODES.join("|")}|loss|revenue)\\b`, "i").test(suffix);
}

/** A reported rate can carry its sign in prose: "fell 8%" is -8%, while "fell to 8%" is a level. */
function decliningRate(text: string, start: number, unit: string | undefined): boolean {
  return (unit === "%" || unit === "pp" || unit === "bps") &&
    /\b(?:down|fell|fall(?:s|en|ing)?|declin(?:e[sd]?|ing)|decreas(?:e[sd]?|ing)|contract(?:s|ed|ing)?|drop(?:s|ped|ping)?|reduc(?:e[sd]?|ing))(?:\s+by)?\s*$/i.test(text.slice(Math.max(0, start - 40), start));
}

interface Parsed {
  value: number;
  unit?: string;
  raw: string;
  index: number;
  /** Multiplier already folded into `value`, used to scale the precision tolerance. */
  scale: number;
  digits: string;
}

function parseToken(text: string, match: RegExpExecArray | RegExpMatchArray): Parsed | undefined {
  const groups = match.groups;
  const indices = (match as RegExpExecArray & { indices?: { groups?: Record<string, [number, number]> } }).indices;
  if (!groups || !indices?.groups) return undefined;
  const digits = groups.num;
  const [numStart, numEnd] = indices.groups.num;

  const suffix = groups.suffix;
  const scale = scaleOf(suffix);
  let unit = unitOfSuffix(suffix);

  // The lookahead lets a leading sign exist only in front of a currency symbol.
  const lead = groups.lead ? indices.groups.lead : undefined;
  let start = lead ? lead[0] : indices.groups.cur ? indices.groups.cur[0] : numStart;
  let end = indices.groups.suffix ? indices.groups.suffix[1] : numEnd;

  if (!unit && groups.cur) unit = CURRENCY_SYMBOLS[groups.cur.toLowerCase()];
  if (!unit) {
    const trailing = TRAILING_CODE_RE.exec(text.slice(end, end + 6));
    if (trailing) {
      unit = normalizeCode(trailing[1]);
      end += trailing[0].length;
    }
  }
  if (!unit) {
    const leading = LEADING_CODE_RE.exec(text.slice(Math.max(0, start - 5), start));
    if (leading) {
      unit = normalizeCode(leading[1]);
      start -= leading[0].length;
    }
  }

  const perShare = PER_SHARE_RE.exec(text.slice(end, end + 24));
  if (perShare) {
    unit = unit && unit !== "%" ? `${unit}/share` : "/share";
    end += perShare[0].length;
  }

  const signAt = indices.groups.sign?.[0] ?? lead?.[0];
  const signText = indices.groups.sign ? groups.sign : lead ? groups.lead : undefined;
  const sign = signAt !== undefined && signsNumber(text, signAt) ? signText : undefined;
  const negative = sign === "-" || sign === "−" || sign === "–" || (sign === undefined && decliningRate(text, start, unit));
  const magnitude = Number.parseFloat(digits.replace(/,/g, "")) * scale;
  if (!Number.isFinite(magnitude)) return undefined;
  const accounting = inParentheses(text, start, end, !!unit || scale !== 1);
  const signed = negative || accounting ? -magnitude : magnitude;

  // Diagnostics and correction tracking must retain the sign the reader actually saw.
  if (signAt !== undefined && sign) start = Math.min(start, signAt);
  if (accounting) {
    start = text.lastIndexOf("(", start);
    end = text.indexOf(")", end) + 1;
  }

  return { value: signed, unit, raw: text.slice(start, end), index: start, scale, digits };
}

/** Small counts written as words: "eight quarters" is not a figure. */
function wordCounts(text: string): Figure[] {
  const figures: Figure[] = [];
  for (const match of text.matchAll(WORD_COUNT_RE)) {
    if (match.index === undefined) continue;
    figures.push({
      raw: match[0],
      value: WORD_NUMBERS[match[1].toLowerCase()],
      index: match.index,
      exempt: "count",
    });
  }
  return figures;
}

/**
 * Every number in `text`, in order, each either usable or marked with the reason it is exempt.
 * Callers that enforce sourcing drop the exempt ones; `matchFigures` does it for them.
 */
export function extractFigures(text: string): Figure[] {
  if (!text) return [];
  const spans = exemptSpans(text.replace(/[\u2010-\u2015\u2212]/g, "-"));
  const figures: Figure[] = [];

  for (const match of text.matchAll(TOKEN_RE)) {
    const parsed = parseToken(text, match);
    if (!parsed) continue;
    const indices = (match as RegExpMatchArray & { indices?: { groups?: Record<string, [number, number]> } }).indices;
    const [numStart, numEnd] = indices?.groups?.num ?? [parsed.index, parsed.index + parsed.raw.length];

    const figure: Figure = { raw: parsed.raw, value: parsed.value, index: parsed.index };
    if (parsed.unit) figure.unit = parsed.unit;

    const overlapping = spanAt(spans, numStart, numEnd);
    if (overlapping && !(["date", "ordinal", "id"].includes(overlapping) && (parsed.unit || parsed.scale !== 1))) {
      figure.exempt = overlapping;
    } else if (
      !parsed.unit &&
      parsed.scale === 1 &&
      /^\d{4}$/.test(parsed.digits) &&
      parsed.value >= 1900 &&
      parsed.value <= 2100
    ) {
      figure.exempt = "year";
    } else if (
      !parsed.unit &&
      parsed.scale === 1 &&
      Number.isInteger(parsed.value) &&
      parsed.value >= 0 &&
      parsed.value <= 12 &&
      COUNT_AFTER.test(text.slice(numEnd, numEnd + 32))
    ) {
      figure.exempt = "count";
    }
    figures.push(figure);
  }

  return [...figures, ...wordCounts(text)].sort((a, b) => a.index - b.index);
}

/**
 * The figures in `text` worth sourcing, without the exempt ones and without repeats: the same
 * value with the same unit is one fact however often the text states it.
 */
export function sourcedFigures(text: string): Figure[] {
  const seen = new Set<string>();
  return extractFigures(text).filter((figure) => {
    const key = `${figure.value}|${figure.unit ?? ""}`;
    if (figure.exempt || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------------------------------------------------------------- matching */

interface Precision {
  /** Half a unit in the last place shown, in the figure's own units. */
  tolerance: number;
  significant: number;
}

const RAW_NUM_RE = new RegExp(
  String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s?(${SCALE_WORDS})?`,
  "iu",
);

/** Re-read `raw` so `Figure` stays the small shape the other tracks serialise. */
function precisionOf(figure: Figure): Precision {
  const match = RAW_NUM_RE.exec(figure.raw);
  if (!match) return { tolerance: Math.abs(figure.value) * 5e-3, significant: 3 };
  const digits = match[1];
  const scale = scaleOf(match[2]);
  return {
    tolerance: 0.5 * 10 ** -decimalsOf(digits) * scale,
    significant: significantDigits(digits),
  };
}

function isPercentLike(unit: string | undefined): boolean {
  return unit === "%" || unit === "pp" || unit === "percent" || unit === "ratio" || unit === "bps";
}

function currencyOf(unit: string | undefined): string | undefined {
  const currency = parseUnit(unit).currency;
  return currency ? normalizeCode(currency) : undefined;
}

function compatibleUnits(left: string | undefined, right: string | undefined): boolean {
  const kind = (unit: string | undefined) => {
    const parsed = parseUnit(unit).kind;
    return isPercentLike(unit) || parsed === "percent" || parsed === "bps" ? "rate" : parsed;
  };
  const a = kind(left);
  const b = kind(right);
  if (a === "plain" || b === "plain" || a === b) return true;
  // Legacy ratio results can describe either a rate or a valuation multiple.
  return (left === "ratio" && b === "multiple") || (right === "ratio" && a === "multiple");
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= Math.abs(tolerance) + Math.abs(b) * 1e-9;
}

/**
 * Does `figure` state `value`, at the precision the figure shows?
 *
 * Beyond the exact comparison two tolerances apply, both calibrated later on the benchmark:
 * - **percent and ratio are the same claim**: `11.2%` matches 0.11237, and 330 bps matches 0.033.
 * - **scale mismatches of 1e3, 1e6 and 1e9 match** when the digits agree, because a table column
 *   in millions (`30,040`) and a raw figure (30,040,000,000) are the same number. Only figures
 *   with three or more significant digits qualify, so a bare `4` never matches 4,000.
 */
export function figureEquals(figure: Figure, value: number, unit?: string): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(figure.value)) return false;
  if (!compatibleUnits(figure.unit, unit)) return false;
  value *= parseUnit(unit).scale;

  const figureCurrency = currencyOf(figure.unit);
  const valueCurrency = currencyOf(unit);
  if (figureCurrency && valueCurrency && figureCurrency !== valueCurrency) return false;

  const { tolerance, significant } = precisionOf(figure);
  if (close(figure.value, value, tolerance)) return true;

  if (isPercentLike(figure.unit) || isPercentLike(unit)) {
    const factors = figure.unit === "bps" ? [1 / 100, 1 / 10_000] : [1 / 100, 100];
    for (const factor of factors) {
      if (close(figure.value * factor, value, tolerance * factor)) return true;
    }
  }

  if (significant >= 3) {
    for (const factor of [1e3, 1e6, 1e9, 1e-3, 1e-6, 1e-9]) {
      if (close(figure.value * factor, value, tolerance * factor)) return true;
    }
  }
  return false;
}

/** True when the entry holds `figure` somewhere: its own value, a number, a fact or a table cell. */
export function holdsValue(entry: EvidenceEntry, figure: Figure): boolean {
  if (entry.value !== undefined && figureEquals(figure, entry.value, entry.unit)) return true;
  for (const number of entry.numbers ?? []) {
    if (figureEquals(figure, number.value, number.unit ?? entry.unit)) return true;
  }
  for (const fact of entry.facts ?? []) {
    if (figureEquals(figure, fact.value, fact.unit)) return true;
  }
  for (const row of entry.table?.rows ?? []) {
    for (const cell of row) {
      if (typeof cell === "number" && figureEquals(figure, cell, entry.unit)) return true;
    }
  }
  return false;
}

const CITED_ID = new RegExp(String.raw`\b${CITABLE_CLASS}\d+\b`, "g");
const CITED_RANGE = new RegExp(String.raw`\b(${CITABLE_CLASS})(\d+)\s*[-–—]\s*\1(\d+)\b`, "g");
/** One or more bracketed citations in a row after a figure, each opening with an id: `[E7] [C2, C3]`. */
const CITATION = new RegExp(String.raw`\[(?:${CITABLE_CLASS}\d+)[^\]\n]*\](?:\s*\[(?:${CITABLE_CLASS}\d+)[^\]\n]*\])*`);

/** Citation ranges name existing entries; checking membership avoids expanding arbitrary ranges. */
function cites(citation: string, id: string): boolean {
  if (citation.match(CITED_ID)?.includes(id)) return true;
  const number = Number(id.slice(1));
  return [...citation.matchAll(CITED_RANGE)]
    .some((range) => range[1] === id[0] && Number(range[2]) <= number && number <= Number(range[3]));
}

/** Every figure in `text` that has to be sourced, with the entries that hold its value. */
export function matchFigures(text: string, ledger: EvidenceLedger): FigureMatch[] {
  return extractFigures(text)
    .filter((figure) => !figure.exempt)
    .map((figure) => {
      const lineEnd = text.indexOf("\n", figure.index);
      const tail = text.slice(figure.index + figure.raw.length, lineEnd < 0 ? text.length : lineEnd);
      const cited = tail.match(CITATION);
      const citation = cited?.index !== undefined ? { at: figure.index + figure.raw.length + cited.index, text: cited[0] } : undefined;
      const available = ledger.matchValue(figure).filter((id) => !ledger.get(id)?.lookAhead);
      const matches = citation ? available.filter((id) => cites(citation.text, id)) : available;
      return { figure, matches, ...(citation ? { citation } : {}), ...(!matches.length && available.length ? { candidates: available } : {}) };
    });
}

/** A wrong citation needs a citation repair; absence from the ledger needs new evidence. */
export function figureProblem({ figure, candidates }: FigureMatch): string {
  const interpretation = figure.value < 0 && figure.raw.startsWith("(") ? " (parentheses are read as a negative amount)" : "";
  return candidates?.length
    ? `the figure "${figure.raw}"${interpretation} does not match its cited evidence. Equal values appear in ${candidates.slice(0, 5).join(", ")}; verify the subject, metric and period before citing one.`
    : `the figure "${figure.raw}"${interpretation} is in no available evidence entry.`;
}
