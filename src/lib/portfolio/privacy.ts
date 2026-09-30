import { replayLedger } from "./holdings";
import type { PortfolioStore } from "./types";

/** Portfolio values that could identify user holdings if leaked to external tools. */
export interface PrivacySummary {
  accountNames: string[];
  quantities: number[];
  costs: number[];
  symbols: string[];
}

/**
 * Anything below this rounds away to nothing once written, so matching on it would only produce
 * false positives.
 */
const MIN_IDENTIFYING = 0.005;

/**
 * The current holdings, reduced to the values a leak would expose.
 *
 * `costs` holds cost bases and average costs together: an average cost is exactly as identifying
 * as the total, and is the number a user is most likely to paste into a search box.
 *
 * `symbols` is context, not a secret: holding NVDA is not private, and searching for "NVDA" must
 * stay allowed. The policy weighs a symbol only alongside a quantity or a cost.
 */
export async function portfolioPrivacySummary(store: PortfolioStore, today: string): Promise<PrivacySummary> {
  const { accounts, snapshot } = await replayLedger(store, today);

  const quantities = new Set<number>();
  const costs = new Set<number>();
  const symbols = new Set<string>();
  for (const position of snapshot.positions) {
    if (Math.abs(position.quantity) >= MIN_IDENTIFYING) quantities.add(position.quantity);
    if (Math.abs(position.costBasis) >= MIN_IDENTIFYING) costs.add(position.costBasis);
    if (Math.abs(position.averageCost) >= MIN_IDENTIFYING) costs.add(position.averageCost);
    const symbol = position.instrument.symbol.trim();
    if (symbol) symbols.add(symbol);
  }

  return {
    accountNames: [...new Set(accounts.map((account) => account.name.trim()).filter(Boolean))],
    quantities: [...quantities],
    costs: [...costs],
    symbols: [...symbols],
  };
}
