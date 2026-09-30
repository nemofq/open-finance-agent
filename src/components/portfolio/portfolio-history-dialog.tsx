"use client";

import { useState } from "react";
import { ArrowRightIcon, GitCompareArrowsIcon } from "lucide-react";
import { postJson } from "@/components/shared/http-client";
import { Field } from "@/components/shared/field-row";
import { EmptyState, Notice } from "@/components/shared/page-shell";
import { useJson } from "@/components/shared/use-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, formatPortfolioNumber, formatQuantity } from "@/lib/portfolio/format";
import type { CashChange, HoldingChange, HoldingComparison } from "@/lib/portfolio/holdings";
import type { Account, ImportBatch } from "@/lib/portfolio/types";
import { errorMessage } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";

function batchLabel(batch: ImportBatch): string {
  return new Date(batch.fetchedAt).toLocaleString();
}

/** One side of a change: what the account held, never what it was worth. */
function sideDetail(side: HoldingChange["before"]): string {
  if (!side) return "—";
  return `${formatQuantity(side.quantity)} units · ${formatPortfolioNumber(side.costBasis)} cost`;
}

/** A delta only reads as a change with its sign; a negative number carries its own. */
function signed(value: number, format: (value: number) => string): string {
  return `${value > 0 ? "+" : ""}${format(value)}`;
}

function statusVariant(status: HoldingChange["status"]) {
  if (status === "removed") return "destructive" as const;
  if (status === "added") return "default" as const;
  return "secondary" as const;
}

function BatchRow({ batch, current }: { batch: ImportBatch; current: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{batchLabel(batch)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {batch.count} positions · {batch.provider}
        </p>
      </div>
      {current ? <Badge variant="secondary">Current</Badge> : null}
    </div>
  );
}

function ChangeRow({ change }: { change: HoldingChange }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{change.symbol}</p>
          {change.name && change.name !== change.symbol ? (
            <p className="truncate text-xs text-muted-foreground">{change.name}</p>
          ) : null}
        </div>
        <Badge variant={statusVariant(change.status)}>{change.status}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{sideDetail(change.before)}</span>
        <ArrowRightIcon className="size-3" />
        <span>{sideDetail(change.after)}</span>
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {signed(change.quantityDelta, formatQuantity)} units ·{" "}
        {signed(change.costBasisDelta, (value) => formatPortfolioNumber(value))} cost
      </p>
    </div>
  );
}

function CashRow({ change }: { change: CashChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{formatMoney(change.before, change.currency)}</span>
      <ArrowRightIcon className="size-3" />
      <span>{formatMoney(change.after, change.currency)}</span>
      <span className="tabular-nums">({signed(change.delta, (value) => formatPortfolioNumber(value))})</span>
    </div>
  );
}

export function PortfolioHistoryDialog({ onOpenChange, accounts, initialAccountId }: {
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  initialAccountId: string;
}) {
  const [accountId, setAccountId] = useState(initialAccountId);
  const history = useJson<{ batches: ImportBatch[] }>(accountId ? `/api/portfolio/${encodeURIComponent(accountId)}` : null);
  const batches = history.data?.batches ?? [];
  /** The imports the user picked to compare; unpicked, the previous import against the latest. */
  const [picked, setPicked] = useState<{ before?: string; after?: string }>({});
  // Batches arrive newest first.
  const beforeId = picked.before ?? batches[1]?.id ?? "";
  const afterId = picked.after ?? batches[0]?.id ?? "";
  const [comparison, setComparison] = useState<HoldingComparison | null>(null);
  const [compareError, setCompareError] = useState("");
  const error = compareError || history.error;

  async function compare() {
    try {
      const body = await postJson<{ comparison: HoldingComparison }>("/api/portfolio/compare", {
        accountId,
        beforeBatchId: beforeId,
        afterBatchId: afterId,
      });
      setComparison(body.comparison);
      setCompareError("");
    } catch (cause) {
      setCompareError(errorMessage(cause));
    }
  }

  const unchanged = comparison && comparison.changes.length === 0 && comparison.cash.length === 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,48rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import history</DialogTitle>
          <DialogDescription>
            Every import is recorded against the ledger. Compare two of them to see how positions changed, without
            inferring trades or returns.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Account">
            {(id) => (
              <NativeSelect
                id={id}
                aria-label="History account"
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setPicked({});
                  setComparison(null);
                  setCompareError("");
                }}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          {error ? <Notice tone="error">{error}</Notice> : null}

          {history.loading ? (
            <Notice tone="info">Loading imports…</Notice>
          ) : batches.length === 0 ? (
            <EmptyState>No imports for this account yet.</EmptyState>
          ) : (
            <>
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">Saved imports</h3>
                <div className="divide-y rounded-lg border">
                  {batches.map((batch, index) => (
                    <BatchRow key={batch.id} batch={batch} current={index === 0} />
                  ))}
                </div>
              </section>

              {batches.length > 1 ? (
                <section className="grid gap-3 border-t pt-4">
                  <h3 className="text-sm font-medium">Compare positions</h3>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <Field label="Before">
                      {(id) => (
                        <NativeSelect
                          id={id}
                          aria-label="Before snapshot"
                          value={beforeId}
                          onChange={(event) => { setPicked({ ...picked, before: event.target.value }); setComparison(null); }}
                        >
                          <option value="">Select</option>
                          {batches.map((batch) => (
                            <option key={batch.id} value={batch.id}>{batchLabel(batch)}</option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                    <ArrowRightIcon className="mb-2 hidden size-4 self-end text-muted-foreground sm:block" />
                    <Field label="After">
                      {(id) => (
                        <NativeSelect
                          id={id}
                          aria-label="After snapshot"
                          value={afterId}
                          onChange={(event) => { setPicked({ ...picked, after: event.target.value }); setComparison(null); }}
                        >
                          <option value="">Select</option>
                          {batches.map((batch) => (
                            <option key={batch.id} value={batch.id}>{batchLabel(batch)}</option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      disabled={!beforeId || !afterId || beforeId === afterId}
                      onClick={compare}
                    >
                      <GitCompareArrowsIcon /> Compare imports
                    </Button>
                  </div>

                  {comparison && unchanged ? <Notice tone="info">No position changes between these imports.</Notice> : null}

                  {comparison && !unchanged ? (
                    <div className="grid gap-2">
                      {comparison.changes.map((change) => (
                        <ChangeRow key={change.instrumentId} change={change} />
                      ))}
                      {comparison.cash.length > 0 ? (
                        <div className="grid gap-2 rounded-lg border p-3">
                          <h4 className="text-sm font-medium">Cash</h4>
                          {comparison.cash.map((change) => (
                            <CashRow key={change.currency} change={change} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
