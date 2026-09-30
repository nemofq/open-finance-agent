"use client";

import { BriefcaseBusinessIcon } from "lucide-react";
import { StatusLine } from "@/components/shared/field-row";
import { todayIsoDate } from "@/components/shared/format";
import { useJson } from "@/components/shared/use-json";
import { formatMoney, formatQuantity } from "@/lib/portfolio/format";
import type { AccountHolding } from "@/lib/portfolio/holdings";

/**
 * What you hold of one ticker across accounts, under its hover card; nothing when you hold none.
 * Read each time the card opens.
 */
export function TickerPositionSummary({ symbol, open }: { symbol: string; open: boolean }) {
  const url = `/api/portfolio/current?symbol=${encodeURIComponent(symbol)}&today=${todayIsoDate()}`;
  const { data, error } = useJson<{ holdings: AccountHolding[] }>(open ? url : null);
  const holdings = data?.holdings;

  if (error) {
    return (
      <StatusLine ok={false} className="mt-3 border-t border-border pt-2">
        Local position unavailable: {error}
      </StatusLine>
    );
  }
  if (!holdings?.length) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <BriefcaseBusinessIcon className="size-3.5 text-muted-foreground" /> Your position
      </div>
      <div className="space-y-1.5">
        {holdings.map((holding) => (
          <div
            key={`${holding.accountId}:${holding.position.instrument.id}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="min-w-0 truncate text-muted-foreground">
              {holding.accountName} · {formatQuantity(holding.position.quantity)} units
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatMoney(holding.position.costBasis, holding.position.instrument.currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
