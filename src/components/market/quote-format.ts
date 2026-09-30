import type { Quote } from "@/lib/tickers/types";

const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** A price to the cent, as the ticker card and the detail dialog print it. */
export function formatPrice(price: number): string {
  return decimal.format(price);
}

/** A share volume, compactly: 12.4M. */
export function formatVolume(volume: number): string {
  return compact.format(volume);
}

/**
 * The day's move and its percentage, "+1.23 (+0.45%)", with a true minus sign for a fall and
 * `unit` (a currency sign, say) before the amount.
 */
export function formatQuoteChange({ change, changePercent }: Pick<Quote, "change" | "changePercent">, unit = ""): string {
  const sign = change >= 0 ? "+" : "−";
  return `${sign}${unit}${decimal.format(Math.abs(change))} (${sign}${decimal.format(Math.abs(changePercent))}%)`;
}
