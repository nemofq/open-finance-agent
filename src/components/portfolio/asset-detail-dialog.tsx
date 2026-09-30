"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/page-shell";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/portfolio/format";
import { instrumentTotals } from "@/lib/portfolio/scope";
import { DEFAULT_PORTFOLIO_CURRENCY } from "@/lib/portfolio/types";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";
import type { SessionHeader } from "@/lib/sessions/types";
import { cn } from "cn";
import { gainClass } from "@/components/shared/format";
import { assetName, holdingKey, signedMoney, signedPercent } from "./display";

function relatedSessions(symbol: string | null, sessions: SessionHeader[]): SessionHeader[] {
  if (!symbol) return [];
  return sessions.filter(
    (session) =>
      session.messageCount > 0 &&
      session.tickers.some((ticker) => ticker.toUpperCase() === symbol.toUpperCase()),
  );
}

/** The totals pattern again, as a plain bordered cell for the asset dialog. */
function DetailCell({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-heading text-base font-semibold tabular-nums", valueClassName)}>{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/** One asset across every account that holds it, and the chats tagged with its ticker. */
export function AssetDetailDialog({
  holding,
  allHoldings,
  sessions,
  onClose,
}: {
  holding: ValuedAccountHolding | null;
  allHoldings: ValuedAccountHolding[];
  sessions: SessionHeader[];
  onClose: () => void;
}) {
  const symbol = holding?.position.instrument.symbol ?? null;
  const totals = instrumentTotals(allHoldings, symbol);
  const matches = totals.positions;
  const conversations = relatedSessions(symbol, sessions);
  const currency = holding?.valuation.valuationCurrency ?? holding?.position.instrument.currency ?? DEFAULT_PORTFOLIO_CURRENCY;

  return (
    <Dialog
      open={holding !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {holding && (
          <>
            <DialogHeader>
              <DialogTitle>{symbol ? `$${symbol}` : "Custom asset"}</DialogTitle>
              <DialogDescription>
                {assetName(holding) || `Held in ${matches.length} ${matches.length === 1 ? "position" : "positions"}`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-3">
              <DetailCell label="Market value" value={totals.marketValue === null ? "—" : formatMoney(totals.marketValue, currency)} />
              <DetailCell label="Cost basis" value={totals.costBasis === null ? "—" : formatMoney(totals.costBasis, currency)} />
              <DetailCell
                label="Unrealized return"
                value={totals.unrealizedPnl === null ? "—" : signedMoney(totals.unrealizedPnl, currency)}
                detail={totals.unrealizedPercent === null ? "Incomplete valuation" : signedPercent(totals.unrealizedPercent)}
                valueClassName={gainClass(totals.unrealizedPnl)}
              />
            </div>

            <section className="grid gap-2">
              <h3 className="font-heading text-base font-semibold">Positions by account</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Account</TableHead>
                      <TableHead scope="col" className="text-right">
                        Quantity
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Cost
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Value
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.map((item) => (
                      <TableRow key={holdingKey(item)}>
                        <TableCell className="font-medium">
                          {item.accountName}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {item.institution ?? "Local account"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatQuantity(item.position.quantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.valuation?.costBasisValue ?? null, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.valuation?.marketValue ?? null, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="font-heading text-base font-semibold">Related chats</h3>
              {conversations.length > 0 ? (
                <div className="grid gap-1">
                  {conversations.map((session) => (
                    <Link
                      key={session.id}
                      href={`/chat/${session.id}`}
                      onClick={onClose}
                      className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-muted/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{session.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(session.updatedAt).toLocaleString()}
                        </span>
                      </span>
                      <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState>
                  {symbol
                    ? `No conversations tagged $${symbol} yet.`
                    : "Name-only assets do not have ticker-linked conversations."}
                </EmptyState>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
