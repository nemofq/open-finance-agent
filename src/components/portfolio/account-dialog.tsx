"use client";

import { useState } from "react";
import { patchJson, postJson } from "@/components/shared/http-client";
import { deepEqual, errorMessage } from "@/lib/utils";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { EnumField, TextField } from "@/components/shared/field-row";
import { FormDialog } from "@/components/shared/form-dialog";
import { DEFAULT_PORTFOLIO_CURRENCY, type Account, type AccountInput } from "@/lib/portfolio/types";
import { accountTypes, costBasisMethods } from "./options";

function seedOf(account: Account | undefined): AccountInput {
  return {
    name: account?.name ?? "",
    institution: account?.institution,
    type: account?.type ?? "taxable",
    baseCurrency: account?.baseCurrency ?? DEFAULT_PORTFOLIO_CURRENCY,
    costBasisMethod: account?.costBasisMethod ?? "fifo",
    openedAt: account?.openedAt,
  };
}

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted when adding; the account being edited otherwise. */
  initial?: Account;
  /** The account was written and the dialog has closed; `created` tells an add from an edit. */
  onSaved: (account: Account, created: boolean) => void;
}

const accountsUrl = "/api/portfolio/accounts";

/**
 * Add/edit dialog for one account, which writes it itself. The draft is seeded at mount, so the
 * caller must remount this component (change its `key`) each time the dialog opens.
 */
export function AccountDialog({ open, onOpenChange, initial, onSaved }: AccountDialogProps) {
  const [seed] = useState(() => seedOf(initial));
  const [draft, setDraft] = useState<AccountInput>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The modal blocks in-app links, so this guards closing or reloading the tab.
  useUnsavedChangesWarning(open && !deepEqual(draft, seed));

  const patch = (fields: Partial<AccountInput>) => setDraft((current) => ({ ...current, ...fields }));
  const name = draft.name.trim();
  const currency = draft.baseCurrency.trim();

  const submit = async () => {
    setSaving(true);
    setError(null);
    const input: AccountInput = { ...draft, name, baseCurrency: currency.toUpperCase() };
    try {
      const { account } = initial
        ? await patchJson<{ account: Account }>(`${accountsUrl}/${encodeURIComponent(initial.id)}`, input)
        : await postJson<{ account: Account }>(accountsUrl, input);
      onOpenChange(false);
      onSaved(account, initial === undefined);
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
      title={initial ? "Edit account" : "Add account"}
      description="An account groups the positions you hold in one place: a brokerage, an IRA, an ISA. Nothing is connected to a broker; you import or enter what it holds."
      error={error}
      submitLabel={initial ? "Save account" : "Add account"}
      submitting={saving}
      canSubmit={name !== "" && currency !== ""}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Name"
          value={draft.name}
          placeholder="Main brokerage"
          onChange={(value) => patch({ name: value ?? "" })}
        />
        <TextField
          label="Institution"
          value={draft.institution}
          placeholder="Fidelity"
          onChange={(institution) => patch({ institution })}
        />
        <EnumField
          label="Account type"
          value={draft.type}
          options={accountTypes}
          required
          onChange={(type) => type && patch({ type })}
        />
        <TextField
          label="Base currency"
          value={draft.baseCurrency}
          placeholder={DEFAULT_PORTFOLIO_CURRENCY}
          help="Cost basis and gains are reported in this currency."
          onChange={(value) => patch({ baseCurrency: value ?? "" })}
        />
        <EnumField
          label="Cost-basis method"
          value={draft.costBasisMethod}
          options={costBasisMethods}
          required
          onChange={(costBasisMethod) => costBasisMethod && patch({ costBasisMethod })}
        />
        <TextField
          label="Opened on"
          value={draft.openedAt}
          type="date"
          onChange={(openedAt) => patch({ openedAt })}
        />
      </div>
    </FormDialog>
  );
}
