/**
 * Display formatting used by more than one feature: dates and clock times, token counts, model
 * prices, the colour of a gain, and reading a number typed into a form. Money and quantities are
 * formatted by src/lib/portfolio/format.ts, which the server's own text uses too.
 */

/** Formats an ISO date or instant in the reader's zone; anything unparseable is shown as stored. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/**
 * A calendar date, such as a quote's or a holdings file's as-of day. Only the `YYYY-MM-DD` it starts
 * with is read, and in UTC, so the day never shifts with the reader's zone.
 */
export function formatCalendarDate(value: string): string {
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/** A clock reading, hours and minutes, in the reader's zone. */
export function formatClock(at: Date | number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** One decimal, without a trailing `.0`. */
function oneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * A token count, short enough for the context meter, a model's window or a file chip, where the
 * order of magnitude matters more than the exact figure: 940, 12.4k, 128k, 1M.
 */
export function formatTokens(count: number): string {
  const tokens = Math.max(0, Math.round(count));
  if (tokens < 1_000) return String(tokens);
  if (tokens >= 1_000_000) return `${oneDecimal(tokens / 1_000_000)}M`;
  const thousands = tokens / 1_000;
  // A decimal is noise once the count is in the hundreds of thousands.
  return `${thousands < 100 ? oneDecimal(thousands) : Math.round(thousands)}k`;
}

function usd(value: number): string {
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

/** A model's price per million tokens, input then output: "$3.00 / $15.00". */
export function formatModelPrice({ input, output }: { input: number; output: number }): string {
  return `${usd(input)} / ${usd(output)}`;
}

/** Gains and losses are the only thing the app colours, and an exact zero is neither. */
export function gainClass(value: number | null): string {
  if (value === null || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** `YYYY-MM-DD` for today, the default trade date of a new transaction in the user's own zone. */
export function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Parses a number typed into a form, allowing thousands separators ("1,250.5"); blank or
 * unparseable input reads as "not given".
 */
export function parseNumber(input: string): number | undefined {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
