"use client";

import { useMemo, useState } from "react";
import { CircleDollarSignIcon, FileClockIcon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteJson } from "@/components/shared/http-client";
import { Notice, PageHeader, PageShell } from "@/components/shared/page-shell";
import { useDialogSubject } from "@/components/shared/use-dialog-subject";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { scopeCash, scopedTotals, scopeHoldings } from "@/lib/portfolio/scope";
import type { Account } from "@/lib/portfolio/types";
import type { ValuedAccountHolding } from "@/lib/portfolio/valuation";
import { errorMessage } from "@/lib/utils";
import { AccountDialog } from "./account-dialog";
import { AccountsSection } from "./accounts-section";
import { AssetDetailDialog } from "./asset-detail-dialog";
import { CashView } from "./cash-view";
import { PortfolioImportDialog } from "./import/portfolio-import-dialog";
import { PortfolioHistoryDialog } from "./portfolio-history-dialog";
import { PortfolioSummary } from "./portfolio-summary";
import { PositionsView } from "./positions-view";
import { TransactionDialog } from "./transaction-dialog";
import { useDashboard } from "./use-dashboard";

/**
 * The portfolio page, the one place holdings are edited: totals, positions and cash for one
 * account or all of them, the accounts themselves, and the dialogs that add and edit accounts,
 * record transactions, import holdings and show history. The data and its polling are
 * `useDashboard`'s; the scoping and the totals are `lib/portfolio/scope`'s.
 */
export function PortfolioPage() {
  const dashboard = useDashboard();
  const { accounts, holdings, cash, error, notice, setError, setNotice, reload } = dashboard;
  const [accountId, setAccountId] = useState("all");
  const accountDialog = useDialogSubject<Account>();
  const transactionDialog = useDialogSubject();
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<ValuedAccountHolding | null>(null);

  const scoped = useMemo(() => scopeHoldings(holdings, accountId), [accountId, holdings]);
  const scopedCash = useMemo(() => scopeCash(cash, accountId), [accountId, cash]);
  const totals = useMemo(
    () => scopedTotals(scoped, scopedCash, dashboard.valuationCurrency),
    [scoped, scopedCash, dashboard.valuationCurrency],
  );
  const initialAccountId = accountId === "all" ? accounts[0]?.id ?? "" : accountId;
  const addAccount = () => accountDialog.show();

  /** A write went through: say so and read everything again, keeping the cached quotes. */
  const changed = async (message: string) => {
    setNotice(message);
    await reload(false);
  };

  async function deleteAccount(account: Account) {
    setDeleting(true);
    try {
      await deleteJson(`/api/portfolio/accounts/${encodeURIComponent(account.id)}`);
      setPendingDelete(null);
      if (accountId === account.id) setAccountId("all");
      await changed(`Deleted ${account.name}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        icon={CircleDollarSignIcon}
        title="Portfolio"
        description="Your accounts and current positions, marked to market."
        actions={
          <>
            <Button
              variant="outline"
              disabled={accounts.length === 0}
              onClick={() => transactionDialog.show()}
            >
              <ReceiptTextIcon />
              Record transaction
            </Button>
            <Button
              variant="outline"
              disabled={accounts.length === 0}
              onClick={() => setHistoryOpen(true)}
            >
              <FileClockIcon />
              Import history
            </Button>
            <Button onClick={() => (accounts.length > 0 ? setImportOpen(true) : addAccount())}>
              <PlusIcon />
              Import holdings
            </Button>
          </>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}

      <PortfolioSummary totals={totals} />

      <PositionsView
        accounts={accounts}
        holdings={scoped}
        accountId={accountId}
        onAccountChange={setAccountId}
        asOf={dashboard.asOf}
        loading={dashboard.loading}
        refreshing={dashboard.refreshing}
        lastUpdated={dashboard.lastUpdated}
        onRefresh={() => {
          setNotice("");
          void reload(true);
        }}
        onChanged={changed}
        onError={setError}
        onSelect={setSelectedHolding}
        onAddAccount={addAccount}
        onImport={() => setImportOpen(true)}
      >
        <CashView cash={scopedCash} />
      </PositionsView>

      <Card>
        <CardContent>
          <AccountsSection
            accounts={accounts}
            onAdd={addAccount}
            onEdit={accountDialog.show}
            onDelete={setPendingDelete}
          />
        </CardContent>
      </Card>

      <AccountDialog
        key={`account-${accountDialog.key}`}
        open={accountDialog.open}
        initial={accountDialog.subject}
        onOpenChange={accountDialog.onOpenChange}
        onSaved={(account, created) => {
          if (created) setAccountId(account.id);
          void changed(created ? `Created ${account.name}. You can now import its holdings.` : `Saved ${account.name}.`);
        }}
      />
      {accounts.length > 0 && (
        <TransactionDialog
          key={`transaction-${transactionDialog.key}`}
          open={transactionDialog.open}
          accounts={accounts}
          initialAccountId={initialAccountId}
          onOpenChange={transactionDialog.onOpenChange}
          onRecorded={(symbol) => void changed(`Recorded a ${symbol} transaction.`)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? "account"}”?`}
        description="The account record is removed. Its transactions stay in the append-only ledger on disk. This cannot be undone."
        confirmLabel="Delete account"
        pending={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteAccount(pendingDelete)}
      />

      {importOpen && (
        <PortfolioImportDialog
          onOpenChange={setImportOpen}
          accounts={accounts}
          initialAccountId={initialAccountId}
          onCommitted={() => {
            setNotice("Import recorded. Current positions have been refreshed.");
            void reload(true);
          }}
        />
      )}
      {historyOpen && (
        <PortfolioHistoryDialog
          onOpenChange={setHistoryOpen}
          accounts={accounts}
          initialAccountId={initialAccountId}
        />
      )}
      <AssetDetailDialog
        holding={selectedHolding}
        allHoldings={holdings}
        sessions={dashboard.sessions}
        onClose={() => setSelectedHolding(null)}
      />
    </PageShell>
  );
}
