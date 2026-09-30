import { errorResponse, readJson } from "@/app/api/http";
import { acceptedPositions, normalizeRows } from "@/lib/portfolio/parser";
import { previewInputSchema } from "@/lib/portfolio/schema";

/**
 * Every source row as it would be read, with its warnings and errors, plus the rows that are ready
 * to commit. v1 imports one currency: every row is read in USD, whatever a currency column says.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, previewInputSchema);
    const preview = normalizeRows(input.table, input.mapping, input.costBasisMode, input.excludedRows);
    return Response.json({
      preview,
      positions: acceptedPositions(preview),
      errors: preview.flatMap((row) => row.errors.map((message) => `Row ${row.rowNumber}: ${message}`)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
