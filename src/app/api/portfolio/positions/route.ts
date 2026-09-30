import { errorResponse, readJson } from "@/app/api/http";
import { requestToday } from "@/app/api/portfolio/request";
import { portfolioDir } from "@/lib/paths";
import { addManualPosition } from "@/lib/portfolio/manual";
import { manualPositionInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

/** Add a position by hand; it is stored as an `opening_balance` transaction. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, manualPositionInputSchema);
    const transaction = await addManualPosition(createPortfolioStore(portfolioDir()), input, requestToday(request));
    return Response.json({ transaction }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
