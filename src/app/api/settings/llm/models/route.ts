import { readConfig } from "@/lib/config/store";
import { listProviderModels } from "@/lib/llm";
import type { LlmModelsResponse } from "@/lib/llm/types";
import { errorResponse } from "@/app/api/http";

/** Every saved provider's models and the default model. */
export async function GET(): Promise<Response> {
  try {
    const config = readConfig();
    const body: LlmModelsResponse = {
      defaultModel: config.llm.defaultModel,
      providers: await listProviderModels(config),
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
