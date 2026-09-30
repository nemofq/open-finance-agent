import { z } from "zod";
import { llmProviderSchema, thinkingLevels } from "@/lib/config/schema";
import { readConfig } from "@/lib/config/store";
import { providerAuthGap } from "@/lib/llm";
import { testModel } from "@/lib/llm/test-model";
import { errorResponse, jsonError, readJson } from "@/app/api/http";
import { restoreDraftKey } from "@/lib/llm/draft";

const bodySchema = z.object({
  provider: llmProviderSchema,
  model: z.string().trim().min(1, "choose a model to test"),
  /** The page's draft thinking level; the saved one when left out. */
  thinkingLevel: z.enum(thinkingLevels).optional(),
});

/** One-shot completion proving the key, the model and the pi-ai path all work, for a drafted provider. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { provider: draft, model, thinkingLevel } = await readJson(request, bodySchema);
    const { llm } = readConfig();
    const provider = restoreDraftKey(draft, llm.providers);
    const gap = await providerAuthGap(provider);
    if (gap) return jsonError(gap.message, 400);
    return Response.json(await testModel(provider, model, thinkingLevel ?? llm.thinkingLevel));
  } catch (err) {
    return errorResponse(err);
  }
}
