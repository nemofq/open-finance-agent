"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Field, StatusLine } from "@/components/shared/field-row";
import { parseNumber, todayIsoDate } from "@/components/shared/format";
import { patchJson, postJson } from "@/components/shared/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Account } from "@/lib/portfolio/types";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";
import { errorMessage } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";

/** What the editor opens on: a new position in an account, or a holding to change. */
export type PositionTarget = { mode: "add"; account: Account } | { mode: "edit"; holding: ValuedAccountHolding };

type PositionDraft = {
  accountId: string;
  symbol: string;
  quantity: string;
  averagePrice: string;
  currency: string;
};

/** One account's holding of one instrument, which an edit or removal adjusts in the ledger. */
export function currentPositionUrl(accountId: string, instrumentId: string): string {
  return `/api/portfolio/positions/current/${encodeURIComponent(accountId)}/${encodeURIComponent(instrumentId)}?today=${todayIsoDate()}`;
}

function draftOf(target: PositionTarget): PositionDraft {
  if (target.mode === "add") {
    const { account } = target;
    return { accountId: account.id, symbol: "", quantity: "", averagePrice: "", currency: account.baseCurrency };
  }
  const { accountId, position } = target.holding;
  return {
    accountId,
    symbol: position.instrument.symbol,
    quantity: String(position.quantity),
    averagePrice: String(position.averageCost),
    currency: position.instrument.currency,
  };
}

/**
 * The portfolio page's inline editor for one position, which saves it itself as a ledger
 * adjustment. The draft is seeded at mount, so the caller remounts it (a new `key`) per opening.
 */
export function PositionEditor({
  target,
  accounts,
  busy,
  removals,
  onBusyChange,
  onSaved,
  onCancel,
}: {
  target: PositionTarget;
  accounts: Account[];
  /** A save here or a removal in the table is running. */
  busy: boolean;
  /** How many removals the table has started; a new one clears this editor's error. */
  removals: number;
  onBusyChange: (busy: boolean) => void;
  /** The position is in the ledger: say so, and read the portfolio again. */
  onSaved: (notice: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(target));
  const [failure, setFailure] = useState({ message: "", removals });
  const error = failure.removals === removals ? failure.message : "";
  const setError = (message: string) => setFailure({ message, removals });
  const adding = target.mode === "add";
  const account = accounts.find((candidate) => candidate.id === draft.accountId);
  const patch = (fields: Partial<PositionDraft>) => setDraft((current) => ({ ...current, ...fields }));

  async function save() {
    const symbol = draft.symbol.trim();
    const quantity = parseNumber(draft.quantity);
    const averagePrice = parseNumber(draft.averagePrice);
    const currency = draft.currency.trim().toUpperCase();
    if (!symbol) {
      setError("Ticker is required.");
      return;
    }
    if (quantity === undefined || quantity <= 0) {
      setError("Quantity must be a number greater than 0.");
      return;
    }
    if (averagePrice === undefined || averagePrice < 0) {
      setError("Average cost must be a number of 0 or more.");
      return;
    }
    if (!currency) {
      setError("Currency is required.");
      return;
    }

    onBusyChange(true);
    setError("");
    try {
      const input = { accountId: draft.accountId, symbol, quantity, averagePrice, currency };
      if (target.mode === "add") await postJson<unknown>(`/api/portfolio/positions?today=${todayIsoDate()}`, input);
      else await patchJson<unknown>(currentPositionUrl(draft.accountId, target.holding.position.instrument.id), input);
      await onSaved(adding ? "Position added." : "Position updated.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <section className="rounded-lg border bg-muted/20 p-3" aria-label={adding ? "Add position" : "Edit position"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{adding ? "Add position" : "Edit position"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Changes are recorded as a new ledger adjustment, so your import history stays intact.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            <XIcon /> Cancel
          </Button>
          <Button size="sm" disabled={busy || !draft.accountId} onClick={() => void save()}>
            <CheckIcon /> {adding ? "Add position" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Account">
          {(id) =>
            adding ? (
              <NativeSelect
                id={id}
                value={draft.accountId}
                onChange={(event) => {
                  const accountId = event.target.value;
                  const next = accounts.find((candidate) => candidate.id === accountId);
                  patch({ accountId, currency: next?.baseCurrency ?? draft.currency });
                }}
              >
                <option value="">Select account</option>
                {accounts.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input id={id} value={account?.name ?? draft.accountId} readOnly />
            )
          }
        </Field>
        <Field label="Ticker">
          {(id) => (
            <Input
              id={id}
              value={draft.symbol}
              placeholder="e.g. AAPL"
              onChange={(event) => patch({ symbol: event.target.value })}
            />
          )}
        </Field>
        <Field label="Quantity">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={draft.quantity}
              placeholder="e.g. 10"
              onChange={(event) => patch({ quantity: event.target.value })}
            />
          )}
        </Field>
        <Field label="Average cost">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={draft.averagePrice}
              placeholder="e.g. 150.25"
              onChange={(event) => patch({ averagePrice: event.target.value })}
            />
          )}
        </Field>
        <Field label="Currency">
          {(id) => (
            <Input
              id={id}
              value={draft.currency}
              maxLength={12}
              onChange={(event) => patch({ currency: event.target.value })}
            />
          )}
        </Field>
      </div>
      {error ? <StatusLine ok={false} className="mt-3">{error}</StatusLine> : null}
    </section>
  );
}
