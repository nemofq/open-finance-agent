import { errorResponse, jsonError } from "@/app/api/http";
import { portfolioDir } from "@/lib/paths";
import { createPortfolioStore } from "@/lib/portfolio/store";

type Context = { params: Promise<{ accountId: string }> };

/** Every import made into one account: the history the Portfolio page compares. */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  try {
    const { accountId } = await params;
    const store = createPortfolioStore(portfolioDir());
    if (!(await store.listAccounts()).some((account) => account.id === accountId)) return jsonError("Account not found", 404);
    const batches = await store.listImportBatches(accountId);
    // Newest first: the history list reads top-down and the newest import is the current one.
    return Response.json({ batches: [...batches].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)) });
  } catch (err) {
    return errorResponse(err);
  }
}
