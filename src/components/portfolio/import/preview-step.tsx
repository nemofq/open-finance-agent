import { AlertTriangleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type EditableField, editFields, fieldLabels, flaggedRows, type ImportState } from "./import-workflow";

/**
 * What the preview found: source rows to exclude or fix at the source, and the accepted positions
 * as editable cells. Rows are keyed by position and edited in place, so the input being typed in
 * keeps its focus.
 */
export function PreviewStep({
  state,
  onExclude,
  onEdit,
  onRemove,
}: {
  state: ImportState;
  onExclude: (rowNumber: number, excluded: boolean) => void;
  onEdit: (index: number, field: EditableField, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const flagged = flaggedRows(state);
  const { rows, excludedRows } = state;
  return (
    <>
      {flagged.length > 0 ? (
        <section className="rounded-lg border border-amber-500/30 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangleIcon className="size-4 text-amber-600" /> Rows needing attention
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Correct the source or mapping, or exclude summary and invalid rows. Preview again after changes.
          </p>
          <div className="mt-3 grid gap-2">
            {flagged.map((row) => (
              <label key={row.rowNumber} className="flex items-start gap-3 rounded-lg border p-3 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={excludedRows.includes(row.rowNumber)}
                  onChange={(event) => onExclude(row.rowNumber, event.target.checked)}
                />
                <span>
                  <strong>Exclude row {row.rowNumber}</strong>
                  <span className="ml-2 text-muted-foreground">{row.errors.join(" ")}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Review positions</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {rows.length} positions · all values in USD · recorded as of today
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[780px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {editFields.map((field) => <TableHead key={field}>{fieldLabels[field]}</TableHead>)}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    {editFields.map((field) => (
                      <TableCell key={field}>
                        <Input
                          aria-label={`${field} row ${index + 1}`}
                          className="h-8 min-w-24 bg-background text-xs"
                          value={row[field]}
                          onChange={(event) => onEdit(index, field, event.target.value)}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove position ${index + 1}`}
                        onClick={() => onRemove(index)}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}
