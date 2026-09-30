"use client";

import { CheckIcon, PencilLineIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteJson } from "@/components/shared/http-client";
import { EmptyState } from "@/components/shared/page-shell";
import { useDialogSubject } from "@/components/shared/use-dialog-subject";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Account } from "@/lib/portfolio/types";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";
import { errorMessage } from "@/lib/utils";
import { formatCalendarDate, formatClock } from "@/components/shared/format";
import { assetName, holdingKey } from "./display";
import { currentPositionUrl, PositionEditor, type PositionTarget } from "./position-editor";
import { PositionRow } from "./position-row";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * The positions card: the scoped holdings as a table with search, the account filter and a price
 * refresh, and an edit mode that adds, changes and removes positions as ledger adjustments.
 * `children` goes under the table, which is where the page puts the cash.
 */
export function PositionsView({
  accounts,
  holdings,
  accountId,
  onAccountChange,
  asOf,
  loading,
  refreshing,
  lastUpdated,
  onRefresh,
  onChanged,
  onError,
  onSelect,
  onAddAccount,
  onImport,
  children,
}: {
  accounts: Account[];
  /** The holdings in the page's account scope. */
  holdings: ValuedAccountHolding[];
  accountId: string;
  onAccountChange: (accountId: string) => void;
  asOf: string;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  /** A position was saved or removed: say so, and read the portfolio again. */
  onChanged: (notice: string) => Promise<void>;
  onError: (message: string) => void;
  onSelect: (holding: ValuedAccountHolding) => void;
  onAddAccount: () => void;
  onImport: () => void;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [editMode, setEditMode] = useState(false);
  const editor = useDialogSubject<PositionTarget>();
  const [busy, setBusy] = useState(false);
  const [removals, setRemovals] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<ValuedAccountHolding | null>(null);

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return holdings;
    return holdings.filter((item) =>
      [item.position.instrument.symbol, assetName(item), item.accountName].some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
  }, [query, holdings]);

  function toggleEditMode() {
    if (editMode) editor.onOpenChange(false);
    setEditMode((active) => !active);
  }

  function beginAddPosition() {
    const account = accountId === "all"
      ? accounts[0]
      : accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      onAddAccount();
      return;
    }
    setEditMode(true);
    editor.show({ mode: "add", account });
  }

  function beginEditPosition(holding: ValuedAccountHolding) {
    setEditMode(true);
    editor.show({ mode: "edit", holding });
  }

  async function deletePosition(item: ValuedAccountHolding) {
    setBusy(true);
    setRemovals((count) => count + 1);
    try {
      await deleteJson(currentPositionUrl(item.accountId, item.position.instrument.id));
      const edited = editor.subject;
      if (edited?.mode === "edit" && holdingKey(edited.holding) === holdingKey(item)) editor.onOpenChange(false);
      await onChanged(`${item.position.instrument.symbol} removed.`);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      // Closed either way: a failure is shown on the page, which the dialog would cover.
      setPendingRemoval(null);
      setBusy(false);
    }
  }

  const showAccount = accountId === "all";
  const emptyMessage = query
    ? "Try a different ticker, asset name, or account."
    : accounts.length === 0
      ? "Create a local account, then import the positions it holds today."
      : "Add a position here or import a holdings file to see it in your portfolio.";

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div className="min-w-0">
          <CardTitle>Current positions</CardTitle>
          <CardDescription>
            {asOf ? `As of ${formatCalendarDate(asOf)}` : "Holdings appear here after your first import."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            disabled={accounts.length === 0 || busy}
            aria-pressed={editMode}
            onClick={toggleEditMode}
          >
            {editMode ? <CheckIcon /> : <PencilLineIcon />}
            {editMode ? "Done" : "Edit positions"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshing || loading}
            onClick={onRefresh}
          >
            <RefreshCwIcon className={refreshing ? "animate-spin" : ""} />
            Refresh prices
          </Button>
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Prices updated {formatClock(lastUpdated)}
            </span>
          )}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search holdings"
              className="h-8 w-52 pl-7"
              placeholder="Search holdings"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <NativeSelect
            aria-label="Filter account"
            value={accountId}
            onChange={(event) => onAccountChange(event.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        {editor.open && editor.subject ? (
          <PositionEditor
            key={editor.key}
            target={editor.subject}
            accounts={accounts}
            busy={busy}
            removals={removals}
            onBusyChange={setBusy}
            onSaved={async (notice) => {
              editor.onOpenChange(false);
              await onChanged(notice);
            }}
            onCancel={() => editor.onOpenChange(false)}
          />
        ) : null}
        {loading ? (
          <div className="grid gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState>
            <p>{emptyMessage}</p>
            {!query && (
              accounts.length > 0 ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button disabled={busy || editor.open} onClick={beginAddPosition}>
                    <PlusIcon /> Add position
                  </Button>
                  <Button variant="outline" onClick={onImport}>
                    Import holdings
                  </Button>
                </div>
              ) : (
                <Button className="mt-3" onClick={onAddAccount}>
                  <PlusIcon /> Add account
                </Button>
              )
            )}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Symbol</TableHead>
                    {showAccount && <TableHead scope="col">Account</TableHead>}
                    <TableHead scope="col" className="text-right">
                      Quantity
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Avg cost
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Price
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Market value
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Return
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Weight
                    </TableHead>
                    {editMode && (
                      <TableHead scope="col" className="w-24 text-right">
                        Actions
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((item) => (
                    <PositionRow
                      key={holdingKey(item)}
                      item={item}
                      showAccount={showAccount}
                      editMode={editMode}
                      busy={busy}
                      onSelect={() => onSelect(item)}
                      onEdit={() => beginEditPosition(item)}
                      onRemove={() => setPendingRemoval(item)}
                    />
                  ))}
                  {editMode && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={showAccount ? 9 : 8} className="p-2">
                        <Button
                          variant="ghost"
                          className="h-9 w-full justify-center border border-dashed text-muted-foreground hover:text-foreground"
                          disabled={busy || editor.open}
                          onClick={beginAddPosition}
                        >
                          <PlusIcon /> Add position
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              {visible.length} of {holdings.length} positions
            </p>
          </>
        )}

        {children}
      </CardContent>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove ${pendingRemoval?.position.instrument.symbol ?? "position"} from ${pendingRemoval?.accountName ?? "the account"}?`}
        description="The position is closed by a ledger adjustment, so your import history stays intact."
        confirmLabel="Remove position"
        pending={busy}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        onConfirm={() => pendingRemoval && void deletePosition(pendingRemoval)}
      />
    </Card>
  );
}
