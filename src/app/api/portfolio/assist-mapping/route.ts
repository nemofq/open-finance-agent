import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { assistMapping } from "@/lib/portfolio/assist-mapping";
import { assistMappingInputSchema } from "@/lib/portfolio/schema";

/** Suggest which column holds which field; the user confirms the mapping before anything is imported. */
export async function POST(request: Request): Promise<Response> {
  try {
    const result = await assistMapping(await readJson(request, assistMappingInputSchema));
    return result.ok ? Response.json({ mapping: result.mapping }) : jsonError(result.message, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
