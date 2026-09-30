/** Numbers for the holdings screens. Nothing is rounded before it is displayed. */

const DASH = "—";

function formatter(places: number): Intl.NumberFormat {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

/** A money-shaped number, or an em dash when the source had no value at all. */
export function formatPortfolioNumber(value: number | null | undefined, places = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return formatter(places).format(value);
}

/** A share count: whole where it is whole, and never rounded into looking like zero. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function formatMoney(value: number | null | undefined, currency: string, places = 2): string {
  const amount = formatPortfolioNumber(value, places);
  return amount === DASH ? DASH : `${currency} ${amount}`;
}
