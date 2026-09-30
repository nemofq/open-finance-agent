"use client";

import { PencilLineIcon, Trash2Icon } from "lucide-react";
import { gainClass } from "@/components/shared/format";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/portfolio/format";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";
import { cn } from "cn";
import { assetName, signedMoney, signedPercent } from "./display";

/** One holding in the positions table, with Edit and Remove while the table is in edit mode. */
export function PositionRow({
  item,
  showAccount,
  editMode,
  busy,
  onSelect,
  onEdit,
  onRemove,
}: {
  item: ValuedAccountHolding;
  showAccount: boolean;
  editMode: boolean;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const valuation = item.valuation;
  const symbol = item.position.instrument.symbol;
  const instrumentCurrency = item.position.instrument.currency;
  const costCurrency = item.baseCurrency ?? instrumentCurrency;
  const price = valuation?.currentPrice ?? null;
  const marketValue = valuation?.marketValue ?? null;
  const unrealizedPnl = valuation?.unrealizedPnl ?? null;
  const unrealizedPercent = valuation?.unrealizedPnlPercent ?? null;
  const todayPercent = valuation?.todayPnlPercent ?? null;
  const weight = valuation?.weight ?? null;

  return (
    <TableRow>
      <TableCell>
        <button type="button" className="group max-w-60 text-left" onClick={onSelect}>
          <span className="block truncate font-medium group-hover:underline">{symbol}</span>
          {assetName(item) && <span className="block truncate text-xs text-muted-foreground">{assetName(item)}</span>}
        </button>
      </TableCell>

      {showAccount && <TableCell className="max-w-40 truncate text-muted-foreground">{item.accountName}</TableCell>}

      <TableCell className="text-right tabular-nums">{formatQuantity(item.position.quantity)}</TableCell>

      <TableCell className="text-right tabular-nums">{formatMoney(item.position.averageCost, costCurrency)}</TableCell>

      <TableCell className="text-right tabular-nums">
        <span className="block">{price === null ? "—" : formatMoney(price, instrumentCurrency)}</span>
        {valuation?.status === "live" && todayPercent !== null ? (
          <span className={cn("block text-xs", gainClass(todayPercent))}>{signedPercent(todayPercent)}</span>
        ) : (
          <span className="block text-xs text-muted-foreground">
            {valuation?.status === "missing-fx" ? "missing FX" : "missing quote"}
          </span>
        )}
      </TableCell>

      <TableCell className="text-right font-medium tabular-nums">
        {marketValue === null ? "—" : formatMoney(marketValue, valuation?.valuationCurrency ?? instrumentCurrency)}
      </TableCell>

      <TableCell className={cn("text-right tabular-nums", gainClass(unrealizedPnl))}>
        <span className="block">
          {unrealizedPnl === null ? "—" : signedMoney(unrealizedPnl, valuation?.valuationCurrency ?? costCurrency)}
        </span>
        <span className="block text-xs">{unrealizedPercent === null ? "—" : signedPercent(unrealizedPercent)}</span>
      </TableCell>

      <TableCell className="text-right tabular-nums">{weight === null ? "—" : `${weight.toFixed(1)}%`}</TableCell>
      {editMode && (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${symbol}`}
              title="Edit position"
              disabled={busy}
              onClick={onEdit}
            >
              <PencilLineIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${symbol}`}
              title="Remove position"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
