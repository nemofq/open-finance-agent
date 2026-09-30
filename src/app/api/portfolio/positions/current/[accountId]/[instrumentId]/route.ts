import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { requestToday } from "@/app/api/portfolio/request";
import { portfolioDir } from "@/lib/paths";
import { CurrentPositionConflictError, CurrentPositionNotFoundError, editCurrentPosition, removeCurrentPosition } from "@/lib/portfolio/manual";
import { manualPositionInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

type Context = { params: Promise<{ accountId: string; instrumentId: string }> };

/** Update the current position in place while preserving the old ledger records. */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  try {
    const input = await readJson(request, manualPositionInputSchema);
    const { accountId, instrumentId } = await params;
    if (input.accountId !== accountId) return jsonError("Account in the path and body must match.", 400);
    const transactions = await editCurrentPosition(createPortfolioStore(portfolioDir()), instrumentId, input, requestToday(request));
    return Response.json({ transactions });
  } catch (err) {
    if (err instanceof CurrentPositionNotFoundError) return jsonError(err.message, 404);
    if (err instanceof CurrentPositionConflictError) return jsonError(err.message, 409);
    return errorResponse(err);
  }
}

/** Remove the current position by appending a zero adjustment to the ledger. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  try {
    const { accountId, instrumentId } = await params;
    const transaction = await removeCurrentPosition(
      createPortfolioStore(portfolioDir()),
      accountId,
      instrumentId,
      requestToday(request),
    );
    return Response.json({ transaction });
  } catch (err) {
    if (err instanceof CurrentPositionNotFoundError) return jsonError(err.message, 404);
    return errorResponse(err);
  }
}
