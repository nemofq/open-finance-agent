import { z } from "zod";
import { llmProviderSchema } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { draftModels } from "@/lib/llm/models";
import { errorResponse, readJson } from "@/app/api/http";
import { providerDefinition } from "@/lib/llm/providers";
import { restoreDraftKey } from "@/lib/llm/draft";

const bodySchema = z.object({ provider: llmProviderSchema });

/** Check a provider as drafted on the settings page (unsaved edits included) without spending tokens. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { provider: draft } = await readJson(request, bodySchema);
    const provider = restoreDraftKey(draft, readConfig().llm.providers);
    return Response.json(await providerDefinition(provider).validate(provider, draftModels(provider)));
  } catch (err) {
    return errorResponse(err);
  }
}
