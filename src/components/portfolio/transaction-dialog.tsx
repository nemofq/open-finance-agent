"use client";

import { useState } from "react";
import { postJson } from "@/components/shared/http-client";
import { EnumField, FieldHelp, TextField } from "@/components/shared/field-row";
import { FormDialog } from "@/components/shared/form-dialog";
import { parseNumber, todayIsoDate } from "@/components/shared/format";
import type { Account, InstrumentKind, SimpleTransactionInput } from "@/lib/portfolio/types";
import { errorMessage } from "@/lib/utils";
import { instrumentKinds, manualTransactionTypes, type ManualTransactionType } from "./options";

interface TransactionDraft {
  accountId: string;
  type: ManualTransactionType;
  symbol: string;
  kind: InstrumentKind | undefined;
  tradeDate: string;
  quantity: string;
  price: string;
  amount: string;
  currency: string;
  fees: string;
  note: string | undefined;
}

export interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Non-empty: the page offers this dialog only once an account exists. */
  accounts: Account[];
  /** The account the form starts on, usually the one the page is scoped to. */
  initialAccountId: string;
  /** The transaction is in the ledger and the dialog has closed. */
  onRecorded: (symbol: string) => void;
}

/**
 * Records one buy, sell or dividend against an account's ledger. The draft is seeded at mount, so
 * the caller remounts this component (changes its `key`) each time the dialog opens.
 */
export function TransactionDialog({ open, onOpenChange, accounts, initialAccountId, onRecorded }: TransactionDialogProps) {
  const initialAccount = accounts.find((candidate) => candidate.id === initialAccountId) ?? accounts.at(0);
  const [draft, setDraft] = useState<TransactionDraft>(() => ({
    accountId: initialAccount?.id ?? "",
    type: "buy",
    symbol: "",
    kind: undefined,
    tradeDate: todayIsoDate(),
    quantity: "",
    price: "",
    amount: "",
    currency: initialAccount?.baseCurrency ?? "",
    fees: "",
    note: undefined,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (fields: Partial<TransactionDraft>) => setDraft((current) => ({ ...current, ...fields }));
  const account = accounts.find((candidate) => candidate.id === draft.accountId);
  // Another account brings its own currency, which is what a trade in it is most likely in.
  const chooseAccount = (accountId: string) =>
    patch({ accountId, currency: accounts.find((candidate) => candidate.id === accountId)?.baseCurrency ?? draft.currency });
  // A dividend is a cash amount; a trade is a quantity at a price.
  const isTrade = draft.type !== "dividend";
  const symbol = draft.symbol.trim().toUpperCase();
  const currency = draft.currency.trim().toUpperCase();
  const quantity = parseNumber(draft.quantity);
  const price = parseNumber(draft.price);
  const amount = parseNumber(draft.amount);
  const valid =
    account !== undefined &&
    symbol !== "" &&
    currency !== "" &&
    draft.tradeDate !== "" &&
    (isTrade ? quantity !== undefined && price !== undefined : amount !== undefined);

  const submit = async () => {
    if (!account) return;
    setSaving(true);
    setError(null);
    const input: SimpleTransactionInput = {
      accountId: account.id,
      type: draft.type,
      symbol,
      kind: draft.kind,
      tradeDate: draft.tradeDate,
      quantity: isTrade ? quantity : undefined,
      price: isTrade ? price : undefined,
      amount: isTrade ? undefined : amount,
      currency,
      fees: parseNumber(draft.fees),
      note: draft.note,
    };
    try {
      await postJson<unknown>("/api/portfolio/transactions", input);
      onOpenChange(false);
      onRecorded(symbol);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a transaction"
      description="A buy, sell or dividend. Positions and cost basis are replayed from the ledger, so the table updates itself."
      error={error}
      submitLabel="Record transaction"
      submitting={saving}
      canSubmit={valid}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <EnumField
          label="Account"
          value={draft.accountId}
          options={accounts.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          required
          onChange={(accountId) => accountId && chooseAccount(accountId)}
        />
        <EnumField
          label="Type"
          value={draft.type}
          options={manualTransactionTypes}
          required
          onChange={(type) => type && patch({ type })}
        />
        <TextField
          label="Trade date"
          value={draft.tradeDate}
          type="date"
          onChange={(value) => patch({ tradeDate: value ?? "" })}
        />
        <TextField
          label="Symbol"
          value={draft.symbol}
          placeholder="AAPL"
          onChange={(value) => patch({ symbol: value ?? "" })}
        />
        <EnumField
          label="Instrument type"
          value={draft.kind}
          options={instrumentKinds}
          onChange={(kind) => patch({ kind })}
        />
        {isTrade ? (
          <>
            <TextField
              label="Quantity"
              value={draft.quantity}
              type="number"
              step="any"
              placeholder="10"
              onChange={(value) => patch({ quantity: value ?? "" })}
            />
            <TextField
              label="Price per unit"
              value={draft.price}
              type="number"
              step="any"
              placeholder="150"
              onChange={(value) => patch({ price: value ?? "" })}
            />
          </>
        ) : (
          <TextField
            label="Amount received"
            value={draft.amount}
            type="number"
            step="any"
            placeholder="120"
            onChange={(value) => patch({ amount: value ?? "" })}
          />
        )}
        <TextField
          label="Currency"
          value={draft.currency}
          placeholder={account?.baseCurrency}
          onChange={(value) => patch({ currency: value ?? "" })}
        />
        <TextField
          label="Fees"
          value={draft.fees}
          type="number"
          step="any"
          placeholder="0"
          onChange={(value) => patch({ fees: value ?? "" })}
        />
        <TextField label="Note" value={draft.note} placeholder="Optional" onChange={(note) => patch({ note })} />
      </div>

      <FieldHelp help="The cash effect is derived by the ledger; you do not need to enter it." />
    </FormDialog>
  );
}
