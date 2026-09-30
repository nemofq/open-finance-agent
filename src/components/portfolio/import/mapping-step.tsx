import { CheckIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnMapping, CostBasisMode } from "@/lib/portfolio/types";
import { editFields, fieldLabels, type ImportState } from "./import-workflow";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Which worksheet, which header row, and what each column means. Changing the worksheet or the
 * header row starts the mapping over; a mapping can be corrected by hand or suggested by the model.
 */
export function MappingStep({
  state,
  onSheet,
  onHeaderRow,
  onMap,
  onCostBasisMode,
  onAssist,
  onPreview,
}: {
  state: ImportState;
  onSheet: (sheetName: string) => void;
  onHeaderRow: (index: number) => void;
  onMap: (field: keyof ColumnMapping, header: string) => void;
  onCostBasisMode: (mode: CostBasisMode) => void;
  onAssist: () => void;
  onPreview: () => void;
}) {
  const { tables, table, headerIndex, mapping, costBasisMode, busy } = state;
  return (
    <>
      {tables.length > 1 ? (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Worksheet
          <NativeSelect
            value={table?.sheetName ?? ""}
            onChange={(event) => onSheet(event.target.value)}
          >
            {tables.map((item) => (
              <option key={item.sheetName} value={item.sheetName}>{item.sheetName}</option>
            ))}
          </NativeSelect>
        </label>
      ) : null}

      {table?.allRows && table.allRows.length > 1 ? (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Header row
          <NativeSelect
            value={headerIndex}
            onChange={(event) => onHeaderRow(Number(event.target.value))}
          >
            {table.allRows.slice(0, 10).map((row, index) => (
              <option key={index} value={index}>Row {index + 1}: {row.join(" · ").slice(0, 100)}</option>
            ))}
          </NativeSelect>
        </label>
      ) : null}

      {table ? (
        <section className="grid gap-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Column mapping</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {table.rows.length} source rows · USD is set automatically
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={onAssist}>
              <SparklesIcon /> Assist mapping
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {editFields.map((field) => (
              <label key={field} className="grid gap-1 text-xs text-muted-foreground">
                {fieldLabels[field]}
                <NativeSelect value={mapping[field] ?? ""} onChange={(event) => onMap(field, event.target.value)}>
                  <option value="">None</option>
                  {table.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </NativeSelect>
              </label>
            ))}
            <label className="grid gap-1 text-xs text-muted-foreground">
              Cost basis type
              <NativeSelect
                value={costBasisMode}
                onChange={(event) => onCostBasisMode(event.target.value as CostBasisMode)}
              >
                <option value="total">Total cost</option>
                <option value="per_unit">Per-unit cost</option>
              </NativeSelect>
            </label>
          </div>
          <div className="flex justify-end">
            <Button disabled={busy} onClick={onPreview}>
              <CheckIcon /> Generate preview
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
