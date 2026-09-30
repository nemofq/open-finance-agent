import { builtinModules, toModuleSummary } from "@/lib/tools/registry";
import { errorResponse } from "@/app/api/http";

/** Every registered module's form definition; the settings pages filter these by `kind`. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ modules: builtinModules.map(toModuleSummary) });
  } catch (err) {
    return errorResponse(err);
  }
}
