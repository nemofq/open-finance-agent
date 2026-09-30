import { errorResponse, readJson } from "@/app/api/http";
import { requestToday } from "@/app/api/portfolio/request";
import { portfolioDir } from "@/lib/paths";
import { commitImport } from "@/lib/portfolio/import";
import { commitImportInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

/**
 * Writes the reviewed rows onto the ledger as one import batch. Sending the same idempotency key
 * again returns the batch that was already written and changes nothing, so a retried request
 * cannot double a position.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, commitImportInputSchema);
    const result = await commitImport(createPortfolioStore(portfolioDir()), input, requestToday(request));
    return Response.json(
      { batch: result.batch, reused: result.reused, transactionCount: result.transactions.length },
      { status: result.reused ? 200 : 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
