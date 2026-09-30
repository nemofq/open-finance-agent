import { errorResponse, jsonError } from "@/app/api/http";
import { requestToday } from "@/app/api/portfolio/request";
import { currentPortfolio } from "@/lib/portfolio/current";

/** Symbols reach this route from a chat chip, so the shape is checked before it becomes a filter. */
const SYMBOL = /^[A-Za-z0-9.\-]{1,32}$/;

/** The positions and cash the ledger replays to, per account, valued at live prices. */
export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const symbol = query.get("symbol")?.trim();
    if (symbol && !SYMBOL.test(symbol)) return jsonError("Invalid symbol.", 400);

    return Response.json(
      await currentPortfolio({
        today: requestToday(request),
        symbol: symbol || undefined,
        refresh: query.get("refresh") === "true",
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
