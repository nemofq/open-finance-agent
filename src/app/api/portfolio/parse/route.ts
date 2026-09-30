import { errorResponse, jsonError } from "@/app/api/http";
import { checkTableBytes, TableTooLarge } from "@/lib/attachments/tables";
import { parseCsv, parsePastedTable, parseXlsx, suggestMapping } from "@/lib/portfolio/parser";
import type { ColumnMapping, RawTable } from "@/lib/portfolio/types";

type ParsedTable = RawTable & { mapping: ColumnMapping };

/**
 * Reads a holdings file or a pasted table and hands back its columns with a guess at what they
 * mean. Nothing is written here: the user checks the mapping, previews, and only then commits.
 *
 * A table comes back whole or not at all. One over the complete-table bounds (file size, rows,
 * columns) is refused with a 413 whose message names the limit, so the preview and the commit can
 * never be handed the first N rows of a longer file.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const text = form.get("text");

    if (file instanceof File) {
      const name = file.name.toLowerCase();
      if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) return jsonError("Only CSV and .xlsx files are supported.", 400);
      // `file.size` is checked before the body is read, so an oversized file is refused unparsed.
      checkTableBytes(file.size, file.name);
      if (name.endsWith(".xlsx")) return Response.json({ tables: (await parseXlsx(await file.arrayBuffer(), file.name)).map(withMapping) });
      return Response.json({ tables: [withMapping(parseCsv(await file.text(), file.name))] });
    }
    if (typeof text === "string" && text.trim()) {
      return Response.json({ tables: [withMapping(parsePastedTable(text))] });
    }
    return jsonError("Provide a CSV or .xlsx file, or a pasted table.", 400);
  } catch (err) {
    if (err instanceof TableTooLarge) return jsonError(err.message, 413);
    return errorResponse(err);
  }
}

function withMapping(table: RawTable): ParsedTable {
  return { ...table, mapping: suggestMapping(table.headers) };
}
