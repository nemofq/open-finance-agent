import { errorResponse, jsonError } from "@/app/api/http";
import { recentTickerSnapshot } from "@/lib/tickers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const symbol = decodeURIComponent((await params).symbol ?? "").trim().toUpperCase();
  if (!symbol) return jsonError("Missing ticker symbol", 400);

  try {
    return Response.json(await recentTickerSnapshot(symbol));
  } catch (err) {
    return errorResponse(err);
  }
}
