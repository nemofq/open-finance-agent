import { errorResponse } from "@/app/api/http";
import { searchSymbols } from "@/lib/tickers";

/** Backs the composer's `$` autocomplete. */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json(await searchSymbols(query, 8));
  } catch (err) {
    return errorResponse(err);
  }
}
