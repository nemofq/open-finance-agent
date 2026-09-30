import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { portfolioDir } from "@/lib/paths";
import { compareBatches } from "@/lib/portfolio/import";
import { compareInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

/** What changed in one account between two of its imports. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, compareInputSchema);
    const comparison = await compareBatches(createPortfolioStore(portfolioDir()), input.accountId, input.beforeBatchId, input.afterBatchId);
    return comparison ? Response.json({ comparison }) : jsonError("No import with that id in this account.", 404);
  } catch (err) {
    return errorResponse(err);
  }
}
