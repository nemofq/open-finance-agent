import { formatMoney } from "@/lib/portfolio/format";
import type { AccountCash } from "@/lib/portfolio/holdings";

/** The scoped accounts' cash balances, each in its own currency. */
export function CashView({ cash }: { cash: AccountCash[] }) {
  if (cash.length === 0) return null;
  return (
    <div className="border-t pt-3">
      <h3 className="text-sm font-medium">Cash</h3>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2 sm:gap-x-6">
        {cash.map((item) => (
          <div
            key={`${item.accountId}:${item.balance.currency}`}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="min-w-0 truncate text-muted-foreground">{item.accountName}</dt>
            <dd className="shrink-0 tabular-nums">
              {formatMoney(item.balance.amount, item.balance.currency)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
