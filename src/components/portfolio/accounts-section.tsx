"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { EmptyState } from "@/components/shared/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/portfolio/types";
import { accountTypes, costBasisMethods } from "./options";

const labelFor = <T extends string>(options: { value: T; label: string }[], value: T): string =>
  options.find((option) => option.value === value)?.label ?? value;

export interface AccountsSectionProps {
  accounts: Account[];
  onAdd: () => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
}

/** The accounts you hold positions in, with their type, currency and cost-basis method. */
export function AccountsSection({ accounts, onAdd, onEdit, onDelete }: AccountsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Accounts</h3>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon />
          Add account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState>
          <p>No accounts yet.</p>
          <p className="mt-1">
            An account is one place you hold positions: a brokerage, an ISA, a 401(k). Add one, then import what it
            holds or enter it by hand.
          </p>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {account.name}
                  <Badge variant="outline">{labelFor(accountTypes, account.type)}</Badge>
                  <Badge variant="secondary" className="font-mono">
                    {account.baseCurrency}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {account.institution ? `${account.institution} · ` : null}
                  {labelFor(costBasisMethods, account.costBasisMethod)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(account)}>
                  <PencilIcon />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(account)}
                >
                  <Trash2Icon />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
