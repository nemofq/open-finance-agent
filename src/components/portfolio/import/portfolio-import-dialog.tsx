"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ClipboardPasteIcon, FileSpreadsheetIcon } from "lucide-react";
import { StatusLine } from "@/components/shared/field-row";
import { Notice } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Account } from "@/lib/portfolio/types";
import { errorMessage } from "@/lib/utils";
import {
  canCommit,
  chooseAccount,
  chooseHeaderRow,
  chooseSheet,
  commitPositions,
  committed,
  confirm,
  editCell,
  excludeRow,
  failed,
  initialImport,
  loaded,
  mapColumn,
  mappingSuggested,
  parseSource,
  previewed,
  previewing,
  removeRow,
  requestMapping,
  requestPreview,
  setCostBasisMode,
  started,
} from "./import-workflow";
import { MappingStep } from "./mapping-step";
import { PreviewStep } from "./preview-step";
import { NativeSelect } from "@/components/ui/native-select";

const fileInputClass =
  "mt-3 w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-foreground";

/** One of the two import sources: a file or a pasted broker table. */
function SourcePanel({ icon, title, hint, dashed, children }: {
  icon: ReactNode;
  title: string;
  hint: string;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-lg border p-4 ${dashed ? "border-dashed" : ""}`}>
      {icon}
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

/**
 * Import current holdings into one account: pick a source, map its columns, review the preview
 * and confirm. The stages and their rules are `import-workflow.ts`'s; this dialog holds the state,
 * runs the requests and lays the steps out.
 */
export function PortfolioImportDialog({ onOpenChange, accounts, initialAccountId, onCommitted }: {
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  initialAccountId: string;
  onCommitted: () => void;
}) {
  const [state, setState] = useState(() => initialImport(initialAccountId));
  const [paste, setPaste] = useState("");
  const { busy, status, isError, previewErrors, draftErrors } = state;

  async function parseInput(input: FormData) {
    setState(started);
    try {
      const tables = await parseSource(input);
      setState((current) => loaded(current, tables));
    } catch (cause) {
      setState((current) => failed(current, errorMessage(cause)));
    }
  }

  async function preview() {
    if (!state.table) return;
    const request = requestPreview(state);
    setState(previewing);
    try {
      const body = await request;
      setState((current) => previewed(current, body));
    } catch (cause) {
      setState((current) => failed(current, errorMessage(cause)));
    }
  }

  async function assistMapping() {
    const table = state.table;
    if (!table) return;
    setState(started);
    try {
      const mapping = await requestMapping(table);
      setState((current) => mappingSuggested(current, mapping));
    } catch (cause) {
      setState((current) => failed(current, errorMessage(cause)));
    }
  }

  async function commit() {
    const checked = confirm(state);
    if (checked.ready === null) {
      setState(checked.state);
      return;
    }
    setState(started(checked.state));
    try {
      await commitPositions(checked.state, checked.ready);
      setState(committed);
      onOpenChange(false);
      onCommitted();
    } catch (cause) {
      setState((current) => failed(current, errorMessage(cause)));
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,48rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import current holdings</DialogTitle>
          <DialogDescription>
            The import records what the file states as of today: every position it lists is adjusted to the
            file&apos;s numbers, and a position an earlier import created but this file omits is closed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Target account
            <NativeSelect
              value={state.accountId}
              onChange={(event) => {
                const accountId = event.target.value;
                setState((current) => chooseAccount(current, accountId));
              }}
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </NativeSelect>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <SourcePanel
              dashed
              icon={<FileSpreadsheetIcon className="size-5 text-muted-foreground" />}
              title="Upload CSV or Excel"
              hint="Select a .csv or .xlsx file"
            >
              <input
                aria-label="Upload holdings file"
                type="file"
                accept=".csv,.xlsx"
                className={fileInputClass}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  void parseInput(form);
                }}
              />
            </SourcePanel>

            <SourcePanel
              icon={<ClipboardPasteIcon className="size-5 text-muted-foreground" />}
              title="Paste a broker table"
              hint="Tabs or comma-separated values"
            >
              <Button
                variant="outline"
                size="sm"
                className="mt-auto w-full"
                disabled={!paste.trim() || busy}
                onClick={() => { const form = new FormData(); form.append("text", paste); void parseInput(form); }}
              >
                Parse pasted table
              </Button>
            </SourcePanel>

          </div>

          <Textarea
            aria-label="Paste holdings table"
            className="min-h-20 bg-background"
            placeholder="Paste a holdings table here, then select Parse pasted table"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
          />

          <MappingStep
            state={state}
            onSheet={(sheetName) => setState((current) => chooseSheet(current, sheetName))}
            onHeaderRow={(index) => setState((current) => chooseHeaderRow(current, index))}
            onMap={(field, header) => setState((current) => mapColumn(current, field, header))}
            onCostBasisMode={(mode) => setState((current) => setCostBasisMode(current, mode))}
            onAssist={() => void assistMapping()}
            onPreview={() => void preview()}
          />

          <PreviewStep
            state={state}
            onExclude={(rowNumber, excluded) => setState((current) => excludeRow(current, rowNumber, excluded))}
            onEdit={(index, field, value) => setState((current) => editCell(current, index, field, value))}
            onRemove={(index) => setState((current) => removeRow(current, index))}
          />

          {status ? <Notice tone={isError ? "error" : "info"}>{status}</Notice> : null}
          {previewErrors.length > 0 ? <StatusLine ok={false}>{previewErrors.join(" ")}</StatusLine> : null}
          {draftErrors.length > 0 ? (
            <ul className="grid gap-1 text-xs text-destructive">
              {draftErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">Confirm only after reviewing every position.</p>
            <Button disabled={!canCommit(state) || busy} onClick={() => void commit()}>
              Confirm import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
