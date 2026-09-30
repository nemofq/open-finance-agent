import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { portfolioDir } from "@/lib/paths";
import { accountPatchSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  try {
    const patch = await readJson(request, accountPatchSchema);
    const account = await createPortfolioStore(portfolioDir()).updateAccount((await params).id, patch);
    return account ? Response.json({ account }) : jsonError("Account not found", 404);
  } catch (err) {
    return errorResponse(err);
  }
}

/** The account's transactions stay in the append-only ledger; only the account record goes. */
export async function DELETE(_request: Request, { params }: Context): Promise<Response> {
  try {
    const deleted = await createPortfolioStore(portfolioDir()).deleteAccount((await params).id);
    return deleted ? Response.json({ ok: true }) : jsonError("Account not found", 404);
  } catch (err) {
    return errorResponse(err);
  }
}
