import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/portfolio/format";
import type { ScopedTotals } from "@/lib/portfolio/scope";
import { cn } from "cn";
import { gainClass } from "@/components/shared/format";
import { signedMoney, signedPercent } from "./display";

function TotalCard({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 font-heading text-xl font-semibold tabular-nums", valueClassName)}>{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

/** The four totals over the page's account scope, in the valuation currency they were computed in. */
export function PortfolioSummary({ totals }: { totals: ScopedTotals }) {
  const { currency } = totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TotalCard
        label="Total value"
        value={totals.totalValue === null ? "—" : formatMoney(totals.totalValue, currency)}
        detail={
          totals.totalValue !== null && totals.hasMissingQuote
            ? `Known positions only${totals.totalCost === null ? "" : ` · Cost basis ${formatMoney(totals.totalCost, currency)}`}`
            : totals.totalCost === null
              ? "Incomplete valuation"
              : `Cost basis ${formatMoney(totals.totalCost, currency)}`
        }
      />
      <TotalCard
        label="Unrealized return"
        value={totals.unrealizedPnl === null ? "—" : signedMoney(totals.unrealizedPnl, currency)}
        detail={totals.unrealizedPercent === null ? "Incomplete valuation" : signedPercent(totals.unrealizedPercent)}
        valueClassName={gainClass(totals.unrealizedPnl)}
      />
      <TotalCard
        label="Today"
        value={totals.todayPnl === null ? "—" : signedMoney(totals.todayPnl, currency)}
        detail={totals.todayPercent === null ? "Incomplete valuation" : `${signedPercent(totals.todayPercent)} today`}
        valueClassName={totals.todayPnl === null ? undefined : gainClass(totals.todayPnl)}
      />
      <TotalCard
        label="Cash"
        value={totals.cashTotal === null ? "—" : formatMoney(totals.cashTotal, currency)}
        detail={totals.cashPercent === null ? "Incomplete valuation" : `${totals.cashPercent.toFixed(1)}% of total`}
      />
    </div>
  );
}
