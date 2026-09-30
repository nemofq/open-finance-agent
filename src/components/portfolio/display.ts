import { formatMoney } from "@/lib/portfolio/format";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";

/** One holding's key: an instrument appears once per account. */
export function holdingKey(holding: ValuedAccountHolding): string {
  return `${holding.accountId}:${holding.position.instrument.id}`;
}

/** The ledger's name for the instrument, else the quote's; empty when neither adds to the symbol. */
export function assetName(holding: ValuedAccountHolding): string {
  const symbol = holding.position.instrument.symbol;
  const name = holding.position.instrument.name ?? holding.quote?.name ?? "";
  return name.toUpperCase() === symbol.toUpperCase() ? "" : name;
}

/** A gain carries an explicit `+`; a loss already carries its own `-`. */
export function signedMoney(value: number, currency: string): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}

export function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
