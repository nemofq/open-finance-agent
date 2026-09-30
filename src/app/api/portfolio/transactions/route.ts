import { errorResponse, readJson } from "@/app/api/http";
import { portfolioDir } from "@/lib/paths";
import { addSimpleTransaction } from "@/lib/portfolio/manual";
import { simpleTransactionInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";

/** The buy / sell / dividend form. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, simpleTransactionInputSchema);
    const transaction = await addSimpleTransaction(createPortfolioStore(portfolioDir()), input);
    return Response.json({ transaction }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
